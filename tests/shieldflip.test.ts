import { describe, expect, it } from 'vitest';
import '../src/cards';
import { createGame } from '../src/engine/engine';
import { dealDamage } from '../src/engine/effects';
import { remainingHp, type GameState } from '../src/engine/state';
import { card } from '../src/engine/registry';

/**
 * A shield handed out by a flip in the middle of a blow: does it stop the rest
 * of that same blow, or only the next one?
 */
function game(): GameState {
  const deck = Array.from({ length: 60 }, () => 'r1-automoton');
  return createGame(
    [
      { name: 'A', leaderId: 'r3-cybersiren', cards: deck },
      { name: 'B', leaderId: 'r3-cybersiren', cards: deck },
    ],
    12345,
    0,
  );
}

describe('a Power Shield granted mid-flip', () => {
  it('does not stop the rest of the instance that revealed it', () => {
    const s = game();
    const leader = s.players[0].leader!;
    // Five face-down cards, every one of them a shield flip.
    leader.hp.length = 0;
    for (let i = 0; i < 5; i++) leader.hp.push({ cardId: 'r1-automoton', flipped: false });
    leader.shields = 0;
    expect(card('r1-automoton').flipText, 'the HP card grants a shield').toContain('Power Shield');

    dealDamage(s, { kind: 'leader', player: 0 }, 5);

    // Every card turned over, so the shield the first one handed out did not
    // stop the four that followed.
    expect(remainingHp(leader), 'all five flipped').toBe(0);
    expect(leader.shields, 'shields banked for the next blow').toBeGreaterThan(0);
    // Flipping the last card is itself the death: it does not wait for a
    // further point of damage to land on an empty body.
    expect(s.winner, 'the leader died on the fifth flip').toBe(1);
  });

  it('does stop the next instance', () => {
    const s = game();
    const leader = s.players[0].leader!;
    leader.hp.length = 0;
    for (let i = 0; i < 5; i++) leader.hp.push({ cardId: 'r1-automoton', flipped: false });
    leader.shields = 0;

    dealDamage(s, { kind: 'leader', player: 0 }, 1);
    const afterFirst = remainingHp(leader);
    expect(leader.shields, 'one flip banked one shield').toBe(1);

    dealDamage(s, { kind: 'leader', player: 0 }, 3);
    expect(remainingHp(leader), 'the shield ate the whole second blow').toBe(afterFirst);
    expect(leader.shields, 'and was spent doing it').toBe(0);
  });
});

describe('a healing flip on the last HP card', () => {
  it('saves the character when the flip is free', () => {
    const s = game();
    const leader = s.players[0].leader!;
    // Two plain cards, then a free heal flip as the last one standing.
    leader.hp.length = 0;
    leader.hp.push({ cardId: 'f1-seasnake', flipped: false });
    leader.hp.push({ cardId: 'f1-whaleshark', flipped: false });
    leader.hp.push({ cardId: 'n2-HonorableKnight', flipped: false });
    leader.shields = 0;
    expect(card('n2-HonorableKnight').flipCost, 'the heal is free').toBeFalsy();

    dealDamage(s, { kind: 'leader', player: 0 }, 3);

    // The flip resolves before the death check, so unflipping a spent card
    // puts HP back on the body and it is still standing.
    expect(remainingHp(leader), 'healed back above zero').toBeGreaterThan(0);
    expect(s.winner, 'the leader survived').toBeNull();
  });

  it('does not save it when the flip has a cost', () => {
    const s = game();
    const leader = s.players[0].leader!;
    leader.hp.length = 0;
    leader.hp.push({ cardId: 'f1-seasnake', flipped: false });
    leader.hp.push({ cardId: 'f1-whaleshark', flipped: false });
    leader.hp.push({ cardId: 's1-livingraincloud', flipped: false });
    leader.shields = 0;
    expect(card('s1-livingraincloud').flipCost, 'this heal is costed').toBeTruthy();

    dealDamage(s, { kind: 'leader', player: 0 }, 3);

    // A costed flip only queues, so it is never offered before the body is
    // checked for death.
    expect(remainingHp(leader), 'nothing came back').toBe(0);
    expect(s.winner, 'the leader died anyway').toBe(1);
  });
});
