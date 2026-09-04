/**
 * Timers for online play, shared by the room and every client so that both sides
 * count the same thing.
 *
 * There are two lengths: a long one for your own turn, and a much shorter one
 * for answering something the opponent did. The bar turns red near the end
 * instead of showing a number the whole time. Every value here is meant to be
 * tuned.
 */

/** Windows a player can be waiting in, longest first. */
export type ClockKind = 'turn' | 'response' | 'mulligan';

export const CLOCK_SECONDS: Record<ClockKind, number> = {
  /** Your own main phase: play, attack, activate, then end. */
  turn: 60,
  /**
   * Answering something on the other player's turn: springing a trap, paying for
   * a flip, filling a hole a dead body left. Short on purpose. These windows
   * interrupt somebody else's turn, and a player who wants to think has already
   * had their own clock to do it in.
   */
  response: 15,
  /** Opening hand decisions, before either clock starts. */
  mulligan: 45,
};

/**
 * Which clock a position is on. Anything queued in front of the main phase is
 * somebody answering something, and answers get the short window even when the
 * player answering is the one whose turn it is.
 */
export function clockKindFor(state: {
  pending: unknown;
  choiceQueue: readonly unknown[];
  flipQueue: readonly unknown[];
  replaceQueue: readonly unknown[];
}): ClockKind {
  if (state.pending) return 'response';
  if (state.choiceQueue.length > 0) return 'response';
  if (state.flipQueue.length > 0) return 'response';
  if (state.replaceQueue.length > 0) return 'response';
  return 'turn';
}

/**
 * The last stretch, when the rope catches. Purely a display threshold: nothing
 * about the rules changes, the bar just stops being ignorable.
 */
export const ROPE_SECONDS = 10;

/**
 * Added to every deadline the room enforces, and to nothing the client draws.
 * A packet in flight must not cost a player their turn, so the authority is
 * slightly more forgiving than the bar the player is watching.
 */
export const NETWORK_GRACE_SECONDS = 3;

/** Milliseconds a clock of this kind runs for, as the room enforces it. */
export function enforcedMs(kind: ClockKind): number {
  return (CLOCK_SECONDS[kind] + NETWORK_GRACE_SECONDS) * 1000;
}

/** Milliseconds a clock of this kind runs for, as the player sees it. */
export function displayedMs(kind: ClockKind): number {
  return CLOCK_SECONDS[kind] * 1000;
}

/**
 * Seconds a turn loses for each turn its player let pass without acting.
 *
 * A player who is not there should not cost everyone else a full minute of
 * staring at their timer, and the loss compounds so a table with an absent seat
 * speeds up rather than crawling. It is spent the moment they act again, since
 * the point is to move past somebody who is gone rather than to punish somebody
 * who is thinking.
 */
export const SKIP_PENALTY_SECONDS = 15;

/**
 * The shortest a turn can shrink to. A clock of nothing would fire its alarm in
 * the same instant it was set, which is a loop rather than a fast turn, and a
 * player coming back to the table needs long enough to notice it is their move.
 */
export const MIN_TURN_SECONDS = 10;

/**
 * How long a seat is held for a player whose connection went.
 *
 * Long enough for a phone to change network, a router to come back, or a page
 * to be reloaded; short enough that a player who really has gone does not hold
 * the table. Their turns keep timing out while they are away, so the match is
 * not paused, it just goes on without them.
 */
export const AWAY_GRACE_SECONDS = 90;

/** Seconds a turn runs for, given how many turns its player has let pass. */
export function turnSecondsFor(skips: number): number {
  const n = Math.max(0, Math.floor(skips));
  return Math.max(MIN_TURN_SECONDS, CLOCK_SECONDS.turn - n * SKIP_PENALTY_SECONDS);
}

/** The same, as the room enforces it: the player's window plus the room's margin. */
export function enforcedTurnMs(skips: number): number {
  return (turnSecondsFor(skips) + NETWORK_GRACE_SECONDS) * 1000;
}

/**
 * Seconds added to the turn timer for the first card a player plays on their
 * own turn. Playing cards costs time that stalling does not, so the timer pays
 * some of it back. The amount decreases with each play, which stops a player
 * from extending one turn indefinitely with cheap cards.
 */
export const PLAY_BONUS_SECONDS = 1.5;

/** The number of plays in one turn after which the fading part reaches 0. */
export const PLAY_BONUS_CARDS = 10;

/** Milliseconds every play pays on top of the fading curve, however deep it is. */
export const PLAY_BONUS_FLOOR_MS = 1000;

/**
 * Returns the milliseconds added for the nth card played this turn, counting
 * from 1. The count resets each turn, so the next turn starts at the full
 * bonus. The flat second under the curve means a turn spent playing cards is
 * never shorter than one spent stalling, however many cards it plays.
 */
export function playBonusMs(nth: number): number {
  if (nth < 1) return 0;
  const curve =
    nth > PLAY_BONUS_CARDS
      ? 0
      : Math.round((PLAY_BONUS_SECONDS * 1000 * (PLAY_BONUS_CARDS - nth + 1)) / PLAY_BONUS_CARDS);
  return curve + PLAY_BONUS_FLOOR_MS;
}

/**
 * Reports whether an action plays a card from a hand, which is what earns the
 * bonus. CAST_TRAP is included for completeness, but a trap only resolves during
 * an opponent's turn and the room gives the bonus to the active player only.
 */
export function isCardPlay(type: import('./actions').ActionType): boolean {
  return (
    type === 'PLAY_SUPPORTER' ||
    type === 'PLAY_SUMMON' ||
    type === 'CAST_SPELL' ||
    type === 'PLAY_STAGE' ||
    type === 'REPLACE_SUMMON' ||
    type === 'CAST_TRAP'
  );
}

/** A running clock, as it travels over the wire. */
export interface Clock {
  kind: ClockKind;
  /** Who is on the clock. Everyone else is waiting and cannot time out. */
  player: import('./types').PlayerIdx;
  /** Wall clock ms since the epoch, on the room's clock, when the bar empties. */
  endsAt: number;
  /** How long this clock ran in total, so a client can draw the fraction left. */
  totalMs: number;
}

/**
 * The clock as the player experiences it. The room's grace is the authority's
 * own margin for a packet in flight, so it is no part of the window a player is
 * being asked to act inside, and nothing client-side should count it.
 */
export function asDisplayed(clock: Clock): Clock {
  return {
    ...clock,
    endsAt: clock.endsAt - NETWORK_GRACE_SECONDS * 1000,
    // Subtract the grace from the length the room granted instead of
    // recomputing it from the kind, so a turn extended by play bonuses
    // displays its real length.
    totalMs: Math.max(0, clock.totalMs - NETWORK_GRACE_SECONDS * 1000),
  };
}

/** Fraction of a clock still to run, 1 at the start and 0 once it is out. */
export function fractionLeft(clock: Clock, now: number, skewMs = 0): number {
  const left = clock.endsAt - (now + skewMs);
  if (clock.totalMs <= 0) return 0;
  return Math.max(0, Math.min(1, left / clock.totalMs));
}

/** Whole seconds still to run, for the number beside the bar. */
export function secondsLeft(clock: Clock, now: number, skewMs = 0): number {
  return Math.max(0, Math.ceil((clock.endsAt - (now + skewMs)) / 1000));
}

/** Whether the rope has caught and the bar should be shouting about it. */
export function isRoping(clock: Clock, now: number, skewMs = 0): boolean {
  return secondsLeft(clock, now, skewMs) <= ROPE_SECONDS;
}
