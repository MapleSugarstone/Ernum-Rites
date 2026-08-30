import { DurableObject } from 'cloudflare:workers';

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

/** No vowels and no look-alikes, so a code read aloud survives the trip. */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';

function makeCode(): string {
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export class Lobby extends DurableObject {
  /** At most one room waiting for a random opponent at a time. */
  private open: Open | null = null;
  private codes = new Map<string, { roomId: string; expiresAt: number }>();

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
    this.sweep();
    if (this.open) {
      const roomId = this.open.roomId;
      this.open = null;
      return { roomId };
    }
    const roomId = `pub-${crypto.randomUUID()}`;
    this.open = { roomId, expiresAt: Date.now() + OPEN_ROOM_MS };
    return { roomId };
  }

  /** A room only somebody holding the code can find. */
  async hostPrivate(): Promise<{ roomId: string; code: string }> {
    this.sweep();
    let code = makeCode();
    // Vanishingly unlikely, but a collision would put two matches in one room.
    while (this.codes.has(code)) code = makeCode();
    const roomId = `prv-${crypto.randomUUID()}`;
    this.codes.set(code, { roomId, expiresAt: Date.now() + CODE_MS });
    return { roomId, code };
  }

  async joinPrivate(code: string): Promise<{ roomId: string } | null> {
    this.sweep();
    const entry = this.codes.get(code.toUpperCase());
    if (!entry) return null;
    // A code is good for one guest. Leaving it live would let a third player
    // knock on a room that is already full.
    this.codes.delete(code.toUpperCase());
    return { roomId: entry.roomId };
  }

  /** A host who backs out before anyone arrives. */
  async cancel(code: string): Promise<void> {
    this.codes.delete(code.toUpperCase());
  }

  /** A player who leaves the random queue rather than wait it out. */
  async leavePublic(roomId: string): Promise<void> {
    if (this.open?.roomId === roomId) this.open = null;
  }
}
