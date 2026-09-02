import type {
  CardColour,
  CardDef,
  ManaKind,
  Phase,
  PlayerIdx,
  Power,
  TargetRef,
} from './types';

export const SUMMON_SLOTS = 3;
export const DEBT_LIMIT = 25;
/** Party games run longer and spread the damage out, so the cliff sits higher. */
export const PARTY_DEBT_LIMIT = 30;
/**
 * Hard stops so a match cannot run forever. Real games end in under thirty
 * turns and a couple of hundred actions, so these only catch a lock.
 */
export const MAX_TURNS = 500;
export const MAX_ACTIONS = 1000;
export const DRAW_PER_TURN = 2;
export const OPENING_HAND = 5;
/** The player going second draws this many extra cards to open. */
export const OPENING_HAND_BONUS = 0;
/** Extra opening cards everyone draws in a 3-4 player party game. */
export const PARTY_HAND_BONUS = 2;
/** A hand holds no more than this. Cards arriving past it go to the discard pile. */
export const HAND_LIMIT = 10;

/** A card placed face down under a summon as one point of HP. */
export interface HpCard {
  cardId: string;
  flipped: boolean;
}

export interface StrengthMod {
  amount: number;
  /** 'turn' mods are cleared during the end phase of the turn they were made. */
  duration: 'turn' | 'permanent';
  /**
   * Card that put it there, so a client can name what is moving a body's
   * numbers. Presentation only: it changes nothing about play and is left out
   * of the digest, the same way log wording and uids are.
   */
  source?: string;
}

export interface SummonInstance {
  uid: string;
  cardId: string;
  owner: PlayerIdx;
  /** True for the leader, which sits behind the slots and cannot attack. */
  isLeader: boolean;
  hp: HpCard[];
  sapped: boolean;
  /** Reborn and Frenzy each fire once for a given body. */
  rebornUsed?: boolean;
  frenzyUsed?: boolean;
  wounds: number;
  /**
   * Power Shields. Each stops one instance of damage outright, however large,
   * and is spent doing it. Robot's keyword.
   */
  shields: number;
  strengthMods: StrengthMod[];
  /**
   * Effect Damage granted to this body after it entered play, on top of what
   * its card prints. Held per body rather than per card because a power can
   * hand it out, and it dies with the body that earned it.
   */
  effectDamageMod: number;
  /** Power name -> times used this turn, for oncePerTurn. */
  powerUses: Record<string, number>;
  /** Set when a card is put into play as something else (Virus's theft). */
  override?: {
    strength: number;
    color: CardColour;
    level: number;
  };
  /** Made Stationary by an effect: it never declares an attack again. */
  rooted?: boolean;
  /** The next time this body would unsap, it stays sapped instead (Pointer). */
  sapLock?: boolean;
  /** Card id whose Deathrattle this body fires in addition to its own. */
  bestowed?: string;
  enteredTurn: number;
}

export interface Supporter {
  cardId: string;
  sapped: boolean;
  /** Reborn and Frenzy each fire once for a given body. */
  rebornUsed?: boolean;
  frenzyUsed?: boolean;
}

export interface PlayerState {
  name: string;
  deck: string[];
  hand: string[];
  /** Bodies this player owes for. Only these feed the debt counter. */
  debt: string[];
  /**
   * Everything else that has been spent: HP cards a summon was wearing, cast
   * spells, sprung traps, replaced stages, mills and discards. Public, and costs
   * nothing by itself.
   */
  discard: string[];
  /** Only dead summons increment this. Reaching DEBT_LIMIT loses the game. */
  debtCount: number;
  supporters: Supporter[];
  /** Fixed length SUMMON_SLOTS. */
  slots: (SummonInstance | null)[];
  leader: SummonInstance | null;
  leaderCardId: string;
  stage: string | null;
  /** Five colours then colourless, so this has six entries. */
  mana: Record<ManaKind, number>;
  /** Supporters this player may still face this turn. One a turn, plus what cards grant. */
  supportersLeft: number;
  /** Effect Damage waiting on this player's next spell this turn. */
  spellBonus: number;
  /**
   * Turns this player may not fill an empty slot. Oil's curse: the hole a
   * dead summon leaves stays open, and the leader behind it stays exposed.
   */
  replaceLocked: number;
  /**
   * Extra colourless this player pays on every spell and trap they cast. Oil and
   * Robot put it there and it stays until something takes it off.
   */
  spellTax: number;
  leaderPlayed: boolean;
  turnsTaken: number;
  /** Times this deck has run dry. Each one costs more than the last. */
  deckOuts: number;
  /**
   * Knocked out of a party game: board swept, turns skipped, still watching.
   * Never set in a 2-player game, where a loss ends the match instead.
   */
  eliminated?: boolean;
}

/** A declared battle waiting on the defender's trap window. */
export interface PendingBattle {
  attacker: TargetRef;
  defender: TargetRef;
  trapUsed: boolean;
}

/** A spell waiting on the other side's response window before it resolves. */
export interface PendingSpell {
  caster: PlayerIdx;
  cardId: string;
  targets: TargetRef[];
  /** Enemy the caster picked for the spell's implicit "the enemy". Party games only. */
  enemy?: PlayerIdx;
}

/**
 * One response window at a time: an attack waiting on a trap, or an enemy
 * spell waiting on a Spell Trap. Exactly one of battle and spell is set.
 */
export type Pending = {
  kind: 'response';
  player: PlayerIdx;
  battle: PendingBattle | null;
  spell: PendingSpell | null;
  /**
   * Enemies still owed this spell's response window after the current one, in
   * turn order. Party games only: with one opponent there is never a queue.
   */
  queue?: PlayerIdx[];
};

/** A costed flip waiting on its owner to pay for it or wave it away. */
export interface FlipOffer {
  player: PlayerIdx;
  /** The summon the card is protecting. */
  holder: TargetRef;
  cardId: string;
  /**
   * Points of the same blow still to land once this flip is answered. A costed
   * flip stops the damage that revealed it, so a card that would save the body
   * gets its chance before the body is gone.
   */
  pending: number;
  /**
   * Nesting depth the blow was at, carried so the resumed half is held to the
   * same recursion guard as the first half. Left out of the digest for the same
   * reason instance uids are: it bounds the engine rather than describing the
   * position.
   */
  depth: number;
}

export interface LogEntry {
  turn: number;
  player: PlayerIdx | null;
  text: string;
}

export interface GameState {
  /** Set from attack declaration until the clash finishes, for triggers and traps. */
  battle: PendingBattle | null;
  seed: number;
  rngState: number;
  nextUid: number;
  turn: number;
  active: PlayerIdx;
  startingPlayer: PlayerIdx;
  phase: Phase;
  /** Two players normally; three or four in a party game. */
  players: PlayerState[];
  pending: Pending | null;
  /**
   * Owner of the summon currently dying, set only while onOtherDeath triggers
   * run so a watcher can ask whose body fell. Always null between actions.
   */
  dyingOwner: PlayerIdx | null;
  /** Card id of the summon currently dying, for onOtherDeath to read. */
  dyingCardId: string | null;
  /** Owners of slots that just emptied, each owed one immediate replacement. */
  replaceQueue: { player: PlayerIdx; slot: number }[];
  /** Costed flips turned over this battle, waiting on a decision. */
  flipQueue: FlipOffer[];
  /** Decisions effects deferred to a player, settled before anything else moves. */
  choiceQueue: PendingChoice[];
  winner: PlayerIdx | null;
  winReason: string | null;
  /** True when the match hit a hard stop with nobody having won. */
  drawn: boolean;
  /** Actions applied so far, against MAX_ACTIONS. */
  actions: number;
  log: LogEntry[];
  /**
   * Cards whose own text did something during the last action, in the order it
   * happened, so a client can say so. Not part of the game: cleared at the top
   * of every action and left out of the digest.
   */
  fx: { cardId: string; player: PlayerIdx; at: TargetRef }[];
  /** Incremented on every applied action, for reconciliation with a server. */
  version: number;
}

export function otherPlayer(p: PlayerIdx): PlayerIdx {
  return p === 0 ? 1 : 0;
}

/** Whether this is a 3-4 player party game. */
export function isParty(state: GameState): boolean {
  return state.players.length > 2;
}

/** The debt a player loses at, which sits higher in a party game. */
export function debtLimitOf(state: GameState): number {
  return isParty(state) ? PARTY_DEBT_LIMIT : DEBT_LIMIT;
}

/** Living players in seat order. In a 2-player game, both. */
export function livingPlayers(state: GameState): PlayerIdx[] {
  const out: PlayerIdx[] = [];
  for (let p = 0 as PlayerIdx; p < state.players.length; p++) {
    if (!state.players[p].eliminated) out.push(p);
  }
  return out;
}

/**
 * Living opponents of `me`, in turn order starting with whoever acts next
 * after `me`. In a 2-player game this is always the one other player.
 */
export function livingOpponents(state: GameState, me: PlayerIdx): PlayerIdx[] {
  const n = state.players.length;
  const out: PlayerIdx[] = [];
  for (let step = 1; step < n; step++) {
    const p = ((me + step) % n) as PlayerIdx;
    if (!state.players[p].eliminated) out.push(p);
  }
  return out;
}

/** The next living player after `from` in seat order. */
export function nextLiving(state: GameState, from: PlayerIdx): PlayerIdx {
  const foes = livingOpponents(state, from);
  return foes.length > 0 ? foes[0] : from;
}

export function emptyMana(): Record<ManaKind, number> {
  return { P: 0, O: 0, R: 0, F: 0, S: 0, C: 0 };
}

/** Current strength: base (or override) plus all modifiers, floored at 0. */
/** Whether the match has finished, by a win or by hitting a hard stop. */
export function isOver(state: GameState): boolean {
  return state.winner !== null || state.drawn;
}

export function strengthOf(s: SummonInstance, def: CardDef): number {
  const base = s.override ? s.override.strength : (def.strength ?? 0);
  const mods = s.strengthMods.reduce((n, m) => n + m.amount, 0);
  return Math.max(0, base + mods);
}

/** Level 1-3. This is the debt a summon is worth when it dies. */
export function levelOf(s: SummonInstance, def: CardDef): number {
  return s.override ? s.override.level : (def.level ?? 1);
}

export function colorOf(s: SummonInstance, def: CardDef): CardColour {
  return s.override ? s.override.color : def.color;
}

export function remainingHp(s: SummonInstance): number {
  return s.hp.filter((h) => !h.flipped).length;
}

/**
 * A card played as something else keeps no printed powers. Borrowed Powers do
 * not appear here: Graft and Living Curse mint a card carrying them, so the
 * body's own printed list is always the whole truth.
 */
export function powersOf(s: SummonInstance, def: CardDef): Power[] {
  return s.override ? [] : (def.powers ?? []);
}

export function findSummon(state: GameState, ref: TargetRef): SummonInstance | null {
  if (ref.kind === 'summon') return state.players[ref.player].slots[ref.slot] ?? null;
  if (ref.kind === 'leader') return state.players[ref.player].leader;
  return null;
}

/** Every summon in play on both sides, leaders included. */
export function allSummons(state: GameState): { ref: TargetRef; summon: SummonInstance }[] {
  const out: { ref: TargetRef; summon: SummonInstance }[] = [];
  for (let p = 0 as PlayerIdx; p < state.players.length; p++) {
    state.players[p].slots.forEach((s, i) => {
      if (s) out.push({ ref: { kind: 'summon', player: p, slot: i }, summon: s });
    });
    const h = state.players[p].leader;
    if (h) out.push({ ref: { kind: 'leader', player: p }, summon: h });
  }
  return out;
}

export function hasFieldSummon(p: PlayerState): boolean {
  return p.slots.some((s) => s !== null);
}

/**
 * A decision an effect could not make on its own: pick a target on the board,
 * or pick from a row of revealed cards. Held as plain data so it digests,
 * clones and replays; the effect's remaining work lives in a resolver both
 * engines register under the same key.
 */
export interface PendingChoice {
  player: PlayerIdx;
  /** Card whose effect is waiting, for the prompt. */
  source: string;
  /** Resolver key, registered by the card set. */
  effect: string;
  prompt: string;
  /** Board mode: pick one of these. */
  refs?: TargetRef[];
  /** Reveal mode: these cards are face up, held out of every zone. */
  cards?: string[];
  /** Indices into cards that may be picked. */
  legal?: number[];
  /** May resolve with no pick at all. */
  optional?: boolean;
  /** A ref the resolver needs beyond the pick, e.g. the body being changed. */
  at?: TargetRef;
  /**
   * The enemy this effect is aimed at, for resolvers that would otherwise infer
   * "whoever isn't choosing". Party games only.
   */
  victim?: PlayerIdx;
}

/**
 * Whether the waiting choice is the thing the game is actually asking about.
 *
 * A Strike fires as an attack is declared and can queue a choice for the
 * attacker, and the response window then opens for the defender. The game is
 * waiting on the defender, so a client that draws the head of the choice queue
 * whenever its own seat may act hands them a prompt no action of theirs can
 * resolve, over the top of the trap window they are actually being asked about.
 * This is the same priority `currentActor` reads, stated once so both agree.
 */
export function choiceIsLive(state: GameState): boolean {
  return state.choiceQueue.length > 0 && !state.pending;
}

/**
 * Whether a ref names a body that has left the board, as opposed to one that
 * has not arrived yet. A leader enters at the start of its controller's first
 * turn, so a seat that has yet to take one still names a leader that is coming,
 * and an effect may legitimately offer that seat as a pick.
 */
export function refIsGone(state: GameState, ref: TargetRef): boolean {
  if (ref.kind !== 'summon' && ref.kind !== 'leader') return false;
  if (findSummon(state, ref)) return false;
  return ref.kind !== 'leader' || state.players[ref.player].leaderPlayed;
}

/** Whoever the game is currently waiting on, which is not always the active player. */
export function currentActor(state: GameState): PlayerIdx {
  if (state.pending) return state.pending.player;
  // Deferred decisions settle before flips, flips before refilling the hole.
  if (state.choiceQueue.length > 0) return state.choiceQueue[0].player;
  if (state.flipQueue.length > 0) return state.flipQueue[0].player;
  if (state.replaceQueue.length > 0) return state.replaceQueue[0].player;
  return state.active;
}

/** The attacker in the battle currently resolving, if any. */
export function battleAttacker(state: GameState): TargetRef | null {
  return state.battle ? state.battle.attacker : null;
}

/** The defender in the battle currently resolving, if any. */
export function battleDefender(state: GameState): TargetRef | null {
  return state.battle ? state.battle.defender : null;
}
