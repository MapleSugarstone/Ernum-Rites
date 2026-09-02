import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame, type DeckList } from '../src/engine/engine';
import { destroySummon, effectiveStrength, putSummonDirect } from '../src/engine/effects';
import { card } from '../src/engine/registry';
import type { GameState } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';

/**
 * A spell that casts twice is cast twice.
 *
 * Scoobert Singularity resolves a spell's effect a second time, and the log
 * announces the echo, so anything that answers "when a spell is cast" has two
 * casts to answer. Firing the answer once made an echoed spell worth half as
 * much to the cards built around it.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const LIGHT = 's3-divergentlight';
const ECHO = 'r3-scoobertsingularity';
const MALWARE = 'm-grp-horriblemalware';
/** Cheap, targetless, and its effect does nothing that changes who is on board. */
const SPELL = 'fx-chumbucket';

function deck(): DeckList {
  return { name: 'Tester', leaderId: LEADER, cards: Array.from({ length: 60 }, () => FILLER) };
}

/** Both leaders out, seat 0 holding the spell with mana to spare. */
function board(): GameState {
  let s = createGame([deck(), deck()], 4, 1);
  for (let i = 0; i < 3; i++) {
    const r = applyAction(s, s.active, { type: 'END_TURN' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  s.players[0].hand[0] = SPELL;
  for (const k of Object.keys(s.players[0].mana)) {
    (s.players[0].mana as Record<string, number>)[k] = 9;
  }
  return s;
}

function cast(s: GameState): GameState {
  const r = applyAction(s, 0 as PlayerIdx, { type: 'CAST_SPELL', handIndex: 0, targets: [] });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const printed = card(LIGHT).strength ?? 0;

describe('what a cast spell sets off', () => {
  it('rings once for a spell that resolves once', () => {
    const s = board();
    putSummonDirect(s, 0, LIGHT, 0, { strength: printed, color: 'S', hp: 5, asPrinted: true });
    const after = cast(s);
    expect(effectiveStrength(after, after.players[0].slots[0]!)).toBe(printed + 1);
  });

  it('rings twice when the spell echoes', () => {
    const s = board();
    putSummonDirect(s, 0, LIGHT, 0, { strength: printed, color: 'S', hp: 5, asPrinted: true });
    putSummonDirect(s, 0, ECHO, 1, { strength: 2, color: 'R', hp: 4, asPrinted: true });
    const after = cast(s);
    expect(
      effectiveStrength(after, after.players[0].slots[0]!),
      'the echo is a second cast, not a louder first one',
    ).toBe(printed + 2);
  });

  it('rings twice on the other side of the table too', () => {
    // Horrible Malware answers the enemy's cast by minting a copy, so an echoed
    // spell owes it two.
    const s = board();
    putSummonDirect(s, 0, ECHO, 1, { strength: 2, color: 'R', hp: 4, asPrinted: true });
    putSummonDirect(s, 1, MALWARE, 0, { strength: 2, color: 'R', hp: 3, asPrinted: true });
    const before = s.players[1].hand.length;
    const after = cast(s);
    expect(after.players[1].hand.length - before, 'one copy per cast').toBe(2);
  });

  it('rings once for the enemy when nothing echoes', () => {
    const s = board();
    putSummonDirect(s, 1, MALWARE, 0, { strength: 2, color: 'R', hp: 3, asPrinted: true });
    const before = s.players[1].hand.length;
    const after = cast(s);
    expect(after.players[1].hand.length - before).toBe(1);
  });

  it('counts the echo once however many echo sources are out', () => {
    const s = board();
    putSummonDirect(s, 0, LIGHT, 0, { strength: printed, color: 'S', hp: 5, asPrinted: true });
    putSummonDirect(s, 0, ECHO, 1, { strength: 2, color: 'R', hp: 4, asPrinted: true });
    putSummonDirect(s, 0, ECHO, 2, { strength: 2, color: 'R', hp: 4, asPrinted: true });
    const after = cast(s);
    expect(effectiveStrength(after, after.players[0].slots[0]!), 'twice, not three times')
      .toBe(printed + 2);
  });
});

/**
 * Skeleton's loop costs its level a lap and nothing more.
 *
 * The debt is not the card's doing: every death is billed for the body's level,
 * and the Deathrattle only sends it home. The card prints the charge because
 * the loop is the whole card, and the price of a lap is what keeps it honest.
 */
describe('Skeleton going round', () => {
  const SKELETON = 'o1-skeleton';

  it('bills one lap for its level, with nothing added', () => {
    const s = board();
    putSummonDirect(s, 0, SKELETON, 0, { strength: 1, color: 'O', hp: 3, asPrinted: true });
    const before = s.players[0].debtCount;
    destroySummon(s, s.players[0].slots[0]!);
    expect(s.players[0].debtCount - before, 'a level 1 body costs 1').toBe(1);
    expect(s.players[0].hand, 'and comes home to go round again').toContain(SKELETON);
  });

  it('says what a lap costs', () => {
    expect(card(SKELETON).text).toContain('Adds its level to your debt');
    expect(card(SKELETON).text, 'the extra point is gone').not.toContain('plus 1');
  });
});
