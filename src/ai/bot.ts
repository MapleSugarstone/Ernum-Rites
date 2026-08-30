import type { Action, SourceRef } from '../engine/actions';
import { effectiveStrength } from '../engine/effects';
import {
  applyAction,
  canPay,
  costFor,
  legalAttackTargets,
  powerBlockers,
  readyAttackers,
  targetCandidates,
} from '../engine/engine';
import { card } from '../engine/registry';
import {
  DEBT_LIMIT,
  DRAW_PER_TURN,
  findSummon,
  isOver,
  levelOf,
  otherPlayer,
  powersOf,
  remainingHp,
  type GameState,
} from '../engine/state';
import type { CardDef, PlayerIdx, TargetRef, TargetSpec } from '../engine/types';

/**
 * A one-ply bot. It enumerates every legal action, plays each one out on a copy
 * of the state, scores the result, and keeps the best improvement. Because it
 * searches by simulation rather than by reading card text, a new card needs no
 * bot support at all.
 */

export interface BotWeights {
  leaderHp: number;
  debt: number;
  /** Panic term once a player is within two debt of losing. */
  debtCliff: number;
  strength: number;
  hp: number;
  level: number;
  wound: number;
  hand: number;
  supporter: number;
  /** Per card of deck remaining, capped, so it will not mill itself dry. */
  deck: number;
  stage: number;
}

export const defaultWeights: BotWeights = {
  leaderHp: 8,
  debt: 12,
  debtCliff: 40,
  strength: 3,
  hp: 2.5,
  level: 2,
  wound: 2,
  hand: 1.5,
  // Worth more than the card is in hand, so the bot always makes its land drop.
  supporter: 2,
  deck: 0.15,
  stage: 3,
};

const DECK_VALUE_CAP = 20;

export function evaluate(state: GameState, me: PlayerIdx, w = defaultWeights): number {
  if (state.winner === me) return 1e9;
  if (state.winner !== null) return -1e9;

  let score = 0;
  for (const side of [me, otherPlayer(me)] as PlayerIdx[]) {
    const sign = side === me ? 1 : -1;
    const p = state.players[side];

    score += sign * w.leaderHp * (p.leader ? remainingHp(p.leader) : 0);

    const cliff = p.debtCount >= DEBT_LIMIT - 2 ? w.debtCliff : 0;
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

    score += sign * w.hand * p.hand.length;
    score += sign * w.supporter * p.supporters.length;
    score += sign * w.deck * Math.min(p.deck.length, DECK_VALUE_CAP);
    score += sign * (p.stage ? w.stage : 0);

    // A one-ply search cannot see fatigue coming, so charge for the cards the
    // next two draw steps would be short by.
    const shortfall = Math.max(0, DRAW_PER_TURN * 2 - p.deck.length);
    score -= sign * w.debt * shortfall;
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
/** Attacks the follow-up probe will simulate before it stops. */
const MAX_STRIKE_STEPS = 6;
/** Bodies the follow-up probe will rebuild before it swings. */
const MAX_DEVELOP_STEPS = 4;
/** Actions deep the lethal search will look for a kill. */
const LETHAL_DEPTH = 2;
/** Damage a Power or spell might add on top of combat, for the gate. */
const LETHAL_SLACK = 4;

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
 * What the rest of this turn could still be worth: swing with everything,
 * strongest body first, at the leader when it is exposed and at the cheapest
 * kill otherwise.
 *
 * Scoring a play on the state right after it stops before the attack step, so
 * every line that reads "use the Power, then hit them" was judged as if the
 * second half never happened. Set Sail empties the board and the leader is only
 * attackable once the slots in front of it are empty, so one ply saw a board
 * wipe that bounced its own summons too and scored it as roughly nothing.
 */
/**
 * Rebuild the board before swinging. Set Sail bounces the attacker's own bodies
 * back to hand and saps the Ship, so a probe that only attacked found nothing
 * left to attack with and scored the play as a loss. Bodies arrive able to
 * swing unless they print otherwise, so replaying them and then hitting is the
 * line the card is actually for.
 */
function develop(state: GameState, me: PlayerIdx): GameState {
  for (let step = 0; step < MAX_DEVELOP_STEPS; step++) {
    if (isOver(state) || state.active !== me || state.pending) break;
    if (state.choiceQueue.length > 0) {
      // A battlecry stopped to ask something; take the first offer so the probe
      // can carry on rather than stalling mid-play.
      const acts = candidateActions(state, me);
      if (acts.length === 0) break;
      const settled = applyAction(state, me, acts[0]);
      if (!settled.ok) break;
      state = settled.state;
      continue;
    }
    // Built here rather than filtered out of candidateActions: that builds
    // every spell target combo and attack pairing too, and this runs once per
    // candidate per probe.
    const p = state.players[me];
    let slot = -1;
    for (let k = 0; k < p.slots.length; k++) {
      if (!p.slots[k]) {
        slot = k;
        break;
      }
    }
    if (slot < 0) break;
    let bestHand = -1;
    let bestKey = -1;
    for (let h = 0; h < p.hand.length; h++) {
      const def = card(p.hand[h]);
      if (def.type !== 'summon') continue;
      const key = (def.level ?? 0) * 100 + (def.strength ?? 0);
      if (key <= bestKey) continue;
      bestKey = key;
      bestHand = h;
    }
    if (bestHand < 0) break;
    const combos = enterCombos(state, me, card(p.hand[bestHand]));
    if (combos.length === 0) break;
    const pick: Action = {
      type: 'PLAY_SUMMON',
      handIndex: bestHand,
      slot,
      targets: combos[0],
    };
    const res = applyAction(state, me, pick);
    if (!res.ok) break;
    state = settle(res.state);
  }
  return state;
}

function alphaStrike(state: GameState, me: PlayerIdx): GameState {
  state = develop(state, me);
  for (let step = 0; step < MAX_STRIKE_STEPS; step++) {
    if (isOver(state) || state.active !== me || state.pending) break;
    let pick: Action | null = null;
    let bestStrength = -1;
    for (const atkRef of readyAttackers(state, me)) {
      const atk = findSummon(state, atkRef);
      if (!atk) continue;
      const str = effectiveStrength(state, atk);
      if (str <= bestStrength) continue;
      const targets = legalAttackTargets(state, atkRef);
      if (targets.length === 0) continue;
      let aim = targets[0];
      let softest = Number.POSITIVE_INFINITY;
      for (const t of targets) {
        if (t.kind === 'leader') {
          aim = t;
          break;
        }
        const body = findSummon(state, t);
        if (body && remainingHp(body) < softest) {
          softest = remainingHp(body);
          aim = t;
        }
      }
      bestStrength = str;
      pick = { type: 'DECLARE_ATTACK', source: atkRef as SourceRef, target: aim };
    }
    if (!pick) break;
    const res = applyAction(state, me, pick);
    if (!res.ok) break;
    state = settle(res.state);
  }
  return state;
}

/**
 * Whether a kill is close enough to be worth searching for. Combat reach is an
 * overestimate, since the leader is only attackable once the slots in front of
 * it are empty, but this only has to be permissive: it is a filter that keeps
 * the search off the great majority of turns, not a judgement.
 */
function lethalPlausible(state: GameState, me: PlayerIdx): boolean {
  const foe = state.players[otherPlayer(me)];
  if (!foe.leader) return false;
  // Combat cannot touch the leader while anything stands in front of it, so
  // attack strength only counts toward reach on an empty board. With bodies up,
  // only a Power or spell can finish, which is the slack.
  for (const s of foe.slots) {
    if (s) return remainingHp(foe.leader) <= LETHAL_SLACK;
  }
  let reach = 0;
  for (const r of readyAttackers(state, me)) {
    const body = findSummon(state, r);
    if (body) reach += effectiveStrength(state, body);
  }
  return remainingHp(foe.leader) <= reach + LETHAL_SLACK;
}

/**
 * Depth-first search for a line that ends the game this turn, returning the
 * action that starts it.
 *
 * The evaluator scores leader HP at a flat rate per point, so a play that
 * converts a body into exactly enough face damage reads as a small gain rather
 * than as a win. Nothing else in the bot can see lethal: the follow-up probe
 * only replays bodies and swings, so any kill needing a Power was invisible.
 * Helemy could fire Alchemize with the mana and a body to spend and declined in
 * 99.8% of those turns.
 *
 * Only damage-carrying actions are searched, which keeps the branching small,
 * and the gate above keeps it off turns where no kill is near.
 */
function findLethal(state: GameState, me: PlayerIdx, depth: number): Action | null {
  if (depth <= 0 || isOver(state) || state.active !== me || state.pending) return null;
  for (const action of candidateActions(state, me)) {
    if (
      action.type !== 'ACTIVATE_POWER' &&
      action.type !== 'DECLARE_ATTACK' &&
      action.type !== 'CAST_SPELL'
    ) {
      continue;
    }
    const res = applyAction(state, me, action);
    if (!res.ok) continue;
    const after = settle(res.state);
    if (after.winner === me) return action;
    if (findLethal(after, me, depth - 1)) return action;
  }
  return null;
}

/** The better of a play judged now and judged after the swing it sets up. */
function withFollowUp(
  after: GameState,
  me: PlayerIdx,
  w: BotWeights,
  flat: number,
): number {
  const swung = evaluate(alphaStrike(after, me), me, w);
  return swung > flat ? swung : flat;
}

export function chooseAction(
  state: GameState,
  me: PlayerIdx,
  w: BotWeights = defaultWeights,
): Action {
  const pass = passAction(state);

  // In a response window, standing still means letting the attack resolve, so
  // that outcome is the bar a trap has to beat.
  let baseline: number;
  const openTurn = !state.pending;
  if (!openTurn) {
    const passed = applyAction(state, me, pass);
    baseline = evaluate(passed.ok ? passed.state : state, me, w);
  } else {
    // Standing still, as before. Crediting the baseline with the swing too
    // would price attacking out of its own comparison and the bot would pass
    // instead of hitting: it doubled game length when tried.
    baseline = evaluate(state, me, w);
  }

  // A kill this turn beats anything the evaluator can score, and it is the one
  // thing the evaluator cannot see.
  if (openTurn && lethalPlausible(state, me)) {
    const kill = findLethal(state, me, LETHAL_DEPTH);
    if (kill) return kill;
  }

  let best = pass;
  let bestScore = baseline;

  // Two passes. The flat score ranks everything cheaply; the follow-up costs a
  // handful of extra applies, so it goes to the plays one ply is known to
  // misjudge — every Power, plus the best few of everything else.
  const candidates = candidateActions(state, me);
  const flat: number[] = new Array(candidates.length).fill(Number.NEGATIVE_INFINITY);
  const usable: boolean[] = new Array(candidates.length).fill(false);
  for (let i = 0; i < candidates.length; i++) {
    const res = applyAction(state, me, candidates[i]);
    if (!res.ok) continue;
    usable[i] = true;
    flat[i] = evaluate(settle(res.state), me, w);
  }

  // Every playable action gets the same look. Probing only some of them would
  // credit those with the whole turn and the rest with one action, which is not
  // a comparison.
  const deep: boolean[] = new Array(candidates.length).fill(false);
  if (openTurn) {
    for (let i = 0; i < candidates.length; i++) deep[i] = usable[i];
  }

  for (let i = 0; i < candidates.length; i++) {
    if (!usable[i]) continue;
    let score = flat[i];
    if (deep[i]) {
      const res = applyAction(state, me, candidates[i]);
      if (res.ok) score = withFollowUp(settle(res.state), me, w, score);
    }
    if (score > bestScore + 1e-6) {
      bestScore = score;
      best = candidates[i];
    }
  }
  return best;
}
