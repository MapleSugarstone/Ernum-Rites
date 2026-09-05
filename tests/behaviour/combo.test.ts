import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/cards';
import {
  candidateActions,
  chooseAction,
  clearPlan,
  evaluate,
  fullSearch,
  quickSearch,
  readEnemy,
  setSearchLimits,
} from '../../src/ai/bot';
import { applyAction, createGame } from '../../src/engine/engine';
import { allCards, card } from '../../src/engine/registry';
import { deckIdentity, isLegalUnder } from '../../src/engine/identity';
import { DEBT_LIMIT, type GameState, type SummonInstance } from '../../src/engine/state';
import type { Action } from '../../src/engine/actions';
import type { PlayerIdx } from '../../src/engine/types';

/**
 * Positions the bot used to misplay, one per thing the searches were added for.
 *
 * Each one is built by hand rather than reached from an opening, because the
 * point of a combo is that it takes several specific cards and waiting for a
 * shuffle to deal them is not a test. The cards are named here and nowhere in
 * the bot: what is being checked is that a search finds these lines, not that
 * anything knows about them.
 */

// The suite runs the bot turned down; this file is the one that asks whether it
// can find a combo, so it asks the real one.
beforeAll(() => setSearchLimits(fullSearch));
afterAll(() => setSearchLimits(quickSearch));

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';

function body(s: GameState, cardId: string, owner: PlayerIdx, hp: number, isLeader = false): SummonInstance {
  return {
    uid: `u${s.nextUid++}`,
    cardId,
    owner,
    isLeader,
    hp: Array.from({ length: hp }, () => ({ cardId: FILLER, flipped: false })),
    sapped: false,
    wounds: 0,
    shields: 0,
    strengthMods: [],
    effectDamageMod: 0,
    powerUses: {},
    enteredTurn: 0,
  };
}

/** A mid-game position with nothing in it but what a test puts there. */
function board(): GameState {
  const s = createGame(
    [
      { name: 'A', leaderId: LEADER, cards: Array(40).fill(FILLER) },
      { name: 'B', leaderId: LEADER, cards: Array(40).fill(FILLER) },
    ],
    1,
    0,
  );
  for (const p of s.players) {
    p.hand = [];
    p.slots = [null, null, null];
    p.supporters = [];
    p.debt = [];
    p.debtCount = 0;
    p.mana = { P: 0, O: 0, R: 0, F: 0, S: 0, K: 0, C: 0, E: 0 };
    p.turnsTaken = 5;
    p.supportersLeft = 1;
    p.leaderPlayed = true;
  }
  s.turn = 6;
  s.phase = 'main';
  s.active = 0;
  s.drawn = false;
  s.pending = null;
  s.choiceQueue = [];
  s.flipQueue = [];
  s.replaceQueue = [];
  clearPlan();
  return s;
}

/** Let the bot take its whole turn, and hand back where it stopped. */
function playTurn(state: GameState, me: PlayerIdx, cap = 80): { state: GameState; line: Action[] } {
  const line: Action[] = [];
  let s = state;
  for (let i = 0; i < cap; i++) {
    if (s.winner !== null || s.drawn) break;
    const action = chooseAction(s, me);
    if (action.type === 'END_TURN') break;
    const res = applyAction(s, me, action);
    if (!res.ok) throw new Error(`illegal ${action.type}: ${res.error}`);
    line.push(action);
    s = res.state;
    if (s.pending) {
      const settled = applyAction(s, s.pending.player, { type: 'PASS_RESPONSE' });
      if (settled.ok) s = settled.state;
    }
    if (s.active !== me) break;
  }
  return { state: s, line };
}

describe('combo search', () => {
  it('finds a kill that needs two Powers in one turn', () => {
    // Alchemize spends Bone Known, whose attack is +1 for every 2 debt, for 5
    // to the face, then Haunt covers the last 2. Neither half wins on its own,
    // and combat cannot reach the leader with a body in front of it.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 10, true);
    foe.leader = body(s, LEADER, 1, 7, true);
    me.slots[0] = body(s, 'p3-helemy', 0, 5);
    me.slots[1] = body(s, 'o2-boneknown', 0, 3);
    me.slots[2] = body(s, 'm-rp-falsehumanity', 0, 3);
    me.debtCount = 6;
    me.debt = Array(6).fill(FILLER);
    me.mana.P = 3;
    me.mana.O = 1;
    foe.slots[0] = body(s, FILLER, 1, 4);

    const { state } = playTurn(s, 0);
    expect(state.winner).toBe(0);
  });

  it('holds a combo piece that is exactly lethal next turn', () => {
    // Bone Known is at 10 attack on 16 debt and Helemy is sapped, so Alchemize
    // cannot fire this turn. Next turn it is exactly the enemy leader's 10 HP,
    // and Alchemize reaches past the blocker that combat cannot. The greedy
    // play is to swing Bone Known into the 4/6, which kills it and takes the
    // combo with it, so the body has to still be standing at the end of the
    // turn.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 12, true);
    foe.leader = body(s, LEADER, 1, 10, true);
    me.slots[0] = body(s, 'p3-helemy', 0, 5);
    me.slots[0].sapped = true;
    me.slots[1] = body(s, 'o2-boneknown', 0, 3);
    me.debtCount = 16;
    me.debt = Array(16).fill(FILLER);
    me.supporters = [{ cardId: 'p3-helemy', sapped: false }, { cardId: 'p3-helemy', sapped: false }];
    foe.slots[0] = body(s, 'p3-helaks', 1, 6);

    const { state, line } = playTurn(s, 0);
    const held = state.players[0].slots.some((b) => b && card(b.cardId).name === 'Bone Known');
    expect(held, `Bone Known was thrown away. line: ${line.map((a) => a.type).join(' ')}`).toBe(true);
  });

  it('grafts a Deathrattle onto a body that returns to hand, and rides the loop to a kill', () => {
    // Graft moves False Humanity's "deal 2 to the enemy leader when it dies"
    // onto Skeleton, which returns to hand one HP smaller each death and stays
    // down at zero, so the loop is three laps deep at most. The evaluator
    // scores every lap as a loss: a body traded off and a debt taken for 2
    // damage. Only the last lap is a win, and the leader sits where the laps
    // that exist can reach it.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 10, true);
    foe.leader = body(s, LEADER, 1, 6, true);
    me.slots[0] = body(s, 'o1-skeleton', 0, 2);
    me.slots[1] = body(s, 'm-rp-falsehumanity', 0, 3);
    me.hand = ['ox-graft'];
    me.mana.O = 1;
    foe.slots[0] = body(s, 'p3-helaks', 1, 6);

    const { state, line } = playTurn(s, 0);
    expect(state.winner, `line: ${line.map((a) => a.type).join(' ')}`).toBe(0);
  });

  it('harms itself to set up a kill, when the harm is what makes the kill', () => {
    // Scientist's Experiment is free, saps nothing and repeats: mill 2, take 1
    // debt, draw a card. Bone Known has +1 attack for every 2 debt you carry.
    // Ten Experiments turn a 4 attack body into a 9 attack one, and Alchemize
    // spends it on the leader for the kill. Every one of those ten steps takes
    // a debt and deals nothing, so both the evaluator and a rollout greedy on
    // damage refuse the first of them.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 10, true);
    foe.leader = body(s, LEADER, 1, 11, true);
    me.slots[0] = body(s, 'p3-helemy', 0, 5);
    me.slots[1] = body(s, 'o2-boneknown', 0, 3);
    me.slots[2] = body(s, 'o2-scientist', 0, 4);
    me.debtCount = 4;
    me.debt = Array(4).fill(FILLER);
    me.mana.P = 2;
    me.deck = Array(40).fill(FILLER);
    foe.slots[0] = body(s, FILLER, 1, 4);

    const { state, line } = playTurn(s, 0);
    expect(state.winner, `line: ${line.map((a) => a.type).join(' ')}`).toBe(0);
    // The kill had to come through the blocker, so it was not combat alone.
    expect(state.players[0].debtCount).toBeGreaterThan(4);
  });

  it('runs its own deck dry to buy the debt a kill needs', () => {
    // Bone Known has +1 attack for every 2 debt you carry, so debt is ammunition
    // and running out of cards is a way to buy it. Four cards left and a kill
    // that wants 16 debt: Experiment mills and draws, the deck goes under twice,
    // and each reshuffle is charged at a price that climbs. The evaluator hates
    // every step of that. It is taken anyway because the line ends in a win, and
    // a win is not scored, it is returned.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 14, true);
    foe.leader = body(s, LEADER, 1, 10, true);
    me.slots[0] = body(s, 'p3-helemy', 0, 5);
    me.slots[1] = body(s, 'o2-boneknown', 0, 3);
    me.slots[2] = body(s, 'o2-scientist', 0, 4);
    me.debtCount = 6;
    me.debt = Array(6).fill(FILLER);
    me.deck = Array(4).fill(FILLER);
    me.discard = [];
    me.deckOuts = 0;
    me.mana.P = 2;
    foe.slots[0] = body(s, 'p3-helaks', 1, 6);

    const { state, line } = playTurn(s, 0);
    expect(state.winner, `line: ${line.map((a) => a.type).join(' ')}`).toBe(0);
    expect(state.players[0].deckOuts, 'it ran the deck out to get there')
      .toBeGreaterThan(0);
  });

  it('spends up to the debt limit for a kill and never past it', () => {
    // Twelve Experiments take the debt from 6 to 22 and Bone Known to 13, and
    // Alchemize puts that on a 13 HP leader: a kill that stops one short of
    // the limit. Milling 3 empties a 30-card deck on the way, so the last few
    // draws cost fatigue debt too. The rollout once lost this line because a
    // full hand and the every-other-point rhythm of Bone Known made every
    // second Experiment a flat step, and its climb stopped on the first one.
    // It may take a flat step now, and it may still never cross the limit.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 14, true);
    foe.leader = body(s, LEADER, 1, 13, true);
    me.slots[0] = body(s, 'p3-helemy', 0, 5);
    me.slots[1] = body(s, 'o2-boneknown', 0, 3);
    me.slots[2] = body(s, 'o2-scientist', 0, 4);
    me.debtCount = 6;
    me.debt = Array(6).fill(FILLER);
    me.deck = Array(30).fill(FILLER);
    me.mana.P = 2;
    foe.slots[0] = body(s, 'p3-helaks', 1, 6);

    const { state, line } = playTurn(s, 0);
    expect(state.winner, `line: ${line.map((a) => a.type).join(' ')}`).toBe(0);
    expect(state.players[0].debtCount, 'it spent almost the whole clock').toBeGreaterThan(20);
    expect(state.players[0].debtCount, 'and never crossed it').toBeLessThan(DEBT_LIMIT);
  });

  it('never reads a Graft pairing off the evaluator alone', () => {
    // The guard on the test above. Every pairing scores the same the instant it
    // resolves, because the evaluator has no term for what a body's text says,
    // so anything that picks between them has to have played the turn out.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 10, true);
    foe.leader = body(s, LEADER, 1, 20, true);
    me.slots[0] = body(s, 'o1-skeleton', 0, 2);
    me.slots[1] = body(s, 'm-rp-falsehumanity', 0, 3);
    me.hand = ['ox-graft'];
    me.mana.O = 3;
    foe.slots[0] = body(s, 'p3-helaks', 1, 6);

    const scores = new Set<number>();
    for (const action of candidateActions(s, 0)) {
      if (action.type !== 'CAST_SPELL') continue;
      const res = applyAction(s, 0, action);
      if (!res.ok) continue;
      scores.add(Math.round(evaluate(res.state, 0)));
    }
    expect(scores.size, 'the evaluator can already tell the pairings apart').toBe(1);
  });
});

describe('reading the opponent', () => {
  /** A position where the opponent has a hand, a discard pile and a leader. */
  function facing(discard: string[], hand: string[]): GameState {
    const s = board();
    s.players[0].leader = body(s, LEADER, 0, 10, true);
    const foe = s.players[1];
    foe.leader = body(s, 'p3-helemy', 1, 5, true);
    foe.leaderCardId = 'p3-helemy';
    foe.discard = [...discard];
    foe.hand = [...hand];
    return s;
  }

  it('is blind to what is in their hand', () => {
    // The same guard the learning code keeps on its observation: change every
    // card they hold, leave the count alone, and the read may not move.
    const a = readEnemy(facing([], ['o1-skeleton', 'o2-boneknown', 'ox-graft']), 1);
    const b = readEnemy(facing([], ['o2-scientist', 'o2-scientist', 'o1-skeleton']), 1);
    expect(b.trapDensity).toBe(a.trapDensity);
    expect(b.cheapestTrap?.id).toBe(a.cheapestTrap?.id);
  });

  it('reads a deck that has shown traps as likelier to hold one', () => {
    const traps = allCards().filter((d) => d.type === 'trap' && !d.uncollectible);
    const legal = traps.find((d) => isLegalUnder(d, deckIdentity('p3-helemy')));
    expect(legal, 'the test leader can run a trap at all').toBeTruthy();

    const cold = readEnemy(facing([], ['x-r-dummy-1']), 1);
    const shown = readEnemy(facing([legal!.id], ['x-r-dummy-1']), 1);
    expect(shown.trapDensity).toBeGreaterThan(cold.trapDensity);
  });
});
