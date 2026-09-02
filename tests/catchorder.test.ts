import { describe, expect, it } from 'vitest';
import '../src/cards';
import { createGame } from '../src/engine/engine';
import { catchHp, unflipHp } from '../src/engine/effects';
import type { GameState, SummonInstance } from '../src/engine/state';
import type { PlayerIdx, TargetRef } from '../src/engine/types';

/**
 * Which spent HP card a Catch reaches for.
 *
 * Damage turns cards over from the front, so the spent cards are the oldest
 * ones. Catch takes those first. Healing goes the other way and undoes the
 * newest damage, which is the opposite end on purpose: healing reverses the blow
 * that just landed, and catching reaches past it for what was spent earliest.
 */

const LEADER = 'x-hero-dummy-warden';
/** Distinguishable, and none of them carries a flip that would cascade. */
const HP = ['p1-ashdemon', 'p2-dragon', 'p2-wizard', 'p3-helaks', 'p3-Pod'];
const REF: TargetRef = { kind: 'summon', player: 0, slot: 0 };

function board(spent: number): GameState {
  const s = createGame(
    [
      { name: 'A', leaderId: LEADER, cards: Array(40).fill('x-r-dummy-1') },
      { name: 'B', leaderId: LEADER, cards: Array(40).fill('x-r-dummy-1') },
    ],
    1,
    0,
  );
  for (const p of s.players) {
    p.hand = [];
    p.slots = [null, null, null];
  }
  const b: SummonInstance = {
    uid: 'u1', cardId: 'x-r-dummy-1', owner: 0 as PlayerIdx, isLeader: false,
    hp: HP.map((cardId) => ({ cardId, flipped: false })),
    sapped: false, wounds: 0, shields: 0, strengthMods: [], effectDamageMod: 0,
    powerUses: {}, enteredTurn: 0,
  };
  // Set directly rather than dealing damage, so no flip effect can cascade and
  // the only thing under test is the order Catch walks the stack in.
  for (let i = 0; i < spent; i++) b.hp[i].flipped = true;
  s.players[0].slots[0] = b;
  return s;
}

describe('Catch takes the oldest spent HP card', () => {
  it('returns them in the order they were spent', () => {
    const s = board(3);
    catchHp(s, REF, 1);
    expect(s.players[0].hand, 'the first card flipped comes back first').toEqual([HP[0]]);
    catchHp(s, REF, 1);
    expect(s.players[0].hand).toEqual([HP[0], HP[1]]);
    catchHp(s, REF, 1);
    expect(s.players[0].hand).toEqual([HP[0], HP[1], HP[2]]);
  });

  it('takes several at once in the same order', () => {
    const s = board(3);
    expect(catchHp(s, REF, 3)).toBe(3);
    expect(s.players[0].hand).toEqual([HP[0], HP[1], HP[2]]);
  });

  it('never takes a card that was not spent', () => {
    const s = board(3);
    // Asked for more than there are: only the three spent cards are eligible.
    expect(catchHp(s, REF, 5), 'two cards are still face down').toBe(3);
    expect(s.players[0].slots[0]!.hp.map((h) => h.cardId)).toEqual([HP[3], HP[4]]);
  });

  it('heals from the other end, which is what makes the two different', () => {
    const s = board(3);
    unflipHp(s, REF, 1);
    const still = s.players[0].slots[0]!.hp.filter((h) => h.flipped).map((h) => h.cardId);
    expect(still, 'healing undid the newest damage').toEqual([HP[0], HP[1]]);
  });

  it('destroys a body it empties', () => {
    const s = board(5);
    catchHp(s, REF, 5);
    expect(s.players[0].slots[0], 'nothing was left holding it up').toBeNull();
  });
});
