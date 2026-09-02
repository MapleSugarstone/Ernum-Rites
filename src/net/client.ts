/**
 * The client half of online play.
 *
 * The room is the authority, but this side is not a thin terminal. Every action
 * either player takes is applied here too, against this client's own copy, and
 * the result is checked against the digest the room sends with its push. That
 * catches a desync immediately rather than at the moment it changes the outcome,
 * and it means a modified client cannot quietly feed its opponent a lie: the
 * opponent recomputes everything it can see and disagrees.
 *
 * What it cannot check is anything it is not allowed to know. Both decks, the
 * other hand and every face-down HP card are hidden from this side, so the shared
 * ground is the public projection and the digest covers exactly that.
 */
import type { Action } from '../engine/actions';
import { digestShort } from '../engine/digest';
import { applyAction } from '../engine/engine';
import { publicView } from '../engine/redact';
import { BUILD_VERSION } from '../version';
import type { GameState } from '../engine/state';
import type { Clock } from '../engine/timing';
import type { PlayerIdx } from '../engine/types';
import type { ClientMessage, QueueReply, RoomKind, ServerMessage } from '../../worker/protocol';

export interface NetHandlers {
  onSeated(seat: PlayerIdx, kind: RoomKind, code?: string): void;
  onWaiting(players: number, code?: string, needed?: number, names?: string[]): void;
  onState(
    state: GameState,
    seat: PlayerIdx,
    clock: Clock | null,
    /** The move behind this state, when it was one. Null on a resync. */
    move: { action: Action; actor: PlayerIdx } | null,
  ): void;
  /** The packs this seat opens, and the one clock the whole draft runs on. */
  onDraft(packs: string[][], endsAt: number, totalMs: number): void;
  /** Who has finished their deck, while this client waits on the rest. */
  onDraftStatus(done: number, needed: number, waiting: string[]): void;
  onRejected(reason: string): void;
  onTimedOut(player: PlayerIdx, action: string): void;
  onOpponentLeft(): void;
  /** A party player dropped mid-match; the room conceded for them and play goes on. */
  onPlayerLeft(seat: PlayerIdx, name: string): void;
  onError(reason: string): void;
  /** Raised when this client's own copy stopped matching the room's. */
  onDesync(): void;
}

export interface NetStatus {
  seat: PlayerIdx | null;
  /** Room clock minus this clock, in ms. Added to every deadline before drawing. */
  skewMs: number;
  connected: boolean;
}

/**
 * What the connection looks like from here, for the match report.
 *
 * The pair of numbers is what separates a socket that died without saying so
 * from every other way a match can stop: a long quiet stretch against a socket
 * still calling itself open is that fault and nothing else. It was the one thing
 * a report could never show.
 */
export interface NetHealth {
  /** Milliseconds since the room last said anything, or -1 if it never has. */
  quietMs: number;
  /** The socket's own opinion: 0 connecting, 1 open, 2 closing, 3 closed. */
  readyState: number;
  /** How the last socket ended. 1006 means it died with nothing said. */
  lastClose: string;
}

/** How often to re-measure the offset between this clock and the room's. */
const PING_EVERY_MS = 10_000;

/**
 * How long the room may say nothing before this client stops believing in the
 * connection.
 *
 * A socket can die without either end being told: the server tears the
 * connection down, the packet saying so never arrives, and what is left reports
 * `readyState` OPEN for as long as the page is open. Nothing else here catches
 * that. No close event fires, `send` writes into a socket that is gone without
 * throwing, and the board goes on taking clicks that reach nobody, so the player
 * sits in front of a match that ended for everyone else.
 *
 * The room answers a ping the moment it arrives, before it looks at seats or
 * state, so a pong is a fact about the connection rather than about the game.
 * Two unanswered in a row is a connection that is gone.
 */
const SILENCE_MS = PING_EVERY_MS * 2 + 5_000;

/** How often to ask whether the room has gone quiet. */
const WATCH_EVERY_MS = 2_500;

/**
 * Whether a connection that has gone quiet should be given up on.
 *
 * Pulled out whole because every clause is a way to get this wrong. Giving up
 * on a tab that was merely put away closes a healthy socket and tells an
 * innocent opponent their opponent left, which is the very fault the watchdog
 * exists to catch: a hidden tab has both the check and the ping that feeds it
 * clamped to about once a minute, so the silence it wakes to says nothing. A
 * socket that already closed properly is the close listener's business, and one
 * already given up on must not be reported twice.
 */
export function connectionLost(now: {
  quietMs: number;
  visible: boolean;
  open: boolean;
  alreadyGaveUp: boolean;
}): boolean {
  if (now.alreadyGaveUp || !now.open || !now.visible) return false;
  return now.quietMs >= SILENCE_MS;
}

export class NetClient {
  private socket: WebSocket | null = null;
  /** Aborted on close, which detaches every listener on the socket being let go. */
  private live: AbortController | null = null;
  private handlers: NetHandlers;
  private base: string;
  private pingTimer: number | null = null;
  private watchTimer: number | null = null;
  /** When the room last said anything at all, which is the only proof it is there. */
  private lastHeard = 0;
  /** Set once the silence has been reported, so it is reported once. */
  private gaveUp = false;
  /** How the last socket ended, for the report. Empty until one has. */
  private lastClose = '';
  /** This client's own copy, kept in step so pushes can be checked against it. */
  private mirror: GameState | null = null;

  readonly status: NetStatus = { seat: null, skewMs: 0, connected: false };

  health(): NetHealth {
    return {
      quietMs: this.lastHeard ? Date.now() - this.lastHeard : -1,
      readyState: this.socket?.readyState ?? WebSocket.CLOSED,
      lastClose: this.lastClose,
    };
  }

  constructor(base: string, handlers: NetHandlers) {
    this.base = base.replace(/\/$/, '');
    this.handlers = handlers;
  }

  // --- matchmaking ----------------------------------------------------------

  private async queue(path: string, params = ''): Promise<QueueReply> {
    try {
      const res = await fetch(`${this.base}${path}${params}`, { method: 'POST' });
      return (await res.json()) as QueueReply;
    } catch {
      return { ok: false, reason: 'could not reach the server' };
    }
  }

  findPublicGame(): Promise<QueueReply> {
    return this.queue('/api/queue/public');
  }

  hostPrivateGame(party?: 3 | 4, noTimers = false, draft = false): Promise<QueueReply> {
    const params = new URLSearchParams();
    if (party) params.set('party', String(party));
    if (noTimers) params.set('timers', 'off');
    if (draft) params.set('draft', 'on');
    const query = params.toString();
    return this.queue('/api/queue/host', query ? `?${query}` : '');
  }

  joinPrivateGame(code: string): Promise<QueueReply> {
    return this.queue('/api/queue/join', `?code=${encodeURIComponent(code.trim().toUpperCase())}`);
  }

  /** Tell the room how many packs have been opened. A short count is what boots. */
  sendDraftOpened(opened: number): void {
    this.send({ type: 'draftOpened', opened });
  }

  /**
   * The deck as it stands. Sent while it is still being built as well as when it
   * is called finished, so a clock that runs out fills in what the player had
   * rather than dealing them a random deck.
   */
  sendDraftDeck(leaderId: string, cards: string[], done: boolean): void {
    this.send({ type: 'draftDeck', leaderId, cards, done });
  }

  /** Back out of the queue so nobody is paired into an empty room. */
  cancelQueue(roomId?: string, code?: string): Promise<QueueReply> {
    const params = new URLSearchParams();
    if (roomId) params.set('roomId', roomId);
    if (code) params.set('code', code);
    return this.queue('/api/queue/cancel', `?${params.toString()}`);
  }

  // --- the match socket -----------------------------------------------------

  /**
   * Swap the deck on a connection that is already waiting. The room reads a
   * second join from a seated socket as a deck change, so this is the same
   * message the seat was taken with.
   */
  changeDeck(deckKey: string, name: string, deck?: { leaderId: string; cards: string[] }): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.send({ type: 'join', deckKey, name, version: BUILD_VERSION, deck });
  }

  connect(
    roomId: string,
    kind: RoomKind,
    deckKey: string,
    name: string,
    code?: string,
    deck?: { leaderId: string; cards: string[] },
  ): void {
    this.close();
    const ws = this.base.replace(/^http/, 'ws');
    const params = new URLSearchParams({ kind });
    if (code) params.set('code', code);
    const socket = new WebSocket(`${ws}/api/room/${roomId}?${params.toString()}`);
    this.socket = socket;
    // Every listener below is hung off this, so closing can take them all back
    // at once. A socket that has been let go must not still be able to reach
    // the handlers: closing one is not instant, and the tail of it arriving
    // later would otherwise report a connection this client no longer wants as
    // a connection that failed.
    const live = new AbortController();
    this.live = live;
    const on = { signal: live.signal };

    socket.addEventListener(
      'open',
      () => {
        this.status.connected = true;
        this.lastHeard = Date.now();
        this.gaveUp = false;
        this.send({ type: 'join', deckKey, name, version: BUILD_VERSION, deck });
        this.measureSkew();
        this.pingTimer = window.setInterval(() => this.measureSkew(), PING_EVERY_MS);
        this.watchTimer = window.setInterval(() => this.checkAlive(), WATCH_EVERY_MS);
      },
      on,
    );
    socket.addEventListener('message', (ev) => this.receive(String(ev.data)), on);
    // A hidden tab has its timers throttled to about once a minute, so the quiet
    // while it was away says nothing about the connection. The count starts
    // again on the way back, and the ping sent with it is what actually tests
    // whether anything is still there.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState !== 'visible') return;
        this.lastHeard = Date.now();
        this.measureSkew();
      },
      on,
    );
    socket.addEventListener(
      'close',
      (ev) => {
        const wasLive = this.status.connected;
        this.status.connected = false;
        this.stopTimers();
        // Which kind of close arrived is the whole question after the fact: 1006
        // is a connection that died with nothing said, while 1000 or 1001 is an
        // end that announced itself.
        this.lastClose = `code ${ev.code}${ev.wasClean ? ' clean' : ''}`;
        // Named in the reason, so the journal and the report agree on which
        // kind of ending this was without the player having to know the codes.
        if (wasLive) {
          this.handlers.onError(
            ev.code === 1006 ? 'the connection died without closing' : 'the connection closed',
          );
          return;
        }
        // A quiet close carries no error event: the network went away or the
        // server hung up. Left unreported, the board keeps taking clicks that
        // go nowhere; surfaced, the player learns the moment it happens.
      },
      on,
    );
    socket.addEventListener('error', () => this.handlers.onError('the connection dropped'), on);
  }

  private stopTimers(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.watchTimer !== null) window.clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  /**
   * Report a socket that is open but no longer attached to anything.
   *
   * The close listener covers a connection that was closed properly. This covers
   * the one that was not: the room is gone, nothing said so, and the only
   * evidence is that it stopped answering. Reported through the same handler a
   * real close uses, so the player is told and put back on the lobby screen
   * rather than left playing a match nobody else is in.
   */
  private checkAlive(): void {
    const lost = connectionLost({
      quietMs: Date.now() - this.lastHeard,
      visible: document.visibilityState === 'visible',
      open: this.socket?.readyState === WebSocket.OPEN,
      alreadyGaveUp: this.gaveUp,
    });
    if (!lost) return;
    this.gaveUp = true;
    this.status.connected = false;
    this.stopTimers();
    this.handlers.onError('the room stopped answering');
  }

  close(): void {
    // Before the close itself, so nothing the teardown raises comes back.
    this.live?.abort();
    this.live = null;
    this.stopTimers();
    this.socket?.close();
    this.socket = null;
    this.mirror = null;
    this.status.connected = false;
    this.status.seat = null;
  }

  /**
   * Send an action, having first checked it against this client's own copy. An
   * action this side can already see is illegal never leaves: the room would
   * reject it anyway, and refusing it here is instant.
   */
  play(action: Action): { ok: true } | { ok: false; reason: string } {
    if (!this.mirror || this.status.seat === null) {
      return { ok: false, reason: 'not in a match' };
    }
    // A dead socket would take the action without a sound: send() only writes
    // to an open one. Refusing here surfaces the loss on the very first click.
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return { ok: false, reason: 'The connection is down.' };
    }
    let trial: ReturnType<typeof applyAction>;
    try {
      trial = applyAction(this.mirror, this.status.seat, action);
    } catch (err) {
      // The pre-check crashed on this side's redacted copy. The room holds the
      // real state, so the action still goes: at worst it comes back rejected.
      // Swallowing the click here is how a bug reads as "nothing happened".
      console.error('local pre-check threw; sending anyway', action.type, err);
      this.send({ type: 'action', action, version: this.mirror.version });
      return { ok: true };
    }
    if (!trial.ok) return { ok: false, reason: trial.error };
    this.send({ type: 'action', action, version: this.mirror.version });
    return { ok: true };
  }

  private send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  private measureSkew(): void {
    this.send({ type: 'ping', sent: Date.now() });
  }

  private receive(raw: string): void {
    // Anything at all counts, not just a pong: a room mid-push is plainly there.
    this.lastHeard = Date.now();
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return this.handlers.onError('the server said something unreadable');
    }

    switch (msg.type) {
      case 'seated':
        this.status.seat = msg.seat;
        return this.handlers.onSeated(msg.seat, msg.kind, msg.code);

      case 'waiting':
        return this.handlers.onWaiting(msg.players, msg.code, msg.needed, msg.names);

      case 'pong': {
        // Round trip halved is the one-way delay, so the room's clock at the
        // moment it answered maps onto ours here.
        const rtt = Date.now() - msg.sent;
        this.status.skewMs = msg.now + rtt / 2 - Date.now();
        return;
      }

      case 'state': {
        const mine = digestShort(publicView(msg.state));
        if (mine !== msg.publicDigest) {
          // Disagreement about something both sides can see. Say so and take the
          // room's copy: it is the authority, but it should know it happened.
          this.send({
            type: 'desync',
            version: msg.state.version,
            mine,
            theirs: msg.publicDigest,
          });
          this.handlers.onDesync();
        }
        this.mirror = msg.state;
        this.status.seat = msg.seat;
        const move =
          msg.action !== undefined && msg.actor !== undefined
            ? { action: msg.action, actor: msg.actor }
            : null;
        return this.handlers.onState(msg.state, msg.seat, msg.clock, move);
      }

      case 'draft':
        return this.handlers.onDraft(msg.packs, msg.endsAt, msg.totalMs);

      case 'draftStatus':
        return this.handlers.onDraftStatus(msg.done, msg.needed, msg.waiting);

      case 'rejected':
        // The room and this client disagreed about legality, which means the
        // copy here is behind. Ask for the whole thing rather than guess.
        this.send({ type: 'resync' });
        return this.handlers.onRejected(msg.reason);

      case 'timedOut':
        return this.handlers.onTimedOut(msg.player, msg.action);

      case 'opponentLeft':
        return this.handlers.onOpponentLeft();

      case 'playerLeft':
        return this.handlers.onPlayerLeft(msg.seat, msg.name);

      case 'error':
        return this.handlers.onError(msg.reason);
    }
  }
}
