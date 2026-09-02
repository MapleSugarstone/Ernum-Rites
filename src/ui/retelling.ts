import { card, tryCard } from '../engine/registry';
import { isOver, type GameState } from '../engine/state';
import { BUILD_VERSION } from '../version';

/**
 * The whole match written out, turn by turn, for a player to keep or to send.
 *
 * The engine already narrates itself: every play, every trigger that fired, every
 * flip left face down and every trap held back is a line in the log. This gathers
 * those lines under the turns they happened in and puts a header on top, so a
 * finished match can be read back by somebody who was not there.
 *
 * It tells the match as this client saw it. Online, the log was written from a
 * redacted state, so a hand you never saw is not in here and neither is the deck
 * order. That is the point: the file can be pasted anywhere without handing over
 * anything the other player kept to themselves.
 */

export interface RetellingContext {
  state: GameState;
  /** Which seat this client played, or null when watching or offline. */
  seat: number | null;
  roomCode?: string | null;
  online: boolean;
  /** ISO stamp for the header. Passed in so this stays a pure function. */
  when: string;
}

function pad(label: string): string {
  return `${label}:`.padEnd(10);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Who sat where, and what they led with. */
function seats(state: GameState, seat: number | null): string[] {
  return state.players.map((p, i) => {
    const leader = tryCard(p.leaderCardId);
    const mine = i === seat ? ' (you)' : '';
    const out = p.eliminated ? ', eliminated' : '';
    return `  seat ${i}${mine}: ${p.name}, leading ${leader?.name ?? p.leaderCardId}${out}`;
  });
}

function outcome(state: GameState): string {
  if (!isOver(state)) return 'unfinished';
  if (state.winner === null) return `a draw${state.winReason ? `, ${state.winReason}` : ''}`;
  const who = state.players[state.winner].name;
  return `${who} wins${state.winReason ? `, ${state.winReason}` : ''}`;
}

/**
 * The board as it stood at the end, which the log does not restate.
 *
 * A retelling that stops at the last action leaves the reader working out who was
 * still standing from the blow-by-blow.
 */
function finalBoard(state: GameState): string[] {
  const rows: string[] = [];
  for (const [i, p] of state.players.entries()) {
    const bodies = p.slots
      .map((s) => (s ? `${card(s.cardId).name} (${s.hp.filter((h) => !h.flipped).length} HP)` : null))
      .filter(Boolean);
    const leader = p.leader
      ? `${card(p.leader.cardId).name} on ${p.leader.hp.filter((h) => !h.flipped).length} HP`
      : 'no leader';
    rows.push(`  seat ${i} ${p.name}: ${leader}, debt ${p.debtCount}, ${p.hand.length} in hand`);
    rows.push(`    field: ${bodies.length ? bodies.join(', ') : 'empty'}`);
  }
  return rows;
}

export function matchRetelling(ctx: RetellingContext): string {
  const { state } = ctx;
  const head = [
    'Ernum Rites, match replay',
    `${pad('when')} ${ctx.when}`,
    `${pad('build')} ${BUILD_VERSION}`,
    `${pad('mode')} ${ctx.online ? 'online' : 'local'}`,
  ];
  if (ctx.online && ctx.roomCode) head.push(`${pad('room')} ${ctx.roomCode}`);
  head.push(
    `${pad('result')} ${outcome(state)}`,
    `${pad('length')} ${count(state.turn, 'turn')}, ${count(state.actions, 'action')}`,
    '',
    'Players',
    ...seats(state, ctx.seat),
  );

  // The log carries the turn each line belongs to, so the turns come straight off
  // it rather than being counted again here.
  const body: string[] = [];
  let turn: number | null = null;
  for (const entry of state.log) {
    if (entry.turn !== turn) {
      turn = entry.turn;
      body.push('', `Turn ${turn}`);
    }
    body.push(`  ${entry.text}`);
  }
  if (body.length === 0) body.push('', '(nothing happened)');

  return [...head, ...body, '', 'Final board', ...finalBoard(state), ''].join('\n');
}

/** A filename that sorts by date and says which match it was. */
export function retellingFilename(ctx: RetellingContext): string {
  const stamp = ctx.when.slice(0, 19).replace(/[:T]/g, '-');
  const room = ctx.online && ctx.roomCode ? `-${ctx.roomCode}` : '';
  return `ernum-rites-${stamp}${room}.txt`;
}

/**
 * The last finished match, written out and kept.
 *
 * Leaving the table throws the board away, because the next match needs the room
 * the old one was using. The story of it is a few kilobytes of text, so it is
 * written once when the result lands and held until a new match starts. That is
 * what lets the lobby offer a match the player has already walked away from.
 */
let told: { filename: string; text: string; version: number } | null = null;

export function rememberMatch(ctx: RetellingContext): void {
  if (told?.version === ctx.state.version) return;
  told = {
    filename: retellingFilename(ctx),
    text: matchRetelling(ctx),
    version: ctx.state.version,
  };
}

export function rememberedMatch(): { filename: string; text: string } | null {
  return told;
}

export function forgetMatch(): void {
  told = null;
}
