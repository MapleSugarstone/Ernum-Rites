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
import type { GameState } from '../engine/state';
import type { Clock } from '../engine/timing';
import type { PlayerIdx } from '../engine/types';
import type { ClientMessage, QueueReply, RoomKind, ServerMessage } from '../../worker/protocol';

export interface NetHandlers {
  onSeated(seat: PlayerIdx, kind: RoomKind, code?: string): void;
  onWaiting(players: number, code?: string): void;
  onState(
    state: GameState,
    seat: PlayerIdx,
    clock: Clock | null,
    /** The move behind this state, when it was one. Null on a resync. */
    move: { action: Action; actor: PlayerIdx } | null,
  ): void;
  onRejected(reason: string): void;
  onTimedOut(player: PlayerIdx, action: string): void;
  onOpponentLeft(): void;
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

/** How often to re-measure the offset between this clock and the room's. */
const PING_EVERY_MS = 10_000;

export class NetClient {
  private socket: WebSocket | null = null;
  private handlers: NetHandlers;
  private base: string;
  private pingTimer: number | null = null;
  /** This client's own copy, kept in step so pushes can be checked against it. */
  private mirror: GameState | null = null;

  readonly status: NetStatus = { seat: null, skewMs: 0, connected: false };

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

  hostPrivateGame(): Promise<QueueReply> {
    return this.queue('/api/queue/host');
  }

  joinPrivateGame(code: string): Promise<QueueReply> {
    return this.queue('/api/queue/join', `?code=${encodeURIComponent(code.trim().toUpperCase())}`);
  }

  /** Back out of the queue so nobody is paired into an empty room. */
  cancelQueue(roomId?: string, code?: string): Promise<QueueReply> {
    const params = new URLSearchParams();
    if (roomId) params.set('roomId', roomId);
    if (code) params.set('code', code);
    return this.queue('/api/queue/cancel', `?${params.toString()}`);
  }

  // --- the match socket -----------------------------------------------------

  connect(roomId: string, kind: RoomKind, deckKey: string, name: string, code?: string): void {
    this.close();
    const ws = this.base.replace(/^http/, 'ws');
    const params = new URLSearchParams({ kind });
    if (code) params.set('code', code);
    const socket = new WebSocket(`${ws}/api/room/${roomId}?${params.toString()}`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.status.connected = true;
      this.send({ type: 'join', deckKey, name });
      this.measureSkew();
      this.pingTimer = window.setInterval(() => this.measureSkew(), PING_EVERY_MS);
    });
    socket.addEventListener('message', (ev) => this.receive(String(ev.data)));
    socket.addEventListener('close', () => {
      this.status.connected = false;
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    });
    socket.addEventListener('error', () => this.handlers.onError('the connection dropped'));
  }

  close(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
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
    const trial = applyAction(this.mirror, this.status.seat, action);
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
        return this.handlers.onWaiting(msg.players, msg.code);

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

      case 'rejected':
        // The room and this client disagreed about legality, which means the
        // copy here is behind. Ask for the whole thing rather than guess.
        this.send({ type: 'resync' });
        return this.handlers.onRejected(msg.reason);

      case 'timedOut':
        return this.handlers.onTimedOut(msg.player, msg.action);

      case 'opponentLeft':
        return this.handlers.onOpponentLeft();

      case 'error':
        return this.handlers.onError(msg.reason);
    }
  }
}
