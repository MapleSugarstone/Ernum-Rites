import type { Action, ApplyResult, SourceRef } from './actions';
import {
  assignHp,
  clearOppWanted,
  destroySummon,
  drawCards,
  effectiveStrength,
  flipWouldFire,
  oppWasWanted,
  strengthSourcesOf,
  supporterLocked,
  fireTrigger,
  log,
  makeEffectCtx,
  makeFlipCtx,
  newSummon,
  playerLoses,
  resolveClash,
  setActingPlayer,
  toDebt,
  clearSpellBonus,
  takeSpellBonus,
  toDiscard,
  toHand,
  type OppMode,
} from './effects';
import { card, tryCard } from './registry';
import { runChoiceResolver } from './choices';
import { shuffle } from './rng';
import {
  allSummons,
  currentActor,
  DRAW_PER_TURN,
  emptyMana,
  findSummon,
  isOver,
  isParty,
  livingOpponents,
  MAX_ACTIONS,
  MAX_TURNS,
  nextLiving,
  OPENING_HAND,
  OPENING_HAND_BONUS,
  otherPlayer,
  PARTY_HAND_BONUS,
  powersOf,
  SUMMON_SLOTS,
  type GameState,
  type PendingSpell,
  type PlayerState,
  type SummonInstance,
} from './state';
import {
  COLORS,
  MANA_KINDS,
  type ManaKind,
  type CardDef,
  type Cost,
  type PlayerIdx,
  type TargetRef,
  type TargetSpec,
} from './types';

export interface DeckList {
  name: string;
  leaderId: string;
  /** Card ids, repeats allowed. The leader is not part of this list. */
  cards: string[];
}

function newPlayer(list: DeckList): PlayerState {
  return {
    name: list.name,
    deck: [...list.cards],
    hand: [],
    debt: [],
    discard: [],
    debtCount: 0,
    supporters: [],
    slots: Array.from({ length: SUMMON_SLOTS }, () => null),
    leader: null,
    leaderCardId: list.leaderId,
    stage: null,
    mana: emptyMana(),
    supportersLeft: 1,
    spellBonus: 0,
    replaceLocked: 0,
    spellTax: 0,
    leaderPlayed: false,
    turnsTaken: 0,
    deckOuts: 0,
  };
}

export function createGame(
  decks: DeckList[],
  seed: number = (Date.now() & 0x7fffffff) >>> 0,
  startingPlayer: PlayerIdx = 0,
): GameState {
  if (decks.length < 2 || decks.length > 4) {
    throw new Error(`A game seats 2 to 4 players, not ${decks.length}.`);
  }
  const state: GameState = {
    battle: null,
    seed,
    rngState: seed,
    nextUid: 1,
    turn: 0,
    active: startingPlayer,
    startingPlayer,
    phase: 'awake',
    players: decks.map(newPlayer),
    pending: null,
    dyingOwner: null,
    dyingCardId: null,
    replaceQueue: [],
    flipQueue: [],
    choiceQueue: [],
    winner: null,
    drawn: false,
    actions: 0,
    winReason: null,
    log: [],
    fx: [],
    version: 0,
  };

  const rng = { state: state.rngState };
  state.players.forEach((p, idx) => {
    shuffle(rng, p.deck);
    // The player going second opens a card up on the one going first.
    const size =
      OPENING_HAND +
      (isParty(state) ? PARTY_HAND_BONUS : 0) +
      (idx === startingPlayer ? 0 : OPENING_HAND_BONUS);
    for (let i = 0; i < size; i++) {
      const id = p.deck.shift();
      if (id) toHand(state, idx as PlayerIdx, id);
    }
  });
  state.rngState = rng.state;

  startTurn(state, startingPlayer);
  return state;
}

// --- mana -------------------------------------------------------------------

/** Pool plus everything the unsapped supporter row could still produce. */
/** What a card costs the player holding it. */
export function costFor(p: PlayerState, def: CardDef): Cost | undefined {
  let cost = def.cost;
  const cast = def.type === 'spell' || def.type === 'trap';
  if (cast && freeSpellsFor(p)) return undefined;
  // A tax only bites on what you cast, never on a body you place.
  if (p.spellTax > 0 && cast) {
    cost = { ...(cost ?? {}), C: (cost?.C ?? 0) + p.spellTax };
  }
  return cost;
}

/** Overknower: an empty board and a body that says so make spells cost nothing. */
function freeSpellsFor(p: PlayerState): boolean {
  if (p.slots.some((s) => s !== null)) return false;
  return [...p.slots, p.leader].some((s) => s !== null && card(s.cardId).freeSpells);
}

/** Which mana bucket a supporter fills. Neutral cards pay colourless. */
export function manaKindFor(_p: PlayerState, def: CardDef): ManaKind {
  return def.color === 'N' || def.neutral ? 'C' : def.color;
}

export function availableMana(p: PlayerState): Record<ManaKind, number> {
  const avail = { ...p.mana };
  for (const s of p.supporters) {
    if (!s.sapped) avail[manaKindFor(p, card(s.cardId))] += 1;
  }
  return avail;
}

/**
 * Coloured pips have to come from their own colour. A colourless pip takes
 * whatever is left over, colourless mana first and then any colour, which is why
 * it is checked against the surplus rather than against a bucket.
 */
export function canPay(p: PlayerState, cost: Cost | undefined): boolean {
  if (!cost) return true;
  const avail = availableMana(p);
  let spare = avail.C;
  for (const c of COLORS) {
    const need = cost[c] ?? 0;
    if (need > avail[c]) return false;
    spare += avail[c] - need;
  }
  return (cost.C ?? 0) <= spare;
}

/** Spends the pool first, then saps matching supporters. */
function payCost(state: GameState, player: PlayerIdx, cost: Cost | undefined): boolean {
  const p = state.players[player];
  if (!canPay(p, cost)) return false;
  if (!cost) return true;
  for (const c of COLORS) {
    let need = cost[c] ?? 0;
    while (need > 0 && p.mana[c] > 0) {
      p.mana[c] -= 1;
      need -= 1;
    }
    while (need > 0) {
      const s = p.supporters.find((x) => !x.sapped && manaKindFor(p, card(x.cardId)) === c);
      if (!s) return false;
      s.sapped = true;
      need -= 1;
    }
  }

  // Colourless takes whatever is spare: the colourless pool first, so coloured
  // mana is kept back for the pips that actually need it.
  let generic = cost.C ?? 0;
  while (generic > 0 && p.mana.C > 0) {
    p.mana.C -= 1;
    generic -= 1;
  }
  while (generic > 0) {
    const s = p.supporters.find((x) => !x.sapped && manaKindFor(p, card(x.cardId)) === 'C');
    if (!s) break;
    s.sapped = true;
    generic -= 1;
  }
  for (const k of MANA_KINDS) {
    while (generic > 0 && p.mana[k] > 0) {
      p.mana[k] -= 1;
      generic -= 1;
    }
  }
  while (generic > 0) {
    const s = p.supporters.find((x) => !x.sapped);
    if (!s) return false;
    s.sapped = true;
    generic -= 1;
  }
  return true;
}

// --- turn structure ---------------------------------------------------------

function startTurn(state: GameState, player: PlayerIdx): void {
  state.active = player;
  state.turn += 1;
  state.phase = 'awake';
  const p = state.players[player];
  p.turnsTaken += 1;
  if (p.replaceLocked > 0) p.replaceLocked -= 1;
  p.supportersLeft = 1;
  p.mana = emptyMana();
  log(state, player, `${p.name} begins turn ${p.turnsTaken}.`);

  if (!p.leaderPlayed) {
    const def = card(p.leaderCardId);
    const leader = newSummon(state, p.leaderCardId, player, { isLeader: true });
    p.leader = leader;
    // Doubled, then two more: a leader has to survive long enough to be played
    // around rather than raced down before the game starts.
    assignHp(state, leader, (def.hp ?? 0) * 2 + 2);
    p.leaderPlayed = true;
    log(state, player, `${def.name} takes the field with ${leader.hp.length} HP.`);
    fireTrigger(state, leader, 'onEnter');
  }

  if (p.stage) {
    const def = card(p.stage);
    def.stageHooks?.onAwake?.(makeEffectCtx(state, player, null, def, []));
  }

  for (const s of [...p.slots, p.leader]) fireTrigger(state, s, 'onAwake');
  if (state.winner !== null) return;

  for (const s of p.supporters) s.sapped = false;
  for (const s of [...p.slots, p.leader]) {
    if (!s) continue;
    if (s.sapLock && s.sapped) {
      s.sapLock = false;
      log(state, player, `${card(s.cardId).name} stays sapped.`);
    } else {
      s.sapped = false;
    }
    s.powerUses = {};
  }

  state.phase = 'draw';
  const goesFirst = p.turnsTaken === 1 && player === state.startingPlayer;
  if (!goesFirst) drawCards(state, player, DRAW_PER_TURN);

  state.phase = 'main';
}

function finishTurn(state: GameState): void {
  state.phase = 'end';
  for (const { summon } of allSummons(state)) {
    summon.strengthMods = summon.strengthMods.filter((m) => m.duration !== 'turn');
  }
  // Only the player ending the turn: "at the end of your turn" is their step.
  // Slots snapshot first, so a body that dies to one of these does not fire.
  const ending = state.players[state.active];
  // 'This turn' runs out here whether or not a spell ever spent it.
  ending.spellBonus = 0;
  for (const s of [...ending.slots, ending.leader]) {
    if (s) fireTrigger(state, s, 'onEndTurn');
  }
  if (state.winner !== null) return;
  state.players[state.active].mana = emptyMana();
  if (state.winner !== null) return;
  startTurn(state, nextLiving(state, state.active));
}

// --- targeting --------------------------------------------------------------

function sidesFor(state: GameState, spec: TargetSpec, me: PlayerIdx): PlayerIdx[] {
  const side = spec.side ?? 'any';
  if (side === 'ally') return [me];
  if (side === 'enemy') return livingOpponents(state, me);
  return [me, ...livingOpponents(state, me)];
}

/**
 * Everything a target spec may legally choose. `source` is the card doing the
 * asking, which decides two things: a spell or trap cannot choose a Spell Immune
 * body, and neither can choose past a Redirection body on the far side.
 */
export function targetCandidates(
  state: GameState,
  me: PlayerIdx,
  spec: TargetSpec,
  source?: CardDef,
): TargetRef[] {
  const out: TargetRef[] = [];
  const bySpell = source?.type === 'spell' || source?.type === 'trap';
  const push = (ref: TargetRef, def: ReturnType<typeof card> | null, summon: SummonInstance | null) => {
    const isBody = ref.kind === 'summon' || ref.kind === 'leader';
    if (isBody && bySpell && !spellCanTarget(state, ref)) return;
    if (isBody && ref.player !== me) {
      const forced = redirectTargets(state, ref.player);
      if (forced.length && !forced.some((f) => sameRef(f, ref))) return;
    }
    if (spec.filter && !spec.filter({ state, me, ref, card: def, summon })) return;
    out.push(ref);
  };

  if (spec.kind === 'color') {
    for (const c of COLORS) push({ kind: 'color', color: c }, null, null);
    return out;
  }

  for (const player of sidesFor(state, spec, me)) {
    const p = state.players[player];
    if (spec.kind === 'summon') {
      p.slots.forEach((s, slot) => {
        if (s) push({ kind: 'summon', player, slot }, card(s.cardId), s);
      });
      if (spec.includeLeader && p.leader) {
        push({ kind: 'leader', player }, card(p.leader.cardId), p.leader);
      }
    } else if (spec.kind === 'hand') {
      p.hand.forEach((id, index) => push({ kind: 'hand', player, index }, card(id), null));
    } else if (spec.kind === 'supporter') {
      p.supporters.forEach((s, index) =>
        push({ kind: 'supporter', player, index }, card(s.cardId), null),
      );
    } else if (spec.kind === 'debt') {
      p.debt.forEach((id, index) => push({ kind: 'debt', player, index }, card(id), null));
    } else if (spec.kind === 'discard') {
      p.discard.forEach((id, index) => push({ kind: 'discard', player, index }, card(id), null));
    }
  }
  return out;
}

function sameRef(a: TargetRef, b: TargetRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The rejection a client recognises: this party action's card says "the enemy"
 * and the action did not name one. The client asks for a leader click and
 * re-sends the action with `enemy` set; nothing was applied.
 */
export const NEEDS_ENEMY = 'NEEDS_ENEMY';

/** A carried enemy pick must point at a living opponent of the actor. */
function enemyPickError(
  state: GameState,
  actor: PlayerIdx,
  enemy: PlayerIdx | undefined,
): string | null {
  if (enemy === undefined) return null;
  if (!isParty(state)) return 'Only party games pick an enemy.';
  if (enemy === actor) return 'You cannot pick yourself as the enemy.';
  if (!state.players[enemy] || state.players[enemy].eliminated) {
    return 'That player is out of the game.';
  }
  return null;
}

/**
 * How the primary effect of this action resolves its `opp`: the carried pick
 * when there is one, tracked when a party game would need to ask, and the
 * plain 2-player default otherwise.
 */
function oppModeFor(
  state: GameState,
  actor: PlayerIdx,
  enemy: PlayerIdx | undefined,
): OppMode | undefined {
  if (enemy !== undefined) return { kind: 'fixed', player: enemy };
  if (isParty(state) && livingOpponents(state, actor).length > 1) return { kind: 'track' };
  return undefined;
}

/** The mode a pending spell resolves under, from the pick stored at cast time. */
function spellOppMode(sp: PendingSpell): OppMode | undefined {
  return sp.enemy !== undefined ? { kind: 'fixed', player: sp.enemy } : undefined;
}

function validateTargets(
  state: GameState,
  me: PlayerIdx,
  specs: TargetSpec[] | undefined,
  refs: TargetRef[],
  source?: CardDef,
): string | null {
  const list = specs ?? [];
  if (refs.length > list.length) return 'Too many targets.';
  for (let i = 0; i < list.length; i++) {
    const spec = list[i];
    const ref = refs[i];
    if (!ref) {
      if (!spec.optional) return `Missing target: ${spec.label}.`;
      continue;
    }
    const ok = targetCandidates(state, me, spec, source).some((c) => sameRef(c, ref));
    if (!ok) return `Illegal target for ${spec.label}.`;
    // No card reads the same body twice, so a repeated pick is always a misclick.
    if (ref.kind === 'summon' || ref.kind === 'leader') {
      for (let j = 0; j < i; j++) {
        if (refs[j] && sameRef(refs[j], ref)) return 'The same target cannot be picked twice.';
      }
    }
  }
  return null;
}

// --- legality helpers used by the client ------------------------------------

export function canAttackThisTurn(state: GameState, player: PlayerIdx): boolean {
  return state.players[player].turnsTaken > 1;
}

/**
 * Everything a given attacker may swing at right now. The leader is allowed to
 * attack: it takes the counter-hit like anyone else, and since a defending leader
 * deals nothing back, swinging with yours spends HP you cannot get back cheaply.
 */
/** Bodies a player controls that pull everything onto themselves. */
export function redirectTargets(state: GameState, player: PlayerIdx): TargetRef[] {
  const p = state.players[player];
  const out: TargetRef[] = [];
  p.slots.forEach((s, i) => {
    if (s && card(s.cardId).redirect) out.push({ kind: 'summon', player, slot: i });
  });
  if (p.leader && card(p.leader.cardId).redirect) out.push({ kind: 'leader', player });
  return out;
}

/** Whether a spell or trap may choose this body at all. */
export function spellCanTarget(state: GameState, ref: TargetRef): boolean {
  const s = findSummon(state, ref);
  return !s || !card(s.cardId).spellImmune;
}

export function legalAttackTargets(state: GameState, source: SourceRef): TargetRef[] {
  const player = source.player;
  if (state.winner !== null || state.pending || state.replaceQueue.length) return [];
  if (state.active !== player || state.phase !== 'main') return [];
  if (!canAttackThisTurn(state, player)) return [];
  const attacker = findSummon(state, source);
  if (!attacker || attacker.sapped) return [];
  // Stationary bodies never declare attacks; they still hit back as defenders.
  if (card(attacker.cardId).stationary || attacker.rooted) return [];

  const targets: TargetRef[] = [];
  for (const opp of livingOpponents(state, player)) {
    const enemy = state.players[opp];

    // Redirection overrides everything else about who may be hit on that side,
    // the leader rule included: a leader that redirects is attackable with its
    // slots full. Other sides are unaffected by it.
    const forced = redirectTargets(state, opp);
    if (forced.length) {
      targets.push(...forced);
      continue;
    }

    const side: TargetRef[] = [];
    enemy.slots.forEach((s, i) => {
      if (s) side.push({ kind: 'summon', player: opp, slot: i });
    });
    // The leader is only exposed once the slots in front of it are empty.
    if (side.length === 0 && enemy.leader) side.push({ kind: 'leader', player: opp });
    targets.push(...side);
  }
  return targets;
}

/** Every attacker on a side that currently has at least one legal target. */
export function readyAttackers(state: GameState, player: PlayerIdx): SourceRef[] {
  const out: SourceRef[] = [];
  state.players[player].slots.forEach((s, slot) => {
    if (s && legalAttackTargets(state, { kind: 'summon', player, slot }).length > 0) {
      out.push({ kind: 'summon', player, slot });
    }
  });
  const leaderSrc: SourceRef = { kind: 'leader', player };
  if (state.players[player].leader && legalAttackTargets(state, leaderSrc).length > 0) {
    out.push(leaderSrc);
  }
  return out;
}

export function powerBlockers(
  state: GameState,
  player: PlayerIdx,
  source: SourceRef,
  powerIndex: number,
): string | null {
  const summon = findSummon(state, source);
  if (!summon) return 'No summon there.';
  if (summon.owner !== player) return 'Not your summon.';
  if (summon.sapped) return 'That summon is sapped.';
  const powers = powersOf(summon, card(summon.cardId));
  const power = powers[powerIndex];
  if (!power) return 'No such power.';
  if (power.oncePerTurn && (summon.powerUses[power.name] ?? 0) > 0) {
    return 'Already used this turn.';
  }
  if (!canPay(state.players[player], power.cost)) return 'Not enough mana.';
  return null;
}

// --- reducer ----------------------------------------------------------------

function mainPhaseBlocker(state: GameState): string | null {
  if (state.pending) return 'A battle response is pending.';
  if (state.choiceQueue.length > 0) return 'Settle the pending choice first.';
  if (state.flipQueue.length > 0) return 'Settle the flipped card first.';
  if (state.replaceQueue.length > 0) return 'Resolve the dead summon first.';
  if (state.phase !== 'main') return 'Not in the main phase.';
  return null;
}

function resolvePendingBattle(state: GameState): void {
  const pending = state.pending;
  if (!pending?.battle) return;
  state.pending = null;
  resolveClash(state, pending.battle.attacker, pending.battle.defender);
}

/**
 * A spell's effect, echoes and cast triggers, run once its response window
 * closes without a counter, or immediately when no window opened.
 */
function resolveSpell(
  state: GameState,
  caster: PlayerIdx,
  id: string,
  targets: TargetRef[],
  oppMode?: OppMode,
): void {
  const def = card(id);
  // A caster knocked out while the spell sat in its response window is gone,
  // and their spell goes with them.
  if (state.players[caster].eliminated) {
    log(state, null, `${def.name} fizzles: its caster is out of the game.`);
    toDiscard(state, caster, id);
    return;
  }
  const times = state.players[caster].slots.some(
    (s) => s && card(s.cardId).spellEcho,
  )
    ? 2
    : 1;
  // A held bonus is spent by whichever spell resolves next, echo included.
  takeSpellBonus(state, caster);
  try {
    for (let i = 0; i < times && state.winner === null; i++) {
      if (i > 0) log(state, caster, `${def.name} echoes.`);
      def.effect?.(makeEffectCtx(state, caster, null, def, targets, oppMode));
    }
  } finally {
    clearSpellBonus();
  }
  toDiscard(state, caster, id);
  if (state.winner !== null) return;
  const p = state.players[caster];
  for (const s of [...p.slots, p.leader]) {
    if (s) fireTrigger(state, s, 'onSpellCast');
  }
  // The spell is already in the discard pile, so its index there is how the
  // other sides' triggers get told which one was cast.
  const cast: TargetRef = { kind: 'discard', player: caster, index: p.discard.length - 1 };
  for (const foeIdx of livingOpponents(state, caster)) {
    const foe = state.players[foeIdx];
    for (const s of [...foe.slots, foe.leader]) {
      if (s) fireTrigger(state, s, 'onEnemySpellCast', [cast]);
    }
  }
}

function reduce(state: GameState, actor: PlayerIdx, action: Action): string | null {
  if (action.type === 'CONCEDE') {
    playerLoses(state, actor, `${state.players[actor].name} conceded.`);
    return null;
  }
  if (actor !== currentActor(state)) return 'It is not your turn to act.';

  const me = state.players[actor];
  const opp = otherPlayer(actor);

  switch (action.type) {
    case 'PLAY_SUPPORTER': {
      const blocked = mainPhaseBlocker(state);
      if (blocked) return blocked;
      // Checked before the allowance, because forbidding beats allowing: an
      // extra supporter granted this turn is spent on nothing while a lock is
      // on the table.
      if (supporterLocked(state, actor)) return 'The enemy is stopping you playing supporters.';
      if (me.supportersLeft <= 0) return 'You already played a supporter this turn.';
      const id = me.hand[action.handIndex];
      if (!id) return 'No card at that hand index.';
      me.hand.splice(action.handIndex, 1);
      me.supporters.push({ cardId: id, sapped: false });
      me.supportersLeft -= 1;
      log(state, actor, `${me.name} faces ${card(id).name} as a supporter.`);
      return null;
    }

    case 'SAP_SUPPORTER': {
      const s = me.supporters[action.index];
      if (!s) return 'No supporter there.';
      if (s.sapped) return 'That supporter is already sapped.';
      s.sapped = true;
      me.mana[manaKindFor(me, card(s.cardId))] += 1;
      return null;
    }

    case 'PLAY_SUMMON': {
      const blocked = mainPhaseBlocker(state);
      if (blocked) return blocked;
      const badEnemy = enemyPickError(state, actor, action.enemy);
      if (badEnemy) return badEnemy;
      const mode = oppModeFor(state, actor, action.enemy);
      clearOppWanted();
      const err = placeSummon(state, actor, action.handIndex, action.slot, action.targets ?? [], mode);
      if (err) return err;
      return mode?.kind === 'track' && oppWasWanted() ? NEEDS_ENEMY : null;
    }

    case 'REPLACE_SUMMON': {
      if (me.replaceLocked > 0) return 'That slot is cursed shut.';
      const entry = state.replaceQueue[0];
      if (!entry || entry.player !== actor) return 'Nothing to replace.';
      // Claim the slot first: placing can end the game, and ending the game
      // clears the queue out from under us.
      state.replaceQueue.shift();
      const badEnemy = enemyPickError(state, actor, action.enemy);
      if (badEnemy) return badEnemy;
      const mode = oppModeFor(state, actor, action.enemy);
      clearOppWanted();
      const err = placeSummon(state, actor, action.handIndex, entry.slot, action.targets ?? [], mode);
      if (err) return err;
      return mode?.kind === 'track' && oppWasWanted() ? NEEDS_ENEMY : null;
    }

    case 'PAY_FLIP': {
      const offer = state.flipQueue[0];
      if (!offer || offer.player !== actor) return 'No flip is waiting.';
      const def = card(offer.cardId);
      const cost = def.flipCost;
      if (!def.flip || !cost) return 'That card asks for nothing.';
      const badEnemy = enemyPickError(state, actor, action.enemy);
      if (badEnemy) return badEnemy;
      const mode = oppModeFor(state, actor, action.enemy);
      if (cost.mana && !canPay(me, cost.mana)) return 'Not enough mana.';
      if (cost.mill && me.deck.length < cost.mill) return 'Not enough deck left to mill.';
      let discardIndex = -1;
      if (cost.discard) {
        discardIndex = action.handIndex ?? -1;
        if (discardIndex < 0 || discardIndex >= me.hand.length) return 'Choose a card to discard.';
      }

      state.flipQueue.shift();
      if (cost.mana) payCost(state, actor, cost.mana);
      if (cost.mill) {
        for (let i = 0; i < cost.mill; i++) {
          const id = me.deck.shift();
          if (id) toDiscard(state, actor, id);
        }
      }
      if (cost.discard && discardIndex >= 0) {
        const [id] = me.hand.splice(discardIndex, 1);
        toDebt(state, actor, id);
      }
      const holder = findSummon(state, offer.holder);
      log(state, actor, `${me.name} pays for ${def.name}'s flip.`);
      clearOppWanted();
      if (holder) def.flip(makeFlipCtx(state, holder, def, 0, mode));
      return mode?.kind === 'track' && oppWasWanted() ? NEEDS_ENEMY : null;
    }

    case 'DECLINE_FLIP': {
      const offer = state.flipQueue[0];
      if (!offer || offer.player !== actor) return 'No flip is waiting.';
      state.flipQueue.shift();
      // Deliberately unnamed: the card stays face down, and the log is public.
      log(state, actor, `${me.name} lets the card lie.`);
      return null;
    }

    case 'DECLINE_REPLACE': {
      const entry = state.replaceQueue[0];
      if (!entry || entry.player !== actor) return 'Nothing to replace.';
      state.replaceQueue.shift();
      log(state, actor, `${me.name} leaves the slot empty.`);
      return null;
    }

    case 'CAST_SPELL': {
      const blocked = mainPhaseBlocker(state);
      if (blocked) return blocked;
      const id = me.hand[action.handIndex];
      if (!id) return 'No card at that hand index.';
      const def = card(id);
      if (def.type !== 'spell') return `${def.name} is not a spell.`;
      const bad = validateTargets(state, actor, def.targets, action.targets, def);
      if (bad) return bad;
      const badEnemy = enemyPickError(state, actor, action.enemy);
      if (badEnemy) return badEnemy;
      const mode = oppModeFor(state, actor, action.enemy);
      const paid = costFor(me, def);
      if (!canPay(me, paid)) return 'Not enough mana.';
      payCost(state, actor, paid);
      me.hand.splice(action.handIndex, 1);
      log(state, actor, `${me.name} casts ${def.name}.`);
      // Every living enemy holding a Spell Trap gets a window, one at a time in
      // turn order. With one opponent this is the same single window as ever.
      const holders = livingOpponents(state, actor).filter((foe) =>
        state.players[foe].hand.some((h) => card(h).type === 'trap' && card(h).spellTrap),
      );
      if (holders.length > 0) {
        // The pick is asked for now rather than after the response windows: a
        // scratch run of the resolution says whether the card will want one.
        if (mode?.kind === 'track') {
          clearOppWanted();
          resolveSpell(structuredClone(state), actor, id, action.targets, mode);
          if (oppWasWanted()) return NEEDS_ENEMY;
        }
        state.pending = {
          kind: 'response',
          player: holders[0],
          battle: null,
          spell: {
            caster: actor,
            cardId: id,
            targets: action.targets,
            ...(action.enemy !== undefined ? { enemy: action.enemy } : {}),
          },
          ...(holders.length > 1 ? { queue: holders.slice(1) } : {}),
        };
      } else {
        clearOppWanted();
        resolveSpell(state, actor, id, action.targets, mode);
        if (mode?.kind === 'track' && oppWasWanted()) return NEEDS_ENEMY;
      }
      return null;
    }

    case 'PLAY_STAGE': {
      const blocked = mainPhaseBlocker(state);
      if (blocked) return blocked;
      const id = me.hand[action.handIndex];
      if (!id) return 'No card at that hand index.';
      const def = card(id);
      if (def.type !== 'stage') return `${def.name} is not a stage.`;
      const badEnemy = enemyPickError(state, actor, action.enemy);
      if (badEnemy) return badEnemy;
      const mode = oppModeFor(state, actor, action.enemy);
      const paid = costFor(me, def);
      if (!canPay(me, paid)) return 'Not enough mana.';
      payCost(state, actor, paid);
      me.hand.splice(action.handIndex, 1);
      if (me.stage) toDiscard(state, actor, me.stage);
      me.stage = id;
      log(state, actor, `${me.name} sets the stage: ${def.name}.`);
      clearOppWanted();
      def.effect?.(makeEffectCtx(state, actor, null, def, [], mode));
      return mode?.kind === 'track' && oppWasWanted() ? NEEDS_ENEMY : null;
    }

    case 'ACTIVATE_POWER': {
      const blocked = mainPhaseBlocker(state);
      if (blocked) return blocked;
      const why = powerBlockers(state, actor, action.source, action.powerIndex);
      if (why) return why;
      const summon = findSummon(state, action.source)!;
      const def = card(summon.cardId);
      const power = powersOf(summon, def)[action.powerIndex];
      const bad = validateTargets(state, actor, power.targets, action.targets);
      if (bad) return bad;
      const badEnemy = enemyPickError(state, actor, action.enemy);
      if (badEnemy) return badEnemy;
      const mode = oppModeFor(state, actor, action.enemy);
      payCost(state, actor, power.cost);
      // Sapping is part of the cost, paid before the effect resolves.
      if (power.sapSelf) summon.sapped = true;
      summon.powerUses[power.name] = (summon.powerUses[power.name] ?? 0) + 1;
      log(state, actor, `${def.name} uses ${power.name}.`);
      clearOppWanted();
      power.effect(makeEffectCtx(state, actor, summon, def, action.targets, mode));
      if (mode?.kind === 'track' && oppWasWanted()) return NEEDS_ENEMY;
      // Tells the other sides a Power resolved, passing the body that used it so
      // a watcher can answer the thing that acted.
      if (state.winner === null) {
        for (const foeIdx of livingOpponents(state, actor)) {
          const watchers = state.players[foeIdx];
          for (const s of [...watchers.slots, watchers.leader]) {
            if (s) fireTrigger(state, s, 'onEnemyPower', [action.source]);
          }
        }
      }
      return null;
    }

    case 'DECLARE_ATTACK': {
      const blocked = mainPhaseBlocker(state);
      if (blocked) return blocked;
      if (state.active !== actor) return 'Not your turn.';
      if (!canAttackThisTurn(state, actor)) return 'You cannot attack on your first turn.';
      if (action.source.player !== actor) return 'That is not yours to swing.';
      const legal = legalAttackTargets(state, action.source);
      if (legal.length === 0) return 'That attacker cannot attack right now.';
      if (!legal.some((t) => sameRef(t, action.target))) return 'Illegal attack target.';

      const attacker = findSummon(state, action.source)!;
      attacker.sapped = true;
      const defender = findSummon(state, action.target)!;
      log(
        state,
        actor,
        `${card(attacker.cardId).name} declares an attack on ${card(defender.cardId).name}.`,
      );
      state.battle = { attacker: action.source, defender: action.target, trapUsed: false };
      fireTrigger(state, attacker, 'onAttack');
      if (state.winner !== null) {
        state.battle = null;
        return null;
      }
      if (!findSummon(state, action.source) || !findSummon(state, action.target)) {
        state.battle = null;
        return null;
      }

      // The window belongs to whoever is being hit, who in a party game is not
      // always the next player over.
      const defOwner = action.target.kind === 'color' ? opp : action.target.player;
      const defenderHoldsTrap = state.players[defOwner].hand.some(
        (id) => card(id).type === 'trap' && !card(id).spellTrap,
      );
      if (defenderHoldsTrap) {
        state.pending = {
          kind: 'response',
          player: defOwner,
          battle: { attacker: action.source, defender: action.target, trapUsed: false },
          spell: null,
        };
      } else {
        resolveClash(state, action.source, action.target);
      }
      return null;
    }

    case 'CAST_TRAP': {
      const pending = state.pending;
      if (!pending || pending.player !== actor) return 'No response window is open.';
      const id = me.hand[action.handIndex];
      if (!id) return 'No card at that hand index.';
      const def = card(id);
      if (def.type !== 'trap') return `${def.name} is not a trap.`;
      if (pending.battle) {
        if (def.spellTrap) return `${def.name} only answers spells.`;
        if (pending.battle.trapUsed) return 'Only one trap per battle.';
      } else if (pending.spell && !def.spellTrap) {
        return `${def.name} only answers attacks.`;
      }
      const bad = validateTargets(state, actor, def.targets, action.targets, def);
      if (bad) return bad;
      const paid = costFor(me, def);
      if (!canPay(me, paid)) return 'Not enough mana.';
      payCost(state, actor, paid);
      me.hand.splice(action.handIndex, 1);
      log(state, actor, `${me.name} springs ${def.name}.`);
      if (pending.battle) {
        pending.battle.trapUsed = true;
        def.effect?.(makeEffectCtx(state, actor, null, def, action.targets));
        toDiscard(state, actor, id);
        resolvePendingBattle(state);
      } else if (pending.spell) {
        // Springing a Spell Trap counters the spell: the trap's own effect
        // runs while the pending spell is still readable, then the spell goes
        // to its caster's discard pile without resolving. A trap that lets the
        // spell resolve still answers first, then hands the window back.
        def.effect?.(makeEffectCtx(state, actor, null, def, action.targets));
        toDiscard(state, actor, id);
        const sp = pending.spell;
        state.pending = null;
        if (def.letSpellResolve) {
          resolveSpell(state, sp.caster, sp.cardId, sp.targets, spellOppMode(sp));
        } else {
          log(state, actor, `${card(sp.cardId).name} is countered.`);
          toDiscard(state, sp.caster, sp.cardId);
        }
      }
      return null;
    }

    case 'RESOLVE_CHOICE': {
      const ch = state.choiceQueue[0];
      if (!ch || ch.player !== actor) return 'No choice is waiting.';
      if (ch.cards) {
        if (action.index === undefined) {
          if (!ch.optional) return 'Pick a card.';
          state.choiceQueue.shift();
          runChoiceResolver(state, ch, {});
          return null;
        }
        if (!ch.legal?.includes(action.index)) return 'That card is not a legal pick.';
        state.choiceQueue.shift();
        runChoiceResolver(state, ch, { index: action.index });
        return null;
      }
      if (!action.pick) {
        const anyLeft = (ch.refs ?? []).some((r) =>
          r.kind === 'summon' || r.kind === 'leader' ? !!findSummon(state, r) : true,
        );
        if (!ch.optional && anyLeft) return 'Pick a target.';
        state.choiceQueue.shift();
        runChoiceResolver(state, ch, {});
        return null;
      }
      const pick = action.pick;
      if (!(ch.refs ?? []).some((r) => sameRef(r, pick))) {
        return 'Not one of the offered targets.';
      }
      if ((pick.kind === 'summon' || pick.kind === 'leader') && !findSummon(state, pick)) {
        return 'That target is gone.';
      }
      state.choiceQueue.shift();
      runChoiceResolver(state, ch, { ref: pick });
      return null;
    }

    case 'PASS_RESPONSE': {
      if (!state.pending || state.pending.player !== actor) {
        return 'No response window is open.';
      }
      if (state.pending.spell) {
        const sp = state.pending.spell;
        // Passing hands the window down the queue before the spell resolves.
        // A responder eliminated while the window sat open is skipped.
        const rest = (state.pending.queue ?? []).filter((p) => !state.players[p].eliminated);
        if (rest.length > 0) {
          state.pending = {
            kind: 'response',
            player: rest[0],
            battle: null,
            spell: sp,
            ...(rest.length > 1 ? { queue: rest.slice(1) } : {}),
          };
        } else {
          state.pending = null;
          resolveSpell(state, sp.caster, sp.cardId, sp.targets, spellOppMode(sp));
        }
      } else {
        resolvePendingBattle(state);
      }
      return null;
    }

    case 'END_TURN': {
      const blocked = mainPhaseBlocker(state);
      if (blocked) return blocked;
      if (state.active !== actor) return 'Not your turn.';
      finishTurn(state);
      return null;
    }
  }
}

/**
 * Battlecry targets are validated against the board as it stands before the
 * summon lands, so an entering card never targets itself. A spec with no legal
 * candidate is skipped and the battlecry simply does less.
 */
function validateEnterTargets(
  state: GameState,
  me: PlayerIdx,
  def: CardDef,
  refs: TargetRef[],
): string | null {
  const specs = def.targets ?? [];
  if (refs.length > specs.length) return 'Too many targets.';
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const cands = targetCandidates(state, me, spec, def);
    const ref = refs[i];
    if (!ref) {
      if (cands.length > 0) return `Missing target: ${spec.label}.`;
      continue;
    }
    if (!cands.some((c) => sameRef(c, ref))) return `Illegal target for ${spec.label}.`;
  }
  return null;
}

function placeSummon(
  state: GameState,
  actor: PlayerIdx,
  handIndex: number,
  slot: number,
  targets: TargetRef[] = [],
  oppMode?: OppMode,
): string | null {
  const me = state.players[actor];
  const id = me.hand[handIndex];
  if (!id) return 'No card at that hand index.';
  const def = card(id);
  if (def.type !== 'summon') return `${def.name} cannot stand in a slot.`;
  if (slot < 0 || slot >= me.slots.length) return 'No such slot.';
  if (me.slots[slot]) return 'That slot is occupied.';
  const badTarget = validateEnterTargets(state, actor, def, targets);
  if (badTarget) return badTarget;

  me.hand.splice(handIndex, 1);
  const summon = newSummon(state, id, actor);
  me.slots[slot] = summon;
  const wanted = def.hp ?? 0;
  const got = assignHp(state, summon, wanted);
  log(
    state,
    actor,
    got < wanted
      ? `${def.name} arrives with only ${got} HP (deck ran short).`
      : `${def.name} arrives with ${got} HP.`,
  );
  if (got === 0) {
    // Nothing left to protect it, so it dies the moment it lands.
    destroySummon(state, summon);
    return null;
  }
  fireTrigger(state, summon, 'onEnter', targets, oppMode);
  const landed: TargetRef[] = [{ kind: 'summon', player: actor, slot }];
  for (const pl of state.players) {
    for (const other of [...pl.slots, pl.leader]) {
      if (other && other !== summon) fireTrigger(state, other, 'onSummonPlayed', landed);
    }
  }
  for (let p = 0 as PlayerIdx; p < state.players.length; p++) {
    const stageId = state.players[p].stage;
    if (!stageId) continue;
    const stageDef = tryCard(stageId);
    const hook = stageDef?.stageHooks?.onSummonPlayed;
    if (!stageDef || !hook) continue;
    hook(makeEffectCtx(state, p, null, stageDef, landed));
  }
  return null;
}

/**
 * After a party-game action, nothing may be left waiting on a player the action
 * knocked out: their response window answers itself and the turn moves along.
 * Never fires in a 2-player game, where a loss ends the match instead.
 */
function sweepEliminated(state: GameState): void {
  if (!isParty(state)) return;
  // Bounded because each pass either settles the one pending window or hands
  // the turn to a player who may in turn be eliminated, at most once a seat.
  for (let guard = 0; guard < 8 && !isOver(state); guard++) {
    const pending = state.pending;
    if (pending && state.players[pending.player].eliminated) {
      if (pending.spell) {
        const rest = (pending.queue ?? []).filter((q) => !state.players[q].eliminated);
        if (rest.length > 0) {
          state.pending = {
            kind: 'response',
            player: rest[0],
            battle: null,
            spell: pending.spell,
            ...(rest.length > 1 ? { queue: rest.slice(1) } : {}),
          };
        } else {
          state.pending = null;
          resolveSpell(
            state,
            pending.spell.caster,
            pending.spell.cardId,
            pending.spell.targets,
            spellOppMode(pending.spell),
          );
        }
      } else {
        resolvePendingBattle(state);
      }
      continue;
    }
    // The turn only moves once nothing else is queued: whatever living players
    // are still owed settles first, and this sweep runs after each answer.
    if (
      !state.pending &&
      state.choiceQueue.length === 0 &&
      state.flipQueue.length === 0 &&
      state.replaceQueue.length === 0 &&
      state.players[state.active].eliminated
    ) {
      startTurn(state, nextLiving(state, state.active));
      continue;
    }
    break;
  }
}

export function applyAction(
  state: GameState,
  actor: PlayerIdx,
  action: Action,
): ApplyResult {
  if (isOver(state)) return { ok: false, error: 'The game is already over.' };
  const next = structuredClone(state);
  // What the last action announced belongs to the last action.
  next.fx = [];
  setActingPlayer(actor);
  let error: string | null;
  try {
    error = reduce(next, actor, action);
  } finally {
    setActingPlayer(null);
  }
  if (error) return { ok: false, error };
  sweepEliminated(next);
  next.version += 1;
  next.actions += 1;
  // A blow that took both leaders leaves nobody to hand the match to. The
  // winner it recorded first stood only so the rest of the action would stop
  // resolving; with the action over, the match is level and reads as one.
  if (next.drawn) next.winner = null;
  // Checked after the action resolves, so nothing is left half-applied.
  if (next.winner === null && !next.drawn && (next.turn >= MAX_TURNS || next.actions >= MAX_ACTIONS)) {
    next.drawn = true;
    next.winReason = next.turn >= MAX_TURNS
      ? `The match reached ${MAX_TURNS} turns and ends in a draw.`
      : `The match reached ${MAX_ACTIONS} actions and ends in a draw.`;
    log(next, null, next.winReason);
  }
  return { ok: true, state: next };
}

export { effectiveStrength, flipWouldFire, strengthSourcesOf };
