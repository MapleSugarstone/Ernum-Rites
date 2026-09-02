import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame, targetCandidates, type DeckList } from '../src/engine/engine';
import type { ApplyResult } from '../src/engine/actions';
import { dealDamage, putSummonDirect, summonRefsOf } from '../src/engine/effects';
import { card } from '../src/engine/registry';
import { currentActor, remainingHp, type GameState } from '../src/engine/state';
import type { PlayerIdx, TargetSpec } from '../src/engine/types';

/**
 * Kapigras asks which leader to become.
 *
 * The seat is what it copies, not the body: a leader takes the field at the
 * start of its controller's first turn, so in a party game most of the seats it
 * is choosing between are still empty when it asks. With one enemy there is
 * nothing to decide and the copy happens on the spot, which is what keeps a
 * two-player game byte-identical to the engine that never seats more.
 */

const FILLER = 'x-r-dummy-1';
const KAPI = 'o1-Kapigras';
/** Distinct printed HP, so the copy is named by the stack it arrives with. */
const FOES = ['p3-heavenknows', 's3-aetusvox', 'r3-infinitemind'];

function deck(leaderId: string): DeckList {
  return { name: leaderId, leaderId, cards: Array.from({ length: 60 }, () => FILLER) };
}

/** Kapigras on seat 0, then `n - 1` enemies, opened by `start`. */
function game(n: number, start: PlayerIdx = 0): GameState {
  const seats = [deck(KAPI), ...FOES.slice(0, n - 1).map(deck)];
  return createGame(seats, 12345, start);
}

/** Ends turns until seat 0 has begun one, which is when its leader enters. */
function toKapigrasTurn(state: GameState): GameState {
  let g = state;
  for (let i = 0; i < 12 && !g.players[0].leaderPlayed; i++) {
    const r = applyAction(g, g.active, { type: 'END_TURN' });
    if (!r.ok) break;
    g = r.state;
  }
  return g;
}

/** The state an action produced, failing the test with the engine's own words. */
function took(r: ApplyResult): GameState {
  expect(r.ok, r.ok ? '' : r.error).toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const SPELL = 'rx-plugzap';
/** Any summon or leader, which is the widest a printed spell reaches. */
const CHARACTER: TargetSpec = { kind: 'summon', side: 'any', includeLeader: true, label: 'a character' };

const leaderOf = (g: GameState) => card(g.players[0].leader!.cardId).name;
const seatsOffered = (g: GameState) =>
  (g.choiceQueue[0]?.refs ?? []).map((r) => ('player' in r ? r.player : -1));

describe('Kapigras picks the leader it copies', () => {
  it('asks nothing with one enemy and reforms on the spot', () => {
    const g = game(2);
    expect(g.choiceQueue, 'nothing to decide between').toHaveLength(0);
    expect(leaderOf(g)).toBe('Heaven Knows');
  });

  it('offers every enemy seat in a party game', () => {
    const g = game(3);
    expect(g.choiceQueue[0]?.effect).toBe('kapigras');
    expect(seatsOffered(g), 'both enemies, neither of them itself').toEqual([1, 2]);
    expect(currentActor(g), 'the game waits on the seat choosing').toBe(0);
  });

  it('copies a leader that has not taken the field yet', () => {
    // Seat 0 opens, so seats 1 and 2 are empty cells when the question is asked.
    const g = game(3);
    expect(g.players[1].leader, 'seat 1 has no body to copy').toBeNull();
    expect(leaderOf(took(applyAction(g, 0, {
      type: 'RESOLVE_CHOICE',
      pick: { kind: 'leader', player: 1 },
    })))).toBe('Heaven Knows');
  });

  it('copies whichever seat was named, not the nearest one', () => {
    const g = game(3);
    expect(leaderOf(took(applyAction(g, 0, {
      type: 'RESOLVE_CHOICE',
      pick: { kind: 'leader', player: 2 },
    })))).toBe('Aetus Vox');
  });

  it('arrives with the HP of the leader it became', () => {
    const g = game(4);
    const after = took(applyAction(g, 0, {
      type: 'RESOLVE_CHOICE',
      pick: { kind: 'leader', player: 3 },
    }));
    const body = after.players[0].leader!;
    // Printed HP doubled plus two, which Kapigras's own 1 HP never reaches.
    expect(remainingHp(body)).toBe((card('r3-infinitemind').hp ?? 0) * 2 + 2);
  });

  it('leaves out a seat that is already out of the game', () => {
    const g = game(4, 1);
    g.players[2].eliminated = true;
    const started = toKapigrasTurn(g);
    expect(seatsOffered(started), 'the dead seat is not on offer').toEqual([1, 3]);
  });

  it('refuses a seat it never offered', () => {
    const g = game(3);
    const r = applyAction(g, 0, { type: 'RESOLVE_CHOICE', pick: { kind: 'leader', player: 0 } });
    expect(r.ok).toBe(false);
  });

  it('will not be answered with no pick while a seat is still on offer', () => {
    // A leader that has not entered is a seat worth pointing at rather than a
    // body that is gone, so the engine holds out for an answer. The client
    // reads the same rule, which is what keeps the Skip button off this prompt.
    const g = game(3);
    const r = applyAction(g, 0, { type: 'RESOLVE_CHOICE' });
    expect(r.ok).toBe(false);
    expect(g.choiceQueue, 'still waiting').toHaveLength(1);
  });

  it('does nothing at all when it is played as a body', () => {
    const g = game(3);
    const s = took(applyAction(g, 0, {
      type: 'RESOLVE_CHOICE',
      pick: { kind: 'leader', player: 1 },
    }));
    putSummonDirect(s, 0, KAPI, 0, { strength: 1, color: 'O', hp: 1, asPrinted: true });
    expect(s.players[0].slots[0]!.cardId, 'still itself in a slot').toBe(KAPI);
    expect(s.choiceQueue, 'and it asked nobody anything').toHaveLength(0);
  });
});

/**
 * The seat-rather-than-body rule is Kapigras's alone.
 *
 * Offering an empty leader cell as a pick had to relax what the engine calls a
 * live ref, and that check is shared by every board choice. Nothing else builds
 * a ref for a leader that has not entered, and targeting never did, so the
 * relaxation reaches exactly one card.
 */
describe('an empty leader seat is still not a target', () => {
  it('is not offered to a spell that reaches any character', () => {
    const g = took(applyAction(game(3), 0, {
      type: 'RESOLVE_CHOICE',
      pick: { kind: 'leader', player: 2 },
    }));
    const seats = targetCandidates(g, 0, CHARACTER, card(SPELL)).map((r) =>
      'player' in r ? `${r.kind}:${r.player}` : r.kind,
    );
    expect(g.players[1].leader, 'seat 1 has not taken the field').toBeNull();
    expect(seats, 'only the leader that is actually standing').toEqual(['leader:0']);
  });

  it('is refused when a spell names it anyway', () => {
    // Kapigras's own question is answered first, or the cast is refused for
    // that instead. Seat 1 is still an empty cell afterwards.
    const g = took(applyAction(game(3), 0, {
      type: 'RESOLVE_CHOICE',
      pick: { kind: 'leader', player: 2 },
    }));
    expect(g.players[1].leader).toBeNull();
    g.players[0].hand[0] = SPELL;
    const r = applyAction(g, 0, {
      type: 'CAST_SPELL',
      handIndex: 0,
      targets: [{ kind: 'leader', player: 1 }],
    });
    expect(r.ok).toBe(false);
    // Targets are checked before mana, so this is the target talking.
    expect(r.ok ? '' : r.error).toContain('Illegal target');
  });

  it('takes no damage from an effect that aims at it directly', () => {
    // Nothing stops a card reading "deal 2 to the enemy leader" from firing
    // before that leader arrives, and it has to land on nothing rather than
    // banking the blow for later.
    const g = game(3);
    expect(dealDamage(g, { kind: 'leader', player: 2 }, 2), 'no body to damage').toBe(0);
    const started = toKapigrasTurn(g);
    expect(started.players[2].leader).toBeNull();
  });

  it('is not offered by the helper every other board choice is built from', () => {
    const g = game(3);
    const refs = summonRefsOf(g, 1, true).map((r) => r.kind);
    expect(refs, 'no slots filled and no leader standing').toEqual([]);
  });
});
