import type { GameState, PendingChoice } from './state';
import type { TargetRef } from './types';

/**
 * The half of a deferred choice that cannot live in state: what actually
 * happens once the player picks. Cards register these at load time under
 * stable keys, mirrored name for name in the C# engine, so a PendingChoice
 * carries only the key.
 */
export interface ChoicePick {
  ref?: TargetRef;
  index?: number;
}

export type ChoiceResolver = (state: GameState, choice: PendingChoice, pick: ChoicePick) => void;

const resolvers = new Map<string, ChoiceResolver>();

export function registerChoiceResolver(key: string, fn: ChoiceResolver): void {
  resolvers.set(key, fn);
}

export function runChoiceResolver(
  state: GameState,
  choice: PendingChoice,
  pick: ChoicePick,
): void {
  const fn = resolvers.get(choice.effect);
  if (!fn) throw new Error(`no choice resolver registered for ${choice.effect}`);
  fn(state, choice, pick);
}
