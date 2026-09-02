import { digestShort } from '../engine/digest';
import { publicView } from '../engine/redact';
import { currentActor, isOver, type GameState } from '../engine/state';
import { BUILD_VERSION } from '../version';

/**
 * What to hand a player when a match ends, and especially when it ends badly.
 *
 * "It closed and I don't know why" is not something anybody can act on. A report
 * that names the build, the room, the seat, the position and the last thing that
 * happened is, and the player should not have to reproduce the fault to give it:
 * the run is already over by the time they notice.
 *
 * Offered on the online screen after a match drops, and nowhere else. A game
 * that simply ended needs no report, and a button on that banner is one more
 * thing between a player and the next match.
 *
 * Everything here is public. The journal records what the room said and what
 * this client did, never a hand, a deck order or a face-down card, so a player
 * can paste it anywhere without giving away a position they are still playing.
 */

/** Entries kept before the oldest is dropped. Enough for a turn or two of trouble. */
const JOURNAL_LIMIT = 60;

interface Entry {
  /** Milliseconds since the page opened, which is what a reader can line up. */
  at: number;
  what: string;
}

const journal: Entry[] = [];
const opened = Date.now();

/** Record something worth seeing in a report. Public facts only. */
export function note(what: string): void {
  journal.push({ at: Date.now() - opened, what });
  if (journal.length > JOURNAL_LIMIT) journal.splice(0, journal.length - JOURNAL_LIMIT);
}

export function clearJournal(): void {
  journal.length = 0;
}

export interface CloseContext {
  /** Why the match stopped, in the words the player was shown. */
  reason: string;
  state: GameState | null;
  seat: number | null;
  roomCode?: string | null;
  online: boolean;
}

function position(state: GameState | null, seat: number | null): string[] {
  if (!state) return ['position:      no match in progress'];
  const rows = [
    `turn:          ${state.turn}, active seat ${state.active}, phase ${state.phase}`,
    `waiting on:    seat ${currentActor(state)}${seat === null ? '' : ` (you are seat ${seat})`}`,
    `public digest: ${digestShort(publicView(state))}`,
    `queues:        pending ${state.pending ? state.pending.player : '-'}`
      + `, choice ${state.choiceQueue.length}`
      + `, flip ${state.flipQueue.length}`
      + `, replace ${state.replaceQueue.length}`,
  ];
  if (state.replaceQueue.length > 0) {
    rows.push(
      `replace queue: ${state.replaceQueue.map((r) => `seat ${r.player} slot ${r.slot}`).join('; ')}`,
    );
  }
  rows.push(
    `debt:          ${state.players.map((p, i) => `seat ${i} ${p.debtCount}`).join(', ')}`,
  );
  if (isOver(state)) {
    rows.push(`result:        ${state.winner === null ? 'draw' : `seat ${state.winner} won`}`);
    if (state.winReason) rows.push(`win reason:    ${state.winReason}`);
  }
  return rows;
}

/**
 * The whole report, as plain text a player can paste into a message.
 *
 * Deliberately not JSON. It is read by a person first, and a wall of braces is
 * something people decline to send.
 */
export function closeReport(ctx: CloseContext): string {
  const head = [
    'Ernum Rites - match report',
    `when:          ${new Date().toISOString()}`,
    `build:         ${BUILD_VERSION}`,
    `mode:          ${ctx.online ? 'online' : 'local'}`,
  ];
  if (ctx.online && ctx.roomCode) head.push(`room:          ${ctx.roomCode}`);
  head.push(`closed:        ${ctx.reason}`);

  const tail = journal.length === 0
    ? ['(nothing recorded)']
    : journal.map((e) => `  ${(e.at / 1000).toFixed(1).padStart(7)}s  ${e.what}`);

  return [
    ...head,
    '',
    ...position(ctx.state, ctx.seat),
    '',
    `last ${journal.length} events:`,
    ...tail,
  ].join('\n');
}
