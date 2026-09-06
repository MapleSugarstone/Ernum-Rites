import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame } from '../src/engine/engine';
import { dealDamage, makeEffectCtx } from '../src/engine/effects';
import { remainingHp, type GameState } from '../src/engine/state';
import { card } from '../src/engine/registry';
import { SHIELD_CAP } from '../src/engine/types';

/**
 * Every flip that grants a Power Shield now carries a mana cost, so none of
 * them resolves inside the blow that revealed it. What the blow does instead is
 * stop dead and park what is left of itself on the offer.
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

describe('a costed shield flip', () => {
  it('parks the rest of the blow until the offer is answered', () => {
    const s = game();
    const leader = s.players[0].leader!;
    // Five face-down cards, every one of them a shield flip.
    leader.hp.length = 0;
    for (let i = 0; i < 5; i++) leader.hp.push({ cardId: 'r1-automoton', flipped: false });
    leader.shields = 0;
    const shieldCard = card('r1-automoton');
    expect(shieldCard.flipText, 'the HP card grants a shield').toContain('Power Shield');
    expect(shieldCard.flipCost, 'and asks to be paid for').toBeTruthy();

    dealDamage(s, { kind: 'leader', player: 0 }, 5);

    // One card turned over and the blow stopped on the question it raised.
    expect(remainingHp(leader), 'four cards still face down').toBe(4);
    expect(leader.shields, 'nothing is granted until the offer is paid').toBe(0);
    expect(s.flipQueue).toHaveLength(1);
    expect(s.flipQueue[0].pending, 'the rest of the blow waits on the answer').toBe(4);
    expect(s.winner, 'the leader is still standing').toBeNull();
  });
});

describe('a Power Shield', () => {
  it('stops the next instance whatever its size, and is spent doing it', () => {
    const s = game();
    const leader = s.players[0].leader!;
    leader.hp.length = 0;
    for (let i = 0; i < 5; i++) leader.hp.push({ cardId: 'r1-automoton', flipped: false });
    leader.shields = 1;
    const before = remainingHp(leader);

    dealDamage(s, { kind: 'leader', player: 0 }, 3);

    expect(remainingHp(leader), 'the shield ate the whole blow').toBe(before);
    expect(leader.shields, 'and was spent doing it').toBe(0);
  });

  it('stacks no higher than the cap', () => {
    const s = game();
    const leader = s.players[0].leader!;
    const ref = { kind: 'leader', player: 0 } as const;
    const ctx = makeEffectCtx(s, 0, leader, card(leader.cardId), []);
    leader.shields = 0;

    for (let i = 0; i < SHIELD_CAP + 2; i++) ctx.shield(ref, 1);
    expect(leader.shields, 'one at a time').toBe(SHIELD_CAP);

    leader.shields = 0;
    ctx.shield(ref, SHIELD_CAP + 3);
    expect(leader.shields, 'all at once').toBe(SHIELD_CAP);
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

  it('also saves it when the flip has a cost and the cost is paid', () => {
    // This used to go the other way, and the asymmetry was deliberate: a costed
    // flip only queued, so the body was checked for death before its owner was
    // ever asked. That meant paying for a card whose holder was already in the
    // debt pile. Damage now stops at a costed flip instead.
    const s = game();
    const leader = s.players[0].leader!;
    leader.hp.length = 0;
    leader.hp.push({ cardId: 'f1-seasnake', flipped: false });
    leader.hp.push({ cardId: 'f1-whaleshark', flipped: false });
    leader.hp.push({ cardId: 's1-livingraincloud', flipped: false });
    leader.shields = 0;
    s.players[0].mana.S = 1;
    expect(card('s1-livingraincloud').flipCost, 'this heal is costed').toBeTruthy();

    dealDamage(s, { kind: 'leader', player: 0 }, 3);
    expect(s.flipQueue.length, 'the blow stopped to ask').toBe(1);
    expect(s.winner, 'and nobody has won yet').toBeNull();

    const paid = applyAction(s, 0, { type: 'PAY_FLIP' });
    expect(paid.ok, paid.ok ? '' : paid.error).toBe(true);
    const after = paid.ok ? paid.state : s;
    expect(remainingHp(after.players[0].leader!), 'healed back above zero')
      .toBeGreaterThan(0);
    expect(after.winner, 'the leader survived').toBeNull();
  });
});
