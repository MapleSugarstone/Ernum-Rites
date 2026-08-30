import type { Action } from '../src/engine/actions';
import type { GameState } from '../src/engine/state';
import type { Clock } from '../src/engine/timing';
import type { PlayerIdx } from '../src/engine/types';

/** How a player got into the room they are asking to sit in. */
export type RoomKind = 'public' | 'private';

/** Sent by a client. */
export type ClientMessage =
  | { type: 'join'; deckKey: string; name: string }
  | { type: 'action'; action: Action; version: number }
  | { type: 'resync' }
  /**
   * Round trip for clock skew. The client stamps `sent`, the room echoes it back
   * beside its own clock, and the client works out the offset from the two.
   */
  | { type: 'ping'; sent: number }
  /**
   * A client saw the state it was pushed disagree with the state it computed by
   * applying the same action itself. The room answers with a full resync. This
   * is the client half of the validation: the room is the authority, and this is
   * how a client says it no longer believes what it is holding.
   */
  | { type: 'desync'; version: number; mine: string; theirs: string };

/** Sent by the room. */
export type ServerMessage =
  | { type: 'seated'; seat: PlayerIdx; roomId: string; kind: RoomKind; code?: string }
  | { type: 'waiting'; players: number; code?: string }
  /**
   * `publicDigest` covers only what both players can see, so each client can
   * check the push against its own copy without either side learning anything
   * hidden. A full-state digest would not survive redaction.
   */
  | {
      type: 'state';
      state: GameState;
      seat: PlayerIdx;
      clock: Clock | null;
      publicDigest: string;
      /**
       * The move that produced this state, so a client can animate it rather
       * than snap to it. Absent on the opening push and on a resync, neither of
       * which is the result of anybody moving.
       */
      action?: Action;
      actor?: PlayerIdx;
    }
  | { type: 'rejected'; reason: string; version: number }
  /** A clock ran out and the room played the passive move for that player. */
  | { type: 'timedOut'; player: PlayerIdx; action: Action['type'] }
  | { type: 'pong'; sent: number; now: number }
  | { type: 'opponentLeft' }
  | { type: 'error'; reason: string };

/** Answers from the matchmaking endpoints, which are plain HTTP rather than sockets. */
export type QueueReply =
  | { ok: true; roomId: string; kind: RoomKind; code?: string }
  | { ok: false; reason: string };

export const NAME_MIN = 2;
export const NAME_MAX = 24;

/**
 * Why a lobby name cannot be used, or null when it is fine. Shared so the room
 * enforces exactly what the lobby greys the buttons out for: the name is shown
 * to the other player, and a modified client must not get to choose it freely.
 */
export function nameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length < NAME_MIN) return `Enter a name of at least ${NAME_MIN} characters.`;
  if (name.length > NAME_MAX) return `A name is at most ${NAME_MAX} characters.`;
  if (!/^[\p{L}\p{N} '_-]+$/u.test(name)) {
    return 'Use letters, numbers, spaces, hyphens or apostrophes.';
  }
  if (!/[\p{L}\p{N}]/u.test(name)) return 'A name needs at least one letter or number.';
  return null;
}
