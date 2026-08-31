import { DurableObject } from 'cloudflare:workers';
import '../src/cards';
import { deckByKey, hasDeck } from '../src/cards';
import { deckProblems } from '../src/engine/decklist';
import type { Action } from '../src/engine/actions';
import { applyAction, createGame } from '../src/engine/engine';
import { digestShort } from '../src/engine/digest';
import { publicView, redactFor } from '../src/engine/redact';
import { currentActor, type GameState } from '../src/engine/state';
import { timeoutAction } from '../src/engine/timeout';
import { clockKindFor, enforcedMs, isCardPlay, playBonusMs, type Clock } from '../src/engine/timing';
import type { PlayerIdx } from '../src/engine/types';
import { BUILD_VERSION } from '../src/version';
import { nameProblem } from './protocol';
import type { ClientMessage, RoomKind, ServerMessage } from './protocol';

interface Seat {
  /** Null once a party player drops mid-match: the seat stays, the socket goes. */
  socket: WebSocket | null;
  name: string;
  deckKey: string;
  /** Set only for a deck the room cannot look up, already checked as legal. */
  deck?: { leaderId: string; cards: string[] };
}

/**
 * How many players this room seats, read off its own name. The lobby mints
 * `prv3-`/`prv4-` names for party rooms and plain `prv-`/`pub-` for the rest.
 */
function seatCountFor(name: string | undefined): number {
  if (name?.startsWith('prv3-')) return 3;
  if (name?.startsWith('prv4-')) return 4;
  return 2;
}

/**
 * Reports whether this room runs without timers, reading the room's own name the
 * same way seatCountFor does. The lobby adds an `nt-` segment when the host
 * turns timers off, and only the lobby routes guests to a room.
 */
function timersOffFor(name: string | undefined): boolean {
  return /^prv[34]?-nt-/.test(name ?? '');
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
      void this.handle(socket, msg);
    });
    socket.addEventListener('close', () => {
      void this.handleClose(socket);
    });
  }

  private async handleClose(socket: WebSocket): Promise<void> {
    const idx = this.seats.findIndex((s) => s?.socket === socket);
    if (idx < 0) return;
    if (this.seats.length === 2) {
      this.seats[idx] = null;
      this.clock = null;
      await this.ctx.storage.deleteAlarm();
      this.broadcast({ type: 'opponentLeft' });
      return;
    }
    // A party room. Before the match starts a drop just frees the seat.
    const seat = idx as PlayerIdx;
    if (this.state === null) {
      this.seats[idx] = null;
      this.broadcastWaiting();
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
      if (!hasDeck(msg.deckKey)) {
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
      if (this.seats.every((s) => s !== null)) await this.startMatch();
      else this.broadcastWaiting();
      return;
    }

    const seatIndex = this.seats.findIndex((s) => s?.socket === socket);
    if (seatIndex < 0 || !this.state) {
      return this.send(socket, { type: 'error', reason: 'not seated in a running match' });
    }
    const seat = seatIndex as PlayerIdx;

    // A client that no longer trusts what it holds gets the whole thing again.
    if (msg.type === 'resync' || msg.type === 'desync') return this.pushState();

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
    if (!this.state || this.state.winner !== null || this.timersOff) {
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
    } catch {
      // The socket closed mid-flight; the close handler clears the seat.
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const s of this.seats) {
      if (s?.socket) this.send(s.socket, msg);
    }
  }
}
