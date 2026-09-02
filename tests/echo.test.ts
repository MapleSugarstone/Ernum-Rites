import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame } from '../src/engine/engine';
import { card } from '../src/engine/registry';
import type { Action } from '../src/engine/actions';
import type { GameState, SummonInstance } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';

/**
 * An echo that points at what it consumed.
 *
 * Scoobert Singularity casts your spells twice, and the second cast used the
 * same target refs as the first. Recompiler fuses two summons off the board, so
 * its echo found both slots empty and did nothing at all.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const ECHOER = 'r3-scoobertsingularity';
const FUSER = 'm-rg-recompiler';

function body(s: GameState, cardId: string, owner: PlayerIdx, hp: number, isLeader = false): SummonInstance {
  return {
    uid: `u${s.nextUid++}`, cardId, owner, isLeader,
    hp: Array.from({ length: hp }, () => ({ cardId: FILLER, flipped: false })),
    sapped: false, wounds: 0, shields: 0, strengthMods: [], effectDamageMod: 0,
    powerUses: {}, enteredTurn: 0,
  };
}

function board(): GameState {
  const s = createGame(
    [
      { name: 'A', leaderId: LEADER, cards: Array(40).fill(FILLER) },
      { name: 'B', leaderId: LEADER, cards: Array(40).fill(FILLER) },
    ],
    3,
    0,
  );
  for (const p of s.players) {
    p.hand = []; p.slots = [null, null, null]; p.supporters = []; p.debt = []; p.debtCount = 0;
    p.mana = { P: 0, O: 0, R: 0, F: 0, S: 0, C: 0 };
    p.turnsTaken = 5; p.supportersLeft = 0; p.leaderPlayed = true;
  }
  s.turn = 6; s.phase = 'main'; s.active = 0; s.drawn = false;
  s.pending = null; s.choiceQueue = []; s.flipQueue = []; s.replaceQueue = [];
  s.players[0].leader = body(s, LEADER, 0, 10, true);
  s.players[1].leader = body(s, LEADER, 1, 10, true);
  return s;
}

describe('a spell echoed onto what it consumed', () => {
  it('names the cards the case is built from', () => {
    expect(card(ECHOER).spellEcho, `${ECHOER} echoes spells`).toBe(true);
    expect(card(FUSER).targets?.length, `${FUSER} takes two summons`).toBe(2);
  });

  it('fuses a second pair when a second pair is standing', () => {
    const s = board();
    const me = s.players[0];
    me.slots[0] = body(s, ECHOER, 0, 4);
    me.mana.P = 4; me.mana.R = 4;
    // Four enemy bodies: two for the cast, two left for the echo.
    for (let i = 0; i < 3; i++) s.players[1].slots[i] = body(s, FILLER, 1, 2);
    me.slots[1] = body(s, FILLER, 0, 2);
    me.hand = [FUSER];

    const cast: Action = {
      type: 'CAST_SPELL',
      handIndex: 0,
      targets: [
        { kind: 'summon', player: 1, slot: 0 },
        { kind: 'summon', player: 1, slot: 1 },
      ],
    };
    const res = applyAction(s, 0, cast);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const after = res.ok ? res.state : s;

    // One Recomp for the cast and one for the echo, rather than one and a fizzle.
    const recomps = after.players[0].hand.filter((id: string) => id.startsWith('gen-fuse-')).length;
    expect(recomps, 'the echo fused a second pair').toBe(2);
  });

  it('does nothing when the board cannot supply a second pair', () => {
    // Only the echoer is left standing after the first fusion, and one body is
    // not a pair. The echo re-aims what it can and otherwise fizzles, which is
    // what it did before this in every case.
    const s = board();
    const me = s.players[0];
    me.slots[0] = body(s, ECHOER, 0, 4);
    me.mana.P = 4; me.mana.R = 4;
    s.players[1].slots[0] = body(s, FILLER, 1, 2);
    s.players[1].slots[1] = body(s, FILLER, 1, 2);
    me.hand = [FUSER];

    const res = applyAction(s, 0, {
      type: 'CAST_SPELL',
      handIndex: 0,
      targets: [
        { kind: 'summon', player: 1, slot: 0 },
        { kind: 'summon', player: 1, slot: 1 },
      ],
    });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const after = res.ok ? res.state : s;
    const recomps = after.players[0].hand.filter((id: string) => id.startsWith('gen-fuse-')).length;
    expect(recomps, 'no second pair, no second fusion').toBe(1);
  });
});

describe('an echoed spell that destroys what it points at', () => {
  it('annihilates a second body rather than the same empty slot', () => {
    // The general case the fusion above is one instance of: any target spec is
    // re-run, so the echo picks a fresh legal body and the filter on that spec
    // still applies.
    const s = board();
    const me = s.players[0];
    me.slots[0] = body(s, ECHOER, 0, 4);
    me.mana.P = 4; me.mana.O = 4;
    s.players[1].slots[0] = body(s, FILLER, 1, 2);
    s.players[1].slots[1] = body(s, FILLER, 1, 2);
    me.hand = ['m-rp-annihilate'];

    const res = applyAction(s, 0, {
      type: 'CAST_SPELL',
      handIndex: 0,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const after = res.ok ? res.state : s;
    const left = after.players[1].slots.filter(Boolean).length;
    expect(left, 'both enemy bodies went').toBe(0);
  });

  it('honours the spec filter when it re-aims', () => {
    // Baited only destroys a sapped summon. The echo must not reach a body the
    // spell was never allowed to touch, so an unsapped one survives it.
    const s = board();
    const me = s.players[0];
    me.slots[0] = body(s, ECHOER, 0, 4);
    me.mana.F = 4; me.mana.C = 4;
    const sapped = body(s, FILLER, 1, 2);
    sapped.sapped = true;
    s.players[1].slots[0] = sapped;
    s.players[1].slots[1] = body(s, FILLER, 1, 2);
    me.hand = ['fx-catch'];

    const res = applyAction(s, 0, {
      type: 'CAST_SPELL',
      handIndex: 0,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const after = res.ok ? res.state : s;
    expect(after.players[1].slots[1], 'the unsapped body was never legal').toBeTruthy();
  });
});
