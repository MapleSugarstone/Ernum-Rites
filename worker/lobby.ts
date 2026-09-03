import { DurableObject } from 'cloudflare:workers';
import { isPartyName, roomName } from './roomname';

/**
 * The front desk. One instance for the whole deployment, so it is the single
 * place that knows which room a waiting player is sitting in.
 *
 * It hands out room names and nothing else. Matches themselves live in MatchRoom
 * and this object never sees a game state, which keeps the busiest object in the
 * deployment cheap.
 */

/** A public room with one player in it, waiting to be paired. */
interface Open {
  roomId: string;
  /** Dropped if nobody joins by then: a player who closed the tab leaves a ghost. */
  expiresAt: number;
}

/** How long a waiting room survives without a second player. */
const OPEN_ROOM_MS = 2 * 60 * 1000;
/** How long a private code is good for before the host has to make a new one. */
const CODE_MS = 15 * 60 * 1000;
/**
 * Party lobbies gather slowly: the code makes its way around a group chat and
 * the last player can be many minutes behind the first. So their codes start
 * with a longer clock, and every guest who joins winds it up again.
 */
const PARTY_CODE_MS = 60 * 60 * 1000;

/**
 * Most live codes to hold at once. Hosting is unauthenticated, so a script can
 * ask for codes in a loop; without a ceiling the map grows until each one
 * expires. Far above any real number of private lobbies, so it only bites abuse.
 */
const MAX_CODES = 5000;

/** No vowels and no look-alikes, so a code read aloud survives the trip. */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

function makeCode(): string {
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** A private room reachable only by its code. */
interface CodeEntry {
  roomId: string;
  expiresAt: number;
}

export class Lobby extends DurableObject {
  /**
   * Cached in memory but owned by storage. Nothing keeps this object alive
   * between requests the way a socket keeps a MatchRoom alive, so it is evicted
   * within seconds of going idle and rebuilt empty. Held only in fields, the
   * room a player is waiting in and every code handed out die with it, and two
   * players arriving seconds apart never meet.
   */
  private open: Open | null = null;
  private codes = new Map<string, CodeEntry>();
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.open = (await this.ctx.storage.get<Open>('open')) ?? null;
    this.codes = new Map((await this.ctx.storage.get<[string, CodeEntry][]>('codes')) ?? []);
    this.loaded = true;
  }

  private async save(): Promise<void> {
    if (this.open) await this.ctx.storage.put('open', this.open);
    else await this.ctx.storage.delete('open');
    await this.ctx.storage.put('codes', [...this.codes]);
  }

  private sweep(): void {
    const now = Date.now();
    if (this.open && this.open.expiresAt < now) this.open = null;
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(code);
    }
  }

  /**
   * Pair with whoever is waiting, or become the one waiting. Returns the room to
   * open a socket against either way; the caller cannot tell which happened, and
   * does not need to.
   */
  async findPublic(): Promise<{ roomId: string }> {
    await this.load();
    this.sweep();
    if (this.open) {
      const roomId = this.open.roomId;
      this.open = null;
      await this.save();
      return { roomId };
    }
    const roomId = `pub-${crypto.randomUUID()}`;
    this.open = { roomId, expiresAt: Date.now() + OPEN_ROOM_MS };
    await this.save();
    return { roomId };
  }

  /**
   * Creates a room that only a player with the code can find, or returns null
   * when too many rooms are live. The party size and the timer setting are both
   * encoded in the room's name, because MatchRoom reads them from its own id.
   * A modified client can therefore only affect a room nobody else can reach.
   */
  async hostPrivate(
    size?: 3 | 4,
    noTimers = false,
    draft = false,
  ): Promise<{ roomId: string; code: string } | null> {
    await this.load();
    this.sweep();
    if (this.codes.size >= MAX_CODES) {
      await this.save();
      return null;
    }
    let code = makeCode();
    // Vanishingly unlikely, but a collision would put two matches in one room.
    while (this.codes.has(code)) code = makeCode();
    const roomId = roomName({ size, noTimers, draft }, crypto.randomUUID());
    this.codes.set(code, { roomId, expiresAt: Date.now() + (size ? PARTY_CODE_MS : CODE_MS) });
    await this.save();
    return { roomId, code };
  }

  async joinPrivate(code: string): Promise<{ roomId: string } | null> {
    await this.load();
    this.sweep();
    const entry = this.codes.get(code.toUpperCase());
    if (!entry) {
      // The sweep may have dropped expired codes, which is worth keeping.
      await this.save();
      return null;
    }
    // The code is not spent here. This runs before the guest has opened a socket,
    // let alone been seated, so every refusal the room can still make, a version
    // mismatch above all, used to leave them holding a dead code and reading
    // "Lobby not found" on the retry they had just been told to make. The room's
    // own "room is full" answer is what turns away anyone extra, which is how a
    // party code has always worked, so a head-to-head one can live out its clock
    // the same way.
    entry.expiresAt = Date.now() + (isPartyName(entry.roomId) ? PARTY_CODE_MS : CODE_MS);
    await this.save();
    return { roomId: entry.roomId };
  }

  /** A host who backs out before anyone arrives. */
  async cancel(code: string): Promise<void> {
    await this.load();
    this.codes.delete(code.toUpperCase());
    await this.save();
  }

  /** A player who leaves the random queue rather than wait it out. */
  async leavePublic(roomId: string): Promise<void> {
    await this.load();
    if (this.open?.roomId === roomId) {
      this.open = null;
      await this.save();
    }
  }
}
