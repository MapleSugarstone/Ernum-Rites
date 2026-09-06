import type { Action, SourceRef } from '../engine/actions';
import type { NetBundle } from './net/bundle';
import { encode } from './net/encoder';
import { valueOf } from './net/model';
import { digestOf } from '../engine/digest';
import { effectDamageOf, effectiveStrength, reshuffleCost } from '../engine/effects';
import {
  applyAction,
  availableMana,
  canPay,
  costFor,
  legalAttackTargets,
  powerBlockers,
  readyAttackers,
  storeBlockers,
  storeBoosted,
  storeOf,
  storePriceBounds,
  targetCandidates,
} from '../engine/engine';
import { deckIdentity, isLegalUnder } from '../engine/identity';
import { allCards, card } from '../engine/registry';
import { nextRandom, randInt, type Rng } from '../engine/rng';
import {
  DRAW_PER_TURN,
  currentActor,
  debtLimitOf,
  findSummon,
  isOver,
  levelOf,
  livingOpponents,
  powersOf,
  refIsGone,
  remainingHp,
  strengthOf,
  type GameState,
  type PendingStore,
  type SummonInstance,
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
   * How much of the debt charge is deferred to the late points. At 0 every
   * point costs `debt`. At 1 the charge is quadratic in the count and reaches
   * the same total at the limit, so the first points are nearly free and the
   * last ones cost double. This is the term that lets the bot take a debt now
   * for something later.
   */
  debtCurve: number;
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
  /**
   * Per Love token held. Slightly good: below a card in hand, because a token
   * only pays off through a Love line, but above zero so a seller counts the
   * token a sale earns and a Love engine reads as progress.
   */
  love: number;
  /**
   * Per body in a slot that carries a Deathrattle. What the trigger does is
   * the card's business and the search reads it by playing the death out; this
   * is the standing value of a death that has not happened yet, so the bot
   * deploys such a body ahead of a vanilla of the same stats and does not
   * trade into an enemy one as if it were free. Untuned.
   */
  deathrattle: number;
  /**
   * Per standing trigger on a body in a slot, Battlecry and Deathrattle
   * excepted: one has fired and the other has its own weight. A body that
   * cycles a card whenever a spell is cast, or strikes when it is attacked, is
   * worth more than its stat line every turn it stands, and the search only
   * reads the trigger by playing it out inside its horizon. Untuned.
   */
  trigger: number;
  /**
   * Per point of Effect Damage a side's spells currently get. It makes every
   * damage spell in hand and in the deck bigger, so it is priced as standing
   * value and counted as progress by the rollout's setup phase. Untuned.
   */
  effectDamage: number;
  /**
   * Per share of the opponent's nearer clock that the best kit in the bot's
   * own list reaches, scaled by how much of that kit it holds squared. A kit
   * is a set of cards the deck scan found to reach further together than
   * apart. This is what makes a piece worth keeping for a turn it cannot use
   * yet, and a draw or a mill worth its debt when the piece is still in the
   * deck. Untuned.
   */
  combo: number;
  /**
   * Per share of the opponent's nearer clock a card takes on its own off a
   * bare probe board, with its side's mana and debt. Measured by playing the
   * card out, so it prices what a card does rather than what it says: a body
   * whose Powers turn a debt pile into damage, a spell that burns, a
   * Deathrattle that fires past a blocker. Vanilla bodies reach nothing past
   * the wall and cost nothing to skip. A card in hand counts at half, for the
   * turn it takes to land. Minted cards are priced the same way, which is how
   * a Recomp or a grafted body is worth what it inherited. Untuned.
   */
  reach: number;
}

export const defaultWeights: BotWeights = {
  leaderHp: 8,
  debt: 12,
  debtCliff: 40,
  debtCurve: 0,
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
  love: 0.6,
  deathrattle: 1.5,
  trigger: 1,
  effectDamage: 2,
  combo: 12,
  reach: 8,
};

/** Trigger hooks that keep firing while the body stands. */
const STANDING_HOOKS = [
  'onAttack',
  'onDefend',
  'onAwake',
  'onEndTurn',
  'onOtherDeath',
  'onSpellCast',
  'onEnemySpellCast',
  'onEnemyPower',
  'onStoreSold',
  'onStoreBought',
] as const;

function standingHooks(def: CardDef): number {
  const t = def.triggers;
  if (!t) return 0;
  let n = 0;
  for (const hook of STANDING_HOOKS) if (t[hook]) n++;
  return n;
}

/** The correction a trained network may add to the turn's final ranking. */
let network: NetBundle | null = null;
let networkWeight = 0;
/** Divisor that puts search scores on the network's [-1, 1] scale, as the trainer did. */
const NET_SCALE = 200;

/**
 * Installs a trained network, or removes one with null. The network does not
 * score positions on its own: it predicts how wrong the search's score was,
 * and `weight` is the size of that nudge on the tanh scale the trainer used.
 * The trainer's sweeps put the useful setting at 0.15, with anything past 0.35
 * below the search alone.
 */
export function setNetwork(bundle: NetBundle | null, weight = 0.15): void {
  network = bundle;
  networkWeight = bundle ? weight : 0;
  clearPlan();
}

const DECK_VALUE_CAP = 20;
/** Leader HP below which the cliff term starts charging. */
const LEADER_CLIFF_AT = 6;
/** Level 3 cards in the deck counted before the term stops growing. */
const OUTS_CAP = 6;
/** Draw steps the deck-out bill is projected over. */
const FATIGUE_LOOKAHEAD = DRAW_PER_TURN * 3;

/** What carrying `debt` costs, on the evaluator's scale. */
function debtCharge(state: GameState, debt: number, w: BotWeights): number {
  const d = Math.max(0, debt);
  const k = Math.min(1, Math.max(0, w.debtCurve));
  return w.debt * d * (1 - k + (k * d) / debtLimitOf(state));
}

/**
 * A body's strength as the evaluator should count it. Turn-length attack mods
 * on a body that cannot swing before they expire are points that will never be
 * used: nothing attacks a player on their own turn, so a sapped, Stationary or
 * first-turn body spends the whole buff idle. Without this the bot happily
 * cast Candy Cane on bodies with no swing left in them.
 */
function scoredStrength(state: GameState, s: SummonInstance): number {
  const full = effectiveStrength(state, s);
  if (s.owner !== state.active) return full;
  const def = card(s.cardId);
  const idle =
    s.sapped ||
    s.rooted ||
    !!def.stationary ||
    state.players[s.owner].turnsTaken <= 1;
  if (!idle || !s.strengthMods.some((m) => m.duration === 'turn')) return full;
  // Rebuild the printed-plus-permanent core the way strengthOf does, keeping
  // its floor at zero, and keep the standing auras, which outlive the turn.
  const auras = full - strengthOf(s, def);
  const base = s.override ? s.override.strength : (def.strength ?? 0);
  let perm = 0;
  for (const m of s.strengthMods) if (m.duration !== 'turn') perm += m.amount;
  return Math.max(0, base + perm) + auras;
}

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
    score -= sign * (debtCharge(state, p.debtCount, w) + cliff);
    score += sign * w.love * p.love;

    for (const s of p.slots) {
      if (!s) continue;
      const def = card(s.cardId);
      score +=
        sign *
        (w.strength * scoredStrength(state, s) +
          w.hp * remainingHp(s) +
          w.level * levelOf(s, def) -
          w.wound * s.wounds +
          (def.triggers?.onDeath ? w.deathrattle : 0) +
          w.trigger * standingHooks(def) +
          w.reach * reachOf(state, side, def, w));
    }
    if (p.leader) score += sign * w.reach * reachOf(state, side, card(p.leader.cardId), w);
    for (const id of p.hand) score += sign * w.reach * HAND_REACH_SHARE * reachOf(state, side, card(id), w);
    score += sign * w.effectDamage * effectDamageOf(state, side);
    if (side === me) score += kitBonus(state, me, w);

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
    if (near > 0) {
      const bill = reshuffleCost(state, side);
      score -=
        sign * (debtCharge(state, p.debtCount + bill, w) - debtCharge(state, p.debtCount, w)) * near;
    }
  }
  return score;
}

// --- stores ------------------------------------------------------------------

/** How near the debt limit a seller has to be before it deals at the floor. */
const SELLER_PRESSURE = 4;
/** Deferred picks a priced sale answers before it is scored. */
const SALE_PICKS = 2;
/** A hard stop on playing a negotiation forward. The five-pass cap ends it first. */
const HAGGLE_STEPS = 8;

/** The slider a window runs on, and 1 to 4 when its shop has left the board. */
function windowBounds(state: GameState, win: PendingStore): { min: number; max: number } {
  const body = findSummon(state, win.source);
  const store = body ? storeOf(body, card(body.cardId)) : null;
  return store ? storePriceBounds(store) : { min: 1, max: 4 };
}

/** The debt a price actually charges, after the seller's Clearance Sale. */
function pricePaid(state: GameState, win: PendingStore, price: number): number {
  return Math.max(1, price - (storeBoosted(state, win.seller) ? 1 : 0));
}

/**
 * What the evaluator charges `side` for carrying `amount` more debt, or credits
 * it for carrying that much less. Infinite once the amount reaches the limit,
 * because that is a loss rather than a price.
 */
function debtCost(state: GameState, side: PlayerIdx, amount: number, w: BotWeights): number {
  const limit = debtLimitOf(state);
  const was = state.players[side].debtCount;
  // Healing stops at nothing owed, the way clearDebt does.
  const now = Math.max(0, was + amount);
  if (now >= limit) return Number.POSITIVE_INFINITY;
  const panic = (n: number) => (n >= limit - 2 ? w.debtCliff : 0);
  return debtCharge(state, now, w) - debtCharge(state, was, w) + panic(now) - panic(was);
}

/**
 * What a debt point buys.
 *
 * The evaluator scores an effect where it lands rather than where it is played.
 * Two cards bought into hand score three points and are worth a body apiece the
 * moment a slot takes them, so a policy that charged the standing price of a
 * debt point against that sitting score refused every trade the colour sells. A
 * shop has to be worth a card in hand for every point of debt it charges, which
 * prices the draw-two shop at the 2 debt its owner pays to run it. The turn
 * search charges the rest: a line that opens a shop is scored by the evaluator
 * at the price it settled at, so cards bought and never played still lose to
 * standing still. Debt the effect itself moves is never lifted, because a debt
 * point healed is worth exactly a debt point paid.
 */
function tradeLift(w: BotWeights): number {
  return w.hand > 0 ? w.debt / w.hand : 1;
}

/** What a sale is worth to each side, with every price taken back out of it. */
interface SaleWorth {
  /** The effect to the buyer, with the debt it moves taken out. */
  board: number;
  /** The same sale to the seller, on the same terms. */
  seller: number;
  /** Debt the effect takes off the buyer, before anything is charged for it. */
  healed: number;
  /** The shop is gone, or the cheapest price on the slider ends the buyer. */
  dead: boolean;
}

/**
 * Close the window at the cheapest price on a copy of the board and read both
 * sides' books off the evaluator.
 *
 * Every price is taken back out of both deltas, so one simulation prices every
 * rung of the slider: the evaluator charges debt at a known rate, and what is
 * left over is the effect. The buyer's deferred pick is answered greedily
 * first, otherwise every shop that asks for a target reads as doing nothing.
 */
function saleWorth(state: GameState, win: PendingStore, w: BotWeights): SaleWorth {
  const dead: SaleWorth = { board: 0, seller: 0, healed: 0, dead: true };
  const body = findSummon(state, win.source);
  const store = body ? storeOf(body, card(body.cardId)) : null;
  if (!store || isOver(state)) return dead;

  const { min } = storePriceBounds(store);
  const paid = pricePaid(state, win, min);
  if (!Number.isFinite(debtCost(state, win.buyer, paid, w))) return dead;

  const sim = structuredClone(state);
  sim.pending = { ...win, player: win.buyer, price: min, pass: 1, final: true };
  const res = applyAction(sim, win.buyer, { type: 'STORE_ACCEPT' });
  if (!res.ok) return dead;
  const closed = answerPicks(res.state, w);

  // The price went on before the effect ran, so what the buyer owes now is the
  // price less whatever the effect took back off.
  const moved = closed.players[win.buyer].debtCount - state.players[win.buyer].debtCount;
  const swing = debtCost(state, win.buyer, moved, w);
  // A sale that ends the buyer prices at nothing rather than at infinity, which
  // would read to them as a shop worth any price at all.
  if (!Number.isFinite(swing)) return dead;
  return {
    board: evaluate(closed, win.buyer, w) - evaluate(state, win.buyer, w) + swing,
    seller: evaluate(closed, win.seller, w) - evaluate(state, win.seller, w) - swing,
    healed: paid - moved,
    dead: false,
  };
}

/**
 * What the buyer's debt ends up doing at a price, which is what the two sides
 * are haggling over: a cost to the buyer and the same number as a gain to the
 * seller. Negative when the effect heals more than the price charges.
 */
function priceSwing(
  state: GameState,
  win: PendingStore,
  worth: SaleWorth,
  price: number,
  w: BotWeights,
): number {
  return debtCost(state, win.buyer, pricePaid(state, win, price) - worth.healed, w);
}

/**
 * What each shop on the table sells for, priced once per decision.
 *
 * Every search in the bot tries opening every shop it can reach, from hundreds
 * of positions, and pricing one costs a simulated purchase and four passes of
 * the evaluator. What a shop sells is worth about the same in the middle of a
 * turn as at the top of it, so the price is read once and stands for the whole
 * decision. The two things that do move inside a turn are read live rather than
 * cached: a shop with nothing left to do for its buyer is dropped by
 * `storeBlockers`, and a price is charged against the debt the buyer stands at
 * when it is named.
 */
const shopPrices = new Map<string, SaleWorth>();
/** Settled deals, which also turn on the debt each side is carrying. */
const shopDeals = new Map<string, number | null>();

function shopKey(win: PendingStore): string {
  const at = win.source;
  return `${win.seller}/${win.buyer}/${at.kind}/${'player' in at ? at.player : ''}/${'slot' in at ? at.slot : ''}`;
}

function worthOf(state: GameState, win: PendingStore, w: BotWeights): SaleWorth {
  const key = shopKey(win);
  const hit = shopPrices.get(key);
  if (hit) return hit;
  const worth = saleWorth(state, win, w);
  shopPrices.set(key, worth);
  return worth;
}

/**
 * The deal the two policies reach, held for the decision.
 *
 * Every node of every search asks this of every shop it can reach, both to
 * decide whether opening one is worth a candidate and to close the window once
 * it has. Only the two debt counts move it once the shop is priced, so they are
 * what the answer is filed under.
 */
function dealOn(state: GameState, win: PendingStore, worth: SaleWorth, w: BotWeights): number | null {
  const key = `${shopKey(win)}#${state.players[win.buyer].debtCount}#${state.players[win.seller].debtCount}`;
  const hit = shopDeals.get(key);
  if (hit !== undefined) return hit;
  const deal = settledPrice(state, win, worth, w);
  shopDeals.set(key, deal);
  return deal;
}

/** Answer whatever pick a resolving effect queued, greedily, for its owner. */
function answerPicks(state: GameState, w: BotWeights): GameState {
  let s = state;
  for (let i = 0; i < SALE_PICKS && s.choiceQueue.length > 0 && !isOver(s); i++) {
    const who = s.choiceQueue[0].player;
    let best: GameState | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const action of candidateActions(s, who, w)) {
      const res = applyAction(s, who, action);
      if (!res.ok) continue;
      const score = evaluate(res.state, who, w);
      if (score > bestScore) {
        bestScore = score;
        best = res.state;
      }
    }
    if (!best) break;
    s = best;
  }
  return s;
}

/** Every price the seller's policy turns on, read off one sale. */
interface SellerBook {
  /** The opening price, 2 over the floor unless the sale is worth more. */
  ask: number;
  /** The price it settles at, and the least it names once the passes run out. */
  take: number;
  /** The cheapest rung the sale is worth making at, which is usually the floor. */
  least: number;
  /** Near enough the debt limit to take the floor for a sale that helps. */
  pressed: boolean;
  gain: (price: number) => number;
}

function sellerBook(
  state: GameState,
  win: PendingStore,
  worth: SaleWorth,
  w: BotWeights,
): SellerBook {
  const { min, max } = windowBounds(state, win);
  const gain = (price: number) => worth.seller + priceSwing(state, win, worth, price, w);
  let least = min;
  while (least < max && gain(least) <= 0) least++;
  return {
    ask: Math.max(Math.min(max, min + 2), least),
    take: Math.max(Math.min(max, min + 1), least),
    least,
    pressed: state.players[win.seller].debtCount >= debtLimitOf(state) - SELLER_PRESSURE,
    gain,
  };
}

/**
 * The seller's answer.
 *
 * Ask 2 over the floor and expect to be countered, take anything from 1 over
 * the floor, and once the passes run out name 1 over the floor as final rather
 * than restating the ask at a buyer who has already refused it twice. A price
 * the evaluator says the sale loses money at is never offered or taken however
 * the passes fall, which is what stops a shop that heals the buyer's debt being
 * sold for less than it heals, and a seller near the debt limit takes the floor
 * when the sale still reads as a gain.
 */
function sellerMove(state: GameState, win: PendingStore, worth: SaleWorth, w: BotWeights): Action {
  const book = sellerBook(state, win, worth, w);
  if (win.pass === 0) return { type: 'STORE_OFFER', price: book.ask, final: false };
  if (win.pass >= 4) return { type: 'STORE_OFFER', price: book.take, final: true };

  const price = win.price;
  if (price !== undefined && book.gain(price) > 0) {
    if (price >= book.take) return { type: 'STORE_ACCEPT' };
    if (book.pressed && price >= book.least) return { type: 'STORE_ACCEPT' };
  }
  return { type: 'STORE_OFFER', price: book.take, final: false };
}

/** The dearest rung still worth paying for. Absent, and no price is. */
function buyerCeiling(
  state: GameState,
  win: PendingStore,
  worth: SaleWorth,
  w: BotWeights,
): number | null {
  if (worth.dead) return null;
  const { min, max } = windowBounds(state, win);
  const lifted = tradeLift(w) * worth.board;
  for (let p = max; p >= min; p--) {
    if (lifted >= priceSwing(state, win, worth, p, w)) return p;
  }
  return null;
}

/**
 * The buyer's answer.
 *
 * Counter at the floor on the first answer and expect to pay more: the seller
 * cannot walk away, so the pass costs nothing but the pass. After that take any
 * price the effect is worth, up to the top of the slider for a shop worth that
 * much, and name the highest price that is worth it when the seller's is above
 * it. Walk away only when even the floor is more than the effect is worth.
 */
function buyerMove(state: GameState, win: PendingStore, worth: SaleWorth, w: BotWeights): Action {
  const { min } = windowBounds(state, win);
  if (win.price === undefined) return { type: 'STORE_REJECT' };
  const price = win.price;
  const ceiling = buyerCeiling(state, win, worth, w);
  if (ceiling === null) return { type: 'STORE_REJECT' };

  const canCounter = !win.final && win.pass < 4 && win.pass % 2 === 1;
  if (canCounter && win.pass <= 1 && price > min) return { type: 'STORE_COUNTER', price: min };
  if (price <= ceiling) return { type: 'STORE_ACCEPT' };
  if (canCounter) return { type: 'STORE_COUNTER', price: ceiling };
  return { type: 'STORE_REJECT' };
}

/**
 * What the side the window is waiting on does about it. Always legal for that
 * side, whatever the board looks like, because a stalled negotiation stalls the
 * game: only the buyer may walk away and the seller has to name a price.
 */
export function storeMove(
  state: GameState,
  win: PendingStore,
  w: BotWeights = defaultWeights,
  worth: SaleWorth = worthOf(state, win, w),
): Action {
  if (win.player === win.seller) {
    // Nothing left to price: name the ceiling and let the buyer walk away.
    if (worth.dead && win.pass > 0) {
      return { type: 'STORE_OFFER', price: windowBounds(state, win).max, final: true };
    }
    return sellerMove(state, win, worth, w);
  }
  return buyerMove(state, win, worth, w);
}

/**
 * The price the two policies reach from an unopened window, or null when the
 * buyer walks away.
 *
 * Both ladders are deterministic and neither reads anything an offer changes,
 * so the whole negotiation comes to this one comparison: the seller opens 2
 * over the floor, the buyer counters at the floor, and the deal is the seller's
 * settling price unless the buyer cannot afford it or the seller is pressed
 * enough to take the floor.
 */
function settledPrice(
  state: GameState,
  win: PendingStore,
  worth: SaleWorth,
  w: BotWeights,
): number | null {
  const ceiling = buyerCeiling(state, win, worth, w);
  if (ceiling === null) return null;
  const book = sellerBook(state, win, worth, w);
  const { min } = windowBounds(state, win);
  if (book.pressed && book.gain(min) > 0) return min;
  return book.take <= ceiling ? book.take : null;
}

/**
 * Play a negotiation out to its close under both sides' policies.
 *
 * A search that walks into a Store window and stops there values the candidate
 * that opened it at the board as it stood, which is what a shop nobody has
 * bought from looks like, so opening one always read as standing still.
 *
 * From the top of a window the settlement is two actions rather than the five
 * the ladders would spend reaching it, because the price they reach is known
 * without playing them and the board a search hands back is the same one either
 * way. A window found part-way through is played out pass by pass, bounded by
 * the engine's own cap.
 */
function settleStore(state: GameState, w: BotWeights): GameState {
  const open = state.pending;
  if (!open || open.kind !== 'store') return state;
  const worth = worthOf(state, open, w);

  if (open.pass === 0) {
    const deal = dealOn(state, open, worth, w);
    const book = sellerBook(state, open, worth, w);
    const priced = applyAction(state, open.seller, {
      type: 'STORE_OFFER',
      price: deal ?? book.take,
      final: true,
    });
    if (priced.ok) {
      if (!priced.state.pending) return priced.state;
      const closed = applyAction(priced.state, open.buyer, {
        type: deal === null ? 'STORE_REJECT' : 'STORE_ACCEPT',
      });
      if (closed.ok) return closed.state;
    }
  }

  let s = state;
  for (let step = 0; step < HAGGLE_STEPS; step++) {
    const win = s.pending;
    if (!win || win.kind !== 'store') break;
    const res = applyAction(s, win.player, storeMove(s, win, w, worth));
    if (!res.ok) break;
    s = res.state;
  }
  return s;
}

/**
 * An attack that opens a trap window is judged on what happens after the window
 * closes, otherwise the bot sees no change and never swings at anyone holding a
 * trap. It assumes the trap is not sprung. A Store window closes on the two
 * deterministic haggling policies instead, so the candidate that opened it is
 * valued by the deal it settles at.
 */
function settle(state: GameState, w: BotWeights = defaultWeights, buyOut = false): GameState {
  if (!state.pending) return state;
  if (state.pending.kind === 'store') return buyOut ? buyOutStore(state, w) : settleStore(state, w);
  const res = applyAction(state, state.pending.player, { type: 'PASS_RESPONSE' });
  return res.ok ? res.state : state;
}

/**
 * Close a Store window at the price the rules guarantee. The seller has no
 * walk-away, so the top of the slider is always on offer, and a kill search
 * that needs what the shop sells takes it at that price rather than asking the
 * evaluator whether the effect is worth the debt. The buyer's deferred pick is
 * answered greedily so the bought effect lands. A window this cannot close
 * falls back to the haggle.
 */
function buyOutStore(state: GameState, w: BotWeights): GameState {
  const win = state.pending;
  if (!win || win.kind !== 'store') return state;
  let s = state;
  if (win.player === win.seller) {
    const offered = applyAction(s, win.seller, {
      type: 'STORE_OFFER',
      price: windowBounds(s, win).max,
      final: true,
    });
    if (!offered.ok) return settleStore(state, w);
    s = offered.state;
  }
  const open = s.pending;
  if (open && open.kind === 'store' && open.player === open.buyer) {
    const closed = applyAction(s, open.buyer, { type: 'STORE_ACCEPT' });
    if (!closed.ok) return settleStore(state, w);
    s = answerPicks(closed.state, w);
  }
  return s;
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
  /** Whether the deck scan runs. Off in the quick profile: a scan a game is most of its cost. */
  scan: boolean;
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
  // Four because a kill that runs through a shop is buy, play, power, swing.
  lethalDepth: 4,
  lethalBudget: 4000,
  scan: true,
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
  scan: false,
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
export function candidateActions(
  state: GameState,
  me: PlayerIdx,
  w: BotWeights = defaultWeights,
  forKill = false,
): Action[] {
  const acts: Action[] = [];
  const p = state.players[me];

  // The order `currentActor` reads them in: a costed flip gates the blow that
  // revealed it, so it comes before the window that would resolve that blow,
  // and both come before a queued choice. Reading them in any other order hands
  // no candidates at all to a player whose turn to answer it actually is.
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

  if (state.pending) {
    if (state.pending.player !== me) return acts;
    if (state.pending.kind === 'store') {
      const win = state.pending;
      const { min, max } = windowBounds(state, win);
      if (me === win.seller) {
        // The seller must always answer with a price, and may take a counter.
        if (win.pass % 2 !== 0) return acts;
        const rungs = new Set([min, Math.min(max, min + 1), Math.min(max, min + 2)]);
        for (const price of rungs) {
          acts.push({ type: 'STORE_OFFER', price, final: win.pass >= 4 });
        }
        if (win.pass > 0 && win.price !== undefined) acts.push({ type: 'STORE_ACCEPT' });
      } else {
        if (win.pass % 2 !== 1) return acts;
        if (win.price !== undefined) acts.push({ type: 'STORE_ACCEPT' });
        if (win.price !== undefined && !win.final && win.pass < 4) {
          const rungs = new Set([min, Math.max(min, win.price - 1)]);
          for (const price of rungs) {
            if (price !== win.price) acts.push({ type: 'STORE_COUNTER', price });
          }
        }
        acts.push({ type: 'STORE_REJECT' });
      }
      return acts;
    }
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
        if (refIsGone(state, pick)) continue;
        acts.push({ type: 'RESOLVE_CHOICE', pick });
      }
    }
    if (ch.optional || acts.length === 0) acts.push({ type: 'RESOLVE_CHOICE' });
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

  // Stores: run your own for debt, or open a haggle over someone else's. An
  // opening the two policies would not settle is left out: the window it opens
  // ends in a rejection, and a search that carried that outcome forward would
  // walk the rest of the turn twice, once against every shop it refused.
  for (let pl = 0 as PlayerIdx; pl < state.players.length; pl++) {
    const p = state.players[pl];
    const seats: (SourceRef | null)[] = p.slots.map((s, slot) =>
      s ? { kind: 'summon', player: pl, slot } : null,
    );
    // The leader seat sells too: any body may lead, a shopkeeper included.
    if (p.leader) seats.push({ kind: 'leader', player: pl });
    for (const src of seats) {
      if (!src) continue;
      if (storeBlockers(state, me, src)) continue;
      if (pl === me) {
        acts.push({ type: 'USE_STORE', source: src });
        continue;
      }
      // A kill search buys at the guaranteed price rather than haggling, so it
      // is offered every shop: the piece that completes a kill is exactly the
      // purchase the evaluator would refuse.
      if (!forKill) {
        const win: PendingStore = {
          kind: 'store',
          player: pl,
          seller: pl,
          buyer: me,
          source: src,
          final: false,
          pass: 0,
          battle: null,
          spell: null,
        };
        const worth = worthOf(state, win, w);
        if (dealOn(state, win, worth, w) === null) continue;
      }
      acts.push({ type: 'OPEN_STORE', source: src });
    }
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
  if (state.flipQueue.length > 0) return { type: 'DECLINE_FLIP' };
  // Standing still is not on offer inside a negotiation: the buyer walks away
  // or the seller names a price, so the policy answers for whichever it is.
  if (state.pending?.kind === 'store') return storeMove(state, state.pending);
  if (state.pending) return { type: 'PASS_RESPONSE' };
  if (state.choiceQueue.length > 0) {
    const ch = state.choiceQueue[0];
    if (ch.optional) return { type: 'RESOLVE_CHOICE' };
    if (ch.cards) return { type: 'RESOLVE_CHOICE', index: ch.legal?.[0] };
    const alive = (ch.refs ?? []).find((r) => !refIsGone(state, r));
    return alive ? { type: 'RESOLVE_CHOICE', pick: alive } : { type: 'RESOLVE_CHOICE' };
  }
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
  /** A trap the bot has named in their hand that they could pay for now. */
  knownTrap?: boolean;
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
  return livingOpponents(state, me).map((foe) => ({
    ...readEnemy(state, foe),
    knownTrap: knownTrapIn(state, me, foe),
  }));
}

/** Copies of each legal card the seat has shown in a public zone. */
function seenCopies(state: GameState, seat: PlayerIdx, pool: LeaderPool): Map<string, number> {
  const foe = state.players[seat];
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
  return seen;
}

// --- the read on the opponent's hand -------------------------------------------

/**
 * How much of the opponent's hidden cards the bot gets to read. Counting what
 * they have shown is free and a person can do it. On top of that, once a turn,
 * the bot rolls a few times to name a card sitting in their deck and once to
 * name one in their hand, which stands in for the intuition a player has about
 * what an opponent is holding. Every number is a dial, and `perfect` reads the
 * real hand, which is what the reply model did before this existed.
 */
export interface IntelConfig {
  deckChance: number;
  deckRolls: number;
  handChance: number;
  handRolls: number;
  perfect: boolean;
}

export const defaultIntel: IntelConfig = {
  deckChance: 0.15,
  deckRolls: 3,
  handChance: 0.05,
  handRolls: 1,
  perfect: false,
};

let intel: IntelConfig = defaultIntel;

export function setIntel(next: IntelConfig | null): void {
  intel = next ?? defaultIntel;
}

interface IntelTrack {
  knownHand: Map<string, number>;
  knownDeck: Map<string, number>;
  lastTurn: number;
}

const intelCache = new Map<string, IntelTrack>();

function copiesIn(zone: readonly string[], id: string): number {
  let n = 0;
  for (const c of zone) if (c === id) n++;
  return n;
}

/** Forget any count the zone no longer bears out: the read may know less than the truth, never more. */
function clampKnown(known: Map<string, number>, zone: readonly string[]): void {
  for (const [id, n] of known) {
    const actual = copiesIn(zone, id);
    if (actual <= 0) known.delete(id);
    else if (n > actual) known.set(id, actual);
  }
}

function rollsFor(state: GameState, me: PlayerIdx, foe: PlayerIdx, salt: number): Rng {
  return {
    state:
      (state.seed ^
        Math.imul(me + 1, 0x9e3779b9) ^
        Math.imul(foe + 1, 0xc2b2ae35) ^
        Math.imul(state.turn + 1, 0x85ebca6b) ^
        salt) |
      0,
  };
}

/** How many of a known count the zone still bears out: the read may know less than the truth, never more. */
function knownIn(zone: readonly string[], id: string, n: number): number {
  return Math.min(n, copiesIn(zone, id));
}

function rollFloat(rng: Rng): number {
  const { value, state } = nextRandom(rng.state);
  rng.state = state;
  return value;
}

/**
 * The tracker for one opponent, rolled forward to this turn. One set of rolls
 * a turn, seeded by the game and the turn, so the same position reads the same
 * way in both engines and on a replay.
 */
function trackOf(state: GameState, me: PlayerIdx, foe: PlayerIdx): IntelTrack {
  const key = `${state.seed}/${me}/${foe}`;
  let t = intelCache.get(key);
  if (!t) {
    prune(intelCache, state.seed);
    t = { knownHand: new Map(), knownDeck: new Map(), lastTurn: -1 };
    intelCache.set(key, t);
  }
  return t;
}

/**
 * The rolls, at the root of a decision and nowhere else: a search state is
 * partly imagined, and a peek rolled inside one would name a card the bot
 * itself made up. Once a turn, seeded by the game and the turn, so the same
 * position reads the same way in both engines and on a replay. Counts the
 * real table no longer bears out are forgotten here too.
 */
function peek(state: GameState, me: PlayerIdx): void {
  if (intel.perfect) return;
  for (let seat = 0; seat < state.players.length; seat++) {
    if (seat === me) continue;
    const foe = seat as PlayerIdx;
    const t = trackOf(state, me, foe);
    const p = state.players[foe];
    if (state.turn > t.lastTurn) {
      const rng = rollsFor(state, me, foe, 0x1b873593);
      for (let r = 0; r < intel.deckRolls; r++) {
        const roll = rollFloat(rng);
        if (roll >= intel.deckChance || p.deck.length === 0) continue;
        const id = p.deck[randInt(rng, p.deck.length)];
        if ((t.knownDeck.get(id) ?? 0) < copiesIn(p.deck, id)) t.knownDeck.set(id, (t.knownDeck.get(id) ?? 0) + 1);
      }
      for (let r = 0; r < intel.handRolls; r++) {
        const roll = rollFloat(rng);
        if (roll >= intel.handChance || p.hand.length === 0) continue;
        const id = p.hand[randInt(rng, p.hand.length)];
        if ((t.knownHand.get(id) ?? 0) < copiesIn(p.hand, id)) t.knownHand.set(id, (t.knownHand.get(id) ?? 0) + 1);
      }
      t.lastTurn = state.turn;
    }
    clampKnown(t.knownHand, p.hand);
    clampKnown(t.knownDeck, p.deck);
  }
}

/** Whether a trap the bot has named in their hand is one they could pay for now. */
function knownTrapIn(state: GameState, me: PlayerIdx, foe: PlayerIdx): boolean {
  const p = state.players[foe];
  if (intel.perfect) {
    return p.hand.some((id) => card(id).type === 'trap' && canPay(p, costFor(p, card(id))));
  }
  const t = trackOf(state, me, foe);
  for (const [id, n] of t.knownHand) {
    if (knownIn(p.hand, id, n) <= 0) continue;
    const def = card(id);
    if (def.type === 'trap' && canPay(p, costFor(p, def))) return true;
  }
  return false;
}

/**
 * The hand the bot believes the opponent holds: what it has named, then the
 * rest drawn from the cards their leader allows that they could still be
 * holding, a card they have shown counting in full and one they have not at
 * the unseen weight. The same size as the real hand, which is public.
 */
function believedHand(state: GameState, me: PlayerIdx, foe: PlayerIdx): string[] {
  const p = state.players[foe];
  if (intel.perfect) return [...p.hand];
  const t = trackOf(state, me, foe);
  const hand: string[] = [];
  // In id order, so both engines build the same hand from the same peeks.
  const known = [...t.knownHand.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [id, n] of known) {
    const m = knownIn(p.hand, id, n);
    for (let i = 0; i < m && hand.length < p.hand.length; i++) hand.push(id);
  }
  if (hand.length >= p.hand.length) return hand;

  const pool = poolBehind(p.leaderCardId);
  const seen = seenCopies(state, foe, pool);
  const ids = [...pool.legal].sort();
  const weights: number[] = [];
  let total = 0;
  for (const id of ids) {
    const shown = (seen.get(id) ?? 0) + copiesIn(hand, id);
    const left = Math.max(0, COPY_LIMIT - shown);
    const weight = left * (seen.has(id) || t.knownDeck.has(id) ? 1 : UNSEEN_WEIGHT);
    weights.push(weight);
    total += weight;
  }
  const rng = rollsFor(state, me, foe, 0x27d4eb2f);
  while (hand.length < p.hand.length && total > 0) {
    let roll = rollFloat(rng) * total;
    let pick = -1;
    for (let i = 0; i < ids.length; i++) {
      if (weights[i] <= 0) continue;
      roll -= weights[i];
      if (roll <= 0) {
        pick = i;
        break;
      }
    }
    if (pick < 0) break;
    hand.push(ids[pick]);
    total -= weights[pick];
    weights[pick] = 0;
  }
  return hand;
}

/** The position with every other seat's hidden hand replaced by the one the bot believes in. */
function redactTable(state: GameState, me: PlayerIdx): GameState {
  if (intel.perfect) return state;
  const s = structuredClone(state);
  for (let seat = 0; seat < state.players.length; seat++) {
    if (seat !== me) s.players[seat].hand = believedHand(state, me, seat as PlayerIdx);
  }
  return s;
}

export function readEnemy(state: GameState, seat: PlayerIdx): EnemyRead {
  const foe = state.players[seat];
  const pool = poolBehind(foe.leaderCardId);
  if (pool.total <= 0) return { trapDensity: 0, cheapestTrap: null, seat };

  const seen = seenCopies(state, seat, pool);

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
    // A trap the bot has named in their hand is not a risk but a fact.
    if (read.knownTrap) return 1;
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
    const debtWas = was.debtCount + pendingFatigue(before, foe);
    const debtNow = now.debtCount + pendingFatigue(after, foe);
    total += (hpWas - hpNow) / Math.max(1, hpWas) + (debtNow - debtWas) / Math.max(1, debtLeft);
  }
  return total;
}

// --- the deck scan -----------------------------------------------------------

/**
 * A set of cards from the bot's own list that, put together on a board, takes
 * a share of the opponent's nearer clock. Found once per game by probing the
 * list, and worth holding and assembling from then on. This is the bot's
 * long horizon: the search sees a combo only once its pieces are in reach of
 * one turn, and the scan is what tells it, turns earlier, which pieces those
 * are.
 */
interface Kit {
  cards: string[];
  /** Share of the opponent's nearer clock the kit takes off a bare board, 1 being a kill. */
  reach: number;
}

/** Share of the clock a kit has to take for the scan to keep it. */
const KIT_MIN_REACH = 0.4;
/** A set has to reach this much further than its best part to count as a kit. */
const KIT_SYNERGY = 0.1;
/** Cards, by single reach, carried into the pair round. */
const KIT_PAIR_CARDS = 12;
/** Cards, by best pair reach, carried into the triple round. */
const KIT_TRIPLE_CARDS = 6;
const KIT_KEEP = 6;
/** Share of a piece's progress a copy still in the deck counts for. */
const KIT_OUT_WEIGHT = 0.3;

const kitCache = new Map<string, Kit[]>();

let wall: CardDef | null | undefined;

/**
 * The blocker every probe faces: the collectable vanilla summon with the most
 * HP in the set, whichever card that is at the time. A wall with no text makes
 * the probe about the kit and not about the wall.
 */
function wallCard(): CardDef | null {
  if (wall !== undefined) return wall;
  let best: CardDef | null = null;
  for (const def of allCards()) {
    if (def.type !== 'summon' || def.uncollectible || def.text || def.powers?.length || def.triggers) continue;
    if (def.flip || def.stationary || def.redirect) continue;
    if (!best || (def.hp ?? 0) > (best.hp ?? 0)) best = def;
  }
  wall = best;
  return wall;
}

let blank: CardDef | null | undefined;

/** A collectible trap, the lowest id: a card the bot cannot play on its own turn. */
function blankCard(): CardDef | null {
  if (blank !== undefined) return blank;
  let best: CardDef | null = null;
  for (const def of allCards()) {
    if (def.type !== 'trap' || def.uncollectible) continue;
    if (!best || def.id < best.id) best = def;
  }
  blank = best;
  return blank;
}

function kitKey(state: GameState, me: PlayerIdx): string {
  return `${state.seed}/${me}/${state.players[me].leaderCardId}`;
}

/** What one card does on its own, for tests and tooling: see `reachOf`. */
export function cardReach(state: GameState, side: PlayerIdx, id: string, w: BotWeights = defaultWeights): number {
  return reachOf(state, side, card(id), w);
}

/** A card in hand reaches at this share of what it reaches on the board: landing it costs the turn. */
const HAND_REACH_SHARE = 0.5;
/** Debt is bucketed for the reach probe, so a card that reads the pile is re-measured as the pile grows. */
const REACH_BUCKET = 4;
/** Per card id, per side and debt bucket, for the current game only. */
const reachCache = new Map<string, Map<number, number>>();
let reachSeed = Number.NaN;

/**
 * What a card does on its own: the share of the opponent's nearer clock it
 * takes off the probe board with its side's mana, at its side's debt. Cards
 * that are only a stat line skip the probe, because nothing on it swings past
 * the wall. A card is probed at most once per debt bucket a game, and a
 * minted card the first time it is seen, which is how a Recomp or a grafted
 * body is priced by what it inherited rather than by its printed line.
 */
function reachOf(state: GameState, side: PlayerIdx, def: CardDef, w: BotWeights): number {
  if (w.reach === 0) return 0;
  return probedReach(state, side, def, w);
}

/** The probe behind `reachOf`, which the scan reads whatever the weight is. */
function probedReach(state: GameState, side: PlayerIdx, def: CardDef, w: BotWeights): number {
  if (!limits.scan) return 0;
  if (def.type === 'trap') return 0;
  if (def.type === 'summon' && !def.powers?.length && !def.triggers && !def.effectDamage) return 0;
  if (reachSeed !== state.seed) {
    reachCache.clear();
    reachSeed = state.seed;
  }
  const bucket = Math.floor(state.players[side].debtCount / REACH_BUCKET);
  const slot = side * 64 + bucket;
  let byBucket = reachCache.get(def.id);
  if (!byBucket) {
    byBucket = new Map();
    reachCache.set(def.id, byBucket);
  }
  const hit = byBucket.get(slot);
  if (hit !== undefined) return hit;
  // Set before the probe runs: the probe evaluates positions, and a card that
  // reaches itself would recurse.
  byBucket.set(slot, 0);
  const reach = kitReach(state, side, [def.id], w, bucket * REACH_BUCKET);
  byBucket.set(slot, reach);
  return reach;
}

/**
 * The board a kit is probed on: the real table's leaders and lists, with the
 * bot's own slots and hand replaced by the kit, three pips of every colour its
 * leader brings and three colourless, the bodies old enough to swing, and the
 * debt asked for. Everything else is reset to the start of a game, every
 * leader at the HP the engine gives it and every opponent behind a wall, so
 * the same card measures the same whenever it is probed and in both engines.
 */
function probeBoard(state: GameState, me: PlayerIdx, kit: string[], debt = 0): GameState {
  const s = structuredClone(state);
  const p = s.players[me];
  s.active = me;
  s.phase = 'main';
  s.pending = null;
  s.battle = null;
  s.choiceQueue = [];
  s.flipQueue = [];
  s.replaceQueue = [];
  s.winner = null;
  s.drawn = false;
  p.turnsTaken = Math.max(p.turnsTaken, 3);
  p.supportersLeft = 1;
  p.slots = [null, null, null];
  p.hand = [];
  p.debtCount = debt;
  p.debt = Array.from({ length: debt }, () => p.deck[p.deck.length - 1] ?? kit[0]);
  p.deckOuts = 0;
  const filler = p.deck[p.deck.length - 1] ?? kit[0];
  // The rest of the list stays out of the measure. A single that dug a second
  // piece out of the deck read as that piece's reach, and the set's baseline
  // then counted the piece twice and refused the kit. The deck keeps its
  // length, for the fatigue clock, and holds a card no turn of the bot's can
  // play.
  const blank = blankCard()?.id ?? filler;
  p.deck = p.deck.map(() => blank);
  const bodyOf = (id: string, owner: PlayerIdx, hp: number, isLeader: boolean): SummonInstance => ({
    uid: `k${s.nextUid++}`,
    cardId: id,
    owner,
    isLeader,
    hp: Array.from({ length: Math.max(1, hp) }, () => ({ cardId: filler, flipped: false })),
    sapped: false,
    wounds: 0,
    shields: 0,
    strengthMods: [],
    effectDamageMod: 0,
    powerUses: {},
    enteredTurn: 0,
  });
  // Every leader stands in fresh at the HP the engine gives it. Every opponent
  // gets a wall in front of the leader and nothing else: without one, any
  // three bodies reach a leader by swinging, and the scan would find stat
  // piles rather than the lines that carry damage past a blocker.
  for (const side of [me, ...livingOpponents(s, me)]) {
    const q = s.players[side];
    q.leader = bodyOf(q.leaderCardId, side, (card(q.leaderCardId).hp ?? 0) * 2 + 2, true);
    q.leaderPlayed = true;
    q.supporters = [];
    q.stage = null;
    q.love = 0;
    if (side === me) continue;
    q.slots = [null, null, null];
    q.debtCount = 0;
    q.debt = [];
    const wall = wallCard();
    if (wall) q.slots[0] = bodyOf(wall.id, side, wall.hp ?? 1, false);
  }
  let slot = 0;
  for (const id of kit) {
    const def = card(id);
    if (def.type === 'summon' && slot < p.slots.length) {
      p.slots[slot++] = {
        uid: `k${s.nextUid++}`,
        cardId: id,
        owner: me,
        isLeader: false,
        hp: Array.from({ length: Math.max(1, def.hp ?? 1) }, () => ({ cardId: filler, flipped: false })),
        sapped: false,
        wounds: 0,
        shields: 0,
        strengthMods: [],
        effectDamageMod: 0,
        powerUses: {},
        enteredTurn: 0,
      };
    } else {
      p.hand.push(id);
    }
  }
  const mana = { ...p.mana };
  for (const kind of MANA_KINDS) mana[kind] = 0;
  mana.C = 3;
  for (const c of deckIdentity(p.leaderCardId)) mana[c] = 3;
  p.mana = mana;
  return s;
}

/** Share of the nearer clock a kit takes off the probe board, 1 meaning a kill. */
function kitReach(state: GameState, me: PlayerIdx, kit: string[], w: BotWeights, debt = 0): number {
  const probe = probeBoard(state, me, kit, debt);
  // Shop prices are filed by seat and slot and stand for the whole decision,
  // and the probe puts its own bodies in those slots. What its rollout prices
  // there must not stand for the real table.
  const prices = new Map(shopPrices);
  const deals = new Map(shopDeals);
  let best = 0;
  try {
    for (const setup of [0, limits.maxSetupSteps]) {
      const r = burn(probe, me, limits.maxBurnSteps, w, setup, true);
      if (r.state.winner === me) return 1;
      best = Math.max(best, progressAgainst(probe, r.state, me));
    }
  } finally {
    shopPrices.clear();
    for (const [k, v] of prices) shopPrices.set(k, v);
    shopDeals.clear();
    for (const [k, v] of deals) shopDeals.set(k, v);
  }
  return Math.min(1, best);
}

/**
 * Probe the bot's own list for kits: every card alone, then pairs among the
 * cards that reached furthest alone, then triples among the cards in the best
 * pairs. Only a set that reaches further than its best part is a kit; a big
 * body on its own is a big body, and the evaluator prices that already.
 */
function scanKits(state: GameState, me: PlayerIdx, w: BotWeights): Kit[] {
  const p = state.players[me];
  const seen = new Set<string>();
  const ids: string[] = [];
  const note = (id: string) => {
    if (!seen.has(id) && card(id).type !== 'trap') {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const id of p.deck) note(id);
  for (const id of p.hand) note(id);
  for (const s of p.slots) if (s) note(s.cardId);

  const single = new Map<string, number>();
  for (const id of ids) single.set(id, probedReach(state, me, card(id), w));
  const byReach = (a: string, b: string) => (single.get(b) ?? 0) - (single.get(a) ?? 0);
  const pairCards = [...ids].sort(byReach).slice(0, KIT_PAIR_CARDS);

  const kits: Kit[] = [];
  const pairBest = new Map<string, number>();
  for (let i = 0; i < pairCards.length; i++) {
    for (let j = i + 1; j < pairCards.length; j++) {
      const set = [pairCards[i], pairCards[j]];
      const reach = kitReach(state, me, set, w);
      // Added, not the larger: two bodies that each reach a third reach two
      // thirds side by side, and that is a pile rather than a kit.
      const parts = Math.min(1, (single.get(set[0]) ?? 0) + (single.get(set[1]) ?? 0));
      for (const id of set) pairBest.set(id, Math.max(pairBest.get(id) ?? 0, reach));
      if (reach >= KIT_MIN_REACH && reach > parts + KIT_SYNERGY) kits.push({ cards: set, reach });
    }
  }

  const tripleCards = [...pairBest.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, KIT_TRIPLE_CARDS)
    .map(([id]) => id);
  for (let i = 0; i < tripleCards.length; i++) {
    for (let j = i + 1; j < tripleCards.length; j++) {
      for (let k = j + 1; k < tripleCards.length; k++) {
        const set = [tripleCards[i], tripleCards[j], tripleCards[k]];
        let parts = Math.min(1, set.reduce((n, id) => n + (single.get(id) ?? 0), 0));
        for (const kit of kits) {
          if (!kit.cards.every((id) => set.includes(id))) continue;
          const rest = set.find((id) => !kit.cards.includes(id));
          parts = Math.max(parts, Math.min(1, kit.reach + (rest ? single.get(rest) ?? 0 : 0)));
        }
        const reach = kitReach(state, me, set, w);
        if (reach >= KIT_MIN_REACH && reach > parts + KIT_SYNERGY) kits.push({ cards: set, reach });
      }
    }
  }

  kits.sort((a, b) => b.reach - a.reach);
  return kits.slice(0, KIT_KEEP);
}

/** Runs the scan once per game and seat. The scan evaluates positions itself, so the key is filled first. */
function ensureKits(state: GameState, me: PlayerIdx, w: BotWeights): void {
  if (!limits.scan) return;
  const key = kitKey(state, me);
  if (kitCache.has(key)) return;
  prune(kitCache, state.seed);
  kitCache.set(key, []);
  kitCache.set(key, scanKits(state, me, w));
}

/** Per-game caches in a process that plays many games: keep the current game's entries, drop the rest once there are many. */
const CACHE_KEEP = 64;

function prune<T>(cache: Map<string, T>, seed: number): void {
  if (cache.size < CACHE_KEEP) return;
  const mine = `${seed}/`;
  for (const key of [...cache.keys()]) if (!key.startsWith(mine)) cache.delete(key);
}

/** The kits found for a seat this game, for tests and for reading what the bot is building toward. */
export function kitsFor(state: GameState, me: PlayerIdx): readonly { cards: string[]; reach: number }[] {
  return kitCache.get(kitKey(state, me)) ?? [];
}

/**
 * What holding the pieces of the best kit is worth right now: the kit's reach,
 * scaled by the share of it in hand or on the board squared, with a copy still
 * in the deck counting for a little. Squared, so two pieces of three are worth
 * far more than one, which is what makes the last piece worth digging for.
 */
function kitBonus(state: GameState, me: PlayerIdx, w: BotWeights): number {
  const kits = kitCache.get(kitKey(state, me));
  if (!kits || kits.length === 0) return 0;
  const p = state.players[me];
  const held = new Set<string>(p.hand);
  for (const s of p.slots) if (s) held.add(s.cardId);
  if (p.leader) held.add(p.leader.cardId);
  const inDeck = new Set<string>(p.deck);
  let best = 0;
  for (const kit of kits) {
    let have = 0;
    let outs = 0;
    for (const id of kit.cards) {
      if (held.has(id)) have++;
      else if (inDeck.has(id)) outs++;
    }
    const progress = (have + KIT_OUT_WEIGHT * outs) / kit.cards.length;
    best = Math.max(best, kit.reach * progress * progress);
  }
  return w.combo * best;
}

/**
 * The debt a player's next draw step will charge them before they see a card:
 * the deck-out bill, once the deck is too short for the draw. Milling an
 * opponent dry is progress on their debt clock one draw step early, and a
 * rollout that read only the count they carry now walked past it.
 */
function pendingFatigue(state: GameState, side: PlayerIdx): number {
  return state.players[side].deck.length < DRAW_PER_TURN ? reshuffleCost(state, side) : 0;
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
  // A Love token is damage waiting on a Love line, so the setup phase counts
  // gaining one as progress toward the swing.
  total += p.love;
  // Deathrattles, stages and Effect Damage are priced by the evaluator and not
  // here. This measure is a proxy for the damage a turn can be made to hold,
  // and counting them here diluted it: a climb that credited a stage or a
  // Deathrattle body built toward those instead of toward the swing, and the
  // threat it then measured was wrong by four points on random decks.
  const mana = availableMana(p);
  for (const kind of MANA_KINDS) total += mana[kind];
  return total;
}

/** Paid Powers a patient climb fires once it has built everything it can. */
const CASH_STEPS = 4;

/**
 * Potential with the best paid Power still to fire. A Power that sets a body's
 * attack from something the free steps build, debt say, gains nothing until it
 * fires, and fired early it fixes the attack at what the pile was then. A climb
 * greedy on the plain measure took it first, for the largest step on offer,
 * and every free step after that built toward nothing. Counting the follow-up
 * without taking it lets the climb build first and cash in last.
 */
function cashPotential(
  state: GameState,
  me: PlayerIdx,
  w: BotWeights,
): { value: number; cash: Action | null; cashState: GameState | null } {
  const standing = potential(state, me);
  let value = standing;
  let cash: Action | null = null;
  let cashState: GameState | null = null;
  for (const action of candidateActions(state, me, w, true)) {
    if (action.type !== 'ACTIVATE_POWER' || freeRepeat(state, me, action)) continue;
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state, w, true);
    if (losesIt(after, me)) continue;
    const p = potential(after, me);
    if (p > value + 1e-9) {
      value = p;
      cash = action;
      cashState = after;
    }
  }
  return { value, cash, cashState };
}

/**
 * A Power that costs no mana and does not sap its body: the kind that can be
 * fired again next step, which is what makes a flat step worth taking.
 */
function freeRepeat(state: GameState, me: PlayerIdx, action: Action): boolean {
  if (action.type !== 'ACTIVATE_POWER') return false;
  const src = action.source;
  const p = state.players[me];
  const summon = src.kind === 'leader' ? p.leader : src.kind === 'summon' ? p.slots[src.slot] : null;
  if (!summon) return false;
  const power = powersOf(summon, card(summon.cardId))[action.powerIndex];
  if (!power) return false;
  if (Object.values(power.cost).some((n) => (n ?? 0) > 0)) return false;
  return !power.sapSelf && !power.oncePerTurn;
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
  patient = false,
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

  // A body whose attack rises one point for every two debt gains nothing on
  // every other free Power, and once the hand is full the card each one draws
  // gains nothing either. A climb that demanded a gain on every step stopped
  // on the first flat one, six Powers short of a kill it could have had. So a
  // patient climb may take one flat step on a free Power between gains: enough
  // to see over a two-step rhythm, and a second flat step in a row still stops
  // it. Only the kill searches are patient. The threat measure is not, because
  // a longer climb there inflated what a board still threatened and the bot
  // held pieces it should have cashed: measured at four points on random decks.
  let flat = 0;
  // The last state a gain was made in, and how long the line was there.
  let firm = cur;
  let firmLength = 0;
  for (let step = 0; step < setup; step++) {
    if (!turnGoesOn(cur, me)) break;
    let pick: Action | null = null;
    let pickState: GameState | null = null;
    let level: Action | null = null;
    let levelState: GameState | null = null;
    const standing = patient ? cashPotential(cur, me, w).value : potential(cur, me);
    let best = standing;

    for (const action of candidateActions(cur, me, w, true)) {
      const res = applyAction(cur, me, action);
      if (!res.ok) continue;
      const after = settle(res.state, w, true);
      if (after.winner === me) {
        return { state: after, line: [...line, action], damage: worstDrop(after) };
      }
      if (losesIt(after, me)) continue;
      const p = patient ? cashPotential(after, me, w).value : potential(after, me);
      // On a tie the free step goes first: the paid one is still there after it,
      // and the free one may be worth more once the paid one has fired.
      const ahead =
        p > best + 1e-9 ||
        (patient &&
          pick !== null &&
          Math.abs(p - best) <= 1e-9 &&
          freeRepeat(cur, me, action) &&
          !freeRepeat(cur, me, pick));
      if (ahead) {
        best = p;
        pick = action;
        pickState = after;
      } else if (patient && !level && Math.abs(p - standing) <= 1e-9 && freeRepeat(cur, me, action)) {
        level = action;
        levelState = after;
      }
    }

    if (pick && pickState) {
      flat = 0;
    } else if (level && levelState && flat < 1) {
      flat++;
      pick = level;
      pickState = levelState;
    }
    if (!pick || !pickState) break;
    line.push(pick);
    cur = pickState;
    if (flat === 0) {
      firm = cur;
      firmLength = line.length;
    }
  }
  // A flat step no gain followed built nothing, and it still spent what the
  // Power spends: a point of debt, say, that the kill below may not have.
  if (line.length > firmLength) {
    cur = firm;
    line.length = firmLength;
  }

  // The climb counted a paid Power it never took. Now that nothing free
  // gains, it fires: the attack it sets is read off everything built above.
  for (let cashed = 0; patient && cashed < CASH_STEPS; cashed++) {
    if (!turnGoesOn(cur, me)) break;
    const { cash, cashState } = cashPotential(cur, me, w);
    if (!cash || !cashState) break;
    if (cashState.winner === me) {
      return { state: cashState, line: [...line, cash], damage: worstDrop(cashState) };
    }
    line.push(cash);
    cur = cashState;
  }

  for (let step = 0; step < steps; step++) {
    if (!turnGoesOn(cur, me)) break;
    const standingStill = evaluate(cur, me, w);
    let pick: Action | null = null;
    let pickState: GameState | null = null;
    let bestGain = Number.NEGATIVE_INFINITY;
    let bestBoard = Number.NEGATIVE_INFINITY;

    for (const action of candidateActions(cur, me, w, true)) {
      const res = applyAction(cur, me, action);
      if (!res.ok) continue;
      const after = settle(res.state, w, true);
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
      // Their turn is played on the hand the bot believes they hold. The table
      // was redacted at the root of this decision, so a reply cannot dodge a
      // held trap or spell it has never been shown.
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
  const built = burn(state, foe, limits.maxBurnSteps, w, limits.maxSetupSteps, true);
  if (built.state.winner === foe) return built.state;

  let s = state;
  for (let step = 0; step < limits.maxReplySteps; step++) {
    if (!turnGoesOn(s, foe)) break;
    const standingStill = evaluate(s, foe, w);
    let pick: GameState | null = null;
    let best = standingStill;
    for (const action of candidateActions(s, foe, w)) {
      const res = applyAction(s, foe, action);
      if (!res.ok) continue;
      const after = settle(res.state, w);
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
      for (const action of candidateActions(node.state, me, w)) {
        if (spent >= limits.searchBudget) break;
        const res = applyAction(node.state, me, action);
        spent++;
        if (!res.ok) continue;
        const after = settle(res.state, w);
        const line = [...node.line, action];
        if (after.winner === me) return [{ state: after, line, risk: 0, score: WIN }];
        // Settling assumed the trap was not sprung. This is what that assumption
        // is worth, charged once for every window the line opened. A Store
        // window is not one of them: nothing can be cast into a negotiation.
        const risk =
          node.risk +
          (res.state.pending && res.state.pending.kind !== 'store'
            ? w.trapWindow * trapRisk(res.state, reads)
            : 0);
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
  for (const action of candidateActions(state, me, defaultWeights, true)) {
    // Shops are in because a purchase can be the step that completes a kill:
    // the piece is bought at the guaranteed price and played.
    if (
      action.type !== 'ACTIVATE_POWER' &&
      action.type !== 'DECLARE_ATTACK' &&
      action.type !== 'CAST_SPELL' &&
      action.type !== 'USE_STORE' &&
      action.type !== 'OPEN_STORE'
    ) {
      continue;
    }
    if (budget.left <= 0) break;
    budget.left--;
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state, defaultWeights, true);
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
  shopPrices.clear();
  shopDeals.clear();
  kitCache.clear();
  intelCache.clear();
  reachCache.clear();
  reachSeed = Number.NaN;
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
  // Shops are priced against the board this decision is made on and the price
  // stands for the whole of it, searches included.
  shopPrices.clear();
  shopDeals.clear();

  // Peeks roll on the real table, once a turn. Then the search sees only what
  // the bot is entitled to: from here to the leaves every other hand is the one
  // it believes in, so no line is priced on a card it could not know about. The
  // evaluator prices hands by level and decks by their outs, and before this the
  // reply model alone was redacted, so the root's own scores leaked the truth.
  peek(state, me);
  state = redactTable(state, me);

  // Once a game: what the bot's own list can assemble, so the evaluator can
  // price a piece before the turn that uses it.
  ensureKits(state, me, w);

  // Haggling is a policy rather than a search: the evaluator cannot price an
  // offer that only pays off if the other side takes it, and a one-ply loop
  // over the window reads every counter as a wasted action. The policy answers
  // for whichever side the window waits on, so it is always legal to send.
  if (state.pending?.kind === 'store') {
    plan = null;
    return storeMove(state, state.pending, w);
  }

  const pass = passAction(state);

  // In a response window, standing still means letting the attack resolve, so
  // that outcome is the bar a trap has to beat. One ply is the right depth
  // here, because the rest of the turn is not mine to plan.
  if (state.pending) {
    plan = null;
    const passed = applyAction(state, me, pass);
    let best = pass;
    let bestScore = evaluate(passed.ok ? passed.state : state, me, w);
    for (const action of candidateActions(state, me, w)) {
      const res = applyAction(state, me, action);
      if (!res.ok) continue;
      const score = evaluate(settle(res.state, w), me, w);
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
  const built = burn(state, me, limits.maxBurnSteps, w, limits.maxSetupSteps, true);
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
  const totals = ranked.map((leaf) => outlook(leaf.state, me, w, leaf.score));
  let pick = 0;
  for (let i = 1; i < ranked.length; i++) {
    if (totals[i] > totals[pick] + 1e-6) pick = i;
  }

  // These few comparisons decide the turn, so they are where a learned
  // correction is worth spending: the search's score on the tanh scale the
  // trainer used, plus the network's guess at how wrong that score is.
  // Duels only: the network was trained at a two-seat table and the encoder
  // reads one opponent.
  if (network && networkWeight > 0 && state.players.length === 2) {
    const net = network;
    const scores = ranked.map(
      (leaf, i) =>
        Math.tanh(totals[i] / NET_SCALE) + networkWeight * valueOf(net, encode(leaf.state, me, net)),
    );
    pick = 0;
    for (let i = 1; i < ranked.length; i++) {
      if (scores[i] > scores[pick]) pick = i;
    }
  }

  return begin(state, me, key, ranked[pick].line) ?? pass;
}
