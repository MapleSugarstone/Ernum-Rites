/**
 * Clocks for online play, shared by the room and both clients so nobody has to
 * guess what the other is counting.
 *
 * Modelled on Legends of Runeterra: a long window for the turn you are actually
 * playing, a much shorter one for answering something the other player did, and
 * a rope that starts burning near the end rather than a number ticking the whole
 * time. The numbers are ours, chosen to feel like that game rather than copied
 * from it, and every one of them is meant to be tuned.
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
 * Seconds handed back for the first card a player plays on their own turn.
 *
 * A turn spent playing is not a turn spent stalling, so the clock gives a little
 * of itself back for each card that goes down. The refund shrinks with every
 * play so a hand of cheap cards cannot be walked into an unlimited turn.
 */
export const PLAY_BONUS_SECONDS = 1.5;

/** Plays in one turn by which the refund has faded to nothing. */
export const PLAY_BONUS_CARDS = 10;

/**
 * Milliseconds returned for the nth card played this turn, counting from 1. The
 * count is per turn: the next turn starts back at a full refund.
 */
export function playBonusMs(nth: number): number {
  if (nth < 1 || nth > PLAY_BONUS_CARDS) return 0;
  return Math.round((PLAY_BONUS_SECONDS * 1000 * (PLAY_BONUS_CARDS - nth + 1)) / PLAY_BONUS_CARDS);
}

/**
 * Whether an action is a card leaving a hand, which is what earns the refund.
 * A trap is on the list but only ever springs on somebody else's turn, and the
 * room hands the refund out to the active player alone.
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
    // Taken off what the room actually granted rather than recomputed from the
    // kind, so a turn extended by the play refund draws its real length.
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
