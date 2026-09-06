import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/cards';
import {
  candidateActions,
  chooseAction,
  clearPlan,
  defaultWeights,
  evaluate,
  fullSearch,
  kitsFor,
  quickSearch,
  readEnemy,
  setSearchLimits,
} from '../../src/ai/bot';
import { applyAction, createGame } from '../../src/engine/engine';
import { allCards, card } from '../../src/engine/registry';
import { fusedRecomp, graftedCopy } from '../../src/engine/generated';
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
    me.mana.P = 3;
    me.mana.O = 1;
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
    me.mana.P = 3;
    me.mana.O = 1;
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
    me.mana.P = 3;
    me.mana.O = 1;
    foe.slots[0] = body(s, 'p3-helaks', 1, 6);

    const { state, line } = playTurn(s, 0);
    expect(state.winner, `line: ${line.map((a) => a.type).join(' ')}`).toBe(0);
    expect(state.players[0].debtCount, 'it spent almost the whole clock').toBeGreaterThan(20);
    expect(state.players[0].debtCount, 'and never crossed it').toBeLessThan(DEBT_LIMIT);
  });

  it('tells a Graft pairing apart by what the graft does', () => {
    // Once every pairing scored the same the instant it resolved, because the
    // evaluator had no term for what a body's text says. The reach term plays
    // each minted body out, so the pairing that puts the Deathrattle on the
    // body that keeps coming back is the one the evaluator prefers.
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

    clearPlan();
    const scores = new Set<number>();
    let best = Number.NEGATIVE_INFINITY;
    let bestBody = '';
    for (const action of candidateActions(s, 0)) {
      if (action.type !== 'CAST_SPELL') continue;
      const res = applyAction(s, 0, action);
      if (!res.ok) continue;
      const score = evaluate(res.state, 0);
      scores.add(Math.round(score));
      if (score > best) {
        best = score;
        bestBody = res.state.players[0].slots[0]?.cardId ?? '';
      }
    }
    expect(scores.size, 'the pairings score apart').toBeGreaterThan(1);
    expect(bestBody.startsWith('gen-graft-o1-skeleton+m-rp-falsehumanity'), `the loop is the one it prefers: ${bestBody}`).toBe(true);
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

describe('the deck scan', () => {
  it('finds the Scientist kit in a list that carries it, and nothing in a list of vanillas', () => {
    // The probe puts a wall in front of the enemy leader, so three bodies that
    // could swing at an open leader are a pile rather than a kit. Experiments
    // into Dark Knowledge are the engine: Bone Known clears the wall or feeds
    // Alchemize, and the third piece is whichever body the scan finds reaches
    // least on its own. The engine has to be in the best kit, and the vanilla
    // Beast may ride along as that third piece.
    const kit = [
      ...Array(38).fill(FILLER),
      'p3-helemy', 'p3-helemy', 'o2-boneknown', 'o2-boneknown', 'o2-scientist', 'o2-scientist',
      'p1-beast', 'p1-beast', 'x-p-bolt', 'x-p-bolt',
    ];
    const s = createGame(
      [
        { name: 'A', leaderId: LEADER, cards: kit },
        { name: 'B', leaderId: LEADER, cards: Array(48).fill(FILLER) },
      ],
      1,
      0,
    );
    clearPlan();
    chooseAction(s, 0);
    const found = kitsFor(s, 0);
    expect(found.length, 'one kit').toBeGreaterThan(0);
    const best = found[0];
    expect(best.reach).toBeGreaterThanOrEqual(0.9);
    for (const id of ['o2-scientist', 'o2-boneknown']) {
      expect(best.cards, `${id} is in the best kit`).toContain(id);
    }

    chooseAction(s, 1);
    expect(kitsFor(s, 1), 'a list of vanillas holds no kit').toHaveLength(0);
  });
});

describe('minted cards', () => {
  it('prices what a minted body carries', () => {
    // A Recomp is registered when it is minted, with the higher stats, both
    // faction lines, both Powers and both trigger lines of its parts. The
    // evaluator reads it through the registry like any printed card, so a
    // Recomp that inherited a Deathrattle is worth more than a vanilla body of
    // the same stats: the Deathrattle term at least, and whatever the reach
    // probe finds the Deathrattle does past the wall on top.
    const plain = card(FILLER);
    const fused = fusedRecomp(FILLER, 'm-rp-falsehumanity', plain.strength ?? 1, plain.hp ?? 1, 1);
    expect(card(fused).triggers?.onDeath, 'the fusion kept the Deathrattle').toBeTruthy();

    const a = board();
    a.players[0].leader = body(a, LEADER, 0, 10, true);
    a.players[1].leader = body(a, LEADER, 1, 10, true);
    const b = structuredClone(a);
    a.players[0].slots[0] = body(a, FILLER, 0, plain.hp ?? 1);
    b.players[0].slots[0] = body(b, fused, 0, plain.hp ?? 1);
    clearPlan();
    const gap = evaluate(b, 0) - evaluate(a, 0);
    expect(gap).toBeGreaterThanOrEqual(defaultWeights.deathrattle);
  });

  it('plays a Recomp from hand and fires the Powers it inherited for the kill', () => {
    // Helemy and Bone Known fused: Alchemize and Dark Knowledge rebuilt in
    // Robot and Pepper on one body. Dark Knowledge sets its attack from the
    // debt pile and Alchemize spends the body on the enemy leader, past the
    // blocker. The Recomp is a minted card in hand: the bot has to enumerate
    // playing it, then its Powers, none of which exist in any printed list.
    const s = board();
    const me = s.players[0];
    const foe = s.players[1];
    me.leader = body(s, LEADER, 0, 10, true);
    foe.leader = body(s, LEADER, 1, 12, true);
    me.hand = [fusedRecomp('p3-helemy', 'o2-boneknown', 4, 5, 3)];
    me.debtCount = 20;
    me.debt = Array(20).fill(FILLER);
    me.mana.R = 3;
    me.mana.P = 1;
    foe.slots[0] = body(s, 'p3-helaks', 1, 6);

    const { state, line } = playTurn(s, 0);
    expect(state.winner, `line: ${line.map((a) => a.type).join(' ')}`).toBe(0);
    expect(line.some((a) => a.type === 'PLAY_SUMMON'), 'the Recomp was played').toBe(true);
  });
});

describe('what a card can do', () => {
  it('prices a Recomp in hand by the Powers it inherited', () => {
    // Nothing in the printed set says what a Recomp of Helemy and Bone Known
    // does. The reach term plays it out on a probe board: Dark Knowledge sets
    // its attack from the debt pile and Alchemize spends it on the leader, so
    // at 20 debt the card in hand is a kill in waiting, and a vanilla of the
    // same level is a body.
    const s = board();
    s.players[0].leader = body(s, LEADER, 0, 10, true);
    s.players[1].leader = body(s, LEADER, 1, 10, true);
    s.players[0].debtCount = 20;
    s.players[0].debt = Array(20).fill(FILLER);
    const plain = structuredClone(s);
    plain.players[0].hand = ['x-r-dummy-3'];
    const fused = structuredClone(s);
    fused.players[0].hand = [fusedRecomp('p3-helemy', 'o2-boneknown', 4, 5, 3)];
    clearPlan();
    expect(evaluate(fused, 0)).toBeGreaterThan(evaluate(plain, 0) + defaultWeights.reach * 0.25);
  });

  it('prices a grafted Skeleton by the loop it carries', () => {
    // Skeleton returns to hand one HP smaller each death. With False
    // Humanity's Deathrattle grafted on, every death also deals 2 to the enemy
    // leader past any blocker, so the body is a line and not a 1/3.
    const skeleton = card('o1-skeleton');
    const grafted = graftedCopy('o1-skeleton', 'm-rp-falsehumanity', {
      strength: skeleton.strength ?? 1,
      color: skeleton.color,
      level: skeleton.level ?? 1,
      powers: [],
    });
    const s = board();
    s.players[0].leader = body(s, LEADER, 0, 10, true);
    s.players[1].leader = body(s, LEADER, 1, 10, true);
    const plain = structuredClone(s);
    plain.players[0].slots[0] = body(plain, 'o1-skeleton', 0, 3);
    const looped = structuredClone(s);
    looped.players[0].slots[0] = body(looped, grafted, 0, 3);
    clearPlan();
    expect(evaluate(looped, 0)).toBeGreaterThan(evaluate(plain, 0) + defaultWeights.deathrattle);
  });
});
