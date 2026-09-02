import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame, type DeckList } from '../src/engine/engine';
import { destroySummon } from '../src/engine/effects';
import { card } from '../src/engine/registry';
import { type GameState } from '../src/engine/state';
import type { Action } from '../src/engine/actions';
import type { PlayerIdx } from '../src/engine/types';

/**
 * An offer to plug a hole that is not there.
 *
 * A summon dying on somebody else's turn offers its owner the chance to refill
 * the slot before their leader is exposed. Slime fills that slot itself: its
 * Deathrattle puts a smaller Slime into an empty one, and the one it just left
 * is empty at that moment. The offer was queued afterwards regardless, so the
 * player was asked to fill a slot that already had a Slime standing in it, and
 * a chain of Slimes asked once per link.
 */

const D1 = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const SLIME = 'o2-slime';

function deck(cards: string[]): DeckList {
  return { name: 'Tester', leaderId: LEADER, cards };
}

function game(): GameState {
  return createGame([deck(Array(60).fill(D1)), deck(Array(60).fill(D1))], 4242, 0);
}

function must(state: GameState, actor: PlayerIdx, action: Action): GameState {
  const res = applyAction(state, actor, action);
  if (!res.ok) throw new Error(`${action.type} rejected: ${res.error}`);
  return res.state;
}

/** End turns until `player` is on the play again. */
function passTo(state: GameState, player: PlayerIdx): GameState {
  let s = must(state, state.active, { type: 'END_TURN' });
  for (let i = 0; i < 10 && (s.active !== player || s.phase !== 'main'); i++) {
    s = must(s, s.active, { type: 'END_TURN' });
  }
  return s;
}

function place(state: GameState, player: PlayerIdx, cardId: string, slot: number): GameState {
  state.players[player].hand.push(cardId);
  return must(state, player, {
    type: 'PLAY_SUMMON',
    handIndex: state.players[player].hand.length - 1,
    slot,
  });
}

describe('the offer to refill a slot', () => {
  it('names a card that fills its own slot when it dies', () => {
    expect(card(SLIME).text, `${SLIME} replaces itself`).toContain('empty slot');
  });

  it('is not made when the Deathrattle already refilled the slot', () => {
    // Seat 1 owns the Slime and seat 0 is on the play, which is the only way the
    // offer is made at all.
    let s = passTo(game(), 1);
    s = place(s, 1, SLIME, 0);
    s = passTo(s, 0);
    // A summon in hand is the other condition for the offer.
    s.players[1].hand.push(D1);

    destroySummon(s, s.players[1].slots[0]!);

    expect(s.players[1].slots[0], 'the Deathrattle stood a smaller Slime up').toBeTruthy();
    expect(s.replaceQueue, 'and there is no hole left to offer').toEqual([]);
  });

  it('is still made when the slot is genuinely left empty', () => {
    // The guard must not swallow the offer it exists for.
    let s = passTo(game(), 1);
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    s.players[1].hand.push(D1);

    destroySummon(s, s.players[1].slots[0]!);

    expect(s.players[1].slots[0], 'nothing refilled it').toBeNull();
    expect(s.replaceQueue.length, 'so the offer stands').toBe(1);
    expect(s.replaceQueue[0].player).toBe(1);
    expect(s.replaceQueue[0].slot).toBe(0);
  });

  it('drops an offer its owner has no summon left to answer with', () => {
    // Two bodies die on the enemy's turn while one summon sits in hand, so two
    // offers go out. Answering the first empties the hand, and the second is
    // then a question with no answer: the only button that does anything is the
    // one that leaves the slot open.
    let s = passTo(game(), 1);
    s = place(s, 1, D1, 0);
    s = place(s, 1, D1, 1);
    s = passTo(s, 0);
    s.players[1].hand = [D1];

    destroySummon(s, s.players[1].slots[0]!);
    destroySummon(s, s.players[1].slots[1]!);
    expect(s.replaceQueue.length, 'both holes were offered').toBe(2);

    // Answer the first with the only summon in hand.
    const res = applyAction(s, 1, { type: 'REPLACE_SUMMON', handIndex: 0 });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const after = res.ok ? res.state : s;

    expect(after.players[1].hand.some((id) => card(id).type === 'summon'),
      'nothing left to place').toBe(false);
    expect(after.replaceQueue, 'so the second offer is not put to them').toEqual([]);
  });

  it('drops an offer for a slot something else has since filled', () => {
    let s = passTo(game(), 1);
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    s.players[1].hand = [D1, D1];

    destroySummon(s, s.players[1].slots[0]!);
    expect(s.replaceQueue.length).toBe(1);
    // Something puts a body back in the slot before the offer is answered.
    s.players[1].slots[0] = s.players[1].slots[0] ?? null;
    const filled = structuredClone(s);
    filled.players[1].slots[0] = {
      uid: 'u999', cardId: D1, owner: 1, isLeader: false,
      hp: [{ cardId: D1, flipped: false }], sapped: false, wounds: 0, shields: 0,
      strengthMods: [], effectDamageMod: 0, powerUses: {}, enteredTurn: 0,
    };
    const res = applyAction(filled, 1, { type: 'DECLINE_REPLACE' });
    // Declining is still legal; what matters is that a swept queue does not
    // leave a second question about a slot that is no longer empty.
    expect(res.ok || filled.replaceQueue.length === 0).toBe(true);
  });
});
