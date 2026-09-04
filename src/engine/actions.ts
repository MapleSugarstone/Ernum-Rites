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
  /** Run your own Store for 2 debt plus its surcharge. Targets are asked after. */
  | { type: 'USE_STORE'; source: SourceRef }
  /** Open a negotiation on another player's Store, on your own main step. */
  | { type: 'OPEN_STORE'; source: SourceRef }
  /** Seller only: put a price on the table. A final offer ends countering. */
  | { type: 'STORE_OFFER'; price: number; final?: boolean }
  /** Buyer only: send a different price back. Not against a final offer. */
  | { type: 'STORE_COUNTER'; price: number }
  /** Close the deal at the other side's price. Targets are asked after. */
  | { type: 'STORE_ACCEPT' }
  /** Buyer only: walk away. The Store is closed to them for the turn. */
  | { type: 'STORE_REJECT' }
  | { type: 'END_TURN' }
  | { type: 'CONCEDE' };

export type ActionType = Action['type'];

export type ApplyResult =
  | { ok: true; state: import('./state').GameState }
  | { ok: false; error: string };
