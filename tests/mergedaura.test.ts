import { describe, expect, it } from 'vitest';
import '../src/cards';
import { createGame } from '../src/engine/engine';
import { effectiveStrength } from '../src/engine/effects';
import { fusedRecomp, graftedCopy } from '../src/engine/generated';
import { card } from '../src/engine/registry';
import type { GameState, SummonInstance } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';

/**
 * Two opposite things are written as a strengthBonus, and a merge has to keep
 * both.
 *
 * An aura buffs every ally but itself and knows itself by card id. A minted id
 * breaks that test, so a fusion carrying an aura would buff the body it rides
 * on, and the merge used to answer that by refusing every bonus aimed at the
 * fused body. That is exactly what a self-buff is: Bone Known reads "+1 attack
 * for every 2 debt you carry" and applies to nothing else, so grafting or
 * recompiling it handed over a trigger that could never pay out.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const BONE = 'o2-boneknown';
const HOST = 'o1-skeleton';
const KING = 'm-rp-theking';
/** A Mortal for the aura to land on, which is not the aura itself. */
const MORTAL = 'o2-scientist';

function body(s: GameState, cardId: string, owner: PlayerIdx, hp: number): SummonInstance {
  return {
    uid: `u${s.nextUid++}`, cardId, owner, isLeader: false,
    hp: Array.from({ length: hp }, () => ({ cardId: FILLER, flipped: false })),
    sapped: false, wounds: 0, shields: 0, strengthMods: [], effectDamageMod: 0,
    powerUses: {}, enteredTurn: 0,
  };
}

function board(debt = 0): GameState {
  const s = createGame(
    [
      { name: 'A', leaderId: LEADER, cards: Array(40).fill(FILLER) },
      { name: 'B', leaderId: LEADER, cards: Array(40).fill(FILLER) },
    ], 1, 0);
  s.players[0].slots = [null, null, null];
  s.players[0].debtCount = debt;
  s.players[0].debt = Array(debt).fill(FILLER);
  return s;
}

/** Skeleton wearing another card's text. */
function grafted(sourceId: string): string {
  const host = card(HOST);
  return graftedCopy(HOST, sourceId, {
    strength: host.strength ?? 0,
    color: 'O',
    level: host.level ?? 1,
    powers: host.powers ?? [],
  });
}

describe('a strength trigger carried onto another body', () => {
  it('names the two kinds it has to tell apart', () => {
    expect(card(BONE).text, 'a self-buff').toContain('for every 2 debt you carry');
    expect(card(KING).text, 'an aura').toContain('Ally Mortals');
    expect(card(MORTAL).factions).toContain('Mortal');
  });

  it('pays out a self-buff that was grafted on', () => {
    const s = board(10);
    const id = grafted(BONE);
    s.players[0].slots[0] = body(s, id, 0, 3);
    // Skeleton prints 1 attack, and ten debt is five more.
    expect(effectiveStrength(s, s.players[0].slots[0]!)).toBe((card(HOST).strength ?? 0) + 5);
  });

  it('pays out a self-buff that was recompiled in', () => {
    const s = board(10);
    const id = fusedRecomp(HOST, BONE, 2, 4, 2);
    s.players[0].slots[0] = body(s, id, 0, 4);
    expect(effectiveStrength(s, s.players[0].slots[0]!)).toBe(2 + 5);
  });

  it('still keeps an aura off the body carrying it', () => {
    // The guard the old code was written for. A fused King must not buff itself
    // just because the mint gave it a new id.
    const s = board();
    const id = fusedRecomp(KING, MORTAL, 3, 5, 3);
    s.players[0].slots[0] = body(s, id, 0, 5);
    expect(effectiveStrength(s, s.players[0].slots[0]!), 'no self buff').toBe(3);
  });

  it('still lets an aura reach the allies it is for', () => {
    const s = board();
    const id = fusedRecomp(KING, MORTAL, 3, 5, 3);
    s.players[0].slots[0] = body(s, id, 0, 5);
    s.players[0].slots[1] = body(s, MORTAL, 0, 4);
    const printed = card(MORTAL).strength ?? 0;
    expect(effectiveStrength(s, s.players[0].slots[1]!), 'the ally Mortal gains 2')
      .toBe(printed + 2);
  });
});
