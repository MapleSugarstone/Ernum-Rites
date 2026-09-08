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
  createGame,
  manaKindFor,
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
  type PlayerState,
  type PendingStore,
  type SummonInstance,
  cloneState,
} from '../engine/state';
import {
  COPY_LIMIT,
  MANA_KINDS,
  costColored,
  type CardDef,
  type Cost,
  type CostKind,
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
   * Per point of damage the opponent can put on the bot's leader on the turn
   * after their reply, when the bot's own threat does not close the game
   * first. The reply is one turn; this is the one behind it, which is where a
   * combo one mana short today lands, and what a blocker, a held trap or a
   * cleared board is measured against.
   */
  peril: number;
  /** A kill they have assembled for the turn after their reply, if nothing changes. */
  standingDeath: number;
  /**
   * Pips the deck scan hands a kit on its probe board. Three is the opening
   * turns; a leader's kill usually wants five to seven, and at three the scan
   * read Warmateer beside Helemy as a third of a kill and Bone Known as
   * nothing. Six is the mana a game reaches by the time the pieces are held.
   */
  kitPips: number;
  /** Debt the scan's probe board starts at, so a piece that scales with debt is probed where it is played. */
  kitDebt: number;
  /**
   * Whether one card beside the leader can be a kit. The leader is on every
   * board the deck plays, so a card that turns its Power into a kill is the
   * kit's only loose piece, and it is worth holding like any other.
   */
  kitSolo: number;
  /**
   * Per point of the enemy pool's unseen spell burst a spell trap in hand
   * can answer. The reply plays the believed hand, which holds no spells, so
   * a counter never springs inside the search and read as a card to play
   * face down. A battle trap needs no such term: the reply attacks, and the
   * search springs it there.
   */
  trapHold: number;
  /**
   * Share of a kit piece's progress it keeps on the board while the kit's
   * mana is not there yet. In the pro meta check Warmateer landed on turn
   * two with no supporters in 231 of 274 Helemy games and was never Rallied
   * or fed to Alchemize in 162 of them: a body on the board is traded off,
   * a card in hand waits for the pips. One is the old reading, where the
   * board and the hand count the same.
   */
  kitExposed: number;
  /**
   * How much of a position's score is read after the opponent has answered it
   * rather than where it stands. The rest is read where it stands, because the
   * reply is a greedy guess and a position should not be judged entirely on
   * one guess about it.
   */
  reply: number;
  /**
   * How many of the reply's best lines are asked whether they hand the next
   * seat a kill before one is believed. A player who looks a turn ahead does
   * not empty their board in front of a leader the other side can reach, and a
   * reply model that does hands the bot kills it will never be given: it stood
   * on a free face hit because the reply it foresaw traded everything and died
   * to the turn after. Zero believes the best line as it stands.
   */
  replyPeril: number;
  /**
   * Share of a pool's worst case priced into each card the enemy holds unseen:
   * the burst of the best cards their leader allows, measured beside that
   * leader. Zero reads an unseen card as nothing. Measured even with zero
   * against bots, so it is on for what it does against people.
   */
  worstCase: number;
  /**
   * Share of a position's outlook read from their turn played with every
   * unseen card replaced by the worst their pool holds, beside the turn played
   * on the hand the bot believes in. Zero plays only the believed hand.
   */
  paranoia: number;
  /** Whether the kill rollout clears the bodies in front of a leader when nothing else moves a clock. Zero leaves it greedy on the clocks alone. */
  breach: number;
  /** Whether the bot's own response windows during their turn are answered with what it holds. Zero passes them all. */
  windowAnswers: number;
  /**
   * Whether a card's burst is the kill rollout's damage beside its leader
   * rather than its best single action. Off: measured two points down on
   * random decks with it on, since the danger term then sat at its cap.
   */
  deepBurst: number;
  /**
   * A supporter whose mana the list has no use for: a colourless one, which
   * only pays what any supporter pays, or a colour no card or Power asks for.
   * Against `supporter` for one the list can spend.
   */
  supporterOff: number;
  /** Share of a supporter's worth kept past what a turn of the list can spend. */
  supporterExcess: number;
  /** Per card a card in hand draws when it is played, on top of its level. */
  handDraw: number;
  /** Per HP a Deathrattle takes off an enemy leader. */
  deathBurst: number;
  /** Per debt a Deathrattle costs beyond the body's own funeral. */
  deathDebt: number;
  /** Share of a body's own board value credited when its Deathrattle hands the body back to the hand. */
  deathReturn: number;
  /** A Deathrattle that seals the enemy's slots for the locker's turn, so the bodies it kills stay dead. */
  deathLock: number;
  /** Per HP a Deathrattle takes off the enemy's bodies. */
  deathFront: number;
  /**
   * Share of a body's standing value written off when the opponent's reply
   * kills it. The standing side of the blend otherwise keeps pricing a body
   * the visible board is about to take, so cashing it in for less than its
   * full value never reads as a gain. Off: measured even on evolved decks
   * and one to two and a half points down on candy and random at 0.5 and 1.
   */
  fallen: number;
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
  // Half convex: early debt is cheap and debt near the limit is dear. Measured
  // even against the deployed bot on three pools and raises the haggles it
  // opens at the other side's Stores by two thirds.
  debtCurve: 0.5,
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
  peril: 0,
  standingDeath: 0,
  replyPeril: 12,
  kitPips: 6,
  kitDebt: 8,
  kitSolo: 1,
  trapHold: 0.5,
  kitExposed: 1,
  reply: 0.6,
  worstCase: 1,
  paranoia: 0,
  breach: 1,
  windowAnswers: 1,
  deepBurst: 0,
  supporterOff: 1,
  supporterExcess: 0.5,
  handDraw: 1,
  deathBurst: 1,
  deathDebt: 0.5,
  deathReturn: 0.5,
  deathLock: 2.5,
  deathFront: 1,
  fallen: 0,
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
export function setNetwork(bundle: NetBundle | null, weight = 0.15, mode: NetworkMode = 'correct'): void {
  network = bundle;
  networkWeight = bundle ? weight : 0;
  networkMode = mode;
  clearPlan();
}

/**
 * How an installed network is used. `correct` adds its guess at how wrong the
 * search's score was to the final ranking, which is what the residual runs
 * trained. `screen` ranks a wider set of end-of-turn leaves by the beam's score
 * plus its prediction of the outlook, and only the top few get one, which is
 * what a network trained on the search's own outlooks is for.
 */
export type NetworkMode = 'correct' | 'screen';
let networkMode: NetworkMode = 'correct';
/** Leaves gathered for a screen to choose the outlooks from: four times what gets one. */
const SCREEN_LEAVES = 24;

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

/** What one body on the board is worth to its own side. */
function bodyWorth(state: GameState, side: PlayerIdx, s: SummonInstance, w: BotWeights): number {
  const def = card(s.cardId);
  return (
    w.strength * scoredStrength(state, s) +
    w.hp * remainingHp(s) +
    w.level * levelOf(s, def) -
    w.wound * s.wounds +
    (def.triggers?.onDeath ? w.deathrattle + deathWorth(state, side, def, w) : 0) +
    w.trigger * standingHooks(def) +
    w.reach * reachOf(state, side, def, w)
  );
}

/**
 * Standing value of every body, on either side, that is on the board now and
 * gone once the reply has been played: positive for the bot's own losses,
 * negative for the enemy's. A body the reply bounces to hand counts too; the
 * reply side of the blend still credits the card it became.
 */
export function fallenWorth(state: GameState, next: GameState, me: PlayerIdx, w: BotWeights): number {
  let lost = 0;
  const sides: { side: PlayerIdx; sign: number }[] = [{ side: me, sign: 1 }];
  for (const foe of livingOpponents(state, me)) sides.push({ side: foe, sign: -1 });
  for (const { side, sign } of sides) {
    const after = next.players[side];
    if (!after) continue;
    for (const s of state.players[side].slots) {
      if (!s) continue;
      if (after.slots.some((b) => b && b.uid === s.uid)) continue;
      lost += sign * bodyWorth(state, side, s, w);
    }
  }
  return lost;
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
    // one point of damage wide. The edge sits higher for a leader facing burn,
    // and a heal still in hand stands in for some of the HP below it.
    const edge = LEADER_CLIFF_AT + BURST_TRUST * dangerOf(state, side, w);
    const shield = HEAL_TRUST * healOf(state, side, w);
    score -= sign * w.leaderCliff * Math.max(0, edge - hp - shield);

    // Debt is charged less the relief the list can still produce for it.
    const eased = RELIEF_TRUST * reliefOf(state, side, w);
    const cliff = p.debtCount >= debtLimitOf(state) - 2 ? w.debtCliff : 0;
    score -= sign * (debtCharge(state, p.debtCount - eased, w) + cliff);
    score += sign * w.love * p.love;

    for (const s of p.slots) if (s) score += sign * bodyWorth(state, side, s, w);
    if (p.leader) score += sign * w.reach * reachOf(state, side, card(p.leader.cardId), w);
    for (const id of p.hand) score += sign * w.reach * HAND_REACH_SHARE * reachOf(state, side, card(id), w);
    score += sign * w.effectDamage * effectDamageOf(state, side);
    if (side === me) score += kitBonus(state, me, w);

    // Cards in hand are not interchangeable, and the game says so with levels.
    let hand = 0;
    for (const id of p.hand) {
      const def = card(id);
      hand += w.hand + w.handLevel * ((def.level ?? 1) - 1) + w.handDraw * cardDoes(state, side, def, w).draw;
      if (def.spellTrap && w.trapHold > 0) hand += w.trapHold * trapAnswers(state, side, def, w);
    }
    score += sign * hand;

    score += sign * supportWorth(state, side, w);
    score += sign * w.deck * Math.min(p.deck.length, DECK_VALUE_CAP);

    // The list is read only when it is the bot's own. Anyone else's outs are
    // the share of what they have shown that was level 3, over their deck.
    let outs = 0;
    if (rootSeat === null || side === rootSeat) {
      for (const id of p.deck) {
        if ((card(id).level ?? 1) >= 3 && ++outs >= OUTS_CAP) break;
      }
    } else {
      const shown = shownIds(p);
      let high = 0;
      for (const id of shown) if ((card(id).level ?? 1) >= 3) high++;
      if (shown.length > 0) outs = Math.min(OUTS_CAP, Math.round((high / shown.length) * p.deck.length));
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

  const sim = cloneState(state);
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
function answerPicks(state: GameState, w: BotWeights, keepPicksOf: PlayerIdx | null = null): GameState {
  let s = state;
  for (let i = 0; i < SALE_PICKS && s.choiceQueue.length > 0 && !isOver(s); i++) {
    const who = s.choiceQueue[0].player;
    // A kill search keeps its own picks open and branches on them: a tutor
    // bought for the finisher has to be allowed to find it.
    if (who === keepPicksOf) break;
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
export function settle(state: GameState, w: BotWeights = defaultWeights, buyOut = false, keepPicksOf: PlayerIdx | null = null): GameState {
  let s = state;
  if (s.pending) {
    if (s.pending.kind === 'store') {
      s = buyOut ? buyOutStore(s, w, keepPicksOf) : settleStore(s, w);
    } else if (w.windowAnswers > 0 && s.pending.player === rootSeat && s.active !== rootSeat) {
      s = answerWindow(s, w);
    } else {
      const res = applyAction(s, s.pending.player, { type: 'PASS_RESPONSE' });
      s = res.ok ? res.state : s;
    }
  }
  return answerReplacements(answerFlips(s, w), w);
}

/**
 * Answer the replacement windows waiting on whoever is not taking the turn,
 * greedily on their own reading, as flips are. The engine refuses every other
 * action while a dead body's hole is unanswered, so a line that killed a body
 * whose owner holds another used to end right there: in the reply model the
 * bot's own hand blocked the opponent's whole turn at their first kill, and
 * a turn that could clear the board and hit the leader read as a turn that
 * did nothing.
 */
function answerReplacements(state: GameState, w: BotWeights): GameState {
  // A probe reads what one card does on a bare board; a hole it opens is not
  // a turn anyone is taking, and the death probe reads a body coming back
  // into the slot a replacement would fill.
  if (probing) return state;
  let s = state;
  for (let i = 0; i < FLIP_ANSWERS; i++) {
    if (isOver(s) || s.replaceQueue.length === 0 || s.flipQueue.length > 0 || s.pending) break;
    const owner = s.replaceQueue[0].player;
    if (owner === s.active) break;
    let pick: GameState | null = null;
    let best = Number.NEGATIVE_INFINITY;
    for (const action of replaceAnswers(s, owner, w)) {
      const res = applyAction(s, owner, action);
      if (!res.ok) continue;
      const score = evaluate(res.state, owner, w);
      if (score > best + 1e-6) {
        best = score;
        pick = res.state;
      }
    }
    if (!pick) break;
    s = pick;
  }
  return s;
}

/**
 * A response window that opened on the bot during someone else's turn is
 * answered with what the bot holds, greedily on its own evaluation: pass, or
 * any trap it can pay for. Before this every window was passed, so a trap
 * in hand was worth its card and nothing more, and the bot turned traps into
 * supporters freely. Other seats' windows are still passed: their hands are
 * believed rather than known, and the trap read prices the risk.
 */
function answerWindow(state: GameState, w: BotWeights): GameState {
  const me = state.pending?.player;
  if (me === undefined) return state;
  let pick: GameState | null = null;
  let best = Number.NEGATIVE_INFINITY;
  for (const action of [passAction(state), ...candidateActions(state, me, w)]) {
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = answerFlips(res.state, w);
    const score = evaluate(after, me, w);
    if (score > best + 1e-6) {
      best = score;
      pick = after;
    }
  }
  return pick ?? state;
}

/** Flip offers one settle answers for the side that is not taking the turn. */
const FLIP_ANSWERS = 8;

/**
 * Answer the flip offers waiting on whoever is not taking the turn. Damage
 * lands one HP card at a time, and a card with a flip cost holds the rest of
 * the blow until its owner pays or declines, so a position left with the
 * offer open has taken the first card of a blow and none of the rest. Nothing
 * in the search answered for the other side, and every damaging line was read
 * short at the first such card: a fifteen-point Alchemize read as two, in the
 * kill search and in the reply alike. Their answer is the greedy one on their
 * own reading of the board, the same guess the reply model makes for them.
 * The acting side's own offers stay with the search, which already holds
 * both answers as candidates, unless `own` asks for them: the reply walker
 * closes the offers a finished reply left open before it ends their turn.
 */
function answerFlips(state: GameState, w: BotWeights, own = false): GameState {
  let s = state;
  for (let i = 0; i < FLIP_ANSWERS; i++) {
    if (isOver(s) || s.flipQueue.length === 0) break;
    const offer = s.flipQueue[0];
    if ((offer.player === s.active) !== own) break;
    const owner = offer.player;
    let pick: GameState | null = null;
    let best = Number.NEGATIVE_INFINITY;
    for (const action of flipAnswers(s, owner)) {
      const res = applyAction(s, owner, action);
      if (!res.ok) continue;
      const score = evaluate(res.state, owner, w);
      if (score > best + 1e-6) {
        best = score;
        pick = res.state;
      }
    }
    if (!pick) break;
    s = pick;
  }
  return s;
}

/**
 * How the bot's own replacement windows are answered inside a search:
 * greedily, or declined while a hole of its own is the decision being judged.
 * Every answer at a hole is judged with the holes after it declined, one
 * blocker against none, because a greedy answer fed a body into every hole
 * their attackers opened next and read any replacement as a massacre, while
 * a model that never reached their beam past the hole read a decline as a
 * turn in which they did nothing: the bot stood open at ten to an unsapped
 * five and three unseen cards.
 */
let replaceStance: 'greedy' | 'decline' = 'greedy';

/** For tooling that walks a reply by hand: the stance a decision would have set. */
export function setReplaceStance(stance: 'greedy' | 'decline'): void {
  replaceStance = stance;
}

/** The answers a seat may give to what waits on it, the stance applied to the root seat's holes. */
function replaceAnswers(state: GameState, owner: PlayerIdx, w: BotWeights): Action[] {
  const hole =
    state.flipQueue.length === 0 &&
    !state.pending &&
    state.choiceQueue.length === 0 &&
    state.replaceQueue.length > 0 &&
    state.replaceQueue[0].player === owner;
  if (hole && owner === rootSeat && replaceStance === 'decline') return [{ type: 'DECLINE_REPLACE' }];
  return [passAction(state), ...candidateActions(state, owner, w)];
}

/** Declining, and paying in each way the cost allows. */
function flipAnswers(state: GameState, owner: PlayerIdx): Action[] {
  const acts: Action[] = [{ type: 'DECLINE_FLIP' }];
  const cost = card(state.flipQueue[0].cardId).flipCost;
  if (cost?.discard) {
    state.players[owner].hand.forEach((_, handIndex) => acts.push({ type: 'PAY_FLIP', handIndex }));
  } else {
    acts.push({ type: 'PAY_FLIP' });
  }
  return acts;
}

/**
 * Close a Store window at the price the rules guarantee. The seller has no
 * walk-away, so the top of the slider is always on offer, and a kill search
 * that needs what the shop sells takes it at that price rather than asking the
 * evaluator whether the effect is worth the debt. The buyer's deferred pick is
 * answered greedily so the bought effect lands. A window this cannot close
 * falls back to the haggle.
 */
function buyOutStore(state: GameState, w: BotWeights, keepPicksOf: PlayerIdx | null = null): GameState {
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
    s = answerPicks(closed.state, w, keepPicksOf);
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
export const LETHAL_SLACK = 6;
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
  /**
   * The believed hand holds only what the bot has named, and the rest is a
   * card no turn of theirs can play. Sampling the rest from the legal pool was
   * measured at four points worse on candy decks and even on random ones; this
   * is ten points better on candy and four on random, against the deployed
   * snapshot, which sees the real hand. What is unseen is priced as risk by the
   * trap read and not imagined as cards.
   */
  knownOnly: boolean;
}

export const defaultIntel: IntelConfig = {
  deckChance: 0.3,
  deckRolls: 3,
  handChance: 0.05,
  handRolls: 1,
  perfect: false,
  knownOnly: true,
};

let intel: IntelConfig = defaultIntel;
/** The seat the current decision belongs to: the one list the bot may read in full. */
let rootSeat: PlayerIdx | null = null;

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
export function trackOf(state: GameState, me: PlayerIdx, foe: PlayerIdx): IntelTrack {
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
export function believedHand(state: GameState, me: PlayerIdx, foe: PlayerIdx): string[] {
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
  if (intel.knownOnly) {
    const blank = blankCard()?.id ?? p.hand[0];
    while (hand.length < p.hand.length) hand.push(blank);
    return hand;
  }

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
export function redactTable(state: GameState, me: PlayerIdx): GameState {
  if (intel.perfect) return state;
  const s = cloneState(state);
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
  let cheapestColored = Number.POSITIVE_INFINITY;

  for (const def of allCards()) {
    if (def.uncollectible) continue;
    if (!isLegalUnder(def, identity)) continue;
    legal.add(def.id);
    const weight = COPY_LIMIT * UNSEEN_WEIGHT;
    total += weight;
    if (def.type !== 'trap') continue;
    traps += weight;
    // Cheapest by total pips, then by coloured pips, then by id: a colourless
    // pip is payable off any supporter where a coloured one is not, and the
    // last key keeps the two engines picking the same card from a tie.
    const pips = costColored(def.cost) + (def.cost?.C ?? 0);
    const colored = pips - (def.cost?.C ?? 0);
    const better =
      !cheapestTrap ||
      pips < cheapestPips ||
      (pips === cheapestPips && (colored < cheapestColored || (colored === cheapestColored && def.id < cheapestTrap.id)));
    if (better) {
      cheapestPips = pips;
      cheapestColored = colored;
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

/** The board a card is measured on, for tooling: see `cardDoes`. */
export function cardProbe(state: GameState, side: PlayerIdx, id: string, inHand: boolean): GameState {
  return probeBoard(state, side, [id], PROBE_DEBT, true, inHand, true);
}

/** What one use of a card does, for tests and tooling: see `cardDoes`. */
export function cardEffects(state: GameState, side: PlayerIdx, id: string, w: BotWeights = defaultWeights): CardDoes {
  return cardDoes(state, side, card(id), w);
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
 * Whether a probe is running. Probes never nest: a probe evaluates its board,
 * the evaluator prices every card by reach, and an uncached card would start
 * another probe. A body carrying a grafted Recompiler Power mints a fresh
 * Recomp at every level, so the chain has no floor. Inside a probe a card is
 * measured against the base evaluator instead.
 */
let probing = false;

// --- what one use of a card does -----------------------------------------------

/**
 * What one use of a card does, measured on a probe board rather than read off
 * its text: the debt it clears for its side, the HP it puts back on its
 * leader, and the damage it deals to the enemy leader past a wall. The
 * evaluator prices debt against the relief a list can still produce, a
 * leader's HP against the heals it holds and the burn the other side has
 * shown, so a deck built around relief carries its debt more lightly and a
 * leader facing burn keeps more in hand. Measured once a game per card, on a
 * hurt leader with twenty debt and the side's own mana.
 */
interface CardDoes {
  relief: number;
  heal: number;
  burst: number;
  /** Cards the side holds after the action beyond what it held before, the card played counted back in. */
  draw: number;
}

const NOTHING_DONE: CardDoes = { relief: 0, heal: 0, burst: 0, draw: 0 };
const doesCache: Map<string, CardDoes>[] = [new Map(), new Map(), new Map(), new Map()];
let doesSeed = Number.NaN;
const PROBE_DEBT = 20;
const PROBE_LOVE = 3;
/** Love a pool prior is taken at, rounded to this step and capped, so a Love deck's unseen burst is priced at the Love on the table. */
const PRIOR_LOVE_STEP = 3;
const PRIOR_LOVE_CAP = 15;
/** Share of a relief or heal in hand the evaluator trusts to land in time. */
const RELIEF_TRUST = 0.5;
const HEAL_TRUST = 0.5;
/** Share of what is still in the deck that counts against what is in hand. */
const DECK_SHARE = 0.25;
/** Share of the enemy's measured reach the leader's cliff moves up by. */
const BURST_TRUST = 0.5;
const DANGER_CAP = 8;

function cardDoes(state: GameState, side: PlayerIdx, def: CardDef, w: BotWeights): CardDoes {
  if (!limits.scan || probing || def.type === 'trap') return NOTHING_DONE;
  if (doesSeed !== state.seed) {
    for (const m of doesCache) m.clear();
    for (const m of deathCache) m.clear();
    doesSeed = state.seed;
  }
  const cache = doesCache[side];
  const hit = cache.get(def.id);
  if (hit) return hit;
  cache.set(def.id, NOTHING_DONE);
  const prices = new Map(shopPrices);
  const deals = new Map(shopDeals);
  const outer = probing;
  probing = true;
  let done = NOTHING_DONE;
  try {
    // The board can do things on its own: a leader's Store, a flip. Only what
    // the card adds counts, so an empty probe is the baseline.
    let empty = cache.get(EMPTY_PROBE);
    if (!empty) {
      const one = measureProbe(probeBoard(state, side, [], PROBE_DEBT, true, false, true), side, w);
      empty = {
        relief: one.relief,
        heal: one.heal,
        burst: w.deepBurst > 0 ? probeDamage(state, side, [], w, PROBE_DEBT, PROBE_PIPS) : one.burst,
        draw: one.draw,
      };
      cache.set(EMPTY_PROBE, empty);
    }
    // A summon is measured from the hand, for its battlecry, and from a slot,
    // for its Powers and its Store. Relief and heal are the most one action
    // does. Burst is the kill rollout's damage, a turn deep and beside the
    // side's own leader: one action never saw a buff repeated into a cash-in.
    const with_: CardDoes = { relief: 0, heal: 0, burst: 0, draw: 0 };
    for (const inHand of def.type === 'summon' ? [true, false] : [true]) {
      const m = measureProbe(probeBoard(state, side, [def.id], PROBE_DEBT, true, inHand, true), side, w);
      with_.relief = Math.max(with_.relief, m.relief);
      with_.heal = Math.max(with_.heal, m.heal);
      with_.draw = Math.max(with_.draw, m.draw);
      with_.burst = Math.max(
        with_.burst,
        w.deepBurst > 0 ? probeDamage(state, side, [def.id], w, PROBE_DEBT, PROBE_PIPS, inHand) : m.burst,
      );
    }
    done = {
      relief: Math.max(0, with_.relief - empty.relief),
      heal: Math.max(0, with_.heal - empty.heal),
      burst: Math.max(0, with_.burst - empty.burst),
      draw: Math.max(0, with_.draw - empty.draw),
    };
  } finally {
    probing = outer;
    shopPrices.clear();
    for (const [k, v] of prices) shopPrices.set(k, v);
    shopDeals.clear();
    for (const [k, v] of deals) shopDeals.set(k, v);
  }
  cache.set(def.id, done);
  return done;
}

const EMPTY_PROBE = '';

/** Pips of each colour a card probe holds: the board's own default. */
const PROBE_PIPS = 3;

/**
 * The most a kill rollout takes off an enemy leader from a probe board: the
 * race and the patient climb, whichever hurts more. The side's own leader
 * stands, so a card is measured beside what it will actually be played with.
 */
function probeDamage(
  state: GameState,
  side: PlayerIdx,
  kit: string[],
  w: BotWeights,
  debt: number,
  pips: number,
  inHand = false,
  love = PROBE_LOVE,
): number {
  const probe = probeBoard(state, side, kit, debt, false, inHand, false, pips, love);
  const prices = new Map(shopPrices);
  const deals = new Map(shopDeals);
  const outer = probing;
  probing = true;
  let best = 0;
  try {
    for (const setup of [0, limits.maxSetupSteps]) {
      const r = burn(probe, side, limits.maxBurnSteps, w, setup, true);
      best = Math.max(best, r.damage);
      if (r.state.winner === side) break;
    }
  } finally {
    probing = outer;
    shopPrices.clear();
    for (const [k, v] of prices) shopPrices.set(k, v);
    shopDeals.clear();
    for (const [k, v] of deals) shopDeals.set(k, v);
  }
  return best;
}

/** The most one action on a probe board does for each measure, its picks answered. */
function measureProbe(probe: GameState, side: PlayerIdx, w: BotWeights): CardDoes {
  const foes = livingOpponents(probe, side);
  const debt = probe.players[side].debtCount;
  const hp = leaderHpOf(probe, side);
  let theirs = 0;
  for (const f of foes) theirs += leaderHpOf(probe, f);
  const held = probe.players[side].hand.length;
  const done: CardDoes = { relief: 0, heal: 0, burst: 0, draw: 0 };
  for (const action of candidateActions(probe, side, w)) {
    const res = applyAction(probe, side, action);
    if (!res.ok) continue;
    const after = answerPicks(settle(res.state, w), w);
    done.relief = Math.max(done.relief, debt - after.players[side].debtCount);
    done.heal = Math.max(done.heal, leaderHpOf(after, side) - hp);
    const played = action.type === 'CAST_SPELL' || action.type === 'PLAY_SUMMON' || action.type === 'PLAY_STAGE' ? 1 : 0;
    done.draw = Math.max(done.draw, after.players[side].hand.length - held + played);
    let left = 0;
    for (const f of foes) left += leaderHpOf(after, f);
    done.burst = Math.max(done.burst, theirs - left);
  }
  return done;
}

/** Pips of each colour a pool is ranked with: enough for a buff repeated into a cash-in. */
const PRIOR_PIPS = 6;
/** Debt the probed side carries when a pool is ranked: a mid-game pile, so a body that scales with debt reads at a mid-game size. */
const PRIOR_DEBT = 10;
/** Blank cards behind each leader on the board a pool is ranked on. */
const PRIOR_DECK = 50;

/** A leader's legal pool ranked by what each card does beside that leader. */
interface PoolPrior {
  /** Card ids, the most dangerous first. */
  ranked: string[];
  /** Mean burst of the top quarter: what one unseen card is priced at. */
  top: number;
  /** Mean burst of the top quarter of the pool's spells: what one unseen spell is priced at. */
  spellTop: number;
}
const priorCache = new Map<string, PoolPrior>();
const NO_PRIOR: PoolPrior = { ranked: [], top: 0, spellTop: 0 };

/**
 * The worst a leader's pool holds: every legal card's kill rollout beside that
 * leader on a board built from nothing else, with six pips of each colour the
 * leader brings, as HP off the enemy leader. A whole turn rather than one
 * action, so a buff that repeats into the leader's own cash-in reads at
 * what the pair does rather than at nothing. Measured once per process per
 * leader. It reads no game state, so it is the same table in every game and
 * in both engines whichever thread fills it first.
 */
export function poolPrior(leaderId: string, w: BotWeights, love = PROBE_LOVE): PoolPrior {
  // Love is public, and a card that spends it deals what the table shows, so
  // the prior is taken at that Love, in steps, and cached per step.
  const at = Math.min(PRIOR_LOVE_CAP, Math.round(Math.max(0, love) / PRIOR_LOVE_STEP) * PRIOR_LOVE_STEP);
  const key = `${leaderId}/${at}`;
  const hit = priorCache.get(key);
  if (hit) return hit;
  if (probing || !limits.scan) return NO_PRIOR;
  const blank = blankCard()?.id ?? leaderId;
  const deck = Array.from({ length: PRIOR_DECK }, () => blank);
  const base = createGame(
    [
      { name: 'A', leaderId, cards: [...deck] },
      { name: 'B', leaderId, cards: [...deck] },
    ],
    0,
    0,
  );
  const ids = [...poolBehind(leaderId).legal].filter((id) => card(id).type !== 'trap').sort();
  const empty = probeDamage(base, 0, [], w, PRIOR_DEBT, PRIOR_PIPS, false, at);
  const bursts = new Map<string, number>();
  for (const id of ids) {
    bursts.set(id, Math.max(0, probeDamage(base, 0, [id], w, PRIOR_DEBT, PRIOR_PIPS, false, at) - empty));
  }
  const ranked = ids
    .slice()
    .sort((a, b) => bursts.get(b)! - bursts.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
  const quarter = Math.ceil(ranked.length / 4);
  let sum = 0;
  for (let i = 0; i < quarter; i++) sum += bursts.get(ranked[i])!;
  const spells = ranked.filter((id) => card(id).type === 'spell');
  const spellQuarter = Math.ceil(spells.length / 4);
  let spellSum = 0;
  for (let i = 0; i < spellQuarter; i++) spellSum += bursts.get(spells[i])!;
  const prior: PoolPrior = {
    ranked,
    top: quarter > 0 ? sum / quarter : 0,
    spellTop: spellQuarter > 0 ? spellSum / spellQuarter : 0,
  };
  priorCache.set(key, prior);
  return prior;
}

/** How many of a seat's hand the bot has not named: the stand-in card, at the root and below it. */
function unseenIn(p: { hand: readonly string[] }): number {
  const blank = blankCard()?.id;
  if (!blank) return 0;
  let n = 0;
  for (const id of p.hand) if (id === blank) n++;
  return n;
}

/**
 * The table with every other seat's unseen cards replaced by the worst their
 * leader's pool holds, best first, so a turn played on it is the turn the bot
 * should fear rather than the one it believes in. The table itself when no
 * seat has an unseen card.
 */
function withWorstHand(state: GameState, me: PlayerIdx, w: BotWeights): GameState {
  const blank = blankCard()?.id;
  if (!blank) return state;
  let s: GameState | null = null;
  for (const foe of livingOpponents(state, me)) {
    const prior = poolPrior(state.players[foe].leaderCardId, w, state.players[foe].love);
    if (prior.ranked.length === 0) continue;
    let k = 0;
    const hand = state.players[foe].hand.map((id) => (id === blank ? prior.ranked[k++ % prior.ranked.length] : id));
    if (k === 0) continue;
    if (!s) s = cloneState(state);
    s.players[foe].hand = hand;
  }
  return s ?? state;
}

/** What a list can spend: the colours any of its costs ask for, and the most pips one item asks for. */
interface ManaNeed {
  colours: Set<CostKind>;
  most: number;
}
const needCache = new Map<PlayerIdx, ManaNeed>();
/** Supporters priced in full however small the list's costs are. */
const SUPPORT_FLOOR = 4;
/** Supporters priced in full beyond the most one item costs, for a turn that fires more than one. */
const SUPPORT_SLACK = 2;

function noteCost(need: ManaNeed, cost: Cost | undefined): void {
  if (!cost) return;
  let pips = 0;
  for (const kind of Object.keys(cost) as CostKind[]) {
    const n = cost[kind] ?? 0;
    if (n <= 0) continue;
    need.colours.add(kind);
    pips += n;
  }
  if (pips > need.most) need.most = pips;
}

/**
 * The mana a side's list can spend: every cost on its cards, its Powers and
 * its paid flips, read from the whole list when it is the bot's own and from
 * what the side has shown when it is not. Held for the decision.
 */
function manaNeed(state: GameState, side: PlayerIdx): ManaNeed {
  const hit = needCache.get(side);
  if (hit) return hit;
  const p = state.players[side];
  const ids: string[] = rootSeat === null || side === rootSeat ? [...p.hand, ...p.deck] : [];
  for (const id of shownIds(p)) ids.push(id);
  const need: ManaNeed = { colours: new Set(), most: 0 };
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const def = card(id);
    noteCost(need, def.cost);
    for (const power of def.powers ?? []) noteCost(need, power.cost);
    noteCost(need, def.flipCost?.mana);
  }
  needCache.set(side, need);
  return need;
}

/**
 * What a side's supporters are worth: a supporter the list can spend counts
 * in full, a colourless one or one of a colour nothing asks for counts as an
 * off supporter, and every supporter past what a turn of the list can spend
 * keeps only a share. A flat count priced every supporter alike and without
 * end, so a level-one card always became one and a neutral one read as a
 * colour.
 */
function supportWorth(state: GameState, side: PlayerIdx, w: BotWeights): number {
  const p = state.players[side];
  if (p.supporters.length === 0) return 0;
  const need = manaNeed(state, side);
  const cap = Math.max(SUPPORT_FLOOR, need.most + SUPPORT_SLACK);
  let worth = 0;
  p.supporters.forEach((s, i) => {
    const kind = manaKindFor(p, card(s.cardId));
    const fits = kind === 'E' || (kind !== 'C' && need.colours.has(kind));
    const each = fits ? w.supporter : w.supporterOff;
    worth += i < cap ? each : each * w.supporterExcess;
  });
  return worth;
}

/** What a body's Deathrattle did when a probe killed it. */
interface DeathDoes {
  /** Cards in hand after the death: a body that returns to hand counts one. */
  draw: number;
  /** HP off the enemy leader. */
  burst: number;
  /** Debt beyond the body's own funeral. */
  debt: number;
  /** Printed attack, HP and level of every body that came back to the hand, summed. */
  backStrength: number;
  backHp: number;
  backLevel: number;
  /** One when the enemy's slots were sealed by the death. */
  lock: number;
  /** HP off the enemy's bodies beyond the clash itself. */
  front: number;
}
const NO_DEATH: DeathDoes = { draw: 0, burst: 0, debt: 0, backStrength: 0, backHp: 0, backLevel: 0, lock: 0, front: 0 };
/** HP cards the death probe's attacker carries, so it outlives the clash and what the Deathrattle does to it is read. */
const DEATH_ATTACKER_HP = 10;
const deathCache: Map<string, DeathDoes>[] = [new Map(), new Map(), new Map(), new Map()];
let deathAttackerId: string | null | undefined;

/** The plainest body that can swing: the first collectible summon by id with an attack, neither stationary nor a Redirection. */
function deathAttacker(): string | null {
  if (deathAttackerId !== undefined) return deathAttackerId;
  const ids = allCards()
    .filter((d) => d.type === 'summon' && !d.uncollectible && !d.stationary && !d.redirect && (d.strength ?? 0) >= 1)
    .map((d) => d.id)
    .sort();
  deathAttackerId = ids[0] ?? null;
  return deathAttackerId;
}

/**
 * What a Deathrattle does, measured by killing the body: it stands alone on
 * the probe board at one HP, the other side gets the plainest attacker there
 * is, and that attacker swings. Read once a game per card, and once for a
 * minted card the first time it is seen, so a grafted Deathrattle is priced
 * by what it does rather than as any Deathrattle. A flat term priced a body
 * that returns to hand the same as one that stays down.
 */
function deathDoes(state: GameState, side: PlayerIdx, def: CardDef, w: BotWeights): DeathDoes {
  if (!limits.scan || probing || !def.triggers?.onDeath) return NO_DEATH;
  if (doesSeed !== state.seed) {
    for (const m of doesCache) m.clear();
    for (const m of deathCache) m.clear();
    doesSeed = state.seed;
  }
  // A Deathrattle that reads the discard pile is worth what the pile holds,
  // so the pile comes along and the reading is kept per size of it, to two.
  const spells = Math.min(2, state.players[side].discard.filter((id) => card(id).type === 'spell').length);
  const key = `${def.id}:${spells}`;
  const cache = deathCache[side];
  const hit = cache.get(key);
  if (hit) return hit;
  cache.set(key, NO_DEATH);
  const attacker = deathAttacker();
  if (!attacker || def.type !== 'summon') return NO_DEATH;
  const prices = new Map(shopPrices);
  const deals = new Map(shopDeals);
  const outer = probing;
  probing = true;
  let done = NO_DEATH;
  try {
    // The side's real leader stands: a plain one is a wall with Redirection,
    // which no attack on the body could get past.
    const probe = probeBoard(state, side, [def.id], 0, false, false, false);
    probe.players[side].discard = [...state.players[side].discard];
    const body = probe.players[side].slots[0];
    const foes = livingOpponents(probe, side);
    if (body && foes.length > 0) {
      const foe = foes[0];
      for (let i = 0; i < body.hp.length - 1; i++) body.hp[i].flipped = true;
      const q = probe.players[foe];
      q.slots[1] = {
        uid: `k${probe.nextUid++}`,
        cardId: attacker,
        owner: foe,
        isLeader: false,
        hp: Array.from({ length: DEATH_ATTACKER_HP }, () => ({ cardId: attacker, flipped: false })),
        sapped: false,
        wounds: 0,
        shields: 0,
        strengthMods: [],
        effectDamageMod: 0,
        powerUses: {},
        enteredTurn: 0,
        storeStock: 1,
      };
      q.turnsTaken = Math.max(q.turnsTaken, 3);
      probe.active = foe;
      const theirs = leaderHpOf(probe, foe);
      const debt = probe.players[side].debtCount;
      const front = frontHp(probe, side);
      const clash = effectiveStrength(probe, body);
      const res = applyAction(probe, foe, {
        type: 'DECLARE_ATTACK',
        source: { kind: 'summon', player: foe, slot: 1 },
        target: { kind: 'summon', player: side, slot: 0 },
      });
      if (res.ok) {
        // Every flip offer is declined, the attacker's own included: the death
        // waits behind them, and nobody pays for anything in a measurement.
        let s = res.state;
        for (let i = 0; i < 8 && s.flipQueue.length > 0; i++) {
          const r = applyAction(s, s.flipQueue[0].player, { type: 'DECLINE_FLIP' });
          if (!r.ok) break;
          s = r.state;
        }
        const after = answerPicks(settle(s, w), w);
        let backStrength = 0;
        let backHp = 0;
        let backLevel = 0;
        for (const id of after.players[side].hand) {
          const back = card(id);
          if (back.type !== 'summon') continue;
          backStrength += back.strength ?? 0;
          backHp += back.hp ?? 0;
          backLevel += back.level ?? 1;
        }
        done = {
          draw: Math.max(0, after.players[side].hand.length),
          burst: Math.max(0, theirs - leaderHpOf(after, foe)),
          debt: Math.max(0, after.players[side].debtCount - debt - (def.level ?? 1)),
          backStrength,
          backHp,
          backLevel,
          lock: livingOpponents(after, side).some((f) => after.players[f].replaceLockedBy === side) ? 1 : 0,
          // The clash itself took the body's attack off the attacker; the rest is the Deathrattle.
          front: Math.max(0, front - frontHp(after, side) - clash),
        };
      }
    }
  } finally {
    probing = outer;
    shopPrices.clear();
    for (const [k, v] of prices) shopPrices.set(k, v);
    shopDeals.clear();
    for (const [k, v] of deals) shopDeals.set(k, v);
  }
  cache.set(key, done);
  return done;
}

/** What a Deathrattle is worth on top of being one: the cards it hands back, the HP it takes, the debt it adds. */
function deathWorth(state: GameState, side: PlayerIdx, def: CardDef, w: BotWeights): number {
  const d = deathDoes(state, side, def, w);
  const back = w.strength * d.backStrength + w.hp * d.backHp + w.level * d.backLevel;
  return (
    w.hand * d.draw +
    w.deathBurst * d.burst -
    w.deathDebt * d.debt +
    w.deathReturn * back +
    w.deathLock * d.lock +
    w.deathFront * d.front
  );
}

/** Cards a seat has shown: everything of theirs in a public zone. */
function shownIds(p: PlayerState): string[] {
  const ids: string[] = [...p.discard, ...p.debt];
  for (const sup of p.supporters) ids.push(sup.cardId);
  if (p.stage) ids.push(p.stage);
  for (const s of p.slots) if (s) ids.push(s.cardId);
  if (p.leader) ids.push(p.leader.cardId);
  return ids;
}

/**
 * What a side's hand and list can still do about a thing, as the evaluator
 * may count it: the hand in full, and the deck at a share, read as the list
 * when it is the bot's own and as the density of what they have shown when it
 * is not. A bot reads its own list and nobody else's.
 */
function stillCan(state: GameState, side: PlayerIdx, w: BotWeights, pick: (d: CardDoes) => number): number {
  const p = state.players[side];
  let total = 0;
  for (const id of p.hand) total += pick(cardDoes(state, side, card(id), w));
  const own = rootSeat === null || side === rootSeat;
  if (own) {
    let deck = 0;
    for (const id of p.deck) deck += pick(cardDoes(state, side, card(id), w));
    total += DECK_SHARE * deck;
  } else {
    const shown = shownIds(p);
    let sum = 0;
    for (const id of shown) sum += pick(cardDoes(state, side, card(id), w));
    if (shown.length > 0) total += DECK_SHARE * (sum / shown.length) * p.deck.length;
  }
  return total;
}

/** Debt the side can still clear, no more than it carries. */
function reliefOf(state: GameState, side: PlayerIdx, w: BotWeights): number {
  return Math.min(state.players[side].debtCount, stillCan(state, side, w, (d) => d.relief));
}

/** HP the side can still put back on its leader. */
function healOf(state: GameState, side: PlayerIdx, w: BotWeights): number {
  return stillCan(state, side, w, (d) => d.heal);
}

/**
 * The enemy's reach past the board at a side's leader: the burn they have
 * shown, per card, over the cards they hold, or the rate they have dealt to
 * that leader so far, whichever is larger. A leader that has lost most of a
 * large base is facing something, whether or not it has been seen yet.
 */
function dangerOf(state: GameState, side: PlayerIdx, w: BotWeights): number {
  let expected = 0;
  for (const foe of livingOpponents(state, side)) {
    const q = state.players[foe];
    const shown = shownIds(q);
    let sum = 0;
    for (const id of shown) sum += cardDoes(state, foe, card(id), w).burst;
    if (shown.length > 0) expected = Math.max(expected, (sum / shown.length) * q.hand.length);
    // Their unseen cards priced at the worst their leader's pool holds, when asked.
    if (w.worstCase > 0) {
      const unseen = unseenIn(q);
      if (unseen > 0) expected = Math.max(expected, w.worstCase * poolPrior(q.leaderCardId, w, q.love).top * unseen);
    }
  }
  const p = state.players[side];
  let rate = 0;
  if (p.leader) {
    const base = (card(p.leader.cardId).hp ?? 0) * 2 + 2;
    rate = Math.max(0, base - remainingHp(p.leader)) / Math.max(1, p.turnsTaken);
  }
  return Math.min(DANGER_CAP, Math.max(expected, rate));
}

/**
 * The unseen spell burst a spell trap in hand can answer: the enemy pool's
 * worst spells over the cards they hold unseen, for a trap its owner could
 * pay for.
 */
export function trapAnswers(state: GameState, side: PlayerIdx, def: CardDef, w: BotWeights): number {
  const p = state.players[side];
  if (!def.spellTrap || !canPay(p, costFor(p, def))) return 0;
  let worst = 0;
  for (const foe of livingOpponents(state, side)) {
    const q = state.players[foe];
    const unseen = unseenIn(q);
    if (unseen <= 0) continue;
    worst = Math.max(worst, Math.min(DANGER_CAP, poolPrior(q.leaderCardId, w, q.love).spellTop * unseen));
  }
  return worst;
}

/**
 * What a card does on its own: the share of the opponent's nearer clock it
 * takes off the probe board with its side's mana, at its side's debt. Cards
 * that are only a stat line skip the probe, because nothing on it swings past
 * the wall. A card is probed at most once per debt bucket a game, and a
 * minted card the first time it is seen, which is how a Recomp or a grafted
 * body is priced by what it inherited rather than by its printed line.
 */
function reachOf(state: GameState, side: PlayerIdx, def: CardDef, w: BotWeights): number {
  if (w.reach === 0 || probing) return 0;
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
 * bot's own slots and hand replaced by the kit, three pips (or the number asked
 * for) of every colour its leader brings and as many colourless, the bodies
 * old enough to swing, and the
 * debt asked for. Everything else is reset to the start of a game, every
 * leader at the HP the engine gives it and every opponent behind a wall, so
 * the same card measures the same whenever it is probed and in both engines.
 */
function probeBoard(
  state: GameState,
  me: PlayerIdx,
  kit: string[],
  debt = 0,
  hurt = false,
  inHand = false,
  plain = false,
  pips = 3,
  love = PROBE_LOVE,
): GameState {
  const s = cloneState(state);
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
  // A card to stand in for HP cards and the debt pile: whatever is at the
  // bottom of the list, or the kit, or a card no turn can play. The deck can
  // be empty deep in a search and the kit is empty for the baseline probe.
  const filler = p.deck[p.deck.length - 1] ?? kit[0] ?? blankCard()?.id ?? p.leaderCardId;
  p.debtCount = debt;
  p.debt = Array.from({ length: debt }, () => filler);
  p.deckOuts = 0;
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
    storeStock: 1,
  });
  // Every leader stands in fresh at the HP the engine gives it. Every opponent
  // gets a wall in front of the leader and nothing else: without one, any
  // three bodies reach a leader by swinging, and the scan would find stat
  // piles rather than the lines that carry damage past a blocker.
  for (const side of [me, ...livingOpponents(s, me)]) {
    const q = s.players[side];
    const full = (card(q.leaderCardId).hp ?? 0) * 2 + 2;
    // A hurt leader, so a heal has something to put back, and a plain one when
    // asked, so a leader's own Powers do not stand in the measure of a card.
    const face = plain && side === me ? (wallCard()?.id ?? q.leaderCardId) : q.leaderCardId;
    q.leader = bodyOf(face, side, full, true);
    // Damage is a flipped HP card, so a hurt leader keeps every card and has
    // half of them face up: that is what a heal turns back over.
    if (hurt && side === me) for (let i = 0; i < Math.floor(full / 2); i++) q.leader.hp[i].flipped = true;
    q.leaderPlayed = true;
    q.supporters = [];
    q.stage = null;
    // A little Love for the side being probed: what Candy does with it is part
    // of what its cards do, and a card measured with none reads as nothing.
    q.love = side === me ? love : 0;
    if (side === me) continue;
    q.slots = [null, null, null];
    q.debtCount = 0;
    q.debt = [];
    // Their hand and list are hidden, and a probe that read either would
    // measure a card differently for what they happen to hold.
    q.hand = q.hand.map(() => blank);
    q.deck = q.deck.map(() => blank);
    const wall = wallCard();
    if (wall) q.slots[0] = bodyOf(wall.id, side, wall.hp ?? 1, false);
  }
  let slot = 0;
  for (const id of kit) {
    const def = card(id);
    if (!inHand && def.type === 'summon' && slot < p.slots.length) {
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
        storeStock: 1,
      };
    } else {
      p.hand.push(id);
    }
  }
  const mana = { ...p.mana };
  for (const kind of MANA_KINDS) mana[kind] = 0;
  mana.C = pips;
  for (const c of deckIdentity(p.leaderCardId)) mana[c] = pips;
  p.mana = mana;
  return s;
}

/** Share of the nearer clock a kit takes off the probe board, 1 meaning a kill. */
export function kitReach(state: GameState, me: PlayerIdx, kit: string[], w: BotWeights, debt = 0, pips = 3): number {
  const probe = probeBoard(state, me, kit, debt, false, false, false, pips);
  // Shop prices are filed by seat and slot and stand for the whole decision,
  // and the probe puts its own bodies in those slots. What its rollout prices
  // there must not stand for the real table.
  const prices = new Map(shopPrices);
  const deals = new Map(shopDeals);
  const outer = probing;
  probing = true;
  let best = 0;
  try {
    for (const setup of [0, limits.maxSetupSteps]) {
      const r = burn(probe, me, limits.maxBurnSteps, w, setup, true);
      if (r.state.winner === me) return 1;
      best = Math.max(best, progressAgainst(probe, r.state, me));
    }
  } finally {
    probing = outer;
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

  // Every piece is probed on the same board the sets are, at the mana and
  // debt of the turns a kit is played on, so a part and its set compare.
  const pips = Math.max(1, Math.round(w.kitPips));
  const debt = Math.max(0, Math.round(w.kitDebt));
  const single = new Map<string, number>();
  for (const id of ids) {
    const def = card(id);
    const bare = def.type === 'summon' && !def.powers?.length && !def.triggers && !def.effectDamage;
    single.set(id, bare ? probedReach(state, me, def, w) : kitReach(state, me, [id], w, debt, pips));
  }
  const byReach = (a: string, b: string) => (single.get(b) ?? 0) - (single.get(a) ?? 0);
  const pairCards = [...ids].sort(byReach).slice(0, KIT_PAIR_CARDS);

  const kits: Kit[] = [];
  // One card beside the leader: a kit whose other piece is on every board.
  if (w.kitSolo > 0) {
    const alone = kitReach(state, me, [], w, debt, pips);
    for (const id of pairCards) {
      const reach = single.get(id) ?? 0;
      if (reach >= KIT_MIN_REACH && reach > alone + KIT_SYNERGY) kits.push({ cards: [id], reach });
    }
  }
  const pairBest = new Map<string, number>();
  for (let i = 0; i < pairCards.length; i++) {
    for (let j = i + 1; j < pairCards.length; j++) {
      const set = [pairCards[i], pairCards[j]];
      const reach = kitReach(state, me, set, w, debt, pips);
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
        const reach = kitReach(state, me, set, w, debt, pips);
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
  const safe = new Set<string>(p.hand);
  if (p.leader) safe.add(p.leader.cardId);
  const onBoard = new Set<string>();
  for (const s of p.slots) if (s) onBoard.add(s.cardId);
  const inDeck = new Set<string>(p.deck);
  // The pips the next turn brings, against the mana the scan probed the kit
  // at: short of it, a piece on the board is waiting where it can be killed.
  const pips = p.supporters.length + (p.supportersLeft > 0 ? 1 : 0);
  const boardShare = pips >= Math.round(w.kitPips) ? 1 : w.kitExposed;
  let best = 0;
  for (const kit of kits) {
    let have = 0;
    for (const id of kit.cards) {
      if (safe.has(id)) have += 1;
      else if (onBoard.has(id)) have += boardShare;
      else if (inDeck.has(id)) have += KIT_OUT_WEIGHT;
    }
    const progress = have / kit.cards.length;
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

/** A paid action that takes HP off an enemy leader, and the mana it needs. */
interface CashIn {
  cost: Cost;
  drop: number;
}

/**
 * Potential with the best paid Power still to fire, and the paid action from
 * here that takes the most off an enemy leader.
 *
 * The value: a Power that sets a body's attack from something the free steps
 * build, debt say, gains nothing until it fires, and fired early it fixes the
 * attack at what the pile was then. A climb greedy on the plain measure took
 * it first, for the largest step on offer, and every free step after that
 * built toward nothing. Counting the follow-up without taking it lets the
 * climb build first and cash in last.
 *
 * The cash-in is what the climb keeps mana back for. On the plain measure it
 * reads as a loss: the body it feeds in and the mana it costs leave the
 * measure, and the damage they became never enters it. So a climb greedy on
 * potential spent every pip on the buff that fed it and left the cash-in
 * unpayable, and a Rally three times into Alchemize was never found with
 * every piece on the board. Its damage is not added to the value: measured
 * one action deep it reads flat under a cash-in that needs a Power fired
 * first, and that stopped the debt climb two steps short of its kill.
 */
function cashPotential(
  state: GameState,
  me: PlayerIdx,
  w: BotWeights,
): { value: number; cash: Action | null; cashState: GameState | null; cashIn: CashIn | null } {
  const standing = potential(state, me);
  let value = standing;
  let cash: Action | null = null;
  let cashState: GameState | null = null;
  let cashIn: CashIn | null = null;
  const was = new Map<PlayerIdx, number>();
  for (const foe of livingOpponents(state, me)) was.set(foe, leaderHpOf(state, foe));
  for (const action of candidateActions(state, me, w, true)) {
    const paidPower = action.type === 'ACTIVATE_POWER' && !freeRepeat(state, me, action);
    const cost = paidCost(state, me, action);
    if (!paidPower && !cost) continue;
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state, w, true);
    if (losesIt(after, me)) continue;
    if (paidPower) {
      const p = potential(after, me);
      if (p > value + 1e-9) {
        value = p;
        cash = action;
        cashState = after;
      }
    }
    if (cost) {
      let drop = 0;
      for (const [foe, hp] of was) drop = Math.max(drop, hp - leaderHpOf(after, foe));
      if (drop > (cashIn?.drop ?? 0) + 1e-9) cashIn = { cost, drop };
    }
  }
  return { value, cash, cashState, cashIn };
}

/**
 * The mana an action spends, or null when it spends none: a Power with a cost,
 * or a spell with one that is aimed at a leader or at nothing in particular.
 */
function paidCost(state: GameState, me: PlayerIdx, action: Action): Cost | null {
  const p = state.players[me];
  let cost: Cost | undefined;
  if (action.type === 'ACTIVATE_POWER') {
    const src = action.source;
    const summon = src.kind === 'leader' ? p.leader : src.kind === 'summon' ? p.slots[src.slot] : null;
    if (!summon) return null;
    cost = powersOf(summon, card(summon.cardId))[action.powerIndex]?.cost;
  } else if (action.type === 'CAST_SPELL') {
    if (action.targets.length > 0 && !action.targets.some((t) => t.kind === 'leader')) return null;
    cost = costFor(p, card(p.hand[action.handIndex]));
  } else {
    return null;
  }
  if (!cost || !Object.values(cost).some((n) => (n ?? 0) > 0)) return null;
  return cost;
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
/**
 * The most a paid step from here is worth to the patient measure: what a flat
 * step that only adds a pip is taken for.
 */
function unlocks(state: GameState, me: PlayerIdx, w: BotWeights): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const action of candidateActions(state, me, w, true)) {
    if (action.type !== 'CAST_SPELL' && action.type !== 'ACTIVATE_POWER') continue;
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state, w, true);
    if (losesIt(after, me)) continue;
    const value = cashPotential(after, me, w).value;
    if (value > best) best = value;
  }
  return best;
}

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
export function burn(
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
    let levelUnlock = Number.NEGATIVE_INFINITY;
    // The mana the best cash-in from here needs stays out of the build. A
    // step that spent it built toward nothing the swing could fire.
    const here = cashPotential(cur, me, w);
    const reserve = here.cashIn;
    const standing = patient ? here.value : potential(cur, me);
    let best = standing;
    let bestCash = here.cashIn?.drop ?? 0;

    for (const action of candidateActions(cur, me, w, true)) {
      const res = applyAction(cur, me, action);
      if (!res.ok) continue;
      const after = settle(res.state, w, true);
      if (after.winner === me) {
        return { state: after, line: [...line, action], damage: worstDrop(after) };
      }
      if (losesIt(after, me)) continue;
      if (reserve && worstDrop(after) <= worstDrop(cur) && !canPay(after.players[me], reserve.cost)) continue;
      const got = patient ? cashPotential(after, me, w) : null;
      const p = got ? got.value : potential(after, me);
      const cash = got?.cashIn?.drop ?? 0;
      // On a tie the step that grows the best cash-in goes first, and then
      // the free step: the paid one is still there after it, and the free one
      // may be worth more once the paid one has fired.
      const ahead =
        p > best + 1e-9 ||
        (patient &&
          pick !== null &&
          Math.abs(p - best) <= 1e-9 &&
          (cash > bestCash + 1e-9 ||
            (Math.abs(cash - bestCash) <= 1e-9 && freeRepeat(cur, me, action) && !freeRepeat(cur, me, pick))));
      if (ahead) {
        best = p;
        bestCash = cash;
        pick = action;
        pickState = after;
      } else if (patient && Math.abs(p - standing) <= 1e-9) {
        if (action.type === 'PLAY_SUPPORTER') {
          // A supporter is a flat step that pays for the paid step after it,
          // and it is taken for what that step is worth: the card that buffs
          // the swing is not the card to set for a pip. A climb that would
          // not set one cast the buff after the swing, on the wrong turn.
          const unlock = unlocks(after, me, w);
          if (unlock > standing + 1e-9 && unlock > levelUnlock + 1e-9) {
            level = action;
            levelState = after;
            levelUnlock = unlock;
          }
        } else if (!level && freeRepeat(cur, me, action)) {
          level = action;
          levelState = after;
          levelUnlock = standing;
        }
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
    const { cash, cashState, cashIn } = cashPotential(cur, me, w);
    if (!cash || !cashState) break;
    // The reserve the climb kept holds here too: a cash that leaves the
    // cash-in unpayable is the buff that fed it, fired one time too many.
    if (cashIn && worstDrop(cashState) <= worstDrop(cur) && !canPay(cashState.players[me], cashIn.cost)) break;
    if (cashState.winner === me) {
      return { state: cashState, line: [...line, cash], damage: worstDrop(cashState) };
    }
    line.push(cash);
    cur = cashState;
  }

  for (let step = 0; step < steps; step++) {
    if (!turnGoesOn(cur, me)) break;
    // An offer of my own holds the rest of the turn: it is answered, on the
    // board it leaves, before anything else is weighed. A rollout that
    // weighed the answer against standing still stopped on it once the front
    // was clear, and read a leader open to an unsapped body as untouched.
    if (cur.flipQueue.length > 0 && cur.flipQueue[0].player === me) {
      let answer: Action | null = null;
      let answered: GameState | null = null;
      let bestAnswer = Number.NEGATIVE_INFINITY;
      for (const action of flipAnswers(cur, me)) {
        const res = applyAction(cur, me, action);
        if (!res.ok) continue;
        const after = settle(res.state, w, true);
        if (after.winner === me) {
          return { state: after, line: [...line, action], damage: worstDrop(after) };
        }
        const board = evaluate(after, me, w);
        if (board > bestAnswer) {
          bestAnswer = board;
          answer = action;
          answered = after;
        }
      }
      if (!answer || !answered) break;
      line.push(answer);
      cur = answered;
      continue;
    }
    const standingStill = evaluate(cur, me, w);
    const bodies = frontCount(cur, me);
    let pick: Action | null = null;
    let pickState: GameState | null = null;
    let bestGain = Number.NEGATIVE_INFINITY;
    let bestKills = false;
    let bestSpent = Number.POSITIVE_INFINITY;
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
      // A kill on the front is progress on their debt, and among the swings
      // that make it the smallest attacker that does goes first, so the
      // largest is still unsapped for the leader once the front is clear.
      // Broken on the board score alone, the tie went to the biggest body,
      // which survives its clash best, and the leader was reached with what
      // was left.
      const kills = frontCount(after, me) < bodies;
      const spent = action.type === 'DECLARE_ATTACK' ? attackerStrength(cur, action.source) : 0;
      let ahead: boolean;
      if (Math.abs(gain - bestGain) > 1e-9) ahead = gain > bestGain;
      else if (kills !== bestKills) ahead = kills;
      else if (kills && Math.abs(spent - bestSpent) > 1e-9) ahead = spent < bestSpent;
      else ahead = board > bestBoard;
      if (ahead) {
        bestGain = gain;
        bestKills = kills;
        bestSpent = spent;
        bestBoard = board;
        pick = action;
        pickState = after;
      }
    }

    if (bestGain <= 1e-9 && (!pick || bestBoard <= standingStill || frontHp(cur, me) > 0)) {
      // Nothing moves a clock from here. A leader behind bodies is reached by
      // clearing the bodies, and a rollout greedy on the clocks never took
      // that step, since an attack on a blocker moves neither. The breach
      // picks the clearing step, and it picks it whenever there is a front:
      // left to the board score, the step that cleared was the biggest body
      // into the softest blocker, and the swing that followed had nothing
      // large left for the leader.
      const breach = w.breach > 0 ? breachStep(cur, me, w) : null;
      if (!breach) {
        if (!pick || bestBoard <= standingStill) break;
      } else {
        pick = breach.action;
        pickState = breach.state;
      }
    }
    if (!pick || !pickState) break;
    line.push(pick);
    cur = pickState;
  }

  return { state: cur, line, damage: worstDrop(cur) };
}

/** HP on the bodies in front of every enemy leader. */
function frontHp(state: GameState, me: PlayerIdx): number {
  let hp = 0;
  for (const foe of livingOpponents(state, me)) {
    for (const s of state.players[foe].slots) if (s) hp += remainingHp(s);
  }
  return hp;
}

/** Bodies in front of every enemy leader. */
function frontCount(state: GameState, me: PlayerIdx): number {
  let n = 0;
  for (const foe of livingOpponents(state, me)) {
    for (const s of state.players[foe].slots) if (s) n++;
  }
  return n;
}

/** The attack an attacker would deal, or zero for a source the board no longer holds. */
function attackerStrength(state: GameState, ref: TargetRef): number {
  const body = ref.kind === 'leader' ? state.players[ref.player].leader : findSummon(state, ref);
  return body ? effectiveStrength(state, body) : 0;
}

/**
 * The attack, Power or spell that takes the most HP off the bodies in front
 * of an enemy leader, ties on the evaluator, or nothing when no leader has
 * bodies in front of it.
 */
function breachStep(state: GameState, me: PlayerIdx, w: BotWeights): { action: Action; state: GameState } | null {
  const front = frontHp(state, me);
  if (front <= 0) return null;
  const bodies = frontCount(state, me);
  let best: { action: Action; state: GameState } | null = null;
  let bestKill = false;
  let bestSpent = Number.POSITIVE_INFINITY;
  let bestCut = 0;
  let bestBoard = Number.NEGATIVE_INFINITY;
  for (const action of candidateActions(state, me, w, true)) {
    if (action.type !== 'DECLARE_ATTACK' && action.type !== 'ACTIVATE_POWER' && action.type !== 'CAST_SPELL') continue;
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state, w, true);
    if (losesIt(after, me)) continue;
    const cut = front - frontHp(after, me);
    if (cut <= 0) continue;
    const board = evaluate(after, me, w);
    // A step that removes a body opens the front, and among those the
    // smallest attacker that does it goes first, so the largest is still
    // unsapped for the leader once the front is clear. A breach that took the
    // most HP off the front spent the buffed body on a blocker and reached the
    // leader with what was left.
    const kills = frontCount(after, me) < bodies;
    const spent = action.type === 'DECLARE_ATTACK' ? attackerStrength(state, action.source) : 0;
    let ahead: boolean;
    if (kills !== bestKill) ahead = kills;
    else if (kills && Math.abs(spent - bestSpent) > 1e-9) ahead = spent < bestSpent;
    else ahead = cut > bestCut + 1e-9 || (Math.abs(cut - bestCut) <= 1e-9 && board > bestBoard);
    if (ahead) {
      bestKill = kills;
      bestSpent = spent;
      bestCut = cut;
      bestBoard = board;
      best = { action, state: after };
    }
  }
  return best;
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
export function nextTurn(state: GameState, me: PlayerIdx, w: BotWeights): GameState | null {
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
      // What their turn so far left waiting on another seat is answered before
      // they go on: a hole of the bot's own at the root of a decision used to
      // reach their beam unanswered, and a beam that may not act finds no line,
      // so the reply to every decline was a turn in which they did nothing.
      if (currentActor(s) !== seat) {
        const before = s;
        if (currentActor(s) === me) s = answerMine(s, me, w);
        if (currentActor(s) !== seat) {
          const res = applyAction(s, currentActor(s), passAction(s));
          if (!res.ok) return null;
          s = res.state;
        }
        if (s === before) return null;
        continue;
      }
      // Their turn is played on the hand the bot believes they hold. The table
      // was redacted at the root of this decision, so a reply cannot dodge a
      // held trap or spell it has never been shown.
      s = replyOf(s, seat, w);
      if (isOver(s)) return s;
      s = answerMine(s, me, w);
      if (isOver(s)) return s;
      // A reply can stop on an offer of its own, and the rest of that blow
      // waits on the answer. It was left there because the paused damage read
      // better than either answer, so the turn could not end and the position
      // got no reply at all, which favoured standing still over every line
      // that traded. Their offers are closed for them, and whatever else is
      // still queued is passed, before their turn ends.
      s = answerFlips(s, w, true);
      if (isOver(s)) return s;
      if (s.active === seat && s.phase === 'main' && !s.pending) {
        for (let k = 0; k < 8; k++) {
          const ended = applyAction(s, seat, { type: 'END_TURN' });
          if (ended.ok) {
            s = ended.state;
            break;
          }
          const cleared = applyAction(s, currentActor(s), passAction(s));
          if (!cleared.ok) return null;
          s = cleared.state;
          if (isOver(s)) return s;
        }
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

  // The rest of their turn is the bot's own beam on a small profile, one ply
  // deep: no reply of its own and no threat measure, so it cannot recurse. A
  // greedy loop used to play their turn one action at a time and never saw
  // what its own action set up: a supporter that paid for the spell after it,
  // a body traded off to clear the way. The beam is about as many applies as
  // that loop was.
  const standing = evaluate(state, foe, w);
  const outer = limits;
  limits = { ...outer, ...replySearch };
  let leaves: Leaf[];
  try {
    leaves = searchTurn(state, foe, w, readTable(state, foe));
  } finally {
    limits = outer;
  }
  const best = leaves[0];
  if (!best || best.score <= standing + 1e-6) return state;
  if (w.replyPeril <= 0) return best.state;
  // The best few lines are asked whether they hand the next seat a kill, and
  // the first that does not is the reply. Standing is asked after them. When
  // everything asked hands one, the best line stands: they are dead either
  // way, or the check is wrong.
  const asked = Math.round(w.replyPeril);
  const seen = new Set<string>();
  let checked = 0;
  for (const leaf of leaves) {
    if (checked >= asked || leaf.score <= standing + 1e-6) break;
    const key = digestOf(leaf.state);
    if (seen.has(key)) continue;
    seen.add(key);
    checked++;
    if (!handsKill(leaf.state, foe, w)) return leaf.state;
  }
  if (!handsKill(state, foe, w)) return state;
  return best.state;
}

/** The beam the opponent's reply gets: the same search, kept to the size of the loop it replaced. */
const replySearch = { beamWidth: 8, maxTurnDepth: 6, searchBudget: 600 } as const;

/**
 * The position the seat after the active one opens on once the active seat
 * ends its turn: what the turn left waiting on other seats answered by them,
 * its own flip offers closed, the turn ended, everything still queued passed.
 * Null when the turn cannot end from here.
 */
function handOver(state: GameState, w: BotWeights): GameState | null {
  const seat = state.active;
  let s = state;
  for (let i = 0; i < 4 && !isOver(s) && currentActor(s) !== seat; i++) s = answerMine(s, currentActor(s), w);
  s = answerFlips(s, w, true);
  if (isOver(s)) return s;
  if (s.active !== seat || s.phase !== 'main' || s.pending) return null;
  const ended = applyAction(s, seat, { type: 'END_TURN' });
  if (!ended.ok) return null;
  s = ended.state;
  for (let i = 0; i < 8; i++) {
    if (isOver(s)) return s;
    if (s.active !== seat && s.phase === 'main' && !s.pending) return s;
    const res = applyAction(s, currentActor(s), passAction(s));
    if (!res.ok) return null;
    s = res.state;
  }
  return null;
}

/** Whether a reply leaves the seat that plays next a kill on the seat that made it. */
function handsKill(state: GameState, foe: PlayerIdx, w: BotWeights): boolean {
  const s = handOver(state, w);
  if (!s) return false;
  if (isOver(s)) return s.winner !== foe;
  const hp = leaderHpOf(s, foe);
  if (hp <= 0) return true;
  const who = s.active;
  const race = burn(s, who, limits.maxThreatSteps, w);
  if (race.state.winner === who || race.damage >= hp) return true;
  const built = burn(s, who, limits.maxThreatSteps, w, limits.maxThreatSetup);
  return built.state.winner === who || built.damage >= hp;
}

/**
 * Answer what their line left waiting on me before their turn can end: a body
 * of mine they killed waits on its replacement, and a choice they handed me
 * waits on its pick. Greedy, one ply, so a trade is priced rather than thrown
 * away with the whole reply.
 */
function answerMine(state: GameState, me: PlayerIdx, w: BotWeights): GameState {
  let s = state;
  for (let i = 0; i < 6; i++) {
    if (isOver(s) || s.active === me || currentActor(s) !== me) break;
    let pick: GameState | null = null;
    let best = Number.NEGATIVE_INFINITY;
    for (const action of replaceAnswers(s, me, w)) {
      const res = applyAction(s, me, action);
      if (!res.ok) continue;
      const after = settle(res.state, w);
      const score = evaluate(after, me, w);
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
export function outlook(state: GameState, me: PlayerIdx, w: BotWeights, standing: number): number {
  // Nothing to learn from a turn nobody takes and no threat measured off it, so
  // a profile that asks for neither does not walk one forward.
  if (limits.maxReplySteps <= 0 && limits.maxThreatSteps <= 0) return standing;
  const next = isOver(state) ? state : nextTurn(state, me, w);
  if (!next) return standing;
  let after = evaluate(next, me, w);
  // The reply the bot should fear, beside the one it believes in: their turn
  // again with every unseen card the worst their pool holds.
  if (w.paranoia > 0 && !isOver(state)) {
    const feared = withWorstHand(state, me, w);
    const worst = feared === state ? next : nextTurn(feared, me, w);
    if (worst) after = (1 - w.paranoia) * after + w.paranoia * evaluate(worst, me, w);
  }
  // A body the reply takes is not standing any more. Without this the
  // standing share of the blend keeps every doomed body at full value, and
  // spending one for less than that value can never read as the better line.
  if (w.fallen > 0 && !isOver(state)) standing -= w.fallen * fallenWorth(state, next, me, w);
  const settled = (1 - w.reply) * standing + w.reply * after;
  if (isOver(next)) return settled;

  const foeHp = nearestFoeHp(next, me);
  if (foeHp <= 0) return settled;
  const reach = Math.max(
    burn(next, me, limits.maxThreatSteps, w).damage,
    burn(next, me, limits.maxThreatSteps, w, limits.maxThreatSetup).damage,
  );
  let total = settled;
  if (reach > 0) total += w.threat * Math.min(reach, foeHp) + (reach >= foeHp ? w.standingKill : 0);
  // The turn behind their reply is theirs again. A kill the bot has standing
  // lands first, so their turn after is charged only when the bot's does not
  // close the game.
  if (w.peril > 0 && reach < foeHp) {
    const myHp = leaderHpOf(next, me);
    const peril = perilOf(next, me, w);
    if (peril > 0 && myHp > 0) total -= w.peril * Math.min(peril, myHp) + (peril >= myHp ? w.standingDeath : 0);
  }
  return total;
}

/**
 * The outlook of a gathered leaf. At a hole of the bot's own, every answer is
 * judged with the holes after it declined: one blocker against none, rather
 * than one blocker against a greedy answer that feeds a body into every hole
 * their attackers open next.
 */
export function leafOutlook(root: GameState, leaf: { state: GameState; line: Action[]; score: number }, me: PlayerIdx, w: BotWeights): number {
  const hole = root.replaceQueue.length > 0 && root.replaceQueue[0].player === me;
  replaceStance = hole ? 'decline' : 'greedy';
  try {
    return outlook(leaf.state, me, w, leaf.score);
  } finally {
    replaceStance = 'greedy';
  }
}

/**
 * What they can put on the bot's leader on the turn after their reply, if the
 * bot's own next turn changes nothing: the position after the reply with the
 * bot's turn passed, then their kill rollout, racing and patient. The turn
 * start draws them a card off their real list, the same one card the reply
 * itself sees.
 */
function perilOf(next: GameState, me: PlayerIdx, w: BotWeights): number {
  if (isOver(next) || next.active !== me || next.phase !== 'main' || next.pending) return 0;
  const ended = applyAction(next, me, { type: 'END_TURN' });
  if (!ended.ok) return 0;
  let s = ended.state;
  for (let i = 0; i < 8; i++) {
    if (isOver(s)) return 0;
    if (s.active !== me && s.phase === 'main' && !s.pending) break;
    const res = applyAction(s, currentActor(s), passAction(s));
    if (!res.ok) return 0;
    s = res.state;
  }
  if (isOver(s) || s.active === me || s.phase !== 'main' || s.pending) return 0;
  const foe = s.active;
  return Math.max(
    burn(s, foe, limits.maxThreatSteps, w).damage,
    burn(s, foe, limits.maxThreatSteps, w, limits.maxThreatSetup).damage,
  );
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
export function searchTurn(state: GameState, me: PlayerIdx, w: BotWeights, reads: EnemyRead[]): Leaf[] {
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
export function findLethal(
  state: GameState,
  me: PlayerIdx,
  depth: number,
  budget: { left: number },
): Action | null {
  if (depth <= 0 || budget.left <= 0 || !turnGoesOn(state, me)) return null;
  for (const action of candidateActions(state, me, defaultWeights, true)) {
    // Shops are in because a purchase can be the step that completes a kill:
    // the piece is bought at the guaranteed price and played. A body from
    // hand is in for the same reason: a buff repeated into a cash-in starts
    // with the body it feeds. A supporter is in for the pip the finisher
    // wants, and a pick is in because a spell that asks one, or a tutor
    // that offers one, used to end the line where the question was asked:
    // a person's kill of Loan, a supporter and Absurdly Spicy Candy needed
    // both and was found only by the beam.
    if (
      action.type !== 'ACTIVATE_POWER' &&
      action.type !== 'DECLARE_ATTACK' &&
      action.type !== 'CAST_SPELL' &&
      action.type !== 'USE_STORE' &&
      action.type !== 'OPEN_STORE' &&
      action.type !== 'PLAY_SUMMON' &&
      action.type !== 'PLAY_SUPPORTER' &&
      action.type !== 'RESOLVE_CHOICE'
    ) {
      continue;
    }
    if (budget.left <= 0) break;
    budget.left--;
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state, defaultWeights, true, me);
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
  needCache.clear();
  for (const m of doesCache) m.clear();
  for (const m of deathCache) m.clear();
  rootSeat = null;
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

/**
 * The once-a-game work a first decision would otherwise pay for on the spot:
 * the deck scan for kits and the pool prior for each opponent's leader, at
 * the Love they show. Run while the other side is still taking its first
 * turn, so the bot's first decision costs what its later ones do.
 */
export function warm(state: GameState, me: PlayerIdx, w: BotWeights = defaultWeights): void {
  peek(state, me);
  rootSeat = me;
  const table = redactTable(state, me);
  ensureKits(table, me, w);
  for (const foe of livingOpponents(table, me)) {
    poolPrior(table.players[foe].leaderCardId, w, table.players[foe].love);
  }
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
  needCache.clear();

  // Peeks roll on the real table, once a turn. Then the search sees only what
  // the bot is entitled to: from here to the leaves every other hand is the one
  // it believes in, so no line is priced on a card it could not know about. The
  // evaluator prices hands by level and decks by their outs, and before this the
  // reply model alone was redacted, so the root's own scores leaked the truth.
  peek(state, me);
  rootSeat = me;
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
  let ranked: Leaf[] = [stand];
  const seen = new Set<string>([key]);
  const screening = network !== null && networkMode === 'screen' && networkWeight > 0 && state.players.length === 2;
  const gather = screening ? SCREEN_LEAVES : limits.threatLeaves;
  for (const leaf of searchTurn(state, me, w, reads)) {
    if (leaf.score >= WIN) {
      const opener = begin(state, me, key, leaf.line);
      if (opener) return opener;
    }
    if (ranked.length > gather) break;
    const leafKey = digestOf(leaf.state);
    if (seen.has(leafKey)) continue;
    seen.add(leafKey);
    ranked.push(leaf);
  }
  ranked.sort((a, b) => b.score - a.score);

  // A screen picks which of the gathered leaves are worth an outlook: the
  // beam's score on the tanh scale the trainer used, plus the network's
  // prediction of the outlook, and only the top few get the real one.
  if (screening && network && ranked.length > limits.threatLeaves + 1) {
    const net = network;
    const guess = ranked.map(
      (leaf) => Math.tanh(leaf.score / NET_SCALE) + networkWeight * valueOf(net, encode(leaf.state, me, net)),
    );
    const order = ranked.map((_, i) => i).sort((a, b) => guess[b] - guess[a] || a - b);
    ranked = order.slice(0, limits.threatLeaves + 1).map((i) => ranked[i]);
  }

  // Playing the reply out costs a turn of simulation apiece, which is why only
  // the handful of leaves gathered above get one.
  const totals = ranked.map((leaf) => leafOutlook(state, leaf, me, w));
  let pick = 0;
  for (let i = 1; i < ranked.length; i++) {
    if (totals[i] > totals[pick] + 1e-6) pick = i;
  }

  // These few comparisons decide the turn, so they are where a learned
  // correction is worth spending: the search's score on the tanh scale the
  // trainer used, plus the network's guess at how wrong that score is.
  // Duels only: the network was trained at a two-seat table and the encoder
  // reads one opponent.
  if (network && networkWeight > 0 && networkMode === 'correct' && state.players.length === 2) {
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
