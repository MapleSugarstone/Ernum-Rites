import { describe, expect, it } from 'vitest';
import '../src/cards';
import type { Action, SourceRef } from '../src/engine/actions';
import { applyAction, createGame, type DeckList } from '../src/engine/engine';
import { publicView, redactFor } from '../src/engine/redact';
import { digestShort } from '../src/engine/digest';
import { currentActor, type GameState } from '../src/engine/state';
import { timeoutAction } from '../src/engine/timeout';
import {
  CLOCK_SECONDS,
  asDisplayed,
  clockKindFor,
  fractionLeft,
  isCardPlay,
  isRoping,
  PLAY_BONUS_CARDS,
  PLAY_BONUS_SECONDS,
  PLAY_BONUS_FLOOR_MS,
  playBonusMs,
  ROPE_SECONDS,
  secondsLeft,
  enforcedMs,
  displayedMs,
  type Clock,
} from '../src/engine/timing';
import type { PlayerIdx } from '../src/engine/types';

const LEADER = 'x-hero-dummy-warden';
const D1 = 'x-r-dummy-1';
const D2 = 'x-p-dummy-2';

function deck(n = 48, id = D1): DeckList {
  return { name: 'T', leaderId: LEADER, cards: Array.from({ length: n }, () => id) };
}
function game(): GameState {
  return createGame([deck(), deck()], 4242, 0);
}
function must(s: GameState, actor: PlayerIdx, a: Action): GameState {
  const r = applyAction(s, actor, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}
function give(s: GameState, p: PlayerIdx, id: string): number {
  s.players[p].hand.push(id);
  return s.players[p].hand.length - 1;
}
const src = (player: PlayerIdx, slot: number): SourceRef => ({ kind: 'summon', player, slot });

function clock(kind: Clock['kind'], leftMs: number, now: number): Clock {
  const total = enforcedMs(kind);
  return { kind, player: 0, endsAt: now + leftMs, totalMs: total };
}

describe('clock arithmetic', () => {
  const now = 1_700_000_000_000;

  it('runs the room a little longer than the bar the player watches', () => {
    // A packet in flight must not cost somebody their turn.
    for (const kind of ['turn', 'response', 'mulligan'] as const) {
      expect(enforcedMs(kind)).toBeGreaterThan(displayedMs(kind));
    }
  });

  it('gives a turn more room than a response', () => {
    expect(CLOCK_SECONDS.turn).toBeGreaterThan(CLOCK_SECONDS.response);
    expect(CLOCK_SECONDS.response).toBeGreaterThan(ROPE_SECONDS);
  });

  it('reports the fraction left and never leaves the rails', () => {
    const c = clock('turn', 30_000, now);
    expect(fractionLeft(c, now)).toBeGreaterThan(0);
    expect(fractionLeft(c, now)).toBeLessThan(1);
    expect(fractionLeft(c, now + 999_999)).toBe(0);
    expect(fractionLeft(c, now - 999_999)).toBe(1);
  });

  it('counts whole seconds down to zero and stops', () => {
    const c = clock('response', 5_400, now);
    expect(secondsLeft(c, now)).toBe(6);
    expect(secondsLeft(c, now + 5_400)).toBe(0);
    expect(secondsLeft(c, now + 60_000)).toBe(0);
  });

  it('catches the rope only in the last stretch', () => {
    expect(isRoping(clock('turn', 40_000, now), now)).toBe(false);
    expect(isRoping(clock('turn', ROPE_SECONDS * 1000, now), now)).toBe(true);
  });

  it('shifts every reading by the measured clock skew', () => {
    const c = clock('turn', 20_000, now);
    // A client whose clock runs 5s behind the room must not think it has 5s more.
    expect(secondsLeft(c, now, 5_000)).toBe(secondsLeft(c, now + 5_000));
  });
});

describe('the time a card buys back', () => {
  it('hands the first play the full refund and fades to the flat second', () => {
    expect(playBonusMs(1)).toBe(PLAY_BONUS_SECONDS * 1000 + PLAY_BONUS_FLOOR_MS);
    expect(playBonusMs(PLAY_BONUS_CARDS)).toBeGreaterThan(PLAY_BONUS_FLOOR_MS);
    // The curve is spent, and every play still pays the flat second.
    expect(playBonusMs(PLAY_BONUS_CARDS + 1)).toBe(PLAY_BONUS_FLOOR_MS);
    expect(playBonusMs(PLAY_BONUS_CARDS + 20)).toBe(PLAY_BONUS_FLOOR_MS);
    expect(playBonusMs(0)).toBe(0);
  });

  it('never grows from one play to the next', () => {
    for (let n = 1; n < PLAY_BONUS_CARDS + 4; n++) {
      expect(playBonusMs(n + 1)).toBeLessThanOrEqual(playBonusMs(n));
    }
  });

  it('cannot be walked into a turn longer than a few of them', () => {
    // Every refund a single turn can earn, which stays well under a second turn.
    let total = 0;
    for (let n = 1; n <= PLAY_BONUS_CARDS; n++) total += playBonusMs(n);
    // The curve plus ten flat seconds still sits under one full turn.
    expect(total).toBeLessThan(CLOCK_SECONDS.turn * 1000);
  });

  it('counts cards leaving a hand and nothing else', () => {
    expect(isCardPlay('PLAY_SUMMON')).toBe(true);
    expect(isCardPlay('CAST_SPELL')).toBe(true);
    expect(isCardPlay('PLAY_SUPPORTER')).toBe(true);
    expect(isCardPlay('END_TURN')).toBe(false);
    expect(isCardPlay('DECLARE_ATTACK')).toBe(false);
    expect(isCardPlay('ACTIVATE_POWER')).toBe(false);
  });

  it('draws the bar against the length the room actually granted', () => {
    const now = 1_700_000_000_000;
    // An ordinary turn still reads as the printed window.
    const plain: Clock = {
      kind: 'turn',
      player: 0,
      endsAt: now + enforcedMs('turn'),
      totalMs: enforcedMs('turn'),
    };
    expect(asDisplayed(plain).totalMs).toBe(displayedMs('turn'));
    // A refunded one reads longer by exactly the refund, so the bar stays full
    // rather than emptying ahead of the clock.
    const bonus = playBonusMs(1);
    const extended: Clock = { ...plain, endsAt: plain.endsAt + bonus, totalMs: plain.totalMs + bonus };
    const shown = asDisplayed(extended);
    expect(shown.totalMs).toBe(displayedMs('turn') + bonus);
    expect(fractionLeft(shown, now)).toBe(1);
  });
});

describe('which clock a position is on', () => {
  it('gives the main phase the long one', () => {
    expect(clockKindFor(game())).toBe('turn');
  });

  it('gives anything queued in front of it the short one', () => {
    const base = game();
    expect(clockKindFor({ ...base, choiceQueue: [{}] as never })).toBe('response');
    expect(clockKindFor({ ...base, flipQueue: [{}] as never })).toBe('response');
    expect(clockKindFor({ ...base, replaceQueue: [{}] as never })).toBe('response');
    expect(clockKindFor({ ...base, pending: {} as never })).toBe('response');
  });
});

describe('what running out of time plays', () => {
  it('ends the turn when nothing is pending', () => {
    const s = game();
    expect(timeoutAction(s)).toEqual({ type: 'END_TURN' });
  });

  it('always picks something the engine will accept', () => {
    // Walk a real game and force the timeout move at every step. A timeout that
    // the engine rejects would hang the room, which is worse than a bad move.
    let s = game();
    for (let i = 0; i < 60 && s.winner === null; i++) {
      const actor = currentActor(s);
      const action = timeoutAction(s);
      expect(action, `no timeout move at turn ${s.turn}`).toBeTruthy();
      const res = applyAction(s, actor, action!);
      expect(res.ok, `timeout ${action!.type} refused: ${res.ok ? '' : res.error}`).toBe(true);
      if (!res.ok) break;
      s = res.state;
    }
  });

  it('declines a flip rather than spending the player mana they did not offer', () => {
    let s = game();
    s = must(s, 0, { type: 'PLAY_SUMMON', handIndex: give(s, 0, D2), slot: 0 });
    // Drive to a position with a flip waiting, if this seed produces one.
    for (let i = 0; i < 20 && s.flipQueue.length === 0 && s.winner === null; i++) {
      const actor = currentActor(s);
      const res = applyAction(s, actor, timeoutAction(s)!);
      if (!res.ok) break;
      s = res.state;
    }
    if (s.flipQueue.length > 0) {
      expect(timeoutAction(s)).toEqual({ type: 'DECLINE_FLIP' });
    }
  });
});

describe('the digest both clients check against', () => {
  it('is the same for both seats even though their views are not', () => {
    const s = game();
    const a = redactFor(s, 0);
    const b = redactFor(s, 1);
    // The views differ: each side sees its own hand.
    expect(digestShort(a)).not.toBe(digestShort(b));
    // The public projection does not, which is what makes it comparable.
    expect(digestShort(publicView(a))).toBe(digestShort(publicView(b)));
  });

  it('moves when the shared board moves', () => {
    let s = game();
    const before = digestShort(publicView(s));
    s = must(s, 0, { type: 'PLAY_SUMMON', handIndex: give(s, 0, D2), slot: 0 });
    expect(digestShort(publicView(s))).not.toBe(before);
  });

  it('hides both hands, both decks and every face-down card', () => {
    let s = game();
    s = must(s, 0, { type: 'PLAY_SUMMON', handIndex: give(s, 0, D2), slot: 0 });
    const pub = publicView(s);
    for (const p of pub.players) {
      expect(new Set(p.deck)).toEqual(new Set(p.deck.length ? ['hidden'] : []));
      expect(new Set(p.hand)).toEqual(new Set(p.hand.length ? ['hidden'] : []));
      for (const body of [...p.slots, p.leader]) {
        if (!body) continue;
        for (const h of body.hp) if (!h.flipped) expect(h.cardId).toBe('hidden');
      }
    }
  });
});

void src;
