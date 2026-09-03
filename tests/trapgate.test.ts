/**
 * A trap is only offered against something it can touch.
 *
 * Scooba shuffles the attacking summon into its owner's deck, and a leader has
 * no slot to leave and never goes back to a deck. It used to offer itself
 * against a leader's attack anyway and do nothing when sprung, which cost the
 * player the card and the mana.
 */
import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame, trapWouldFire } from '../src/engine/engine';
import { putSummonDirect } from '../src/engine/effects';
import { card } from '../src/engine/registry';
import type { GameState } from '../src/engine/state';

const SCOOBA = 'fx-scooba';
const BACKDRAFT = 'px-firebolt';
const PLAIN = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';

function game(): GameState {
  const s = createGame(
    [
      { name: 'A', leaderId: LEADER, cards: Array(40).fill(PLAIN) },
      { name: 'B', leaderId: LEADER, cards: Array(40).fill(PLAIN) },
    ],
    7,
    0,
  );
  for (const p of s.players) {
    p.hand = [];
    p.mana = { P: 0, O: 0, R: 0, F: 0, S: 0, C: 0 };
  }
  return s;
}

/** Seat 1 holding Scooba, with a battle already declared against them. */
function underAttack(s: GameState, attacker: 'leader' | 'summon'): void {
  s.players[1].hand = [SCOOBA];
  s.players[1].mana.F = 3;
  const opts = { strength: 2, color: 'R' as const, hp: 3, asPrinted: true };
  if (attacker === 'summon') putSummonDirect(s, 0, PLAIN, 0, opts);
  putSummonDirect(s, 1, PLAIN, 0, opts);
  s.battle = {
    attacker:
      attacker === 'leader'
        ? { kind: 'leader', player: 0 }
        : { kind: 'summon', player: 0, slot: 0 },
    defender: { kind: 'summon', player: 1, slot: 0 },
    trapUsed: false,
  };
  s.pending = { kind: 'response', player: 1, battle: s.battle, spell: null };
}

describe('Trap: Scooba against a leader', () => {
  it('says it cannot answer an attack led by a leader', () => {
    const s = game();
    underAttack(s, 'leader');
    expect(trapWouldFire(s, 1, card(SCOOBA))).toBe(false);
  });

  it('still answers an attack led by a summon', () => {
    const s = game();
    underAttack(s, 'summon');
    expect(trapWouldFire(s, 1, card(SCOOBA))).toBe(true);
  });

  it('refuses the cast rather than spending the card on nothing', () => {
    const s = game();
    underAttack(s, 'leader');
    const before = { mana: s.players[1].mana.F, hand: s.players[1].hand.length };

    const r = applyAction(s, 1, { type: 'CAST_TRAP', handIndex: 0, targets: [] });

    expect(r.ok, 'the engine turns it down').toBe(false);
    expect(s.players[1].mana.F, 'no mana spent').toBe(before.mana);
    expect(s.players[1].hand.length, 'and the card is still in hand').toBe(before.hand);
  });

  it('leaves every trap that prints no opinion alone', () => {
    // The gate is opt-in, so the rest of the set is untouched by it.
    expect(card(BACKDRAFT).trapUseful).toBeUndefined();
    const s = game();
    underAttack(s, 'leader');
    expect(trapWouldFire(s, 1, card(BACKDRAFT))).toBe(true);
  });
});
