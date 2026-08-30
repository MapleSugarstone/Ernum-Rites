import type { PlayerIdx, TargetRef } from './types';

/** Anything that can activate a power or swing: a slot summon or the leader. */
export type SourceRef =
  | { kind: 'summon'; player: PlayerIdx; slot: number }
  | { kind: 'leader'; player: PlayerIdx };

/**
 * `enemy` names the player a card's implicit "the enemy" means, picked by
 * clicking their leader. Party games only: with one opponent it is never set,
 * and the engine answers NEEDS_ENEMY when a party action omits a needed one.
 */
export type Action =
  /** Face a card into the supporter row. One per turn. */
  | { type: 'PLAY_SUPPORTER'; handIndex: number }
  /** Manually tap a supporter for mana. Costs also auto-sap when needed. */
  | { type: 'SAP_SUPPORTER'; index: number }
  /** targets feed a battlecry that asks for them; required while any candidate exists. */
  | { type: 'PLAY_SUMMON'; handIndex: number; slot: number; targets?: TargetRef[]; enemy?: PlayerIdx }
  | { type: 'CAST_SPELL'; handIndex: number; targets: TargetRef[]; enemy?: PlayerIdx }
  | { type: 'PLAY_STAGE'; handIndex: number; enemy?: PlayerIdx }
  | { type: 'ACTIVATE_POWER'; source: SourceRef; powerIndex: number; targets: TargetRef[]; enemy?: PlayerIdx }
  /** The leader may attack too, at the cost of taking the counter-hit. */
  | { type: 'DECLARE_ATTACK'; source: SourceRef; target: TargetRef }
  /** Only legal inside a response window, only for the defender, once per battle. */
  | { type: 'CAST_TRAP'; handIndex: number; targets: TargetRef[] }
  | { type: 'PASS_RESPONSE' }
  /** Settle the front of the choice queue: a board pick, a revealed-card pick, or a skip. */
  | { type: 'RESOLVE_CHOICE'; pick?: TargetRef; index?: number }
  | { type: 'REPLACE_SUMMON'; handIndex: number; targets?: TargetRef[]; enemy?: PlayerIdx }
  | { type: 'DECLINE_REPLACE' }
  /** Pay for the flip at the front of the queue. handIndex feeds a discard cost. */
  | { type: 'PAY_FLIP'; handIndex?: number; enemy?: PlayerIdx }
  | { type: 'DECLINE_FLIP' }
  | { type: 'END_TURN' }
  | { type: 'CONCEDE' };

export type ActionType = Action['type'];

export type ApplyResult =
  | { ok: true; state: import('./state').GameState }
  | { ok: false; error: string };
