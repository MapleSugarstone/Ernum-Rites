import type { SourceRef } from '../../engine/actions';
import { effectiveStrength } from '../../engine/effects';
import { availableMana, storeBlockers } from '../../engine/engine';
import { deckIdentity } from '../../engine/identity';
import { card, tryCard } from '../../engine/registry';
import {
  colorOf,
  debtLimitOf,
  hasFieldSummon,
  levelOf,
  otherPlayer,
  powersOf,
  remainingHp,
  type GameState,
  type PlayerState,
  type SummonInstance,
} from '../../engine/state';
import { COLORS, MANA_KINDS, type Color, type Cost, type PlayerIdx } from '../../engine/types';
import { Tag, type NetBundle } from './bundle';

/**
 * Turns a position into the observation the network was trained on, from one
 * player's side of the table: one column per card the network knows, one
 * entry per body, and the scalars for the clocks and pools.
 *
 * This is `csharp/Selatza.Learn/Encoder.cs` channel for channel, with the
 * opponent read the trainer's tracker gives when it has no scouting and no
 * history: the copies of each card standing in their public zones, and the
 * legal pool their leader fixes. The hidden half of the table, their hand and
 * both decks' order, is not read. The parity fixture holds both encoders to the
 * same floats on the same positions.
 */

const SLOTS = 3;
const COLORLESS = 6;

function maskOf(colors: Color[]): number {
  let m = 0;
  for (const c of colors) m |= 1 << COLORS.indexOf(c);
  return m;
}

/** Pool plus unsapped supporters, indexed the way the trainer indexes mana kinds. */
function manaVec(p: PlayerState): number[] {
  const avail = availableMana(p);
  return MANA_KINDS.map((k) => avail[k]);
}

function affordable(cost: Cost | undefined, mana: number[]): boolean {
  let spare = mana[COLORLESS];
  for (let i = 0; i < COLORS.length; i++) {
    const need = cost?.[COLORS[i]] ?? 0;
    if (need > mana[i]) return false;
    spare += mana[i] - need;
  }
  return (cost?.C ?? 0) <= spare;
}

/** The same test the engine's attack targeting makes, without building the list. */
function canAttackNow(state: GameState, s: SummonInstance, owner: PlayerIdx): boolean {
  if (state.winner !== null || state.pending !== null || state.replaceQueue.length > 0) return false;
  if (state.active !== owner || state.phase !== 'main') return false;
  if (state.players[owner].turnsTaken <= 1 || s.sapped) return false;
  if (card(s.cardId).stationary) return false;
  const foe = state.players[otherPlayer(owner)];
  return hasFieldSummon(foe) || foe.leader !== null;
}

function freeSlots(p: PlayerState): number {
  let n = 0;
  for (const s of p.slots) if (s === null) n++;
  return n;
}

export function encode(state: GameState, me: PlayerIdx, net: NetBundle): Float32Array {
  const enemy = otherPlayer(me);
  const n = net.cards.length;
  const CC = net.cardChannels;
  const E = net.entities;
  const PS = net.perSide;
  const cardPlane = CC * n;
  const entPlane = net.entityChannels * E;
  const obs = new Float32Array(cardPlane + entPlane + net.scalarCount);
  const meP = state.players[me];
  const enP = state.players[enemy];

  const myId = maskOf(deckIdentity(meP.leaderCardId));
  const enId = maskOf(deckIdentity(enP.leaderCardId));
  const legal = (c: number, id: number): boolean => (net.masks[c] & ~id) === 0;
  const col = (id: string): number => net.index.get(id) ?? -1;

  // --- what the enemy's public zones say about their deck -------------------

  const visible = new Int32Array(n);
  const bump = (id: string): void => {
    const c = col(id);
    if (c >= 0) visible[c]++;
  };
  for (const s of enP.supporters) bump(s.cardId);
  for (const s of enP.slots) {
    if (!s) continue;
    bump(s.cardId);
    for (const h of s.hp) if (h.flipped) bump(h.cardId);
  }
  if (enP.leader) for (const h of enP.leader.hp) if (h.flipped) bump(h.cardId);
  for (const id of enP.debt) bump(id);
  for (const id of enP.discard) bump(id);
  if (enP.stage) bump(enP.stage);

  const plausible = (c: number): number =>
    legal(c, enId) ? Math.max(0, net.limits[c] - visible[c]) : 0;

  const enemyPool: number[] = [];
  for (let c = 0; c < n; c++) {
    if (legal(c, myId)) obs[7 * n + c] = 1;
    if (legal(c, enId)) {
      obs[16 * n + c] = 1;
      enemyPool.push(c);
    }
  }

  const myMana = manaVec(meP);
  const enMana = manaVec(enP);

  // --- card plane -----------------------------------------------------------

  const add = (channel: number, id: string, amount: number): void => {
    const c = col(id);
    if (c >= 0) obs[channel * n + c] += amount;
  };
  for (const id of meP.hand) add(0, id, 0.25);
  for (const id of meP.deck) add(1, id, 0.25);
  for (const s of meP.slots) if (s) add(2, s.cardId, 0.5);
  for (const s of meP.supporters) add(3, s.cardId, 0.25);
  for (const id of meP.debt) add(4, id, 0.25);
  for (const id of meP.discard) add(21, id, 0.25);
  if (meP.stage) add(5, meP.stage, 1);
  add(6, meP.leaderCardId, 1);

  for (const s of enP.slots) if (s) add(8, s.cardId, 0.5);
  for (const s of enP.supporters) add(9, s.cardId, 0.25);
  for (const id of enP.debt) add(10, id, 0.25);
  for (const id of enP.discard) add(22, id, 0.25);
  if (enP.stage) add(11, enP.stage, 1);
  add(12, enP.leaderCardId, 1);

  for (const c of enemyPool) {
    if (visible[c] > 0) obs[13 * n + c] = visible[c] * 0.25;
    const left = plausible(c);
    if (left === 0) continue;
    obs[17 * n + c] = left * 0.25;
    if (affordable(tryCard(net.cards[c])?.cost, enMana)) obs[20 * n + c] = 1;
  }
  for (const id of meP.hand) {
    const c = col(id);
    if (c >= 0 && affordable(card(id).cost, myMana)) obs[19 * n + c] = 1;
  }

  // --- entity plane ---------------------------------------------------------

  const ent: (SummonInstance | null)[] = new Array(E).fill(null);
  ent[0] = meP.leader;
  ent[PS] = enP.leader;
  for (let i = 0; i < SLOTS; i++) {
    ent[1 + i] = meP.slots[i] ?? null;
    ent[PS + 1 + i] = enP.slots[i] ?? null;
  }
  const entStrength = new Int32Array(E);
  const entHp = new Int32Array(E);
  for (let e = 0; e < E; e++) {
    const s = ent[e];
    entStrength[e] = s ? effectiveStrength(state, s) : 0;
    entHp[e] = s ? remainingHp(s) : 0;
  }
  const kills = (strength: number, entity: number): number =>
    ent[entity] && strength >= entHp[entity] ? 1 : 0;
  const diesTo = (remaining: number, entity: number): number =>
    ent[entity] && entStrength[entity] >= remaining ? 1 : 0;

  const entOff = cardPlane;
  for (let e = 0; e < E; e++) {
    const s = ent[e];
    if (!s) continue;
    let c = 0;
    const put = (v: number): void => {
      obs[entOff + c++ * E + e] = v;
    };
    const def = card(s.cardId);
    const mine = e < PS;
    const owner: PlayerIdx = mine ? me : enemy;
    const strength = entStrength[e];
    const remaining = entHp[e];
    const total = s.hp.length;
    const foeBase = mine ? PS : 0;

    put(1);
    put(s.isLeader ? 1 : 0);
    put(mine ? 1 : 0);
    put(strength / 6);
    put(remaining / 8);
    put((total - remaining) / 8);
    put(total / 10);
    put(total > 0 ? remaining / total : 0);
    put(s.wounds / 2);
    put(s.sapped ? 1 : 0);
    put(s.enteredTurn === state.turn ? 1 : 0);
    put(levelOf(s, def) / 3);

    const colour = colorOf(s, def);
    for (const cc of COLORS) put(colour === cc ? 1 : 0);

    const powers = powersOf(s, def);
    put(powers.length / 3);
    const mana = mine ? myMana : enMana;
    put(powers.some((p) => affordable(p.cost, mana)) ? 1 : 0);
    put(def.triggers?.onAttack ? 1 : 0);
    put(def.triggers?.onDeath ? 1 : 0);
    put(def.triggers?.strengthBonus ? 1 : 0);
    put(canAttackNow(state, s, owner) ? 1 : 0);

    let foeHasBoard = false;
    for (let i = 1; i <= SLOTS; i++) if (ent[foeBase + i]) foeHasBoard = true;
    for (let i = 1; i <= SLOTS; i++) put(kills(strength, foeBase + i));
    put(foeHasBoard ? 0 : kills(strength, foeBase));
    for (let i = 1; i <= SLOTS; i++) put(diesTo(remaining, foeBase + i));
    put(s.override ? 1 : 0);
    put(Math.min(3, s.strengthMods.length) / 3);
    if (c !== net.entityChannels) {
      throw new Error(`entity channel count is ${c}, bundle declares ${net.entityChannels}`);
    }
  }

  // --- scalars --------------------------------------------------------------

  let k = 0;
  const scaOff = cardPlane + entPlane;
  const put = (v: number): void => {
    obs[scaOff + k++] = v;
  };

  put(Math.min(state.turn, 60) / 30);
  put(Math.min(meP.turnsTaken, 30) / 20);
  put(Math.min(enP.turnsTaken, 30) / 20);
  put(state.phase === 'awake' ? 1 : 0);
  put(state.phase === 'draw' ? 1 : 0);
  put(state.phase === 'main' ? 1 : 0);
  put(state.phase === 'end' ? 1 : 0);
  put(state.active === me ? 1 : 0);
  put(state.pending !== null ? 1 : 0);
  put(state.pending !== null && state.pending.player === me ? 1 : 0);
  put(state.flipQueue.length > 0 ? 1 : 0);
  put(state.replaceQueue.length > 0 ? 1 : 0);

  const limit = debtLimitOf(state);
  put(meP.debtCount / limit);
  put(enP.debtCount / limit);
  put((meP.debtCount - enP.debtCount) / limit);
  put(meP.debtCount >= limit - 2 ? 1 : 0);
  put(enP.debtCount >= limit - 2 ? 1 : 0);

  put(Math.min(meP.hand.length, 12) / 10);
  put(Math.min(enP.hand.length, 12) / 10);
  put((meP.hand.length - enP.hand.length) / 10);
  put(Math.min(meP.deck.length, 60) / 48);
  put(Math.min(enP.deck.length, 60) / 48);
  put((meP.deck.length - enP.deck.length) / 48);
  put(Math.min(Math.floor(meP.deck.length / 2), 20) / 10);
  put(Math.min(Math.floor(enP.deck.length / 2), 20) / 10);

  for (let i = 0; i < COLORS.length; i++) put(Math.min(myMana[i], 6) / 3);
  for (let i = 0; i < COLORS.length; i++) put(Math.min(enMana[i], 6) / 3);

  let mySapped = 0;
  let enSapped = 0;
  for (const s of meP.supporters) if (s.sapped) mySapped++;
  for (const s of enP.supporters) if (s.sapped) enSapped++;
  put(Math.min(meP.supporters.length, 12) / 8);
  put(Math.min(enP.supporters.length, 12) / 8);
  put(Math.min(mySapped, 12) / 8);
  put(Math.min(enSapped, 12) / 8);

  let myStrength = 0;
  let enStrength = 0;
  let myReady = 0;
  let myBoardHp = 0;
  let enBoardHp = 0;
  for (let i = 1; i <= SLOTS; i++) {
    myStrength += entStrength[i];
    enStrength += entStrength[PS + i];
    const s = ent[i];
    if (s && !s.sapped) myReady += entStrength[i];
    myBoardHp += entHp[i];
    enBoardHp += entHp[PS + i];
  }
  put(myStrength / 12);
  put(enStrength / 12);
  put((myStrength - enStrength) / 12);
  put(myBoardHp / 16);
  put(enBoardHp / 16);

  const myLeader = entHp[0];
  const enLeader = entHp[PS];
  put(myLeader / 12);
  put(enLeader / 12);
  put((myLeader - enLeader) / 12);
  put(hasFieldSummon(meP) ? 0 : 1);
  put(hasFieldSummon(enP) ? 0 : 1);
  put(meP.stage !== null ? 1 : 0);
  put(enP.stage !== null ? 1 : 0);
  put(freeSlots(meP) / SLOTS);
  put(freeSlots(enP) / SLOTS);

  // Trap risk, with nothing named in their hand: the chance at least one of
  // the cards they hold came from the traps their colours still allow.
  let trapRisk = 0;
  if (enP.hand.length > 0) {
    let trapsLeft = 0;
    let poolLeft = 0;
    for (let c = 0; c < n; c++) {
      const left = plausible(c);
      if (left === 0) continue;
      poolLeft += left;
      if (tryCard(net.cards[c])?.type === 'trap') trapsLeft += left;
    }
    if (poolLeft > 0) trapRisk = 1 - Math.pow(1 - trapsLeft / poolLeft, enP.hand.length);
  }
  put(trapRisk);
  put(trapRisk >= 1 ? 1 : 0);
  // Named cards in their hand and deck: none without scouting.
  put(0);
  put(0);
  let seen = 0;
  let pool = 0;
  for (const c of enemyPool) {
    seen += visible[c];
    pool += net.limits[c];
  }
  put(pool > 0 ? Math.min(1, (seen / pool) * 4) : 0);

  for (let i = 0; i < COLORS.length; i++) put((myId & (1 << i)) !== 0 ? 1 : 0);
  for (let i = 0; i < COLORS.length; i++) put((enId & (1 << i)) !== 0 ? 1 : 0);

  put(!hasFieldSummon(enP) && myReady >= enLeader && enLeader > 0 ? 1 : 0);
  put(!hasFieldSummon(meP) && enStrength >= myLeader && myLeader > 0 ? 1 : 0);
  const tagged = (tag: number): number => {
    let total = 0;
    for (let c = 0; c < n; c++) if (net.tags[c] & tag) total += plausible(c);
    return total;
  };
  put(Math.min(1, tagged(Tag.Reach) / 12));
  put(Math.min(1, tagged(Tag.Steal) / 12));

  let playable = 0;
  let summons = 0;
  let traps = 0;
  for (const id of meP.hand) {
    const def = card(id);
    if (affordable(def.cost, myMana)) playable++;
    if (def.type === 'summon') summons++;
    else if (def.type === 'trap') traps++;
  }
  put(Math.min(6, playable) / 6);
  put(Math.min(6, summons) / 6);
  put(Math.min(3, traps) / 3);
  // The weight of cards named in their hand: none without scouting.
  put(0);

  const wounds = (entity: number): number => ent[entity]?.wounds ?? 0;
  let myWounds = wounds(0);
  let enWounds = wounds(PS);
  for (let i = 1; i <= SLOTS; i++) {
    myWounds += wounds(i);
    enWounds += wounds(PS + i);
  }
  put(Math.min(4, myWounds) / 4);
  put(Math.min(4, enWounds) / 4);
  let ready = 0;
  for (let i = 1; i <= SLOTS; i++) {
    const s = ent[i];
    if (s && canAttackNow(state, s, me)) ready++;
  }
  put(Math.min(3, ready) / 3);
  put(meP.supportersLeft > 0 ? 1 : 0);
  put(meP.leaderPlayed ? 1 : 0);
  put(state.battle !== null ? 1 : 0);
  put(state.startingPlayer === me ? 1 : 0);
  // Scouting rolls taken: none.
  put(0);

  const openShops = (owner: PlayerIdx): number => {
    const p = state.players[owner];
    let count = 0;
    for (let i = 0; i < p.slots.length; i++) {
      if (!p.slots[i]) continue;
      const src: SourceRef = { kind: 'summon', player: owner, slot: i };
      if (!storeBlockers(state, me, src)) count++;
    }
    if (p.leader) {
      const src: SourceRef = { kind: 'leader', player: owner };
      if (!storeBlockers(state, me, src)) count++;
    }
    return count;
  };
  put(Math.min(meP.love, 6) / 6);
  put(Math.min(enP.love, 6) / 6);
  put((meP.love - enP.love) / 6);
  put(Math.min(3, openShops(me)) / 3);
  put(Math.min(3, openShops(enemy)) / 3);
  put(Math.min(meP.playsThisTurn, 6) / 6);

  if (k > net.scalarCount) {
    throw new Error(`scalar count is ${k}, bundle declares ${net.scalarCount}`);
  }
  return obs;
}
