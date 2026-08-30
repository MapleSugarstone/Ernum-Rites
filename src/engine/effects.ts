import { card, tryCard } from './registry';
import { robotCopy } from './generated';
import { randInt, shuffle } from './rng';
import { registerChoiceResolver, runChoiceResolver } from './choices';
import {
  DEBT_LIMIT,
  emptyMana,
  findSummon,
  HAND_LIMIT,
  levelOf,
  remainingHp,
  strengthOf,
  type FlipOffer,
  type GameState,
  type PlayerState,
  type SummonInstance,
} from './state';
import { MANA_KINDS } from './types';
import type {
  CardDef,
  EffectCtx,
  Faction,
  FlipCheckCtx,
  FlipCtx,
  PlayerIdx,
  PutSummonOptions,
  TargetRef,
} from './types';

/** Guards against a flip effect that damages something whose flip damages back. */
const MAX_FLIP_DEPTH = 8;

/**
 * The same guard for triggers that fire other triggers. Slime replaces itself
 * when it dies, and a replacement drawn against an empty deck arrives with no
 * HP and dies again immediately. The debt a death costs is added only after the
 * trigger has fired, which is deliberate, so the debt limit cannot be what ends
 * it. Nothing in the set legitimately nests this far, and an unbounded chain
 * takes the process down with it.
 */
const MAX_TRIGGER_DEPTH = 8;

let triggerDepth = 0;

/**
 * Set by a Deathrattle that sends its own body back to hand. A dying summon is
 * in flight when its trigger runs, in neither the slot nor the debt zone, so the
 * trigger cannot move the card itself: it raises this instead and the destroy
 * routes the body to the hand rather than into debt. Minting a fresh copy would
 * let one card become two and break the deckbuilding limit.
 */
let returnToHand = false;

/** Raised by a Deathrattle so the destroy sends the body to hand. */
export function markReturnToHand(): void {
  returnToHand = true;
}

/**
 * The body eating this one. Set for the length of a single destroy: the eaten
 * card goes face down under the eater instead of into the debt zone, and no debt
 * is charged, because the card never reached the zone the counter counts.
 */
let eater: SummonInstance | null = null;

/**
 * Annihilation: the body is silenced, then removed from play instead of going
 * anywhere. None of its own text runs, so no Deathrattle fires and nothing it
 * was granted fires either, and it never reaches the debt zone, so its owner is
 * never charged for it. Other cards still see the death.
 */
let annihilating = false;

/** Effect Damage lent to the spell currently resolving. */
let spellBonus = 0;

export function log(state: GameState, player: PlayerIdx | null, text: string): void {
  state.log.push({ turn: state.turn, player, text });
}

/** A body the player owes for. This is what the debt counter counts. */
export function toDebt(state: GameState, player: PlayerIdx, cardId: string): void {
  state.players[player].debt.push(cardId);
}

/** Anything else that has been spent. Costs nothing by itself. */
/** True while that side holds a body whose aura voids its discard pile. */
export function voidsDiscard(state: GameState, player: PlayerIdx): boolean {
  const p = state.players[player];
  for (const s of p.slots) if (s && card(s.cardId).voidsDiscard) return true;
  if (p.leader && card(p.leader.cardId).voidsDiscard) return true;
  return !!(p.stage && tryCard(p.stage)?.voidsDiscard);
}

export function toDiscard(state: GameState, player: PlayerIdx, cardId: string): void {
  if (voidsDiscard(state, player)) return;
  state.players[player].discard.push(cardId);
}

/**
 * The only way a card reaches a hand. A hand that is already full sends
 * whatever arrives next to the discard pile instead, so cards drawn past the
 * limit are spent rather than stored. Returns false when the card was turned away.
 */
export function toHand(state: GameState, player: PlayerIdx, cardId: string): boolean {
  const p = state.players[player];
  if (p.hand.length >= HAND_LIMIT) {
    log(state, player, `${card(cardId).name} is discarded. Hand is full at ${HAND_LIMIT}.`);
    toDiscard(state, player, cardId);
    return false;
  }
  p.hand.push(cardId);
  return true;
}

/** Debt charged for running the deck out and having to turn the discard over. */
export const RESHUFFLE_DEBT = 3;
/**
 * Added to the bill on every deck-out after the first, so the second costs 6,
 * the third 9, and a deck that survives on cycling eventually cannot.
 */
export const RESHUFFLE_DEBT_STEP = 3;
/** Debt charged per card a mill cannot take, because there is nothing to take. */
export const MILL_DEBT = 1;

/** What the next deck-out will cost this player, before it happens. */
export function reshuffleCost(state: GameState, player: PlayerIdx): number {
  return RESHUFFLE_DEBT + state.players[player].deckOuts * RESHUFFLE_DEBT_STEP;
}

/**
 * Drawing off an empty deck turns the discard pile over rather than ending the
 * game: you pay the debt and keep playing. The debt is the clock, and it climbs
 * each time round, so a deck that survives on cycling runs out of rope.
 */
export function drawCards(state: GameState, player: PlayerIdx, count: number): number {
  const p = state.players[player];
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      // Charged whether or not there is a pile to turn over. With nothing left
      // anywhere the debt is the only thing still moving, and without it two
      // empty decks sit across from each other forever.
      const owed = reshuffleCost(state, player);
      p.deckOuts += 1;
      addDebt(state, player, owed, `${p.name} runs out of cards for ${owed} debt.`);
      if (state.winner !== null) break;
      if (p.discard.length === 0) break;
      const rng = { state: state.rngState };
      p.deck = shuffle(rng, p.discard.splice(0, p.discard.length));
      state.rngState = rng.state;
    }
    const id = p.deck.shift();
    if (!id) break;
    toHand(state, player, id);
    drawn++;
  }
  return drawn;
}

/**
 * Milling an empty deck charges debt instead. There is nothing left to put in
 * the discard pile, so the effect lands on the only thing it still can, and mill
 * keeps meaning something against a player who has already run out.
 */
export function millCards(state: GameState, player: PlayerIdx, count: number): number {
  const p = state.players[player];
  let milled = 0;
  let dry = 0;
  for (let i = 0; i < count; i++) {
    const id = p.deck.shift();
    if (!id) {
      dry++;
      continue;
    }
    toDiscard(state, player, id);
    milled++;
  }
  if (dry > 0) {
    const owed = dry * MILL_DEBT;
    addDebt(state, player, owed, `${p.name} has nothing left to mill and takes ${owed} debt.`);
  }
  return milled;
}

/** The only place debt is added, so the loss check can never be skipped. */
export function addDebt(
  state: GameState,
  player: PlayerIdx,
  amount: number,
  reason: string,
): void {
  // Charged even once the match has been decided. The action that decided it is
  // still resolving, and a second bill falling due inside that action is what a
  // tie looks like; endGame settles who the tie belongs to.
  if (amount <= 0) return;
  const p = state.players[player];
  p.debtCount += amount;
  log(state, player, `${reason} Debt is now ${p.debtCount}/${DEBT_LIMIT}.`);
  if (p.debtCount >= DEBT_LIMIT) {
    endGame(state, player === 0 ? 1 : 0, `${p.name} reached ${DEBT_LIMIT} debt.`);
  }
}

export function clearDebt(state: GameState, player: PlayerIdx, amount: number): void {
  if (amount <= 0) return;
  const p = state.players[player];
  const paid = Math.min(amount, p.debtCount);
  if (paid === 0) return;
  p.debtCount -= paid;
  log(state, player, `${p.name} pays off ${paid} debt, down to ${p.debtCount}/${DEBT_LIMIT}.`);
}

/** Pull `count` cards off the top of the deck as face-down HP. Returns how many landed. */
export function assignHp(state: GameState, summon: SummonInstance, count: number): number {
  const p = state.players[summon.owner];
  let added = 0;
  let scavenged = 0;
  for (let i = 0; i < count; i++) {
    let id = p.deck.shift();
    // An empty deck is not the end: HP comes out of the discard pile at random.
    if (!id && p.discard.length > 0) {
      const rng = { state: state.rngState };
      const at = randInt(rng, p.discard.length);
      state.rngState = rng.state;
      [id] = p.discard.splice(at, 1);
      scavenged++;
    }
    if (!id) break;
    summon.hp.push({ cardId: id, flipped: false });
    added++;
  }
  if (scavenged > 0) {
    log(state, summon.owner, `${scavenged} HP card(s) scavenged from the discard pile.`);
  }
  return added;
}

export function newSummon(
  state: GameState,
  cardId: string,
  owner: PlayerIdx,
  opts: { isLeader?: boolean; override?: SummonInstance['override'] } = {},
): SummonInstance {
  const s: SummonInstance = {
    uid: `s${state.nextUid++}`,
    cardId,
    owner,
    isLeader: opts.isLeader ?? false,
    hp: [],
    sapped: false,
    wounds: 0,
    shields: 0,
    strengthMods: [],
    powerUses: {},
    enteredTurn: state.turn,
  };
  if (opts.override) s.override = opts.override;
  return s;
}

export function refFor(state: GameState, summon: SummonInstance): TargetRef {
  if (summon.isLeader) return { kind: 'leader', player: summon.owner };
  const slot = state.players[summon.owner].slots.indexOf(summon);
  return { kind: 'summon', player: summon.owner, slot };
}

/** Every summon in play on a side. */
/** Refs for every supporter in a player's row, sapped or not. */
export function supporterRefsOf(state: GameState, player: PlayerIdx): TargetRef[] {
  return state.players[player].supporters.map((_, index) => ({
    kind: 'supporter' as const,
    player,
    index,
  }));
}

export function summonRefsOf(
  state: GameState,
  player: PlayerIdx,
  includeLeader = false,
): TargetRef[] {
  const out: TargetRef[] = [];
  state.players[player].slots.forEach((s, slot) => {
    if (s) out.push({ kind: 'summon', player, slot });
  });
  if (includeLeader && state.players[player].leader) out.push({ kind: 'leader', player });
  return out;
}

export function countFaction(
  state: GameState,
  player: PlayerIdx,
  faction: Faction,
): number {
  let n = 0;
  for (const ref of summonRefsOf(state, player, true)) {
    const s = findSummon(state, ref);
    if (!s) continue;
    const def = tryCard(s.cardId);
    if (def?.factions?.includes(faction)) n++;
  }
  return n;
}

// --- triggers ---------------------------------------------------------------

type TriggerName =
  | 'onEnter'
  | 'onDeath'
  | 'onAttack'
  | 'onDefend'
  | 'onAwake'
  | 'onEndTurn'
  | 'onOtherDeath'
  | 'onSpellCast'
  | 'onEnemySpellCast'
  | 'onEnemyPower'
  | 'onSurvive'
  | 'onSummonPlayed';

/** Runs a summon's own trigger, if it has one. Never asks the player anything. */
export function fireTrigger(
  state: GameState,
  summon: SummonInstance | null,
  name: TriggerName,
  targets: TargetRef[] = [],
): void {
  if (!summon || state.winner !== null) return;
  const def = tryCard(summon.cardId);
  const fn = def?.triggers?.[name];
  if (!fn || !def || triggerDepth >= MAX_TRIGGER_DEPTH) return;
  triggerDepth++;
  // A trigger that wrote nothing to the log did nothing worth announcing, which
  // is the difference between a card that reacted and a card that merely could
  // have. Read before and after rather than asked of the effect, so no card has
  // to remember to say it fired.
  const quiet = state.log.length;
  const at = refFor(state, summon);
  try {
    fn(makeEffectCtx(state, summon.owner, summon, def, targets));
  } finally {
    triggerDepth--;
  }
  if (state.log.length > quiet) {
    state.fx.push({ cardId: summon.cardId, player: summon.owner, at });
  }
}

// --- damage -----------------------------------------------------------------

/**
 * Flip face-down HP cards one at a time, resolving each flip effect before the
 * next, then send the summon to debt if nothing face-down remains.
 */
export function dealDamage(
  state: GameState,
  ref: TargetRef,
  amount: number,
  depth = 0,
  muffle = false,
): number {
  const summon = findSummon(state, ref);
  // Not stopped by a game that has just been won. A blow aimed at every
  // character lands on every character, so one that reaches both leaders takes
  // both, and the match is settled once the whole of it has resolved.
  if (!summon || amount <= 0) return 0;
  const def = card(summon.cardId);
  // A Power Shield stops the whole instance, however big, and is spent.
  if (summon.shields > 0) {
    summon.shields--;
    log(state, summon.owner, `A Power Shield on ${def.name} takes all ${amount} of it.`);
    return 0;
  }
  let muted = 0;
  for (let i = 0; i < amount; i++) {
    const next = summon.hp.find((h) => !h.flipped);
    if (!next) break;
    next.flipped = true;
    const flipped = card(next.cardId);
    log(
      state,
      summon.owner,
      `${def.name} flips ${flipped.name} (${remainingHp(summon)} HP left).`,
    );
    if (flipped.flip && depth < MAX_FLIP_DEPTH) {
      if (muffle) {
        // The attacker mutes the flip: it turns over and does nothing.
        muted++;
        log(state, summon.owner, `${flipped.name}'s FLIP is muted.`);
      } else if (flipped.flipCost) {
        // Costed flips are optional, so they wait for their owner rather than
        // interrupting damage resolution with a question.
        state.flipQueue.push({
          player: summon.owner,
          holder: refFor(state, summon),
          cardId: next.cardId,
        });
      } else {
        flipped.flip(makeFlipCtx(state, summon, flipped, depth + 1));
      }
    }
    if (
      remainingHp(summon) > 0 &&
      def.frenzy &&
      !summon.frenzyUsed &&
      def.triggers?.onSurvive &&
      depth < MAX_FLIP_DEPTH
    ) {
      summon.frenzyUsed = true;
      log(state, summon.owner, `${def.name} frenzies.`);
      fireTrigger(state, summon, 'onSurvive');
    }
    if (remainingHp(summon) === 0) {
      destroySummon(state, summon);
      return muted;
    }
  }
  return muted;
}

/** Wounds convert at 2 per damage, or 1 while the other side fields an amplifier. */
function woundRate(state: GameState, owner: PlayerIdx): number {
  const foe = state.players[owner === 0 ? 1 : 0];
  for (const s of [...foe.slots, foe.leader]) {
    if (s && tryCard(s.cardId)?.woundAmplify) return 1;
  }
  if (foe.stage && tryCard(foe.stage)?.woundAmplify) return 1;
  return 2;
}

/**
 * One batch of wounds landing on one body, for the client to animate. Not game
 * state: it is never cloned, digested or sent, and the C# engine has no
 * counterpart. Recording is off unless a caller asks for it, so the bot filling
 * its search with simulated actions does not fill this too.
 */
export interface WoundTick {
  uid: string;
  /** Wounds already on the body when the batch landed. */
  from: number;
  added: number;
  /** Wounds to the point of damage while the batch resolved. */
  rate: number;
  /** Damage the batch actually produced. */
  damage: number;
}

let woundLog: WoundTick[] | null = null;

/** Start recording wound batches. Call immediately before the one real action. */
export function captureWounds(): void {
  woundLog = [];
}

/** Take what was recorded and stop recording. */
export function takeWounds(): WoundTick[] {
  const out = woundLog ?? [];
  woundLog = null;
  return out;
}

export function addWounds(
  state: GameState,
  ref: TargetRef,
  amount: number,
  depth = 0,
): void {
  const summon = findSummon(state, ref);
  if (!summon || amount <= 0) return;
  const from = summon.wounds;
  summon.wounds += amount;
  const def = card(summon.cardId);
  log(state, summon.owner, `${def.name} takes ${amount} wound(s).`);
  const rate = woundRate(state, summon.owner);
  let damage = 0;
  while (summon.wounds >= rate) {
    summon.wounds -= rate;
    dealDamage(state, refFor(state, summon), 1, depth);
    damage++;
    if (remainingHp(summon) === 0) break;
  }
  if (woundLog) woundLog.push({ uid: summon.uid, from, added: amount, rate, damage });
}

export function destroySummon(state: GameState, summon: SummonInstance): void {
  // Consumed by this destroy alone: a Deathrattle that kills something else
  // must not annihilate it as a side effect.
  const annihilated = annihilating;
  annihilating = false;
  const p = state.players[summon.owner];
  const rdef = card(summon.cardId);
  // Reborn answers before anything else a death does: no zone, no debt, no
  // Deathrattle, so nothing that punishes dying gets to punish this.
  if (rdef.reborn && !summon.rebornUsed && !annihilated && !summon.isLeader) {
    summon.rebornUsed = true;
    summon.hp.length = 0;
    summon.hp.push({ cardId: summon.cardId, flipped: false });
    summon.wounds = 0;
    summon.shields = 0;
    log(state, summon.owner, `${rdef.name} is reborn.`);
    return;
  }
  const def = card(summon.cardId);
  if (summon.isLeader) {
    p.leader = null;
    log(state, summon.owner, `${def.name} has died.`);
    endGame(state, summon.owner === 0 ? 1 : 0, `${p.name} lost their leader.`);
    return;
  }
  const slot = p.slots.indexOf(summon);
  if (slot < 0) return;
  p.slots[slot] = null;

  // Fires while the debt is still unpaid, so a card can discount its own death.
  // Annihilation silences the body first, so none of its own text runs.
  const outer = returnToHand;
  returnToHand = false;
  if (!annihilated) fireTrigger(state, summon, 'onDeath');
  // A Deathrattle bestowed by another card fires after the body's own.
  const bestowed =
    !annihilated && summon.bestowed ? tryCard(summon.bestowed) : undefined;
  const bfn = bestowed?.triggers?.onDeath;
  if (bfn && bestowed && triggerDepth < MAX_TRIGGER_DEPTH) {
    triggerDepth++;
    try {
      bfn(makeEffectCtx(state, summon.owner, summon, bestowed, []));
    } finally {
      triggerDepth--;
    }
  }
  const handBack = returnToHand;
  returnToHand = outer;

  // The summon and everything that was protecting it goes to the debt zone,
  // but only the summon itself counts against the debt limit.
  const eatenBy = eater;
  if (annihilated) {
    log(state, summon.owner, `${def.name} is annihilated.`);
  } else if (handBack) {
    if (toHand(state, summon.owner, summon.cardId)) {
      log(state, summon.owner, `${def.name} goes back to hand instead of into debt.`);
    }
  } else if (eatenBy) {
    eatenBy.hp.push({ cardId: summon.cardId, flipped: false });
    log(state, summon.owner, `${card(eatenBy.cardId).name} eats ${def.name}.`);
  } else {
    toDebt(state, summon.owner, summon.cardId);
  }
  for (const h of summon.hp) toDiscard(state, summon.owner, h.cardId);
  if (!eatenBy && !annihilated) {
    const level = levelOf(summon, def);
    addDebt(state, summon.owner, level, `${def.name} dies for ${level} debt.`);
  }
  if (state.winner !== null) return;

  // Every other body in play sees the death, whichever side it was on.
  state.dyingOwner = summon.owner;
  state.dyingCardId = summon.cardId;
  for (const pl of state.players) {
    for (const other of [...pl.slots, pl.leader]) {
      if (other && other !== summon) fireTrigger(state, other, 'onOtherDeath');
    }
  }
  state.dyingOwner = null;
  state.dyingCardId = null;
  if (state.winner !== null) return;

  // The owner gets a chance to plug the hole before their leader is exposed.
  // On their own turn the main phase already offers that, so no prompt.
  if (summon.owner !== state.active && p.hand.some((id) => card(id).type === 'summon')) {
    state.replaceQueue.push({ player: summon.owner, slot });
  }
}

export function endGame(state: GameState, winner: PlayerIdx, reason: string): void {
  if (state.winner !== null) {
    // The player the first loss handed the match to has now lost as well.
    // Nothing calls this outside an action, so both losses came out of one, and
    // neither player is owed the win. The recorded winner is left standing for
    // the rest of the action, because it is what stops anything else resolving;
    // applyAction takes it away once the action is done.
    if (state.winner !== winner && !state.drawn) {
      // A clash has an aggressor. Both bodies dying and both bills falling due
      // is a trade the swing forced, so the attacker takes the match rather
      // than levelling it. A leader going down in the same breath is not a
      // trade anybody won, and falls through to the draw.
      const swing = state.battle?.attacker;
      const attacker =
        swing && (swing.kind === 'summon' || swing.kind === 'leader') ? swing.player : undefined;
      const leadersStanding = state.players.every((q) => q.leader !== null);
      if (attacker !== undefined && leadersStanding) {
        state.winner = attacker;
        state.winReason = `${state.winReason ?? ''} ${reason} The attacker takes the trade.`.trim();
        log(state, null, `Both players lost at once: ${state.players[attacker].name} attacked and takes it.`);
        return;
      }
      state.drawn = true;
      state.winReason = `${state.winReason ?? ''} ${reason}`.trim();
      log(state, null, `Both players lost at once: the match is a draw.`);
    }
    return;
  }
  state.winner = winner;
  state.winReason = reason;
  state.pending = null;
  state.replaceQueue = [];
  state.flipQueue = [];
  log(state, null, `${state.players[winner].name} wins: ${reason}`);
}

// --- library and zone verbs -------------------------------------------------

/** Look at the top `count`, take the first match to hand, rest to the bottom. */
/**
 * Scry: the top cards come off the deck into a face-up row held by a pending
 * choice, and the player picks a legal one. The unpicked cards go to the
 * bottom of the deck when the generic 'scry' resolver runs; a custom effect
 * key changes what happens to the pick, never to the rest.
 */
export function digForCard(
  state: GameState,
  player: PlayerIdx,
  count: number,
  match: (c: CardDef) => boolean,
  opts: { source?: string; effect?: string; prompt?: string; at?: TargetRef } = {},
): void {
  const p = state.players[player];
  const looked = p.deck.splice(0, count);
  if (looked.length === 0) return;
  const legal = looked.map((id, i) => (match(card(id)) ? i : -1)).filter((i) => i >= 0);
  const choice = {
    player,
    source: opts.source ?? '',
    effect: opts.effect ?? 'scry',
    prompt: opts.prompt ?? 'Take a card',
    cards: looked,
    legal,
    optional: true,
    ...(opts.at ? { at: opts.at } : {}),
  };
  // A scry with nothing legal still shows its owner what was there; they
  // acknowledge it rather than having it resolve out of sight.
  if (legal.length === 0) log(state, player, 'The scry turns up nothing.');
  state.choiceQueue.push(choice);
}

/**
 * A scry across the table: the cards come off the victim's deck but the other
 * player picks. Every resolver for one of these reads the victim back off the
 * choice as the player who is not choosing, so the leftovers go home.
 */
export function raidDeck(
  state: GameState,
  victim: PlayerIdx,
  chooser: PlayerIdx,
  count: number,
  effect: string,
  source: string,
): void {
  const looked = state.players[victim].deck.splice(0, count);
  if (looked.length === 0) {
    log(state, chooser, 'There is nothing left to take.');
    return;
  }
  state.choiceQueue.push({
    player: chooser,
    source,
    effect,
    prompt: 'Take a card',
    cards: looked,
    legal: looked.map((_, i) => i),
    optional: true,
  });
}

registerChoiceResolver('scry', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  const p = state.players[choice.player];
  if (pick.index !== undefined) {
    const [id] = cards.splice(pick.index, 1);
    if (toHand(state, choice.player, id)) {
      log(state, choice.player, `${card(id).name} goes to hand.`);
    }
  }
  p.deck.push(...cards);
});

/**
 * A board decision an effect defers to its controller. With one legal answer
 * the pick is made on the spot; with none the resolver runs pickless so it can
 * tidy up. Anything else waits in the queue.
 */
export function chooseBoard(
  state: GameState,
  player: PlayerIdx,
  source: string,
  effect: string,
  refs: TargetRef[],
  prompt: string,
  opts: { optional?: boolean; at?: TargetRef } = {},
): void {
  const choice = {
    player,
    source,
    effect,
    prompt,
    refs,
    ...(opts.optional ? { optional: true } : {}),
    ...(opts.at ? { at: opts.at } : {}),
  };
  if (refs.length === 0) {
    runChoiceResolver(state, choice, {});
    return;
  }
  if (refs.length === 1 && !opts.optional) {
    runChoiceResolver(state, choice, { ref: refs[0] });
    return;
  }
  state.choiceQueue.push(choice);
}

/**
 * Removes the card at `index` from a player's debt pile. The pile only ever
 * holds summons, and a summon leaving it is no longer owed for, so its level
 * is healed off the debt counter.
 */
export function removeFromDebt(
  state: GameState,
  player: PlayerIdx,
  index: number,
): string | null {
  const p = state.players[player];
  const id = p.debt[index];
  if (id === undefined) return null;
  p.debt.splice(index, 1);
  clearDebt(state, player, card(id).level ?? 1);
  return id;
}

export function reviveFromDebt(
  state: GameState,
  player: PlayerIdx,
  match: (c: CardDef) => boolean,
): CardDef | null {
  const p = state.players[player];
  const idx = p.debt.findIndex((id) => match(card(id)));
  if (idx < 0) return null;
  const id = removeFromDebt(state, player, idx)!;
  toHand(state, player, id);
  return card(id);
}

export function unflipHp(state: GameState, ref: TargetRef, count: number): number {
  const s = findSummon(state, ref);
  if (!s || count <= 0) return 0;
  let healed = 0;
  // Newest damage heals first, so a card just flipped can be undone.
  for (let i = s.hp.length - 1; i >= 0 && healed < count; i--) {
    if (s.hp[i].flipped) {
      s.hp[i].flipped = false;
      healed++;
    }
  }
  if (healed > 0) {
    log(state, s.owner, `${card(s.cardId).name} turns ${healed} HP card(s) back down.`);
  }
  return healed;
}

export function moveHpCards(
  state: GameState,
  from: TargetRef,
  to: TargetRef,
  count: number,
): number {
  const a = findSummon(state, from);
  const b = findSummon(state, to);
  if (!a || !b || a === b || count <= 0) return 0;
  let moved = 0;
  while (moved < count) {
    const idx = a.hp.findIndex((h) => !h.flipped);
    if (idx < 0) break;
    const [hp] = a.hp.splice(idx, 1);
    b.hp.push(hp);
    moved++;
  }
  if (moved > 0) {
    log(
      state,
      b.owner,
      `${moved} HP card(s) move from ${card(a.cardId).name} to ${card(b.cardId).name}.`,
    );
  }
  // Stripped to nothing, the donor falls.
  if (remainingHp(a) === 0) destroySummon(state, a);
  return moved;
}

export function bounceSummon(state: GameState, ref: TargetRef): boolean {
  const s = findSummon(state, ref);
  if (!s || s.isLeader) return false;
  const p = state.players[s.owner];
  const slot = p.slots.indexOf(s);
  if (slot < 0) return false;
  p.slots[slot] = null;
  const kept = toHand(state, s.owner, s.cardId);
  // Its armour is spent either way, but no debt is taken for a bounce.
  for (const h of s.hp) toDiscard(state, s.owner, h.cardId);
  if (kept) log(state, s.owner, `${card(s.cardId).name} returns to hand.`);
  return true;
}

/**
 * A body leaves play and goes back into its owner's deck at a random spot.
 * Unlike a bounce it is not replayable this turn, and unlike a destroy it
 * charges no debt: the card is neither in play nor in the debt zone. What was
 * spent protecting it is discarded, the same as a bounce.
 */
export function shuffleSummonIntoDeck(state: GameState, ref: TargetRef): boolean {
  const s = findSummon(state, ref);
  if (!s || s.isLeader) return false;
  const p = state.players[s.owner];
  const slot = p.slots.indexOf(s);
  if (slot < 0) return false;
  p.slots[slot] = null;
  const rng = { state: state.rngState };
  const into = p.deck.length === 0 ? 0 : randInt(rng, p.deck.length + 1);
  state.rngState = rng.state;
  p.deck.splice(into, 0, s.cardId);
  for (const h of s.hp) toDiscard(state, s.owner, h.cardId);
  log(state, s.owner, `${card(s.cardId).name} shuffles into ${p.name}'s deck.`);
  return true;
}

/** Every card in hand goes back into the deck. Returns how many moved. */
export function shuffleHandIntoDeck(state: GameState, player: PlayerIdx): number {
  const p = state.players[player];
  const moved = p.hand.length;
  if (moved === 0) return 0;
  const rng = { state: state.rngState };
  for (const id of p.hand) {
    const into = p.deck.length === 0 ? 0 : randInt(rng, p.deck.length + 1);
    p.deck.splice(into, 0, id);
  }
  state.rngState = rng.state;
  p.hand.length = 0;
  log(state, player, `${p.name} shuffles ${moved} card(s) back into their deck.`);
  return moved;
}

export function transformSummon(
  state: GameState,
  ref: TargetRef,
  cardId: string,
): boolean {
  const s = findSummon(state, ref);
  const def = tryCard(cardId);
  if (!s || !def) return false;
  const was = card(s.cardId).name;
  s.cardId = cardId;
  delete s.override;
  s.powerUses = {};
  log(state, s.owner, `${was} becomes ${def.name}.`);
  return true;
}

export function takeControlOf(state: GameState, ref: TargetRef, to: PlayerIdx): boolean {
  const s = findSummon(state, ref);
  if (!s || s.isLeader) return false;
  const from = state.players[s.owner];
  const dest = state.players[to];
  const openSlot = dest.slots.findIndex((x) => x === null);
  if (openSlot < 0) return false;
  const slot = from.slots.indexOf(s);
  if (slot < 0) return false;
  from.slots[slot] = null;
  dest.slots[openSlot] = s;
  s.owner = to;
  s.sapped = true;
  log(state, to, `${dest.name} seizes ${card(s.cardId).name}.`);
  return true;
}

// --- contexts ---------------------------------------------------------------

function baseHelpers(state: GameState, me: PlayerIdx, sourceId: string) {
  return {
    // Damage from a card, so Effect Damage applies. Combat does not come
    // through here, which is what keeps the keyword off the clash.
    damage: (target: TargetRef, amount: number) =>
      dealDamage(state, target, amount + effectDamageOf(state, me)),
    wound: (target: TargetRef, amount: number) => addWounds(state, target, amount),
    shield: (target: TargetRef, count: number) => {
      const s = findSummon(state, target);
      if (s && count > 0) {
        s.shields += count;
        log(state, me, `${card(s.cardId).name} raises ${count} Power Shield(s).`);
      }
    },
    returnToHand: () => markReturnToHand(),
    catch: (target: TargetRef, count: number) => catchHp(state, target, count),
    // Solar's ramp: the top card goes into the supporter row rather than the
    // hand. Sapped, so it pays nothing this turn and everything after. The card
    // is spent doing it, which is the price.
    supporterFromDeck: (player: PlayerIdx, sapped = true) => {
      const p = state.players[player];
      const id = p.deck.shift();
      if (!id) {
        log(state, player, `${p.name} has nothing left to feed the row.`);
        return null;
      }
      p.supporters.push({ cardId: id, sapped });
      log(state, player, `${card(id).name} is spent straight into the supporter row.`);
      return id;
    },
    curse: (player: PlayerIdx, cardId: string, count: number) =>
      curseDeck(state, player, cardId, count),
    giveSupporter: (player: PlayerIdx, cardId: string, sapped = true) => {
      state.players[player].supporters.push({ cardId, sapped });
      log(state, me, `${state.players[player].name} gains ${card(cardId).name} as a supporter.`);
    },
    destroySupporter: (target: TargetRef) => {
      if (target.kind !== 'supporter') return false;
      const p = state.players[target.player];
      const s = p.supporters[target.index];
      if (!s) return false;
      p.supporters.splice(target.index, 1);
      p.debt.push(s.cardId);
      log(state, me, `${card(s.cardId).name} stops supporting.`);
      return true;
    },
    returnSupporter: (target: TargetRef) => {
      if (target.kind !== 'supporter') return false;
      const p = state.players[target.player];
      const s = p.supporters[target.index];
      if (!s) return false;
      p.supporters.splice(target.index, 1);
      if (toHand(state, target.player, s.cardId)) {
        log(state, me, `${card(s.cardId).name} comes back off the supporter row.`);
      }
      return true;
    },
    raidDeck: (victim: PlayerIdx, chooser: PlayerIdx, count: number, effect: string) =>
      raidDeck(state, victim, chooser, count, effect, sourceId),
    lockReplace: (player: PlayerIdx, turns = 1) => {
      const p = state.players[player];
      p.replaceLocked = Math.max(p.replaceLocked, turns);
      state.replaceQueue = state.replaceQueue.filter((r) => r.player !== player);
      log(state, me, `${p.name} cannot fill that slot yet.`);
    },
    draw: (player: PlayerIdx, count: number) => {
      drawCards(state, player, count);
    },
    reinforce: (target: TargetRef, count: number) => {
      const s = findSummon(state, target);
      if (s) assignHp(state, s, count);
    },
    buffStrength: (target: TargetRef, amount: number, duration: 'turn' | 'permanent') => {
      const s = findSummon(state, target);
      if (s) s.strengthMods.push({ amount, duration, source: sourceId });
    },
    mill: (player: PlayerIdx, count: number) => {
      millCards(state, player, count);
    },
    reviveFromDebt: (player: PlayerIdx, match: (c: CardDef) => boolean) =>
      reviveFromDebt(state, player, match),
    removeFromDebt: (player: PlayerIdx, index: number) => removeFromDebt(state, player, index),
    unflip: (target: TargetRef, count: number) => unflipHp(state, target, count),
    addDebt: (player: PlayerIdx, amount: number, reason?: string) =>
      addDebt(state, player, amount, reason ?? `${state.players[player].name} takes ${amount} debt.`),
    clearDebt: (player: PlayerIdx, amount: number) => clearDebt(state, player, amount),
    summonsOf: (player: PlayerIdx, includeLeader = false) =>
      summonRefsOf(state, player, includeLeader),
    toHand: (player: PlayerIdx, cardId: string) => {
      toHand(state, player, cardId);
    },
    log: (message: string) => log(state, me, message),
  };
}

/**
 * Effect Damage a player has in play: the sum over their summons and stage. It
 * lifts damage dealt by cards, never damage dealt by a clash.
 */
export function effectDamageOf(state: GameState, player: PlayerIdx): number {
  const p = state.players[player];
  const args = { state, controller: player };
  const from = (def: CardDef | undefined) =>
    (def?.effectDamage ?? 0) + (def?.triggers?.effectDamageBonus?.(args) ?? 0);
  let total = 0;
  for (const s of p.slots) if (s) total += from(card(s.cardId));
  if (p.leader) total += from(card(p.leader.cardId));
  if (p.stage) total += tryCard(p.stage)?.effectDamage ?? 0;
  return total + spellBonus;
}

/**
 * Silences a body and removes it from play for good. Its own Deathrattle never
 * fires, it reaches no zone, and nothing can raise it, recycle it or charge
 * debt for it. Other cards still see that a summon died.
 */
export function annihilate(state: GameState, summon: SummonInstance): void {
  const outer = annihilating;
  annihilating = true;
  try {
    destroySummon(state, summon);
  } finally {
    annihilating = outer;
  }
}

/**
 * Strips cards off the top of a discard pile for good, most recently discarded
 * first. Deterministic so both engines annihilate the same cards.
 */
export function annihilateDiscard(
  state: GameState,
  player: PlayerIdx,
  count: number,
): number {
  const pile = state.players[player].discard;
  const took = Math.min(count, pile.length);
  if (took <= 0) return 0;
  pile.splice(pile.length - took, took);
  log(state, player, `${took} card(s) are annihilated from ${state.players[player].name}'s discard pile.`);
  return took;
}

/** Lends Effect Damage to a spell for the length of its resolution. */
export function takeSpellBonus(state: GameState, caster: PlayerIdx): number {
  const p = state.players[caster];
  const had = p.spellBonus ?? 0;
  p.spellBonus = 0;
  spellBonus = had;
  return had;
}

export function clearSpellBonus(): void {
  spellBonus = 0;
}

/**
 * Fish catches flipped HP cards: they leave the board and go back to their
 * owner's hand. The summon gets smaller, which is the price, and a card that
 * was spent comes back, which is the point.
 */
export function catchHp(state: GameState, ref: TargetRef, count: number): number {
  const summon = findSummon(state, ref);
  if (!summon || count <= 0) return 0;
  let taken = 0;
  for (let i = summon.hp.length - 1; i >= 0 && taken < count; i--) {
    if (!summon.hp[i].flipped) continue;
    toHand(state, summon.owner, summon.hp[i].cardId);
    summon.hp.splice(i, 1);
    taken++;
  }
  if (taken > 0) {
    log(
      state,
      summon.owner,
      `${taken} spent HP card(s) are caught back off ${card(summon.cardId).name}.`,
    );
  }
  if (summon.hp.length === 0) destroySummon(state, summon);
  return taken;
}

/**
 * Oil curses a deck: copies of a junk card go in at spread-out depths, so they
 * turn up as draws and as face-down HP for the rest of the game.
 */
export function curseDeck(
  state: GameState,
  player: PlayerIdx,
  cardId: string,
  count: number,
): number {
  if (!tryCard(cardId) || count <= 0) return 0;
  const deck = state.players[player].deck;
  const rng = { state: state.rngState };
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const at = deck.length === 0 ? 0 : randInt(rng, deck.length + 1);
    deck.splice(at, 0, cardId);
    placed++;
  }
  state.rngState = rng.state;
  log(
    state,
    player,
    `${placed} ${card(cardId).name} are worked into ${state.players[player].name}'s deck.`,
  );
  return placed;
}

/** Takes a card out of a debt zone and puts it in `me`'s hand. */
export function takeFromDebt(
  state: GameState,
  me: PlayerIdx,
  from: PlayerIdx,
  match: (c: CardDef) => boolean,
): CardDef | null {
  const zone = state.players[from].debt;
  for (let i = 0; i < zone.length; i++) {
    const def = tryCard(zone[i]);
    if (!def || !match(def)) continue;
    removeFromDebt(state, from, i);
    if (toHand(state, me, def.id)) {
      log(state, me, `${def.name} is pulled out of the scrap.`);
    }
    return def;
  }
  return null;
}

export function makeEffectCtx(
  state: GameState,
  me: PlayerIdx,
  source: SummonInstance | null,
  def: CardDef,
  targets: TargetRef[],
): EffectCtx {
  const opp: PlayerIdx = me === 0 ? 1 : 0;
  return {
    state,
    me,
    opp,
    source,
    card: def,
    targets,
    ...baseHelpers(state, me, def.id),
    rawDamage: (target: TargetRef, amount: number) => dealDamage(state, target, amount),
    taxSpells: (player: PlayerIdx, amount: number) => {
      const p = state.players[player];
      p.spellTax = Math.max(0, p.spellTax + amount);
      log(
        state,
        me,
        amount > 0 ? `${p.name}'s spells cost ${amount} more.` : `${p.name}'s spells get cheaper.`,
      );
    },
    takeFromDebt: (from: PlayerIdx, match: (c: CardDef) => boolean) =>
      takeFromDebt(state, me, from, match),
    hack: (from: PlayerIdx, match: (c: CardDef) => boolean) => {
      const got = takeFromDebt(state, me, from, match);
      if (!got) return null;
      // The taken card is swapped for a freshly minted Robot copy.
      const hand = state.players[me].hand;
      hand[hand.lastIndexOf(got.id)] = robotCopy(got.id);
      log(state, me, `${got.name} is rebuilt in Robot.`);
      return got;
    },
    sap: (target: TargetRef) => {
      const s = findSummon(state, target);
      if (s) s.sapped = true;
    },
    unsap: (target: TargetRef) => {
      const s = findSummon(state, target);
      if (s) s.sapped = false;
    },
    dig: (
      player: PlayerIdx,
      count: number,
      match: (c: CardDef) => boolean,
      opts: { effect?: string; prompt?: string; at?: TargetRef } = {},
    ) => digForCard(state, player, count, match, { source: def.id, ...opts }),
    choose: (
      effect: string,
      refs: TargetRef[],
      prompt: string,
      opts: { optional?: boolean; at?: TargetRef; player?: PlayerIdx } = {},
    ) =>
      chooseBoard(state, opts.player ?? me, def.id, effect, refs, prompt, {
        // Default the anchor to the body asking. The client draws the targeting
        // arrow from here, and without it the arrow springs from nowhere.
        ...(source ? { at: refFor(state, source) } : {}),
        ...opts,
      }),
    debtSummons: (player: PlayerIdx) => debtSummonRefs(state, player),
    discardSpells: (player: PlayerIdx) => discardSpellRefs(state, player),
    scryDiscard: (player: PlayerIdx, count: number, match: (c: CardDef) => boolean) =>
      scryDiscardPile(state, player, count, match, def.id),
    recycleDiscard: (player: PlayerIdx, count: number) => recycleDiscard(state, player, count),
    recycleTopDiscard: (player: PlayerIdx) => recycleTopDiscard(state, player),
    reviveFromDiscard: (player: PlayerIdx, match?: (c: CardDef) => boolean) => {
      const pile = state.players[player].discard;
      let idx = pile.length - 1;
      while (idx >= 0 && match && !match(card(pile[idx]))) idx--;
      if (idx < 0) return null;
      const [id] = pile.splice(idx, 1);
      if (toHand(state, me, id)) {
        log(state, me, `${card(id).name} comes back from the discard pile.`);
      }
      return card(id);
    },
    reclaim: (target: TargetRef) => {
      if (target.kind !== 'discard') return null;
      const pile = state.players[target.player].discard;
      const [id] = pile.splice(target.index, 1);
      if (!id) return null;
      if (toHand(state, me, id)) {
        log(state, me, `${card(id).name} comes back from the discard pile.`);
      }
      return card(id);
    },
    drawRandomFromDiscard: (player: PlayerIdx) => {
      const pile = state.players[player].discard;
      if (pile.length === 0) return null;
      const rng = { state: state.rngState };
      const at = randInt(rng, pile.length);
      state.rngState = rng.state;
      const [id] = pile.splice(at, 1);
      if (toHand(state, me, id)) {
        log(state, me, `${card(id).name} is fished out of the discard pile.`);
      }
      return card(id);
    },
    summonAt: (target: TargetRef) => findSummon(state, target),
    destroy: (target: TargetRef) => {
      const s = findSummon(state, target);
      if (s) destroySummon(state, s);
    },
    annihilate: (target: TargetRef) => {
      const s = findSummon(state, target);
      if (s) annihilate(state, s);
    },
    annihilateDiscard: (player: PlayerIdx, count: number) =>
      annihilateDiscard(state, player, count),
    grantSpellBonus: (amount: number) => {
      state.players[me].spellBonus += amount;
    },
    devour: (target: TargetRef) => {
      const victim = findSummon(state, target);
      if (!source || !victim || victim === source) return false;
      const outer = eater;
      eater = source;
      try {
        destroySummon(state, victim);
      } finally {
        eater = outer;
      }
      return true;
    },
    emptySlot: (player: PlayerIdx) => {
      const i = state.players[player].slots.findIndex((s) => s === null);
      return i < 0 ? null : i;
    },
    takeFromHand: (player: PlayerIdx, index: number) => {
      const hand = state.players[player].hand;
      if (index < 0 || index >= hand.length) return null;
      return hand.splice(index, 1)[0];
    },
    putSummon: (
      player: PlayerIdx,
      cardId: string,
      slot: number,
      options: PutSummonOptions,
    ) => putSummonDirect(state, player, cardId, slot, options),
    stackHp: (target: TargetRef, handIndex: number) => {
      const s = findSummon(state, target);
      const hand = state.players[me].hand;
      if (!s || handIndex < 0 || handIndex >= hand.length) return false;
      const [id] = hand.splice(handIndex, 1);
      s.hp.push({ cardId: id, flipped: false });
      log(state, me, `A card from hand slides under ${card(s.cardId).name} as HP.`);
      return true;
    },
    moveHp: (from: TargetRef, to: TargetRef, count: number) =>
      moveHpCards(state, from, to, count),
    bounce: (target: TargetRef) => bounceSummon(state, target),
    shuffleIntoDeck: (target: TargetRef) => shuffleSummonIntoDeck(state, target),
    shuffleHandIntoDeck: (player: PlayerIdx) => shuffleHandIntoDeck(state, player),
    transform: (target: TargetRef, cardId: string) =>
      transformSummon(state, target, cardId),
    takeControl: (target: TargetRef) => takeControlOf(state, target, me),
    debtToHp: (target: TargetRef, debtIndex: number) => {
      const s = findSummon(state, target);
      const debt = state.players[me].debt;
      if (!s || debtIndex < 0 || debtIndex >= debt.length) return false;
      const id = removeFromDebt(state, me, debtIndex)!;
      s.hp.push({ cardId: id, flipped: false });
      log(state, me, `${card(id).name} climbs out of debt as HP.`);
      return true;
    },
    countFaction: (player: PlayerIdx, faction: Faction) =>
      countFaction(state, player, faction),
    discard: (player: PlayerIdx, index: number) => {
      const hand = state.players[player].hand;
      if (index < 0 || index >= hand.length) return null;
      const [id] = hand.splice(index, 1);
      toDiscard(state, player, id);
      return id;
    },
  };
}

/** Refs for every spell sitting in a player's discard pile. */
export function discardSpellRefs(state: GameState, player: PlayerIdx): TargetRef[] {
  const out: TargetRef[] = [];
  state.players[player].discard.forEach((id, index) => {
    if (card(id).type === 'spell') out.push({ kind: 'discard', player, index });
  });
  return out;
}

/**
 * Shuffle the discard pile, then reveal its top cards as a scry. The picked
 * card goes to hand; the rest fall back onto the pile.
 */
export function scryDiscardPile(
  state: GameState,
  player: PlayerIdx,
  count: number,
  match: (c: CardDef) => boolean,
  source: string,
): void {
  const p = state.players[player];
  if (p.discard.length === 0) {
    log(state, player, 'The discard pile is empty.');
    return;
  }
  const rng = { state: state.rngState };
  shuffle(rng, p.discard);
  state.rngState = rng.state;
  const looked = p.discard.splice(0, count);
  const legal = looked.map((id, i) => (match(card(id)) ? i : -1)).filter((i) => i >= 0);
  const choice = {
    player,
    source,
    effect: 'scry-discard',
    prompt: 'Take a card from the discard pile',
    cards: looked,
    legal,
    optional: true,
  };
  if (legal.length === 0) log(state, player, 'The scry turns up nothing.');
  state.choiceQueue.push(choice);
}

registerChoiceResolver('scry-discard', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  if (pick.index !== undefined) {
    const [id] = cards.splice(pick.index, 1);
    if (toHand(state, choice.player, id)) {
      log(state, choice.player, `${card(id).name} goes to hand.`);
    }
  }
  for (const rest of cards) toDiscard(state, choice.player, rest);
});

/** Shuffle `count` random discard cards back into the deck at random spots. */
/** The most recent card in a discard pile goes back into its owner's deck. */
export function recycleTopDiscard(state: GameState, player: PlayerIdx): boolean {
  const p = state.players[player];
  const id = p.discard.pop();
  if (!id) return false;
  const rng = { state: state.rngState };
  const into = p.deck.length === 0 ? 0 : randInt(rng, p.deck.length + 1);
  state.rngState = rng.state;
  p.deck.splice(into, 0, id);
  log(state, player, `${card(id).name} shuffles back into ${p.name}'s deck.`);
  return true;
}

export function recycleDiscard(state: GameState, player: PlayerIdx, count: number): void {
  const p = state.players[player];
  const rng = { state: state.rngState };
  let moved = 0;
  for (let i = 0; i < count && p.discard.length > 0; i++) {
    const at = randInt(rng, p.discard.length);
    const [id] = p.discard.splice(at, 1);
    const into = p.deck.length === 0 ? 0 : randInt(rng, p.deck.length + 1);
    p.deck.splice(into, 0, id);
    moved++;
  }
  state.rngState = rng.state;
  log(state, player, `${moved} card(s) shuffled back into ${p.name}'s deck.`);
}

/** Refs for every summon sitting in a player's debt zone. */
export function debtSummonRefs(state: GameState, player: PlayerIdx): TargetRef[] {
  const out: TargetRef[] = [];
  state.players[player].debt.forEach((id, index) => {
    if (card(id).type === 'summon') out.push({ kind: 'debt', player, index });
  });
  return out;
}

/** Put a summon into a slot from anywhere, for effects and choice resolvers alike. */
export function putSummonDirect(
  state: GameState,
  player: PlayerIdx,
  cardId: string,
  slot: number,
  options: PutSummonOptions,
): SummonInstance | null {
  const p = state.players[player];
  if (slot < 0 || slot >= p.slots.length || p.slots[slot]) return null;
  const s = newSummon(
    state,
    cardId,
    player,
    options.asPrinted
      ? {}
      : {
          override: {
            strength: options.strength,
            color: options.color,
            level: options.level ?? 1,
          },
        },
  );
  p.slots[slot] = s;
  assignHp(state, s, options.hp);
  log(state, player, `${card(cardId).name} enters play with ${s.hp.length} HP.`);
  if (s.hp.length === 0) {
    destroySummon(state, s);
    return s;
  }
  fireTrigger(state, s, 'onEnter');
  return s;
}

export function makeFlipCtx(
  state: GameState,
  holder: SummonInstance,
  def: CardDef,
  depth = 0,
): FlipCtx {
  const me = holder.owner;
  const opp: PlayerIdx = me === 0 ? 1 : 0;
  return {
    state,
    me,
    opp,
    holder,
    card: def,
    ...baseHelpers(state, me, def.id),
    // A flip's own damage and wounds carry the flip depth, so a chain of
    // damage-flips and heal-flips cannot recurse without limit.
    damage: (target: TargetRef, amount: number) =>
      dealDamage(state, target, amount + effectDamageOf(state, me), depth),
    wound: (target: TargetRef, amount: number) => addWounds(state, target, amount, depth),
    choose: (
      effect: string,
      refs: TargetRef[],
      prompt: string,
      opts: { optional?: boolean; at?: TargetRef; player?: PlayerIdx } = {},
    ) => chooseBoard(state, opts.player ?? me, def.id, effect, refs, prompt, opts),
    debtSummons: (player: PlayerIdx) => debtSummonRefs(state, player),
    discardSpells: (player: PlayerIdx) => discardSpellRefs(state, player),
    scryDiscard: (player: PlayerIdx, count: number, match: (c: CardDef) => boolean) =>
      scryDiscardPile(state, player, count, match, def.id),
    recycleDiscard: (player: PlayerIdx, count: number) => recycleDiscard(state, player, count),
    summonAt: (target: TargetRef) => findSummon(state, target),
    supportersOf: (player: PlayerIdx) => supporterRefsOf(state, player),
    clearMana: (player: PlayerIdx) => {
      const pool = state.players[player].mana;
      const lost = MANA_KINDS.reduce((n, k) => n + pool[k], 0);
      state.players[player].mana = emptyMana();
      return lost;
    },
    // Free when the body was going to fall anyway, a real decision when it was not.
    destroyHolder: () => destroySummon(state, holder),
    discardThis: () => {
      const at = holder.hp.findIndex((h) => h.flipped && h.cardId === def.id);
      if (at < 0) return false;
      const [gone] = holder.hp.splice(at, 1);
      toDiscard(state, holder.owner, gone.cardId);
      return true;
    },
  };
}

function makeFlipCheckCtx(
  state: GameState,
  holder: SummonInstance,
): FlipCheckCtx {
  const me = holder.owner;
  return {
    state,
    me,
    opp: me === 0 ? 1 : 0,
    holder,
    debtSummons: (player: PlayerIdx) => debtSummonRefs(state, player),
    summonsOf: (player: PlayerIdx, includeLeader = false) =>
      summonRefsOf(state, player, includeLeader),
    summonAt: (target: TargetRef) => findSummon(state, target),
    deckLeft: (player: PlayerIdx) => state.players[player].deck.length,
    discardLeft: (player: PlayerIdx) => state.players[player].discard.length,
  };
}

/**
 * Whether paying for the flip at the head of the queue would change anything.
 * A card that prints no opinion is always worth asking about; the ones that do
 * answer for positions where the effect would find nothing to work on.
 */
export function flipWouldFire(state: GameState, offer: FlipOffer): boolean {
  const def = tryCard(offer.cardId);
  if (!def?.flipUseful) return true;
  const holder = findSummon(state, offer.holder);
  if (!holder) return false;
  return def.flipUseful(makeFlipCheckCtx(state, holder));
}

// --- combat -----------------------------------------------------------------

/** Printed strength plus modifiers plus every aura currently in play. */
export function effectiveStrength(state: GameState, summon: SummonInstance): number {
  const def = card(summon.cardId);
  let total = strengthOf(summon, def);
  for (const controller of [0, 1] as PlayerIdx[]) {
    const stageId = state.players[controller].stage;
    if (stageId) {
      const bonus = tryCard(stageId)?.stageHooks?.strengthBonus;
      if (bonus) total += bonus({ state, controller, summon, def });
    }
    for (const ref of summonRefsOf(state, controller, true)) {
      const other = findSummon(state, ref);
      if (!other) continue;
      const bonus = tryCard(other.cardId)?.triggers?.strengthBonus;
      if (bonus) total += bonus({ state, controller, summon, def, source: other });
    }
  }
  return Math.max(0, total);
}

/**
 * The same sum effectiveStrength returns, broken out by the card responsible for
 * each part: modifiers an effect stapled on, and the auras a field or another
 * body radiates. For a client that wants to print what is moving a number, so it
 * allocates and effectiveStrength stays a plain addition.
 */
export function strengthSourcesOf(
  state: GameState,
  summon: SummonInstance,
): { cardId: string; amount: number }[] {
  const def = card(summon.cardId);
  const totals = new Map<string, number>();
  const add = (cardId: string, amount: number) => {
    if (amount !== 0) totals.set(cardId, (totals.get(cardId) ?? 0) + amount);
  };
  // A modifier from before sources were recorded reads as the body's own doing.
  for (const m of summon.strengthMods) add(m.source ?? summon.cardId, m.amount);
  for (const controller of [0, 1] as PlayerIdx[]) {
    const stageId = state.players[controller].stage;
    const stageBonus = stageId && tryCard(stageId)?.stageHooks?.strengthBonus;
    if (stageId && stageBonus) add(stageId, stageBonus({ state, controller, summon, def }));
    for (const ref of summonRefsOf(state, controller, true)) {
      const other = findSummon(state, ref);
      if (!other) continue;
      const bonus = tryCard(other.cardId)?.triggers?.strengthBonus;
      if (bonus) add(other.cardId, bonus({ state, controller, summon, def, source: other }));
    }
  }
  return [...totals].map(([cardId, amount]) => ({ cardId, amount }));
}

/**
 * Both sides of a clash hit each other, then damage is flipped attacker first.
 * A leader that is attacked deals nothing back, which is what makes attacking
 * with your own leader a real gamble: it takes the counter-hit, it never gives one.
 */
export function resolveClash(
  state: GameState,
  attackerRef: TargetRef,
  defenderRef: TargetRef,
): void {
  const attacker = findSummon(state, attackerRef);
  const defender = findSummon(state, defenderRef);
  if (!attacker || !defender) {
    state.battle = null;
    return;
  }

  fireTrigger(state, defender, 'onDefend');
  if (state.winner !== null || !findSummon(state, attackerRef) || !findSummon(state, defenderRef)) {
    state.battle = null;
    return;
  }

  const atkPower = effectiveStrength(state, attacker);
  const defPower = defender.isLeader ? 0 : effectiveStrength(state, defender);

  log(
    state,
    attacker.owner,
    `${card(attacker.cardId).name} (${atkPower}) clashes with ${card(defender.cardId).name} (${defPower}).`,
  );

  dealDamage(state, attackerRef, defPower);
  const muffle = !defender.isLeader && !!card(attacker.cardId).muffleFlips;
  const muted = dealDamage(state, defenderRef, atkPower, 0, muffle);
  if (muted > 0 && findSummon(state, attackerRef)) {
    unflipHp(state, attackerRef, muted);
  }
  state.battle = null;
}

export function manaAvailable(p: PlayerState): number {
  return p.supporters.filter((s) => !s.sapped).length;
}
