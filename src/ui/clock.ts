/**
 * The clock, drawn as a rope that burns down rather than a number counting.
 *
 * A number is precise and easy to ignore. A bar that shortens is read out of the
 * corner of an eye, which is what a player under time pressure is doing with it.
 * The number is still there, but it is the small part.
 *
 * Two clocks look different on purpose: your own turn is a long calm bar, while
 * being asked to answer something on the other player's turn is short and
 * urgent. A player should be able to tell which one they are on without reading.
 */
import { fractionLeft, isRoping, secondsLeft, type Clock } from '../engine/timing';
import type { PlayerIdx } from '../engine/types';

export interface ClockView {
  clock: Clock | null;
  /** The seat this client is sitting in, so the bar knows whose time is burning. */
  seat: PlayerIdx;
  /** Room clock minus local clock, added before anything is measured. */
  skewMs: number;
}

const LABEL: Record<Clock['kind'], string> = {
  turn: 'your turn',
  response: 'respond',
  mulligan: 'opening hand',
};

export function clockHtml(view: ClockView, now = Date.now()): string {
  const { clock, seat, skewMs } = view;
  if (!clock) return '<div class="clock clock-idle"></div>';

  const mine = clock.player === seat;
  const left = secondsLeft(clock, now, skewMs);
  const frac = fractionLeft(clock, now, skewMs);
  const roping = isRoping(clock, now, skewMs);

  const classes = [
    'clock',
    `clock-${clock.kind}`,
    mine ? 'clock-mine' : 'clock-theirs',
    roping ? 'clock-rope' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const label = mine ? LABEL[clock.kind] : 'waiting';
  // The bar is the thing being read, so it carries the accessible name and the
  // number is decoration beside it.
  return `<div class="${classes}" role="timer" aria-label="${label}, ${left} seconds left">
    <span class="clock-label">${label}</span>
    <span class="clock-track"><span class="clock-fill" style="--left:${(frac * 100).toFixed(2)}%"></span></span>
    <span class="clock-count">${left}</span>
  </div>`;
}

/**
 * Whether the bar needs redrawing this frame. The whole point is a bar that
 * moves, so it repaints on a timer, but only while a clock is actually running.
 */
export function clockIsLive(clock: Clock | null, now: number, skewMs: number): boolean {
  return !!clock && secondsLeft(clock, now, skewMs) > 0;
}
