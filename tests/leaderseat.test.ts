import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame, type DeckList } from '../src/engine/engine';
import { effectDamageOf, effectiveStrength, putSummonDirect } from '../src/engine/effects';
import { card } from '../src/engine/registry';
import type { GameState } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';

/**
 * Printed text has to mean the same thing from the leader seat.
 *
 * Any summon with HP can be chosen to lead, and a leader is a body like any other. It
 * sits in its own seat rather than in the three slots, though, so a card that reads the
 * board by walking slots alone quietly changes what it does when it leads.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const P1 = 'rh-player1';
/** Something to stand beside it, so "no other summons" can be made false. */
const OTHER = 'n1-Wallguy';

function deck(leaderId = LEADER): DeckList {
  return { name: 'Tester', leaderId, cards: Array.from({ length: 60 }, () => FILLER) };
}

/** Both leaders out, seat 0 to act on a turn it may attack. */
function board(leaderId = LEADER, foeLeaderId = LEADER): GameState {
  let s = createGame([deck(leaderId), deck(foeLeaderId)], 4, 1);
  for (let i = 0; i < 3; i++) {
    const r = applyAction(s, s.active, { type: 'END_TURN' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

/** Play Player One into slot 0 with the mana to do it, or say why not. */
function play(s: GameState, slot: number): GameState {
  s.players[0].hand[0] = P1;
  for (const k of Object.keys(s.players[0].mana)) {
    (s.players[0].mana as Record<string, number>)[k] = 9;
  }
  const r = applyAction(s, 0 as PlayerIdx, { type: 'PLAY_SUMMON', handIndex: 0, slot });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const printed = card(P1).strength ?? 0;

/** Whether the battlecry paid out, read off the body rather than off the log. */
function buffed(s: GameState, body: NonNullable<GameState['players'][0]['leader']>): boolean {
  return body.shields === 1 && effectiveStrength(s, body) === printed + 4;
}

describe('Player One counting the summons you control', () => {
  it('pays out in a slot on an empty board', () => {
    const after = play(board(), 0);
    expect(buffed(after, after.players[0].slots[0]!), 'a Power Shield and +4').toBe(true);
  });

  it('stays quiet in a slot beside another summon', () => {
    const s = board();
    putSummonDirect(s, 0, OTHER, 1, { strength: 0, color: 'O', hp: 3 });
    const after = play(s, 0);
    expect(buffed(after, after.players[0].slots[0]!), 'it is not alone').toBe(false);
  });

  it('pays out from the leader seat, where the slots are empty', () => {
    const s = board(P1);
    const lead = s.players[0].leader!;
    expect(lead.cardId, 'it leads').toBe(P1);
    expect(s.players[0].slots.every((x) => x === null), 'and controls nothing else').toBe(true);
    expect(buffed(s, lead), 'the same board, so the same battlecry').toBe(true);
  });

  it('does not count its own seat as another summon', () => {
    // The leader is always on the board. Counting it would make "no other
    // summons" a condition nobody could ever meet, from either seat.
    const s = board(P1);
    expect(s.players[0].leader!.shields).toBe(1);
  });
});

/**
 * Screener counts every ally Machine, the one in the leader seat included.
 *
 * Its caller was already leader-aware: effectDamageOf runs the hook for the leader
 * as well as for slot bodies. The card's own loop was what dropped it.
 */
describe('Screener totalling ally Machines', () => {
  const SCREENER = 'm-bgr-screener';
  /** A Machine with no text of its own, so nothing else moves the count. */
  const MACHINE = 'm-bg-robotfish';
  const PLAIN = 'x-hero-dummy-warden';

  /** Leaves `left` HP face down on a body, without firing anything. */
  function wearDown(s: GameState, ref: { player: PlayerIdx }, left: number): void {
    const body = s.players[ref.player].leader!;
    for (let i = 0; i < body.hp.length - left; i++) body.hp[i].flipped = true;
  }

  it('counts an ally Machine leader down to its last HP card', () => {
    const s = board(MACHINE);
    putSummonDirect(s, 0, SCREENER, 0, { strength: 3, color: 'R', hp: 5, asPrinted: true });
    wearDown(s, { player: 0 as PlayerIdx }, 1);
    expect(effectDamageOf(s, 0 as PlayerIdx), 'the leader is an ally Machine').toBe(1);
  });

  it('leaves it out while it still has HP to spare', () => {
    const s = board(MACHINE);
    putSummonDirect(s, 0, SCREENER, 0, { strength: 3, color: 'R', hp: 5, asPrinted: true });
    wearDown(s, { player: 0 as PlayerIdx }, 2);
    expect(effectDamageOf(s, 0 as PlayerIdx), 'not on its last card').toBe(0);
  });

  it('leaves out a leader that is not a Machine', () => {
    const s = board(PLAIN);
    putSummonDirect(s, 0, SCREENER, 0, { strength: 3, color: 'R', hp: 5, asPrinted: true });
    wearDown(s, { player: 0 as PlayerIdx }, 1);
    expect(effectDamageOf(s, 0 as PlayerIdx), 'wrong faction').toBe(0);
  });

  it('still counts an ally Machine standing in a slot', () => {
    const s = board(PLAIN);
    putSummonDirect(s, 0, SCREENER, 0, { strength: 3, color: 'R', hp: 5, asPrinted: true });
    putSummonDirect(s, 0, MACHINE, 1, { strength: 2, color: 'F', hp: 1 });
    expect(effectDamageOf(s, 0 as PlayerIdx)).toBe(1);
  });
});

/**
 * Nommer mutes the flips of anything it hits, leaders included.
 *
 * resolveClash used to compute the muting as `!defender.isLeader && muffleFlips`,
 * so both halves of the card switched off against the one target whose flipped HP
 * cards matter most.
 */
describe('Nommer swinging at a leader', () => {
  const NOMMER = 'r2-nommer';
  /** A free flip with a visible result: the body wearing it gains 2 attack. */
  const FLIPPER = 'f1-swordfish';

  function facing(defenderLeader: string): GameState {
    const s = board(LEADER, defenderLeader);
    // Nommer with room to be healed, three of its own cards already spent.
    putSummonDirect(s, 0, NOMMER, 0, { strength: 3, color: 'R', hp: 6, asPrinted: true });
    for (let i = 0; i < 3; i++) s.players[0].slots[0]!.hp[i].flipped = true;
    const foe = s.players[1].leader!;
    for (const h of foe.hp) h.cardId = FLIPPER;
    return s;
  }

  it('mutes a leader\u2019s flips and heals for each one', () => {
    const s = facing(LEADER);
    const foe = s.players[1].leader!;
    const before = effectiveStrength(s, foe);
    const spentBefore = s.players[0].slots[0]!.hp.filter((h) => h.flipped).length;
    const r = applyAction(s, 0 as PlayerIdx, {
      type: 'DECLARE_ATTACK',
      source: { kind: 'summon', player: 0, slot: 0 },
      target: { kind: 'leader', player: 1 },
    });
    if (!r.ok) throw new Error(r.error);
    const after = r.state.players[1].leader!;
    expect(effectiveStrength(r.state, after), 'no Swordfish fired').toBe(before);
    const spentAfter = r.state.players[0].slots[0]!.hp.filter((h) => h.flipped).length;
    expect(spentBefore - spentAfter, 'one HP back for each muted flip').toBeGreaterThan(0);
  });
});
