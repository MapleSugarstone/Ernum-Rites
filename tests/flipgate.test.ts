import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame } from '../src/engine/engine';
import { dealDamage } from '../src/engine/effects';
import { card } from '../src/engine/registry';
import { remainingHp, type GameState } from '../src/engine/state';

/**
 * A costed flip stops the blow that revealed it.
 *
 * Costed flips wait for their owner to answer, and damage used to carry on
 * without them: the body ran out of HP, died, and the offer was still sitting
 * in the queue. Its owner was then asked to pay for a card protecting something
 * that was already in the debt pile, paid, and got nothing.
 */

const HEAL_FLIP = 'n1-Thing';
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

/** The leader wearing the given HP cards, face down, in order. */
function wearing(s: GameState, ids: string[]): void {
  const leader = s.players[0].leader!;
  leader.hp = ids.map((cardId) => ({ cardId, flipped: false }));
}

describe('a costed flip on the last HP card', () => {
  it('is offered before the body dies, not after', () => {
    const s = game();
    expect(card(HEAL_FLIP).flipCost, 'the HP card asks for something').toBeTruthy();
    expect(card(HEAL_FLIP).flipText).toContain('Heal');
    wearing(s, [PLAIN, HEAL_FLIP]);
    s.players[0].mana.C = 1;

    dealDamage(s, { kind: 'leader', player: 0 }, 2);

    expect(s.flipQueue.length, 'the flip is waiting').toBe(1);
    expect(s.players[0].leader, 'the body it protects is still there').toBeTruthy();
    expect(s.winner, 'and the game has not been handed over').toBeNull();
  });

  it('saves the body when it is paid for', () => {
    const s = game();
    wearing(s, [PLAIN, HEAL_FLIP]);
    s.players[0].mana.C = 1;

    dealDamage(s, { kind: 'leader', player: 0 }, 2);
    const paid = applyAction(s, 0, { type: 'PAY_FLIP' });
    expect(paid.ok, paid.ok ? '' : paid.error).toBe(true);

    const after = paid.ok ? paid.state : s;
    expect(remainingHp(after.players[0].leader!), 'the heal landed').toBeGreaterThan(0);
    expect(after.winner, 'so nobody won').toBeNull();
    expect(after.flipQueue.length, 'and the queue is clear').toBe(0);
  });

  it('lets the body die when the flip is declined', () => {
    const s = game();
    wearing(s, [PLAIN, HEAL_FLIP]);
    s.players[0].mana.C = 1;

    dealDamage(s, { kind: 'leader', player: 0 }, 2);
    const declined = applyAction(s, 0, { type: 'DECLINE_FLIP' });
    expect(declined.ok, declined.ok ? '' : declined.error).toBe(true);

    const after = declined.ok ? declined.state : s;
    expect(after.winner, 'the leader fell').toBe(1);
  });

  it('lands the rest of the blow after the flip settles', () => {
    // Four cards, the second of them costed. Two points are still owed when the
    // flip comes up, and they have to arrive once it is answered.
    const s = game();
    wearing(s, [PLAIN, HEAL_FLIP, PLAIN, PLAIN]);
    s.players[0].mana.C = 1;

    dealDamage(s, { kind: 'leader', player: 0 }, 4);
    expect(s.flipQueue.length, 'the blow stopped at the flip').toBe(1);
    expect(remainingHp(s.players[0].leader!), 'two cards still face down').toBe(2);

    const declined = applyAction(s, 0, { type: 'DECLINE_FLIP' });
    expect(declined.ok, declined.ok ? '' : declined.error).toBe(true);
    const after = declined.ok ? declined.state : s;
    expect(after.winner, 'the last two points landed and took the leader').toBe(1);
  });
});
