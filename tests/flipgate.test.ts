import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame } from '../src/engine/engine';
import { dealDamage } from '../src/engine/effects';
import { card } from '../src/engine/registry';
import { choiceIsLive, currentActor, remainingHp, type GameState } from '../src/engine/state';

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

/**
 * A parked flip gates the blow, so nothing that would resolve that blow may run
 * while the flip is still waiting.
 *
 * A trigger can reveal a costed flip during an attack declaration, and the trap
 * window for that same attack opens straight afterwards. Both were live at once,
 * and either passing the window or springing a trap resolved the clash over the
 * top of the offer: the body the flip existed to save died before its owner was
 * ever asked. The flip is answered first, and only then does the clash resolve.
 */
describe('a flip parked under an open response window', () => {
  /** A live window over the same board, waiting on seat 1. */
  function windowOver(s: GameState): void {
    s.pending = {
      kind: 'response',
      player: 1,
      battle: {
        attacker: { kind: 'summon', player: 1, slot: 0 },
        defender: { kind: 'leader', player: 0 },
        trapUsed: false,
      },
      spell: null,
    };
  }

  function parked(): GameState {
    const s = game();
    wearing(s, [PLAIN, HEAL_FLIP]);
    s.players[0].mana.C = 1;
    dealDamage(s, { kind: 'leader', player: 0 }, 2);
    expect(s.flipQueue.length, 'the blow stopped on the flip').toBe(1);
    windowOver(s);
    return s;
  }

  it('is what the game is waiting on, ahead of the window', () => {
    const s = parked();
    expect(currentActor(s), 'the flip owner, not the window owner').toBe(0);
  });

  it('holds back a choice sitting behind it', () => {
    const s = parked();
    // The window is gone and the flip alone is enough to hold the choice.
    s.pending = null;
    s.choiceQueue.push({ player: 0, source: '', effect: 'scry', prompt: 'x', refs: [] });
    expect(choiceIsLive(s), 'the flip is in front of it').toBe(false);
  });

  it('refuses to pass the window while the flip is unanswered', () => {
    const r = applyAction(parked(), 1, { type: 'PASS_RESPONSE' });
    expect(r.ok, 'the game is waiting on the flip, not the window').toBe(false);
  });

  it('refuses to spring a trap while the flip is unanswered', () => {
    const s = parked();
    s.players[1].hand = ['nx-Mousetrap'];
    s.players[1].mana.C = 1;
    const r = applyAction(s, 1, { type: 'CAST_TRAP', handIndex: 0, targets: [] });
    expect(r.ok).toBe(false);
  });

  it('says so even when the same player holds both', () => {
    // Priority alone does not cover this: with the flip and the window on one
    // seat the actor gate is satisfied, and only the explicit guard stops them
    // resolving the clash over their own unanswered flip.
    const s = parked();
    s.pending!.player = 0;
    const r = applyAction(s, 0, { type: 'PASS_RESPONSE' });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('flipped card');
  });

  it('lets the window through once the flip is answered', () => {
    const paid = applyAction(parked(), 0, { type: 'PAY_FLIP' });
    expect(paid.ok, paid.ok ? '' : paid.error).toBe(true);
    const s = paid.ok ? paid.state : parked();
    expect(s.flipQueue.length, 'the offer is settled').toBe(0);
    const passed = applyAction(s, 1, { type: 'PASS_RESPONSE' });
    expect(passed.ok, passed.ok ? '' : passed.error).toBe(true);
  });

  it('never bills for an offer whose body has already left the board', () => {
    const s = parked();
    s.pending = null;
    // Something else finished the body off while its flip sat in the queue.
    s.players[0].leader = null;
    const before = s.players[0].mana.C;
    const r = applyAction(s, 0, { type: 'PAY_FLIP' });
    const after = r.ok ? r.state : s;
    expect(after.players[0].mana.C, 'nothing was charged for nothing').toBe(before);
    expect(after.flipQueue.length, 'and the offer is not left hanging').toBe(0);
  });
});
