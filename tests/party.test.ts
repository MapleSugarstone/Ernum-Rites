import { describe, expect, it } from 'vitest';
import '../src/cards';
import type { Action } from '../src/engine/actions';
import {
  applyAction,
  createGame,
  legalAttackTargets,
  targetCandidates,
  type DeckList,
} from '../src/engine/engine';
import { NEEDS_ENEMY } from '../src/engine/engine';
import { addDebt, defaultOpp, destroySummon, putSummonDirect } from '../src/engine/effects';
import { HIDDEN_ID, redactFor } from '../src/engine/redact';
import {
  currentActor,
  DEBT_LIMIT,
  debtLimitOf,
  isOver,
  livingOpponents,
  nextLiving,
  OPENING_HAND,
  PARTY_DEBT_LIMIT,
  PARTY_HAND_BONUS,
  type GameState,
} from '../src/engine/state';
import type { PlayerIdx, TargetSpec } from '../src/engine/types';
import { chooseAction, defaultWeights, evaluate } from '../src/ai/bot';

const D1 = 'x-r-dummy-1';
const D2 = 'x-p-dummy-2';
const LEADER = 'x-hero-dummy-warden';

function deck(cards: string[], leaderId = LEADER): DeckList {
  return { name: 'Tester', leaderId, cards };
}

function filler(n: number, id = D1): string[] {
  return Array.from({ length: n }, () => id);
}

function game(seats: number): GameState {
  return createGame(
    Array.from({ length: seats }, () => deck(filler(60))),
    12345,
    0,
  );
}

function must(state: GameState, actor: PlayerIdx, action: Action): GameState {
  const res = applyAction(state, actor, action);
  if (!res.ok) throw new Error(`${action.type} rejected: ${res.error}`);
  return res.state;
}

/** End the current turn and keep passing until `player` is on the play again. */
function passTo(state: GameState, player: PlayerIdx): GameState {
  let s = must(state, state.active, { type: 'END_TURN' });
  let guard = 0;
  while (s.active !== player || s.phase !== 'main') {
    if (guard++ > 12) throw new Error('could not reach that turn');
    s = must(s, s.active, { type: 'END_TURN' });
  }
  return s;
}

function give(state: GameState, player: PlayerIdx, cardId: string): number {
  state.players[player].hand.push(cardId);
  return state.players[player].hand.length - 1;
}

function dummy(state: GameState, player: PlayerIdx, slot: number, cardId = D1): void {
  putSummonDirect(state, player, cardId, slot, {
    strength: 1,
    color: 'R',
    hp: 2,
    asPrinted: true,
  });
}

describe('party setup', () => {
  it('deals everyone two extra opening cards at three or four seats', () => {
    for (const seats of [3, 4]) {
      const s = game(seats);
      for (let p = 0; p < seats; p++) {
        if (p === 0) continue; // The starter's opening turn skipped no draw yet.
        expect(s.players[p].hand).toHaveLength(OPENING_HAND + PARTY_HAND_BONUS);
      }
      expect(s.players[0].hand).toHaveLength(OPENING_HAND + PARTY_HAND_BONUS);
    }
    expect(game(2).players[0].hand).toHaveLength(OPENING_HAND);
  });

  it('rotates turns through every seat in order', () => {
    let s = game(3);
    expect(s.active).toBe(0);
    s = must(s, 0, { type: 'END_TURN' });
    expect(s.active).toBe(1);
    s = must(s, 1, { type: 'END_TURN' });
    expect(s.active).toBe(2);
    s = must(s, 2, { type: 'END_TURN' });
    expect(s.active).toBe(0);
  });

  it('orders living opponents by turn order from each seat', () => {
    const s = game(4);
    expect(livingOpponents(s, 2)).toEqual([3, 0, 1]);
    s.players[3].eliminated = true;
    expect(livingOpponents(s, 2)).toEqual([0, 1]);
    expect(nextLiving(s, 2)).toBe(0);
  });

  it('redacts every other hand and every deck for each viewer', () => {
    const r = redactFor(game(4), 2);
    for (let p = 0; p < 4; p++) {
      expect(r.players[p].deck.every((c) => c === HIDDEN_ID)).toBe(true);
      const hidden = r.players[p].hand.every((c) => c === HIDDEN_ID);
      expect(hidden).toBe(p !== 2);
    }
  });
});

describe('party targeting', () => {
  it('fans enemy target specs out over every living opponent', () => {
    let s = game(3);
    s = passTo(s, 0);
    dummy(s, 1, 0, D2);
    const spec: TargetSpec = {
      kind: 'summon',
      label: 'an enemy',
      side: 'enemy',
      includeLeader: true,
    };
    const cands = targetCandidates(s, 0, spec);
    const key = (c: (typeof cands)[number]) => JSON.stringify(c);
    expect(cands.map(key)).toContain(JSON.stringify({ kind: 'summon', player: 1, slot: 0 }));
    expect(cands.map(key)).toContain(JSON.stringify({ kind: 'leader', player: 1 }));
    expect(cands.map(key)).toContain(JSON.stringify({ kind: 'leader', player: 2 }));
    expect(cands.map(key)).not.toContain(JSON.stringify({ kind: 'leader', player: 0 }));

    s.players[2].eliminated = true;
    const after = targetCandidates(s, 0, spec);
    expect(after.map(key)).not.toContain(JSON.stringify({ kind: 'leader', player: 2 }));
  });

  it('lets an attacker swing at any opponent, with leader exposure per side', () => {
    let s = game(3);
    s = passTo(s, 0);
    dummy(s, 0, 0);
    dummy(s, 1, 0, D2);
    const targets = legalAttackTargets(s, { kind: 'summon', player: 0, slot: 0 });
    const keys = targets.map((t) => JSON.stringify(t));
    expect(keys).toContain(JSON.stringify({ kind: 'summon', player: 1, slot: 0 }));
    // Player 2 fields nothing, so their leader stands open. Player 1's does not.
    expect(keys).toContain(JSON.stringify({ kind: 'leader', player: 2 }));
    expect(keys).not.toContain(JSON.stringify({ kind: 'leader', player: 1 }));
  });
});

describe('party spell windows', () => {
  function armed(): GameState {
    const s = game(3);
    give(s, 1, 'sx-lemonaid');
    s.players[1].supporters.push({ cardId: 's1-fluterat', sapped: false });
    give(s, 2, 'rx-siphon');
    s.players[2].supporters.push({ cardId: 'r1-slicebot', sapped: false });
    return s;
  }

  it('offers the window to each trap holder in turn order until one springs', () => {
    let s = armed();
    const idx = give(s, 0, 'sx-celebrate');
    s = must(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [] });
    expect(s.pending?.player).toBe(1);
    expect(s.pending?.queue).toEqual([2]);

    s = must(s, 1, { type: 'PASS_RESPONSE' });
    expect(s.pending?.player).toBe(2);
    expect(s.pending?.queue).toBeUndefined();

    const trapIdx = s.players[2].hand.indexOf('rx-siphon');
    s = must(s, 2, { type: 'CAST_TRAP', handIndex: trapIdx, targets: [] });
    expect(s.pending).toBeNull();
    // Wiretap counters: the spell reaches its caster's discard unresolved.
    expect(s.players[0].discard).toContain('sx-celebrate');
    expect(s.players[0].supporters).toHaveLength(0);
  });

  it('closes the whole queue when the first responder springs a trap', () => {
    let s = armed();
    const idx = give(s, 0, 'sx-celebrate');
    s = must(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [] });
    const trapIdx = s.players[1].hand.indexOf('sx-lemonaid');
    s = must(s, 1, { type: 'CAST_TRAP', handIndex: trapIdx, targets: [] });
    expect(s.pending).toBeNull();
    // Lemon Aid lets the spell through, so Celebrate still resolved.
    expect(s.players[0].supporters).toHaveLength(1);
    expect(s.players[2].hand).toContain('rx-siphon');
  });

  it('resolves the spell after every responder passes', () => {
    let s = armed();
    const idx = give(s, 0, 'sx-celebrate');
    s = must(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [] });
    s = must(s, 1, { type: 'PASS_RESPONSE' });
    s = must(s, 2, { type: 'PASS_RESPONSE' });
    expect(s.pending).toBeNull();
    expect(s.players[0].supporters).toHaveLength(1);
  });
});

describe('party enemy choice', () => {
  function fed(s: GameState, player: PlayerIdx): void {
    s.players[player].supporters.push(
      { cardId: 'f1-basicfish', sapped: false },
      { cardId: 'f1-basicfish', sapped: false },
    );
  }

  it('rejects an implicit-enemy spell until the actor names one, then hits them', () => {
    const s = game(3);
    fed(s, 0);
    const idx = give(s, 0, 'fx-error');
    const bare = applyAction(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [] });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error).toBe(NEEDS_ENEMY);

    const before1 = s.players[1].deck.length;
    const before2 = s.players[2].deck.length;
    const picked = must(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [], enemy: 2 });
    expect(picked.players[2].deck.length).toBe(before2 - 4);
    expect(picked.players[1].deck.length).toBe(before1);
  });

  it('rejects picks of yourself or an eliminated player', () => {
    const s = game(3);
    fed(s, 0);
    const idx = give(s, 0, 'fx-error');
    expect(applyAction(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [], enemy: 0 }).ok).toBe(
      false,
    );
    s.players[2].eliminated = true;
    expect(applyAction(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [], enemy: 2 }).ok).toBe(
      false,
    );
    // With one living opponent left there is nothing to ask any more.
    const one = must(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [] });
    expect(one.players[1].deck.length).toBe(s.players[1].deck.length - 4);
  });

  it('leaves nothing behind after a NEEDS_ENEMY rejection', () => {
    const s = game(3);
    fed(s, 0);
    const errIdx = give(s, 0, 'fx-error');
    const bare = applyAction(s, 0, { type: 'CAST_SPELL', handIndex: errIdx, targets: [] });
    expect(bare.ok).toBe(false);
    // The failed run raised the flag; a later effect that never reads the
    // enemy must not trip over it.
    const quiet = give(s, 0, 'sx-celebrate');
    expect(applyAction(s, 0, { type: 'CAST_SPELL', handIndex: quiet, targets: [] }).ok).toBe(true);
  });

  it('asks before the response windows and honors the stored pick after them', () => {
    const s = game(3);
    fed(s, 0);
    give(s, 1, 'sx-lemonaid');
    const idx = give(s, 0, 'fx-error');
    const bare = applyAction(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [] });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error).toBe(NEEDS_ENEMY);

    let t = must(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [], enemy: 2 });
    expect(t.pending?.player).toBe(1);
    expect(t.pending?.spell?.enemy).toBe(2);
    const before2 = t.players[2].deck.length;
    t = must(t, 1, { type: 'PASS_RESPONSE' });
    expect(t.players[2].deck.length).toBe(before2 - 4);
  });

  it('derives the enemy from the battle for reactive triggers', () => {
    const s = game(4);
    s.battle = {
      attacker: { kind: 'summon', player: 2, slot: 0 },
      defender: { kind: 'summon', player: 0, slot: 0 },
      trapUsed: false,
    };
    expect(defaultOpp(s, 0)).toBe(2);
    expect(defaultOpp(s, 2)).toBe(0);
    s.battle = null;
    expect(defaultOpp(s, 0)).toBe(1);
    expect(defaultOpp(s, 3)).toBe(0);
  });
});

describe('party elimination', () => {
  it('knocks a leaderless player out, sweeps their board and plays on', () => {
    let s = game(3);
    s = passTo(s, 0);
    dummy(s, 1, 0, D2);
    s.players[1].supporters.push({ cardId: 's1-fluterat', sapped: false });

    destroySummon(s, s.players[1].leader!);
    const p = s.players[1];
    expect(p.eliminated).toBe(true);
    expect(p.leader).toBeNull();
    expect(p.slots.every((x) => x === null)).toBe(true);
    expect(p.supporters).toHaveLength(0);
    expect(p.discard).toContain(LEADER);
    expect(p.discard).toContain(D2);
    expect(s.winner).toBeNull();
    expect(isOver(s)).toBe(false);

    // The last elimination ends the match the ordinary way.
    destroySummon(s, s.players[2].leader!);
    expect(s.winner).toBe(0);
    expect(s.winReason).toContain('lost their leader');
  });

  it('eliminates on the raised party debt limit with three still seated', () => {
    const s = game(3);
    addDebt(s, 1, DEBT_LIMIT, 'The bill lands.');
    // 25 debt loses a duel and survives a party game: the party limit is 30.
    expect(s.players[1].eliminated).toBeUndefined();
    addDebt(s, 1, PARTY_DEBT_LIMIT - DEBT_LIMIT, 'The rest lands.');
    expect(s.players[1].eliminated).toBe(true);
    expect(s.winner).toBeNull();
  });

  it('skips eliminated seats when the turn passes', () => {
    let s = game(3);
    s = must(s, 1, { type: 'CONCEDE' });
    expect(s.players[1].eliminated).toBe(true);
    expect(isOver(s)).toBe(false);
    s = must(s, 0, { type: 'END_TURN' });
    expect(s.active).toBe(2);
  });

  it('hands the turn along when the active player concedes', () => {
    let s = game(3);
    s = must(s, 0, { type: 'CONCEDE' });
    expect(s.players[0].eliminated).toBe(true);
    expect(s.active).toBe(1);
    expect(s.phase).toBe('main');
    expect(isOver(s)).toBe(false);
  });

  it('advances a spell window past a responder who is knocked out', () => {
    let s = game(3);
    give(s, 1, 'sx-lemonaid');
    give(s, 2, 'rx-siphon');
    const idx = give(s, 0, 'sx-celebrate');
    s = must(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [] });
    expect(s.pending?.player).toBe(1);
    s = must(s, 1, { type: 'CONCEDE' });
    // The window moved on to the next holder rather than dying with the seat.
    expect(s.players[1].eliminated).toBe(true);
    expect(s.pending?.player).toBe(2);
    s = must(s, 2, { type: 'PASS_RESPONSE' });
    expect(s.pending).toBeNull();
    expect(s.players[0].supporters).toHaveLength(1);
  });
});

describe('the bot reads the debt cap off the mode', () => {
  /** The debt at which the panic term starts, which is two short of the cap. */
  function cliffBites(seats: number, debt: number): boolean {
    const s = game(seats);
    s.players[0].debtCount = debt;
    const withDebt = evaluate(s, 0);
    // The same position with the panic term certainly off, so the difference is
    // the term rather than the flat per-debt charge either side of it.
    const q = game(seats);
    q.players[0].debtCount = debt;
    const flat = evaluate(q, 0, { ...defaultWeights, debtCliff: 0 });
    return Math.abs(withDebt - flat) > 1e-9;
  }

  it('puts the cap where the engine puts it', () => {
    expect(debtLimitOf(game(2))).toBe(DEBT_LIMIT);
    expect(debtLimitOf(game(3))).toBe(PARTY_DEBT_LIMIT);
  });

  it('panics two short of 25 in a duel and two short of 30 in a party', () => {
    expect(cliffBites(2, DEBT_LIMIT - 3), 'quiet at 22 of 25').toBe(false);
    expect(cliffBites(2, DEBT_LIMIT - 2), 'biting at 23 of 25').toBe(true);

    // The number that would be wrong if the bot carried the duel cap into a
    // party game: 23 is three short of nothing there.
    expect(cliffBites(3, DEBT_LIMIT - 2), 'quiet at 23 of 30').toBe(false);
    expect(cliffBites(3, PARTY_DEBT_LIMIT - 3), 'quiet at 27 of 30').toBe(false);
    expect(cliffBites(3, PARTY_DEBT_LIMIT - 2), 'biting at 28 of 30').toBe(true);
  });
});

describe('the bot in a party game', () => {
  it('plays three and four seats without offering an illegal action', () => {
    // The search was two-player throughout: it scored one opponent, measured
    // progress against one, and handed one seat a turn. Every part of that now
    // walks `livingOpponents`, and this is the guard that the walk is legal at
    // every seat count the engine seats.
    // Deliberately short. Each decision now plays out every other seat's turn,
    // so a party position costs roughly one rollout per opponent and a long run
    // here would be a benchmark rather than a guard.
    for (const seats of [3, 4]) {
      let s = game(seats);
      for (let step = 0; step < 24 && !isOver(s); step++) {
        const who = currentActor(s);
        const action = chooseAction(s, who);
        const res = applyAction(s, who, action);
        expect(res.ok, res.ok ? '' : `${seats} seats: ${action.type} rejected: ${res.error}`)
          .toBe(true);
        if (!res.ok) break;
        s = res.state;
      }
    }
  }, 300_000);
});
