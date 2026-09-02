import { DurableObject } from 'cloudflare:workers';
import '../src/cards';
import { deckByKey, hasDeck } from '../src/cards';
import { deckProblems } from '../src/engine/decklist';
import {
  autofill,
  draftDeckLegal,
  DRAFT_SECONDS,
  PACK_COUNT,
  rollPacks,
  withinPool,
} from '../src/engine/draft';
import type { Action } from '../src/engine/actions';
import { applyAction, createGame } from '../src/engine/engine';
import { digestShort } from '../src/engine/digest';
import { publicView, redactFor } from '../src/engine/redact';
import { currentActor, isOver, type GameState } from '../src/engine/state';
import { timeoutAction } from '../src/engine/timeout';
import {
  clockKindFor,
  enforcedMs,
  isCardPlay,
  NETWORK_GRACE_SECONDS,
  playBonusMs,
  type Clock,
} from '../src/engine/timing';
import type { PlayerIdx } from '../src/engine/types';
import { BUILD_VERSION } from '../src/version';
import { nameProblem } from './protocol';
import type { ClientMessage, RoomKind, ServerMessage } from './protocol';
import { draftFor, seatCountFor, timersOffFor } from './roomname';

interface Seat {
  /** Null once a party player drops mid-match: the seat stays, the socket goes. */
  socket: WebSocket | null;
  name: string;
  deckKey: string;
  /** Set only for a deck the room cannot look up, already checked as legal. */
  deck?: { leaderId: string; cards: string[] };
  /** Set only in a draft room: the eighty cards this seat opened, and its build. */
  draft?: DraftSeat;
}

/** What one player is doing with their packs while the draft clock runs. */
interface DraftSeat {
  packs: string[][];
  /** Packs the client says it has looked at. A short count is what boots. */
  opened: number;
  /** The build as it last stood, kept so a clock that runs out can finish it. */
  leaderId: string;
  cards: string[];
  /** True once they called it finished, which is what the room waits for. */
  done: boolean;
}

/**
 * One match. This object is the authority: clients send intents, it runs the
 * shared rules engine and pushes each side a redacted view of the result.
 *
 * It is also the only clock. Timers cannot live on the clients, because the
 * player being timed is exactly the person who benefits from a slow one.
 */
export class MatchRoom extends DurableObject {
  private seats: (Seat | null)[] = Array.from(
    { length: seatCountFor(this.ctx.id.name) },
    () => null,
  );
  private state: GameState | null = null;
  private clock: Clock | null = null;
  /**
   * What the active player's main phase still has left. Banked whenever a
   * response window takes the clock over, so answering something costs the
   * window's time rather than the turn's, and the turn picks up where it was.
   */
  private turnLeftMs = 0;
  /** The total time this turn was granted, play bonuses included, for the bar. */
  private turnTotalMs = 0;
  /** Which turn the bank belongs to. A different one refills it. */
  private turnKey = '';
  /** Cards the active player has played this turn, which the bonus decreases on. */
  private turnPlays = 0;
  /** True when the host asked for a room without timers. */
  private readonly timersOff = timersOffFor(this.ctx.id.name);
  /** True when the host asked for a draft, which runs before the match. */
  private readonly drafting = draftFor(this.ctx.id.name);
  /** When the draft clock empties, as the players see it. Null outside a draft. */
  private draftEndsAt: number | null = null;
  private kind: RoomKind = 'public';
  private code: string | undefined;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }
    const url = new URL(request.url);
    this.kind = url.searchParams.get('kind') === 'private' ? 'private' : 'public';
    this.code = url.searchParams.get('code') ?? undefined;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private attach(socket: WebSocket): void {
    socket.addEventListener('message', (ev) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ClientMessage;
      } catch {
        return this.send(socket, { type: 'error', reason: 'malformed message' });
      }
      // Guarded here rather than path by path. An unhandled rejection out of a
      // socket handler is what the runtime turns into a dead connection, and
      // the player who sent the message is the one who loses it with no idea
      // why: their opponents see nothing at all. Guarding the dispatch covers
      // every path under it, including the ones nobody has written yet.
      void this.handle(socket, msg).catch((err) => {
        console.error('handle threw', msg?.type, err);
        // Rejected rather than error: a bug in the room is not a reason to end
        // somebody's session, and the client shows this without leaving.
        this.send(socket, {
          type: 'rejected',
          reason: `The server hit a bug handling that: ${
            err instanceof Error ? err.message : String(err)
          }`,
          version: this.state?.version ?? 0,
        });
      });
    });
    socket.addEventListener('close', (ev) => {
      void this.handleClose(socket, `code ${ev.code}${ev.wasClean ? ' clean' : ''}`).catch((err) => {
        console.error('handleClose threw', err);
      });
    });
  }

  private async handleClose(socket: WebSocket, how = 'unknown'): Promise<void> {
    const idx = this.seats.findIndex((s) => s?.socket === socket);
    if (idx < 0) return;
    // Left in the log for `wrangler tail ernum-rites-server`, because the player
    // this happens to is the one who cannot see it: their opponent is told the
    // seat was vacated while their own end may never learn its socket went. The
    // turn is here because a drop at a turn boundary and a drop mid-turn are
    // different faults.
    console.log(
      'seat closed',
      JSON.stringify({
        room: this.ctx.id.name ?? this.ctx.id.toString(),
        seat: idx,
        name: this.seats[idx]?.name ?? '',
        seats: this.seats.length,
        started: this.state !== null,
        turn: this.state?.turn ?? null,
        active: this.state?.active ?? null,
        drafting: this.draftEndsAt !== null,
        // 1006 is a connection that died with nothing said, which is the one
        // the player on the other end never learns about.
        how,
      }),
    );
    if (this.seats.length === 2) {
      this.seats[idx] = null;
      this.clock = null;
      this.draftEndsAt = null;
      await this.ctx.storage.deleteAlarm();
      this.broadcast({ type: 'opponentLeft' });
      return;
    }
    // A party room. Before the match starts a drop just frees the seat.
    const seat = idx as PlayerIdx;
    if (this.state === null) {
      this.seats[idx] = null;
      // A drop mid-draft leaves the rest to their packs rather than sending
      // them back to the lobby: the clock is still running and their pools are
      // still theirs. The seats close up when the draft ends.
      if (this.draftEndsAt !== null) this.broadcastDraftStatus();
      else this.broadcastWaiting();
      return;
    }
    // Mid-match the seat stays so the roster keeps its shape; the socket goes,
    // and a player still in the game concedes, which eliminates them and
    // leaves everyone else playing.
    const gone = this.seats[idx]!;
    gone.socket = null;
    if (this.state.winner !== null || this.state.drawn) return;
    if (this.state.players[seat].eliminated) return;
    this.broadcast({ type: 'playerLeft', seat, name: gone.name });
    try {
      const result = applyAction(this.state, seat, { type: 'CONCEDE' });
      if (result.ok) {
        this.state = result.state;
        await this.restartClock();
        this.pushState({ action: { type: 'CONCEDE' }, actor: seat });
      }
    } catch (err) {
      console.error('concede applyAction threw', err);
    }
  }

  /** The lobby roster, sent to everyone already seated while the room fills. */
  private broadcastWaiting(): void {
    const seated = this.seats.filter((s): s is Seat => s !== null);
    const msg: ServerMessage = {
      type: 'waiting',
      players: seated.length,
      needed: this.seats.length,
      names: seated.map((s) => s.name),
      ...(this.code ? { code: this.code } : {}),
    };
    for (const s of seated) {
      if (s.socket) this.send(s.socket, msg);
    }
  }

  private async handle(socket: WebSocket, msg: ClientMessage): Promise<void> {
    // Free of the match, and answered even before anyone is seated.
    if (msg.type === 'ping') {
      return this.send(socket, { type: 'pong', sent: msg.sent, now: Date.now() });
    }

    if (msg.type === 'join') {
      // A modified client can send anything, so the fields are checked for shape
      // before they are used: nameProblem trims the name, and an unknown deck key
      // would otherwise throw when startMatch rebuilds the deck and wedge the
      // match for the honest opponent it was paired with.
      if (
        typeof msg.name !== 'string' ||
        typeof msg.deckKey !== 'string' ||
        typeof msg.version !== 'string'
      ) {
        return this.send(socket, { type: 'error', reason: 'malformed join' });
      }
      // Checked here as well as in the lobby: the name reaches the other player,
      // so the room does not take a client's word for it.
      const bad = nameProblem(msg.name);
      if (bad) return this.send(socket, { type: 'error', reason: bad });
      // A deck the room knows by key is rebuilt from it. Anything else is one the
      // player built, which lives in their browser, so it arrives with the join
      // and is checked here against the same rules the builder enforces. The
      // check is the point: the cards come from the client and nothing else in
      // the room ever looks at them again.
      // A draft room deals every card itself, so the deck a player arrives
      // with is not the deck they will play and there is nothing to check. It
      // is left unchecked rather than merely ignored: refusing a seat over a
      // deck the room is about to throw away would turn a half-built deck into
      // a locked door.
      if (!this.drafting && !hasDeck(msg.deckKey)) {
        if (!msg.deck) {
          return this.send(socket, {
            type: 'error',
            reason: 'That deck could not be read. Open the deckbuilder, save it again, and retry.',
          });
        }
        const faults = deckProblems(msg.deck.leaderId, msg.deck.cards);
        if (faults.length > 0) {
          return this.send(socket, {
            type: 'error',
            reason: `That deck is not legal: ${faults[0]}`,
          });
        }
      }
      // Checked before a seat is given rather than after the match goes wrong.
      // The room runs the same build it is comparing against, so a client that
      // disagrees with it disagrees with the other player too.
      if (msg.version !== BUILD_VERSION) {
        return this.send(socket, {
          type: 'error',
          reason: 'Your copy of the game is a different version. Reload the page and try again.',
        });
      }
      // A second join from a socket that already holds a seat is that player
      // changing their deck while they wait, not a second player arriving.
      // Handing it a fresh seat would sit one person on both sides of the room,
      // and leaving it alone was why a deck swapped in the queue never reached
      // the match. Only before the match starts: once the cards are dealt the
      // deck is part of the game.
      const held = this.seats.findIndex((s) => s?.socket === socket);
      if (held >= 0) {
        if (this.state !== null) {
          return this.send(socket, { type: 'error', reason: 'The match has already started.' });
        }
        // A draft seat plays what it opened, so the deck that came with the join
        // is nothing to swap and the seat is left exactly as the draft left it.
        if (this.draftEndsAt !== null) return;
        this.seats[held] = { socket, name: msg.name.trim(), deckKey: msg.deckKey, deck: msg.deck };
        this.broadcastWaiting();
        return;
      }
      // The draft deals packs to everyone at once, so a seat freed after that is
      // not one a latecomer can take: they would arrive with no cards and no
      // clock left to open any.
      if (this.draftEndsAt !== null) {
        return this.send(socket, { type: 'error', reason: 'The draft has already started.' });
      }
      // Nor is a seat freed mid-match. A head-to-head drop empties its seat and
      // leaves the game standing, so without this the next socket through the
      // door fills the room, every seat reads as taken, and startMatch deals a
      // second game over the one already being played.
      if (this.state !== null) {
        return this.send(socket, { type: 'error', reason: 'The match has already started.' });
      }
      const seat = this.seats.findIndex((s) => s === null);
      if (seat < 0) return this.send(socket, { type: 'error', reason: 'room is full' });
      this.seats[seat] = { socket, name: msg.name.trim(), deckKey: msg.deckKey, deck: msg.deck };
      this.send(socket, {
        type: 'seated',
        seat: seat as PlayerIdx,
        roomId: this.ctx.id.toString(),
        kind: this.kind,
        ...(this.code ? { code: this.code } : {}),
      });
      if (this.seats.every((s) => s !== null)) {
        if (this.drafting) await this.startDraft();
        else await this.startMatch();
      } else this.broadcastWaiting();
      return;
    }

    if (msg.type === 'draftOpened' || msg.type === 'draftDeck') {
      return this.handleDraft(socket, msg);
    }

    const seatIndex = this.seats.findIndex((s) => s?.socket === socket);
    if (seatIndex < 0) {
      return this.send(socket, { type: 'error', reason: 'not seated in a running match' });
    }
    const seat = seatIndex as PlayerIdx;

    // A client that no longer trusts what it holds gets the whole thing again.
    // Answered before the match is checked for, because a resync is a question
    // about what this client should be holding and the answer before a match
    // exists is the draft. Answering it with an error ended the session of
    // anyone whose draft deck was ever refused: every `rejected` makes the
    // client resync, and a resync mid-draft used to fall through to the line
    // below and eject them.
    if (msg.type === 'resync' || msg.type === 'desync') {
      if (this.state) return this.pushState();
      if (this.draftEndsAt !== null) return this.pushDraft();
      return;
    }

    if (!this.state) {
      return this.send(socket, { type: 'error', reason: 'not seated in a running match' });
    }

    if (msg.type === 'action') {
      // An engine exception must not take the room down with it: the reducer
      // works on a clone, so the state is untouched. Refuse the action, name
      // the bug for the player, and leave the stack in the log for the tail.
      let result: ReturnType<typeof applyAction>;
      try {
        result = applyAction(this.state, seat, msg.action);
      } catch (err) {
        console.error('applyAction threw', msg.action?.type, err);
        result = {
          ok: false,
          error: `The server hit a bug applying that: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      if (!result.ok) {
        return this.send(socket, {
          type: 'rejected',
          reason: result.error,
          version: this.state.version,
        });
      }
      this.state = result.state;
      // Only the active player earns time back, so a trap played during an
      // opponent's turn earns nothing.
      await this.restartClock(isCardPlay(msg.action.type) && this.state.active === seat);
      this.pushState({ action: msg.action, actor: seat });
    }
  }

  // --- the draft ------------------------------------------------------------

  /**
   * Deal every seat its packs and start the one clock the whole draft runs on.
   *
   * The room rolls the packs rather than the clients, for the same reason it
   * runs the clocks: a client rolling its own would roll until it liked the
   * answer. They are dealt in full up front rather than one at a time, so a
   * player who reloads mid-draft is handed the same eighty cards back instead of
   * a fresh pool, and the opening of each pack stays a thing the client draws.
   */
  private async startDraft(): Promise<void> {
    const rng = { state: Math.floor(Math.random() * 0x7fffffff) };
    this.draftEndsAt = Date.now() + DRAFT_SECONDS * 1000;
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.draft = { packs: rollPacks(rng), opened: 0, leaderId: '', cards: [], done: false };
    }
    this.pushDraft();
    this.broadcastDraftStatus();
    // The room's own margin, the same one every other deadline here carries, so
    // a build sent in the last second is not lost to its flight time.
    await this.ctx.storage.setAlarm(this.draftEndsAt + NETWORK_GRACE_SECONDS * 1000);
  }

  /** Each seat its own packs, which nobody else has any business seeing. */
  private pushDraft(): void {
    if (this.draftEndsAt === null) return;
    for (const seat of this.seats) {
      if (!seat?.socket || !seat.draft) continue;
      this.send(seat.socket, {
        type: 'draft',
        packs: seat.draft.packs,
        endsAt: this.draftEndsAt,
        totalMs: DRAFT_SECONDS * 1000,
      });
    }
  }

  /** Who is still building, so a player who finished early knows what for. */
  private broadcastDraftStatus(): void {
    const seated = this.seats.filter((s): s is Seat => s !== null && s.draft !== undefined);
    this.broadcast({
      type: 'draftStatus',
      done: seated.filter((s) => s.draft!.done).length,
      needed: seated.length,
      waiting: seated.filter((s) => !s.draft!.done).map((s) => s.name),
    });
  }

  private async handleDraft(socket: WebSocket, msg: ClientMessage): Promise<void> {
    const seatIndex = this.seats.findIndex((s) => s?.socket === socket);
    const draft = seatIndex < 0 ? undefined : this.seats[seatIndex]?.draft;
    // Dropped rather than answered. The client batches its build, so a deck can
    // still be in flight when the clock runs out or the last player finishes,
    // and the sender is by then in a match that is starting. Telling them off
    // for it ended the session of a player who did nothing wrong.
    if (!draft || this.draftEndsAt === null) return;

    if (msg.type === 'draftOpened') {
      // Only ever forwards, and never past the packs that were dealt: the count
      // decides who is booted, so a client cannot walk it back after the fact.
      if (typeof msg.opened !== 'number' || !Number.isFinite(msg.opened)) return;
      draft.opened = Math.max(draft.opened, Math.min(PACK_COUNT, Math.floor(msg.opened)));
      return;
    }

    if (msg.type !== 'draftDeck') return;
    if (
      typeof msg.leaderId !== 'string' ||
      !Array.isArray(msg.cards) ||
      msg.cards.some((id) => typeof id !== 'string')
    ) {
      return this.send(socket, { type: 'error', reason: 'malformed draft deck' });
    }
    const pool = draft.packs.flat();
    // Checked on every message, not only on the last one: a build the room
    // banks has to be one the player could have made from what they opened, or
    // the clock running out would hand a modified client whatever it asked for.
    if (!withinPool(msg.leaderId, msg.cards, pool)) {
      return this.send(socket, {
        type: 'rejected',
        reason: 'That deck holds cards you did not open.',
        version: 0,
      });
    }
    draft.leaderId = msg.leaderId;
    draft.cards = [...msg.cards];
    if (!msg.done) return;
    if (!draftDeckLegal(msg.leaderId, msg.cards, pool)) {
      return this.send(socket, {
        type: 'rejected',
        reason: 'That deck is not finished yet.',
        version: 0,
      });
    }
    draft.done = true;
    this.broadcastDraftStatus();
    const seated = this.seats.filter((s): s is Seat => s !== null && s.draft !== undefined);
    if (seated.every((s) => s.draft!.done)) await this.finishDraft();
  }

  /**
   * Close the draft and deal the match.
   *
   * A player who never opened all their packs is out: eight packs is the format,
   * and someone sitting on unopened ones has not drafted. A player who opened
   * them and ran out of building time keeps every card they had chosen and the
   * rest is filled from what they opened and did not use.
   */
  private async finishDraft(): Promise<void> {
    if (this.draftEndsAt === null) return;
    this.draftEndsAt = null;
    await this.ctx.storage.deleteAlarm();
    const rng = { state: Math.floor(Math.random() * 0x7fffffff) };

    const booted: Seat[] = [];
    const ready: Seat[] = [];
    for (const seat of this.seats) {
      if (!seat?.draft) continue;
      if (seat.draft.opened < PACK_COUNT) {
        booted.push(seat);
        continue;
      }
      const pool = seat.draft.packs.flat();
      const filled = seat.draft.done
        ? { leaderId: seat.draft.leaderId, cards: seat.draft.cards }
        : autofill(rng, pool, seat.draft.leaderId, seat.draft.cards);
      // A pool that somehow cannot make a legal deck is a bug in the fill, not
      // something to seat: better one player told than four in a broken match.
      if (!draftDeckLegal(filled.leaderId, filled.cards, pool)) {
        booted.push(seat);
        continue;
      }
      seat.deck = filled;
      ready.push(seat);
    }

    for (const seat of booted) {
      if (!seat.socket) continue;
      this.send(seat.socket, {
        type: 'error',
        reason: 'The draft ended with packs you had not opened, so your seat went with it.',
      });
      try {
        seat.socket.close();
      } catch {
        // Already gone; the close handler has nothing left to clear.
      }
      seat.socket = null;
    }

    const playing = ready.filter((s) => s.socket !== null);
    if (playing.length < 2) {
      for (const seat of playing) {
        if (seat.socket) {
          this.send(seat.socket, {
            type: 'error',
            reason: 'Not enough players finished the draft.',
          });
        }
      }
      this.seats = this.seats.map(() => null);
      return;
    }

    // The seats close up over anyone who dropped out, because a seat index is
    // a player index once the match starts and the engine seats every player it
    // is given. Each survivor is told the chair it ended up in before the first
    // push arrives written from it.
    this.seats = playing;
    playing.forEach((seat, i) => {
      if (!seat.socket) return;
      this.send(seat.socket, {
        type: 'seated',
        seat: i as PlayerIdx,
        roomId: this.ctx.id.toString(),
        kind: this.kind,
        ...(this.code ? { code: this.code } : {}),
      });
    });
    await this.startMatch();
  }

  private async startMatch(): Promise<void> {
    const decks = this.seats.map((s, i) => {
      // A custom deck came in with the join and was checked then; anything else
      // the room rebuilds from its key.
      const d = s!.deck ?? deckByKey(s!.deckKey);
      return { name: s!.name || `Player ${i + 1}`, leaderId: d.leaderId, cards: d.cards };
    });
    // Seeded from the room so a replay of the same actions reproduces the match.
    const seed = Math.floor(Math.random() * 0x7fffffff);
    // Who opens is a die roll, taken off the seed rather than a second roll so
    // the seed on its own still reproduces the whole match.
    this.state = createGame(decks, seed, (seed % this.seats.length) as PlayerIdx);
    await this.restartClock();
    this.pushState();
  }

  /**
   * Put whoever must act next on the appropriate clock and set the alarm that
   * enforces it. Called after every accepted action, because an action can hand
   * the turn over, open a response window, or close one.
   */
  private async restartClock(played = false): Promise<void> {
    // isOver rather than a winner: a draw ends the match with no winner set, and
    // a clock started past the end re-arms an alarm that fires at once, pushing
    // the finished state to both seats over and over.
    if (!this.state || isOver(this.state) || this.timersOff) {
      this.clock = null;
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const kind = clockKindFor(this.state);
    const player = currentActor(this.state);
    // A turn is one budget, and it is the turn number and whose it is that name
    // it. Anything queued in front of the main phase is a different clock that
    // interrupts this one rather than replacing it.
    const key = `${this.state.turn}/${this.state.active}`;

    if (key !== this.turnKey) {
      this.turnKey = key;
      this.turnLeftMs = enforcedMs('turn');
      this.turnTotalMs = enforcedMs('turn');
      this.turnPlays = 0;
    } else if (this.clock?.kind === 'turn') {
      // Still the same turn and still in the main phase, so what it has left is
      // whatever its own clock says. Reading it back here is what stops an
      // action from restarting the turn.
      this.turnLeftMs = Math.max(0, this.clock.endsAt - now);
    }

    // Each card played adds time to the turn, less with every play. The bonus
    // goes into the bank rather than the running timer, so a play that opens a
    // response window keeps the time until the turn resumes.
    if (played) {
      const bonus = playBonusMs(++this.turnPlays);
      this.turnLeftMs += bonus;
      this.turnTotalMs += bonus;
    }

    if (kind === 'turn') {
      this.clock = { kind, player, endsAt: now + this.turnLeftMs, totalMs: this.turnTotalMs };
    } else if (this.clock && this.clock.kind === kind && this.clock.player === player) {
      // The same window still open: acting inside one does not buy more of it.
    } else {
      const total = enforcedMs(kind);
      this.clock = { kind, player, endsAt: now + total, totalMs: total };
    }
    await this.ctx.storage.setAlarm(this.clock.endsAt);
  }

  /**
   * A clock ran out. Play the passive move for whoever was on it and carry on;
   * a timeout is a missed decision, not a forfeit.
   */
  async alarm(): Promise<void> {
    // The draft clock is the only deadline in flight while it runs, so it is
    // answered before anything looks for a game that has not been dealt yet.
    if (this.draftEndsAt !== null) {
      if (Date.now() < this.draftEndsAt) return;
      // Its own entry point, so its own guard: a throw here is not attached to
      // any one socket and would take the whole room with it.
      try {
        return await this.finishDraft();
      } catch (err) {
        console.error('finishDraft threw', err);
        this.draftEndsAt = null;
        this.broadcast({ type: 'error', reason: 'The draft could not be finished.' });
        return;
      }
    }
    if (!this.state || !this.clock) return;
    // The alarm can outlive the clock it was set for if an action landed in the
    // same instant. Anything still to run means this alarm is stale.
    if (Date.now() < this.clock.endsAt - 250) return;

    const player = this.clock.player;
    const action = timeoutAction(this.state);
    if (!action) return;
    // Guarded like a player's own action: a bug in the passive move must not
    // wedge the alarm loop, and the state is untouched when the reducer throws.
    let result: ReturnType<typeof applyAction>;
    try {
      result = applyAction(this.state, player, action);
    } catch (err) {
      console.error('timeout applyAction threw', action.type, err);
      result = { ok: false, error: 'timeout action failed' };
    }
    if (result.ok) {
      this.state = result.state;
      this.broadcast({ type: 'timedOut', player, action: action.type });
    }
    await this.restartClock();
    // A move all the same, even though nobody chose it, so it animates too.
    this.pushState(result.ok ? { action, actor: player } : undefined);
  }

  private pushState(move?: { action: Action; actor: PlayerIdx }): void {
    if (!this.state) return;
    // One digest of what both sides can see, so each client can check the push
    // against the state it computed itself without learning anything private.
    const digest = digestShort(publicView(this.state));
    this.seats.forEach((s, i) => {
      if (!s?.socket) return;
      const seat = i as PlayerIdx;
      this.send(s.socket, {
        type: 'state',
        state: redactFor(this.state!, seat),
        seat,
        clock: this.clock,
        publicDigest: digest,
        ...(move ? { action: move.action, actor: move.actor } : {}),
      });
    });
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      // The socket closed mid-flight; the close handler clears the seat. Said
      // out loud all the same: a write that fails is the room's first sign that
      // a connection is gone, and swallowing it left no trace of the moment.
      console.log('send failed', msg.type, err instanceof Error ? err.message : String(err));
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const s of this.seats) {
      if (s?.socket) this.send(s.socket, msg);
    }
  }
}
