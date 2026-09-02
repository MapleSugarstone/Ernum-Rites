import type { Action, SourceRef } from '../engine/actions';
import { digestOf } from '../engine/digest';
import { effectiveStrength, reshuffleCost } from '../engine/effects';
import {
  applyAction,
  availableMana,
  canPay,
  costFor,
  legalAttackTargets,
  powerBlockers,
  readyAttackers,
  targetCandidates,
} from '../engine/engine';
import { deckIdentity, isLegalUnder } from '../engine/identity';
import { allCards, card } from '../engine/registry';
import {
  DRAW_PER_TURN,
  currentActor,
  debtLimitOf,
  findSummon,
  isOver,
  levelOf,
  livingOpponents,
  powersOf,
  remainingHp,
  type GameState,
} from '../engine/state';
import {
  COPY_LIMIT,
  MANA_KINDS,
  costColored,
  type CardDef,
  type PlayerIdx,
  type TargetRef,
  type TargetSpec,
} from '../engine/types';

/**
 * A searching bot. Every part of it plays actions out on copies of the state
 * and reads the result, so it knows nothing about any particular card and a new
 * card needs no bot support at all.
 *
 * Three searches run on an open turn, each covering what the others miss.
 *
 * `burn` plays the turn out choosing whichever action takes the most off the
 * enemy's clocks. It is the only part that can find a long combo, because it
 * never consults the evaluator about whether a step looks sensible.
 *
 * `searchTurn` is a beam over sequences of this turn's actions, scored by the
 * evaluator at the point the turn would end. It is what orders a turn
 * correctly: a Power fired before the body that owns it attacks and saps.
 *
 * `threatOf` measures what the board left standing could still do if the turn
 * came round again. It is the reason to hold a combo rather than spend it for
 * chip damage, and without it the bot cashes every piece the moment it can.
 */

export interface BotWeights {
  leaderHp: number;
  debt: number;
  /** Panic term once a player is within two debt of losing. */
  debtCliff: number;
  /**
   * Charged per point a leader is below `LEADER_CLIFF_AT`, on top of the flat
   * rate. The last points of a leader are worth more than the first, and a flat
   * rate says otherwise: it prices nine HP spared off a leader on thirty at
   * exactly what it prices nine spared off a leader on ten.
   */
  leaderCliff: number;
  strength: number;
  hp: number;
  level: number;
  wound: number;
  hand: number;
  /** Extra per level above 1 for a card in hand, so a hand is not just a count. */
  handLevel: number;
  supporter: number;
  /** Per card of deck remaining, capped, so it will not mill itself dry. */
  deck: number;
  /**
   * Per level 3 card still in the deck, capped. The bot reads its own deck
   * while it plans, so "my answer is still in there" is a fact available to it
   * rather than a guess, and a deck holding its win condition is worth more
   * than the same number of cards without it.
   */
  deckLevel: number;
  stage: number;
  /**
   * Per point of the enemy's nearer clock the standing board could still take
   * off next turn. Priced below `leaderHp` because the opponent gets a turn to
   * answer, which is what keeps the bot spending small Powers for chip damage
   * while holding the pieces of something larger.
   */
  threat: number;
  /** A kill that is already assembled but not reachable until next turn. */
  standingKill: number;
  /**
   * How much of a position's score is read after the opponent has answered it
   * rather than where it stands. The rest is read where it stands, because the
   * reply is a greedy guess and a position should not be judged entirely on
   * one guess about it.
   */
  reply: number;
  /** What opening a response window costs when they are certainly holding a trap. */
  trapWindow: number;
}

export const defaultWeights: BotWeights = {
  leaderHp: 8,
  debt: 12,
  debtCliff: 40,
  leaderCliff: 6,
  strength: 3,
  hp: 2.5,
  level: 2,
  wound: 2,
  hand: 1.5,
  handLevel: 1,
  // Worth more than the card is in hand, so the bot always makes its land drop.
  supporter: 2,
  deck: 0.15,
  deckLevel: 0.5,
  stage: 3,
  threat: 4,
  standingKill: 60,
  reply: 0.6,
  trapWindow: 12,
};

const DECK_VALUE_CAP = 20;
/** Leader HP below which the cliff term starts charging. */
const LEADER_CLIFF_AT = 6;
/** Level 3 cards in the deck counted before the term stops growing. */
const OUTS_CAP = 6;
/** Draw steps the deck-out bill is projected over. */
const FATIGUE_LOOKAHEAD = DRAW_PER_TURN * 3;

export function evaluate(state: GameState, me: PlayerIdx, w = defaultWeights): number {
  if (state.winner === me) return 1e9;
  if (state.winner !== null) return -1e9;

  let score = 0;
  // Every living opponent, not just one. A party game seats up to four, and a
  // bot that scored only the seat opposite it was blind to half the table.
  const sides: { side: PlayerIdx; sign: number }[] = [{ side: me, sign: 1 }];
  for (const foe of livingOpponents(state, me)) sides.push({ side: foe, sign: -1 });

  for (const { side, sign } of sides) {
    const p = state.players[side];

    const hp = p.leader ? remainingHp(p.leader) : 0;
    score += sign * w.leaderHp * hp;
    // Graded rather than a step, so the search is not sitting on a knife edge
    // one point of damage wide.
    score -= sign * w.leaderCliff * Math.max(0, LEADER_CLIFF_AT - hp);

    const cliff = p.debtCount >= debtLimitOf(state) - 2 ? w.debtCliff : 0;
    score -= sign * (w.debt * p.debtCount + cliff);

    for (const s of p.slots) {
      if (!s) continue;
      score +=
        sign *
        (w.strength * effectiveStrength(state, s) +
          w.hp * remainingHp(s) +
          w.level * levelOf(s, card(s.cardId)) -
          w.wound * s.wounds);
    }

    // Cards in hand are not interchangeable, and the game says so with levels.
    let hand = 0;
    for (const id of p.hand) hand += w.hand + w.handLevel * ((card(id).level ?? 1) - 1);
    score += sign * hand;

    score += sign * w.supporter * p.supporters.length;
    score += sign * w.deck * Math.min(p.deck.length, DECK_VALUE_CAP);

    let outs = 0;
    for (const id of p.deck) {
      if ((card(id).level ?? 1) >= 3 && ++outs >= OUTS_CAP) break;
    }
    score += sign * w.deckLevel * outs;

    score += sign * (p.stage ? w.stage : 0);

    // What running dry will cost, at the price the engine will actually charge
    // for it: a bill that climbs every time this deck has already done it.
    // Charged in proportion to how near the next few draw steps come to the end.
    // The old term charged a flat debt per card missing from the next two draws,
    // which both overcharged a deck one card short and could not see that a deck
    // which had already cycled twice owes three times as much for the next one.
    const near = Math.min(1, Math.max(0, FATIGUE_LOOKAHEAD - p.deck.length) / FATIGUE_LOOKAHEAD);
    if (near > 0) score -= sign * w.debt * reshuffleCost(state, side) * near;
  }
  return score;
}

/**
 * An attack that opens a trap window is judged on what happens after the window
 * closes, otherwise the bot sees no change and never swings at anyone holding a
 * trap. It assumes the trap is not sprung.
 */
function settle(state: GameState): GameState {
  if (!state.pending) return state;
  const res = applyAction(state, state.pending.player, { type: 'PASS_RESPONSE' });
  return res.ok ? res.state : state;
}

const MAX_COMBOS = 48;

/**
 * How hard the bot thinks.
 *
 * The searching bot is the one that plays: it reads a whole turn, the reply to
 * it, and what the board still threatens after that, and it costs about two
 * cpu-seconds a game. That is the right price to pay a player and the wrong one
 * to pay a test suite that only wants to know the game still runs, so the size
 * of every search lives here and can be turned down.
 *
 * Turning it down makes a worse player, not a broken one. Every search still
 * runs; each simply looks at less.
 */
export interface SearchLimits {
  /** Positions the turn search carries forward from one action to the next. */
  beamWidth: number;
  /** Actions deep one turn is searched. */
  maxTurnDepth: number;
  /** Applies the turn search spends before it settles for the best line so far. */
  searchBudget: number;
  /** Actions the clock rollout plays out before it gives up on a kill. */
  maxBurnSteps: number;
  /** Actions the same rollout spends building up before it starts swinging. */
  maxSetupSteps: number;
  /** Actions it spends building up when it is only measuring a threat. */
  maxThreatSetup: number;
  /** Actions the same rollout plays out when it is only measuring a threat. */
  maxThreatSteps: number;
  /** End-of-turn positions the opponent's reply is played out against. */
  threatLeaves: number;
  /** Actions the opponent is given to answer a position with. */
  maxReplySteps: number;
  /** Actions deep the exhaustive kill search will look. */
  lethalDepth: number;
  /** Applies that search spends before it gives up. */
  lethalBudget: number;
}

/** What a player faces. */
export const fullSearch: SearchLimits = {
  beamWidth: 12,
  maxTurnDepth: 10,
  searchBudget: 6000,
  maxBurnSteps: 60,
  maxSetupSteps: 30,
  maxThreatSetup: 10,
  maxThreatSteps: 24,
  threatLeaves: 6,
  maxReplySteps: 14,
  lethalDepth: 3,
  lethalBudget: 2500,
};

/**
 * Enough to play legally and finish a game, and not much more.
 *
 * For the suites that ask whether the game still runs rather than whether the
 * bot plays well. The turn search keeps a single line, the rollouts stop after
 * a few steps and nobody's reply is played out, which is roughly the one-ply
 * bot this replaced.
 */
export const quickSearch: SearchLimits = {
  beamWidth: 3,
  maxTurnDepth: 8,
  searchBudget: 600,
  maxBurnSteps: 10,
  maxSetupSteps: 0,
  maxThreatSetup: 0,
  maxThreatSteps: 0,
  // Not zero. The leaves are the only place an action is compared against
  // standing still, so a profile with none of them can do nothing but pass.
  threatLeaves: 3,
  maxReplySteps: 0,
  lethalDepth: 2,
  lethalBudget: 300,
};

let limits: SearchLimits = fullSearch;

/** Swap how hard the bot thinks. Tests turn it down; the client never does. */
export function setSearchLimits(next: SearchLimits): void {
  limits = next;
  clearPlan();
}

export function searchLimits(): SearchLimits {
  return limits;
}
/**
 * How far short of a kill the rollout may come and still be worth an
 * exhaustive check. The rollout takes the largest hit available at every step,
 * which is not always the ordering that finishes.
 */
const LETHAL_SLACK = 6;
/** A win, scored above anything the evaluator can reach. */
const WIN = 1e9;

function targetCombos(
  state: GameState,
  me: PlayerIdx,
  specs: TargetSpec[] | undefined,
  source?: CardDef,
): TargetRef[][] {
  if (!specs || specs.length === 0) return [[]];
  let combos: TargetRef[][] = [[]];
  for (const spec of specs) {
    const cands = targetCandidates(state, me, spec, source);
    if (cands.length === 0) {
      if (!spec.optional) return [];
      continue;
    }
    const next: TargetRef[][] = [];
    for (const base of combos) {
      for (const t of cands) {
        // The engine rejects the same body picked twice in one action.
        if (
          (t.kind === 'summon' || t.kind === 'leader') &&
          base.some((r) => JSON.stringify(r) === JSON.stringify(t))
        ) {
          continue;
        }
        next.push([...base, t]);
      }
    }
    combos = next.length > MAX_COMBOS ? next.slice(0, MAX_COMBOS) : next;
  }
  return combos;
}

/** Battlecry targets: each spec is required only while it has a candidate. */
function enterCombos(state: GameState, me: PlayerIdx, def: CardDef): TargetRef[][] {
  const specs = def.targets;
  if (!specs || specs.length === 0) return [[]];
  return targetCombos(state, me, specs.map((s) => ({ ...s, optional: true })), def);
}

/** Every action the bot could legally take right now, excluding the pass. */
export function candidateActions(state: GameState, me: PlayerIdx): Action[] {
  const acts: Action[] = [];
  const p = state.players[me];

  // A response window outranks a queued choice, which is the order
  // `currentActor` reads them in. Checking the choice first handed no
  // candidates at all to a player whose trap window was open while somebody
  // else's choice sat at the head of the queue.
  if (state.pending) {
    if (state.pending.player !== me) return acts;
    const wantsSpellTrap = !!state.pending.spell;
    p.hand.forEach((id, handIndex) => {
      const def = card(id);
      if (def.type !== 'trap' || !canPay(p, costFor(p, def))) return;
      if ((def.spellTrap ?? false) !== wantsSpellTrap) return;
      for (const targets of targetCombos(state, me, def.targets, def)) {
        acts.push({ type: 'CAST_TRAP', handIndex, targets });
      }
    });
    return acts;
  }

  if (state.choiceQueue.length > 0) {
    const ch = state.choiceQueue[0];
    if (ch.player !== me) return acts;
    if (ch.cards) {
      for (const index of ch.legal ?? []) acts.push({ type: 'RESOLVE_CHOICE', index });
    } else {
      for (const pick of ch.refs ?? []) {
        if ((pick.kind === 'summon' || pick.kind === 'leader') && !findSummon(state, pick)) {
          continue;
        }
        acts.push({ type: 'RESOLVE_CHOICE', pick });
      }
    }
    if (ch.optional || acts.length === 0) acts.push({ type: 'RESOLVE_CHOICE' });
    return acts;
  }

  if (state.flipQueue.length > 0) {
    const offer = state.flipQueue[0];
    if (offer.player !== me) return acts;
    const cost = card(offer.cardId).flipCost;
    if (cost?.discard) {
      p.hand.forEach((_, handIndex) => acts.push({ type: 'PAY_FLIP', handIndex }));
    } else {
      acts.push({ type: 'PAY_FLIP' });
    }
    return acts;
  }

  if (state.replaceQueue.length > 0) {
    if (state.replaceQueue[0].player !== me) return acts;
    p.hand.forEach((id, handIndex) => {
      const def = card(id);
      if (def.type !== 'summon') return;
      for (const targets of enterCombos(state, me, def)) {
        acts.push({ type: 'REPLACE_SUMMON', handIndex, targets });
      }
    });
    return acts;
  }

  if (state.active !== me || state.phase !== 'main') return acts;

  if (p.supportersLeft > 0) {
    p.hand.forEach((_, handIndex) => acts.push({ type: 'PLAY_SUPPORTER', handIndex }));
  }

  p.hand.forEach((id, handIndex) => {
    const def = card(id);
    if (def.type === 'summon') {
      p.slots.forEach((occupant, slot) => {
        if (!occupant) {
          for (const targets of enterCombos(state, me, def)) {
            acts.push({ type: 'PLAY_SUMMON', handIndex, slot, targets });
          }
        }
      });
    } else if (def.type === 'spell' && canPay(p, costFor(p, def))) {
      for (const targets of targetCombos(state, me, def.targets, def)) {
        acts.push({ type: 'CAST_SPELL', handIndex, targets });
      }
    } else if (def.type === 'stage' && canPay(p, costFor(p, def))) {
      acts.push({ type: 'PLAY_STAGE', handIndex });
    }
  });

  const sources: SourceRef[] = [];
  p.slots.forEach((s, slot) => {
    if (s) sources.push({ kind: 'summon', player: me, slot });
  });
  if (p.leader) sources.push({ kind: 'leader', player: me });
  for (const source of sources) {
    const s = findSummon(state, source);
    if (!s) continue;
    powersOf(s, card(s.cardId)).forEach((power, powerIndex) => {
      if (powerBlockers(state, me, source, powerIndex)) return;
      for (const targets of targetCombos(state, me, power.targets)) {
        acts.push({ type: 'ACTIVATE_POWER', source, powerIndex, targets });
      }
    });
  }

  for (const attacker of readyAttackers(state, me)) {
    for (const target of legalAttackTargets(state, attacker)) {
      acts.push({ type: 'DECLARE_ATTACK', source: attacker, target });
    }
  }

  return acts;
}

/** The action taken when nothing on offer beats standing still. */
function passAction(state: GameState): Action {
  if (state.pending) return { type: 'PASS_RESPONSE' };
  if (state.choiceQueue.length > 0) {
    const ch = state.choiceQueue[0];
    if (ch.optional) return { type: 'RESOLVE_CHOICE' };
    if (ch.cards) return { type: 'RESOLVE_CHOICE', index: ch.legal?.[0] };
    const alive = (ch.refs ?? []).find((r) =>
      r.kind === 'summon' || r.kind === 'leader' ? !!findSummon(state, r) : true,
    );
    return alive ? { type: 'RESOLVE_CHOICE', pick: alive } : { type: 'RESOLVE_CHOICE' };
  }
  if (state.flipQueue.length > 0) return { type: 'DECLINE_FLIP' };
  if (state.replaceQueue.length > 0) return { type: 'DECLINE_REPLACE' };
  return { type: 'END_TURN' };
}

/**
 * A prior on cards nobody has seen. A deck is about fifty cards drawn from a
 * legal pool many times that size, so a card that has never surfaced is far
 * less likely to be in there than one whose other copy is already in the
 * discard. Cards that have shown up count in full and the rest count at this.
 */
const UNSEEN_WEIGHT = 0.25;

export interface EnemyRead {
  /** Share of the cards they could still be holding that are traps. */
  trapDensity: number;
  /** The cheapest trap their colours still allow them to be holding. */
  cheapestTrap: CardDef | null;
  /** The seat this read is about. */
  seat: PlayerIdx;
}

/**
 * What the opponent's public zones say about the deck behind them.
 *
 * Everything read here is face up to both players: the discard pile, the bodies
 * they owe debt for, their board and supporters and stage, and every HP card
 * that has been flipped. Their hand and the order of their deck are not read.
 *
 * Their leader is face up from turn one and fixes the colours their deck may
 * run, so the pool is known exactly. What is not known is which of it they
 * actually built with, and every card that surfaces settles a little more of
 * that: a card in the discard is proof its other copy is in the deck, where a
 * card nobody has seen is only proof that it was allowed.
 */
/** One read per living opponent: any of them can spring a trap on my attack. */
export function readTable(state: GameState, me: PlayerIdx): EnemyRead[] {
  return livingOpponents(state, me).map((foe) => readEnemy(state, foe));
}

export function readEnemy(state: GameState, seat: PlayerIdx): EnemyRead {
  const foe = state.players[seat];
  const pool = poolBehind(foe.leaderCardId);
  if (pool.total <= 0) return { trapDensity: 0, cheapestTrap: null, seat };

  const seen = new Map<string, number>();
  const note = (id: string) => {
    if (pool.legal.has(id)) seen.set(id, (seen.get(id) ?? 0) + 1);
  };

  for (const id of foe.discard) note(id);
  for (const id of foe.debt) note(id);
  for (const sup of foe.supporters) note(sup.cardId);
  if (foe.stage) note(foe.stage);
  for (const b of [...foe.slots, foe.leader]) {
    if (!b) continue;
    note(b.cardId);
    // An HP card is face down until something flips it, and face up after.
    for (const h of b.hp) if (h.flipped) note(h.cardId);
  }

  // The pool above counted every card as unseen. Only the handful that have
  // actually surfaced need correcting, which is what keeps this off the whole
  // set on every plan.
  let total = pool.total;
  let traps = pool.traps;
  for (const [id, shown] of seen) {
    const left = Math.max(0, COPY_LIMIT - shown);
    const delta = left - COPY_LIMIT * UNSEEN_WEIGHT;
    total += delta;
    if (card(id).type === 'trap') traps += delta;
  }

  return {
    trapDensity: total > 0 ? Math.max(0, Math.min(1, traps / total)) : 0,
    cheapestTrap: pool.cheapestTrap,
    seat,
  };
}

interface LeaderPool {
  /** Every collectible card the leader's colours allow. */
  legal: Set<string>;
  /** Weight of the whole pool with nothing yet seen. */
  total: number;
  /** The trap share of that weight. */
  traps: number;
  cheapestTrap: CardDef | null;
}

const poolCache = new Map<string, LeaderPool>();

/**
 * The card pool a leader allows, which is fixed the moment the leader is turned
 * face up and is the same in every game that leader is played in. Held rather
 * than rebuilt, because walking the whole set on every plan cost more than every
 * search in the bot put together.
 */
function poolBehind(leaderCardId: string): LeaderPool {
  const hit = poolCache.get(leaderCardId);
  if (hit) return hit;

  const identity = deckIdentity(leaderCardId);
  const legal = new Set<string>();
  let total = 0;
  let traps = 0;
  let cheapestTrap: CardDef | null = null;
  let cheapestPips = Number.POSITIVE_INFINITY;

  for (const def of allCards()) {
    if (def.uncollectible) continue;
    if (!isLegalUnder(def, identity)) continue;
    legal.add(def.id);
    const weight = COPY_LIMIT * UNSEEN_WEIGHT;
    total += weight;
    if (def.type !== 'trap') continue;
    traps += weight;
    const pips = costColored(def.cost) + (def.cost?.C ?? 0);
    if (pips < cheapestPips) {
      cheapestPips = pips;
      cheapestTrap = def;
    }
  }

  const built: LeaderPool = { legal, total, traps, cheapestTrap };
  poolCache.set(leaderCardId, built);
  return built;
}

/**
 * How likely they are holding a trap they could pay for right now.
 *
 * The second half is what makes this worth reading rather than guessing. A trap
 * somewhere in their colours is a fact about the set; a trap they have the
 * unsapped supporters to cast this instant is a fact about the attack being
 * declared.
 */
function trapRisk(state: GameState, reads: EnemyRead[]): number {
  let worst = 0;
  for (const read of reads) {
    const foe = state.players[read.seat];
    if (foe.eliminated) continue;
    if (foe.hand.length === 0 || read.trapDensity <= 0 || !read.cheapestTrap) continue;
    if (!canPay(foe, costFor(foe, read.cheapestTrap))) continue;
    const risk = 1 - Math.pow(1 - read.trapDensity, foe.hand.length);
    if (risk > worst) worst = risk;
  }
  return worst;
}

/** Whether there is any of my own turn left to search. */
function turnGoesOn(state: GameState, me: PlayerIdx): boolean {
  return !isOver(state) && state.active === me && !state.pending;
}

function leaderHpOf(state: GameState, side: PlayerIdx): number {
  const l = state.players[side].leader;
  return l ? remainingHp(l) : 0;
}

/**
 * How much of a player's nearer clock one action consumed, as a fraction of
 * what was left of it.
 *
 * Both routes to a loss count. A line that piles debt on the opponent ends the
 * game as surely as one that empties their leader, and a rollout watching only
 * leader HP would walk past every deck built the other way. Measuring each as a
 * fraction of its own remaining clock puts the two on one scale without having
 * to claim an exchange rate between a point of HP and a point of debt.
 */
function progressAgainst(before: GameState, after: GameState, me: PlayerIdx): number {
  let total = 0;
  for (const foe of livingOpponents(before, me)) {
    const was = before.players[foe];
    const now = after.players[foe];
    const hpWas = was.leader ? remainingHp(was.leader) : 0;
    const hpNow = now.leader ? remainingHp(now.leader) : 0;
    const debtLeft = debtLimitOf(before) - was.debtCount;
    total +=
      (hpWas - hpNow) / Math.max(1, hpWas) +
      (now.debtCount - was.debtCount) / Math.max(1, debtLeft);
  }
  return total;
}

/** The leader closest to falling, which is the one a threat is measured against. */
function nearestFoeHp(state: GameState, me: PlayerIdx): number {
  let least = Number.POSITIVE_INFINITY;
  for (const foe of livingOpponents(state, me)) {
    const hp = leaderHpOf(state, foe);
    if (hp < least) least = hp;
  }
  return Number.isFinite(least) ? least : 0;
}

/**
 * What a position could still be turned into: bodies that can still act, cards
 * that can still be played, mana that can still be spent.
 *
 * Deliberately silent about the harm a line does to its owner, because the
 * rollout it ranks is asking how much damage this turn can be made to hold
 * rather than whether the board is in good order afterwards. A Power that mills
 * you and takes a debt to draw a card is a loss on every term the evaluator
 * carries, and it is also how a body whose attack scales with your own debt
 * reaches the number that ends the game.
 */
function potential(state: GameState, me: PlayerIdx): number {
  const p = state.players[me];
  let total = 0;
  for (const s of p.slots) {
    if (s && !s.sapped) total += effectiveStrength(state, s);
  }
  if (p.leader && !p.leader.sapped) total += effectiveStrength(state, p.leader);
  total += p.hand.length;
  const mana = availableMana(p);
  for (const kind of MANA_KINDS) total += mana[kind];
  return total;
}

/** Whether an action hands the game to the opponent or ends it level. */
function losesIt(state: GameState, me: PlayerIdx): boolean {
  return state.drawn || (state.winner !== null && state.winner !== me);
}

interface Rollout {
  state: GameState;
  /** Every action of the line, in order. */
  line: Action[];
  /** Points taken off the enemy leader over the whole line. */
  damage: number;
}

/**
 * Play the turn out taking whichever action pushes the opponent furthest
 * towards a loss, breaking ties on the evaluator.
 *
 * Greedy on the clocks rather than on the evaluator, and that is the point of
 * it. A recursion loop scores every one of its own steps as a loss: a body that
 * deals damage when it dies and returns to hand costs a body and a debt each
 * time round, so the evaluator marks every cycle down and only the last one is
 * a win. A beam ordered by the evaluator prunes such a line at its first step
 * however wide the beam is, because the line never looks good until it is over.
 * This is the search that can follow one.
 *
 * It stops once nothing on offer either hurts the opponent or improves the
 * board, so a line that has run out of cycles does not spend the rest of its
 * budget shuffling.
 *
 * `setup` is how many actions it may spend climbing `potential` before it
 * starts swinging. Greedy on damage from the first action is greedy too early:
 * a body whose attack rises with your own debt wants every free Power fired
 * first, and a rollout that took the largest hit available immediately would
 * cash it at half size. Called with zero it strikes at once, which is the right
 * line about as often, so both are tried and whichever kills is the one used.
 */
function burn(
  state: GameState,
  me: PlayerIdx,
  steps: number,
  w: BotWeights,
  setup = 0,
): Rollout {
  // Damage is tracked per seat and reported as the worst any one of them took,
  // because a threat is a threat against somebody in particular.
  const startHp = new Map<PlayerIdx, number>();
  for (const foe of livingOpponents(state, me)) startHp.set(foe, leaderHpOf(state, foe));
  const worstDrop = (at: GameState): number => {
    let worst = 0;
    for (const [foe, was] of startHp) {
      const drop = was - leaderHpOf(at, foe);
      if (drop > worst) worst = drop;
    }
    return worst;
  };
  const line: Action[] = [];
  let cur = state;

  for (let step = 0; step < setup; step++) {
    if (!turnGoesOn(cur, me)) break;
    let pick: Action | null = null;
    let pickState: GameState | null = null;
    let best = potential(cur, me);

    for (const action of candidateActions(cur, me)) {
      const res = applyAction(cur, me, action);
      if (!res.ok) continue;
      const after = settle(res.state);
      if (after.winner === me) {
        return { state: after, line: [...line, action], damage: worstDrop(after) };
      }
      if (losesIt(after, me)) continue;
      const p = potential(after, me);
      if (p > best + 1e-9) {
        best = p;
        pick = action;
        pickState = after;
      }
    }

    if (!pick || !pickState) break;
    line.push(pick);
    cur = pickState;
  }

  for (let step = 0; step < steps; step++) {
    if (!turnGoesOn(cur, me)) break;
    const standingStill = evaluate(cur, me, w);
    let pick: Action | null = null;
    let pickState: GameState | null = null;
    let bestGain = Number.NEGATIVE_INFINITY;
    let bestBoard = Number.NEGATIVE_INFINITY;

    for (const action of candidateActions(cur, me)) {
      const res = applyAction(cur, me, action);
      if (!res.ok) continue;
      const after = settle(res.state);
      if (after.winner === me) {
        return { state: after, line: [...line, action], damage: worstDrop(after) };
      }
      if (losesIt(after, me)) continue;
      const gain = progressAgainst(cur, after, me);
      const board = evaluate(after, me, w);
      if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && board > bestBoard)) {
        bestGain = gain;
        bestBoard = board;
        pick = action;
        pickState = after;
      }
    }

    if (!pick || !pickState) break;
    if (bestGain <= 1e-9 && bestBoard <= standingStill) break;
    line.push(pick);
    cur = pickState;
  }

  return { state: cur, line, damage: worstDrop(cur) };
}

/**
 * The position at the start of my next turn, with the opponent having taken
 * theirs against it.
 *
 * Everything else in the bot stops when my own turn does, which leaves it
 * unable to price the two things a turn costs rather than gains. A body put
 * down is worth its stat line and never the debt its funeral will charge, so
 * the bot filled all three slots at 18 debt into three attackers that could
 * kill all three, and handed itself to 23 of a limit of 25. And a body that
 * returns to hand when it dies scored exactly what a body of the same stats
 * that stays dead scored, so blocking with something renewable was never worth
 * anything.
 *
 * The opponent's turn is played greedily on their own reading of the board,
 * which is a guess and not a search. That is what `w.reply` is for: it is the
 * share of a position's score that is read from here rather than from where the
 * position stands, and it is not 1.
 */
function nextTurn(state: GameState, me: PlayerIdx, w: BotWeights): GameState | null {
  const from = state.players[me].turnsTaken;
  let s = state;

  for (let i = 0; i < 24; i++) {
    if (isOver(s)) return s;
    if (
      s.players[me].turnsTaken > from &&
      s.active === me &&
      !s.pending &&
      s.choiceQueue.length === 0 &&
      s.flipQueue.length === 0 &&
      s.replaceQueue.length === 0
    ) {
      return s;
    }
    // Every seat between me and my next turn spends its own, not just the one
    // opposite: a party game seats up to four and they all get to answer.
    if (s.active !== me && !s.pending && s.phase === 'main') {
      const seat = s.active;
      s = replyOf(s, seat, w);
      if (isOver(s)) return s;
      if (s.active === seat && s.phase === 'main' && !s.pending) {
        const ended = applyAction(s, seat, { type: 'END_TURN' });
        if (!ended.ok) return null;
        s = ended.state;
      }
      continue;
    }
    const actor = currentActor(s);
    const res = applyAction(s, actor, passAction(s));
    if (!res.ok) return null;
    s = res.state;
  }
  return null;
}

/**
 * One opponent's turn.
 *
 * Their combos are looked for the same way mine are, and this is the reason.
 * A purely greedy reply is exactly as blind as this bot was before the rollout
 * existed: every step of a recursion loop scores as a loss, so greed refuses
 * the first of them and a position that is about to be killed reads as safe.
 * Modelling the opponent as a weaker player than yourself is how you walk into
 * the line you just taught yourself to play.
 */
function replyOf(state: GameState, foe: PlayerIdx, w: BotWeights): GameState {
  // A profile that gives the opponent no turn gets no opponent model, rollouts
  // included: they are the expensive half of it.
  if (limits.maxReplySteps <= 0) return state;
  const race = burn(state, foe, limits.maxBurnSteps, w);
  if (race.state.winner === foe) return race.state;
  const built = burn(state, foe, limits.maxBurnSteps, w, limits.maxSetupSteps);
  if (built.state.winner === foe) return built.state;

  let s = state;
  for (let step = 0; step < limits.maxReplySteps; step++) {
    if (!turnGoesOn(s, foe)) break;
    const standingStill = evaluate(s, foe, w);
    let pick: GameState | null = null;
    let best = standingStill;
    for (const action of candidateActions(s, foe)) {
      const res = applyAction(s, foe, action);
      if (!res.ok) continue;
      const after = settle(res.state);
      const score = evaluate(after, foe, w);
      if (score > best + 1e-6) {
        best = score;
        pick = after;
      }
    }
    if (!pick) break;
    s = pick;
  }
  return s;
}

/**
 * What holding a position is worth on top of what it already is: the damage the
 * standing board could still deal next turn, plus a lump for a kill that is
 * assembled and only waiting for the turn to come round.
 *
 * This is the term that stops the bot cashing a combo for chip damage. Firing a
 * body's Power for eight to the face and losing the body scores about what
 * holding it does, so the body it keeps decides the comparison, and once the
 * enemy leader drops inside range the kill search takes over.
 */
function outlook(state: GameState, me: PlayerIdx, w: BotWeights, standing: number): number {
  // Nothing to learn from a turn nobody takes and no threat measured off it, so
  // a profile that asks for neither does not walk one forward.
  if (limits.maxReplySteps <= 0 && limits.maxThreatSteps <= 0) return standing;
  const next = isOver(state) ? state : nextTurn(state, me, w);
  if (!next) return standing;
  const settled = (1 - w.reply) * standing + w.reply * evaluate(next, me, w);
  if (isOver(next)) return settled;

  const foeHp = nearestFoeHp(next, me);
  if (foeHp <= 0) return settled;
  const reach = Math.max(
    burn(next, me, limits.maxThreatSteps, w).damage,
    burn(next, me, limits.maxThreatSteps, w, limits.maxThreatSetup).damage,
  );
  if (reach <= 0) return settled;
  return settled + w.threat * Math.min(reach, foeHp) + (reach >= foeHp ? w.standingKill : 0);
}

interface Leaf {
  state: GameState;
  /** Every action of the turn up to this position, in order. */
  line: Action[];
  /** Charged for every response window the line opened along the way. */
  risk: number;
  score: number;
}

/**
 * A beam over the sequences of actions one turn can hold, scored by the
 * evaluator at the point the turn would end.
 *
 * Every position reached is a leaf, because stopping there and ending the turn
 * is always legal. Ending the turn is scored where it stands rather than after
 * the opponent has been handed the turn: a value function asked to compare
 * across the turn boundary answers a different question on each side of it.
 *
 * Positions are deduplicated by digest, so the many orderings of one set of
 * actions cost a single slot in the beam instead of filling it.
 */
function searchTurn(state: GameState, me: PlayerIdx, w: BotWeights, reads: EnemyRead[]): Leaf[] {
  const leaves: Leaf[] = [];
  const seen = new Set<string>();
  let level: { state: GameState; line: Action[]; risk: number }[] = [
    { state, line: [], risk: 0 },
  ];
  let spent = 0;

  for (let depth = 0; depth < limits.maxTurnDepth && spent < limits.searchBudget; depth++) {
    const next: Leaf[] = [];
    for (const node of level) {
      for (const action of candidateActions(node.state, me)) {
        if (spent >= limits.searchBudget) break;
        const res = applyAction(node.state, me, action);
        spent++;
        if (!res.ok) continue;
        const after = settle(res.state);
        const line = [...node.line, action];
        if (after.winner === me) return [{ state: after, line, risk: 0, score: WIN }];
        // Settling assumed the trap was not sprung. This is what that assumption
        // is worth, charged once for every window the line opened.
        const risk =
          node.risk +
          (res.state.pending ? w.trapWindow * trapRisk(res.state, reads) : 0);
        const leaf: Leaf = { state: after, line, risk, score: evaluate(after, me, w) - risk };
        leaves.push(leaf);
        if (turnGoesOn(after, me)) next.push(leaf);
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => b.score - a.score);
    level = [];
    for (const leaf of next) {
      if (level.length >= limits.beamWidth) break;
      const key = digestOf(leaf.state);
      if (seen.has(key)) continue;
      seen.add(key);
      level.push(leaf);
    }
    if (level.length === 0) break;
  }

  leaves.sort((a, b) => b.score - a.score);
  return leaves;
}

/**
 * Depth-first search for a line that ends the game this turn.
 *
 * The rollout above finds most kills and finds the long ones, but it commits to
 * the largest hit at every step and some kills need a smaller one first. This
 * covers those exhaustively over the actions that can carry damage, a small
 * enough branching factor to be worth doing whenever a kill is close.
 */
function findLethal(
  state: GameState,
  me: PlayerIdx,
  depth: number,
  budget: { left: number },
): Action | null {
  if (depth <= 0 || budget.left <= 0 || !turnGoesOn(state, me)) return null;
  for (const action of candidateActions(state, me)) {
    if (
      action.type !== 'ACTIVATE_POWER' &&
      action.type !== 'DECLARE_ATTACK' &&
      action.type !== 'CAST_SPELL'
    ) {
      continue;
    }
    if (budget.left <= 0) break;
    budget.left--;
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state);
    if (after.winner === me) return action;
    if (findLethal(after, me, depth - 1, budget)) return action;
  }
  return null;
}

/**
 * The turn the searches settled on, and the position it expects to be handed
 * next.
 *
 * A turn is planned once and then followed rather than re-derived before every
 * action. Re-deriving costs the whole search five or six times a turn for an
 * answer that hardly ever changes. The plan is followed only while the position
 * matches the digest it was built against, so a sprung trap or any other
 * surprise throws it out and plans again.
 */
interface Plan {
  me: PlayerIdx;
  /** Digest of the position this plan's next action belongs to. */
  key: string;
  line: Action[];
}
let plan: Plan | null = null;

/** Forget the planned turn. Exposed so a test can time one decision on its own. */
export function clearPlan(): void {
  plan = null;
}

/** The next action of the standing plan, or null if there is nothing to follow. */
function follow(state: GameState, me: PlayerIdx, key: string): Action | null {
  if (!plan || plan.me !== me || plan.key !== key) return null;
  const next = plan.line.shift();
  if (!next) {
    plan = null;
    return null;
  }
  const res = applyAction(state, me, next);
  if (!res.ok) {
    plan = null;
    return null;
  }
  const after = settle(res.state);
  // A card arriving in hand is a set of options the rest of this plan was
  // ranked without, and the plan's tail had the least search left of any of
  // it. Draw one, mint one or take one back, and the turn is planned again.
  if (!sameHand(state.players[me].hand, after.players[me].hand)) {
    plan = null;
    return next;
  }
  plan.key = digestOf(after);
  return next;
}

function sameHand(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return false;
  }
  return true;
}

/** Adopt a line as the plan and hand back its first action. */
function begin(state: GameState, me: PlayerIdx, key: string, line: Action[]): Action | null {
  if (line.length === 0) return null;
  plan = { me, key, line: [...line] };
  return follow(state, me, key);
}

export function chooseAction(
  state: GameState,
  me: PlayerIdx,
  w: BotWeights = defaultWeights,
): Action {
  const pass = passAction(state);

  // In a response window, standing still means letting the attack resolve, so
  // that outcome is the bar a trap has to beat. One ply is the right depth
  // here, because the rest of the turn is not mine to plan.
  if (state.pending) {
    plan = null;
    const passed = applyAction(state, me, pass);
    let best = pass;
    let bestScore = evaluate(passed.ok ? passed.state : state, me, w);
    for (const action of candidateActions(state, me)) {
      const res = applyAction(state, me, action);
      if (!res.ok) continue;
      const score = evaluate(settle(res.state), me, w);
      if (score > bestScore + 1e-6) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }

  const key = digestOf(state);
  const planned = follow(state, me, key);
  if (planned) return planned;

  // Built once. It reads their public zones, which my own turn barely moves.
  const reads = readTable(state, me);

  // A kill this turn beats anything the evaluator can score, and it is the one
  // thing the evaluator cannot see: a play that converts the whole board into
  // exactly enough damage reads as a small gain rather than as a win.
  const race = burn(state, me, limits.maxBurnSteps, w);
  if (race.state.winner === me) {
    const opener = begin(state, me, key, race.line);
    if (opener) return opener;
  }
  const built = burn(state, me, limits.maxBurnSteps, w, limits.maxSetupSteps);
  if (built.state.winner === me) {
    const opener = begin(state, me, key, built.line);
    if (opener) return opener;
  }
  if (Math.max(race.damage, built.damage) + LETHAL_SLACK >= nearestFoeHp(state, me)) {
    const kill = findLethal(state, me, limits.lethalDepth, { left: limits.lethalBudget });
    if (kill) return kill;
  }

  // Otherwise take the best turn the beam found, judged on where it leaves the
  // board, on what survives the opponent's answer, and on what still threatens
  // them after that. Standing still is one of the candidates rather than a bar
  // the others have to clear, so holding a combo and spending it are compared
  // the same way.
  const stand: Leaf = { state, line: [], risk: 0, score: evaluate(state, me, w) };
  const ranked: Leaf[] = [stand];
  const seen = new Set<string>([key]);
  for (const leaf of searchTurn(state, me, w, reads)) {
    if (leaf.score >= WIN) {
      const opener = begin(state, me, key, leaf.line);
      if (opener) return opener;
    }
    if (ranked.length > limits.threatLeaves) break;
    const leafKey = digestOf(leaf.state);
    if (seen.has(leafKey)) continue;
    seen.add(leafKey);
    ranked.push(leaf);
  }
  ranked.sort((a, b) => b.score - a.score);

  // Playing the reply out costs a turn of simulation apiece, which is why only
  // the handful of leaves gathered above get one.
  let best = stand;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const leaf of ranked) {
    const total = outlook(leaf.state, me, w, leaf.score);
    if (total > bestScore + 1e-6) {
      bestScore = total;
      best = leaf;
    }
  }

  return begin(state, me, key, best.line) ?? pass;
}
