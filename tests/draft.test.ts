import { describe, expect, it } from 'vitest';
import '../src/cards';
import { DECK_SIZE } from '../src/engine/decklist';
import {
  DRAFT_SECONDS,
  PACK_COUNT,
  PACK_SIZE,
  autofill,
  draftDeckLegal,
  draftProblems,
  packPools,
  rollPack,
  rollPacks,
  withinPool,
} from '../src/engine/draft';
import { canBeLeader, colorsOf, deckIdentity } from '../src/engine/identity';
import { allCards, card } from '../src/engine/registry';
import { COPY_LIMIT } from '../src/engine/types';
import { connectionLost } from '../src/net/client';
import {
  AWAY_GRACE_SECONDS,
  CLOCK_SECONDS,
  MIN_TURN_SECONDS,
  NETWORK_GRACE_SECONDS,
  SKIP_PENALTY_SECONDS,
  enforcedTurnMs,
  turnSecondsFor,
} from '../src/engine/timing';
import { windowOverflow } from '../src/ui/draft';
import { draftFor, isPartyName, roomName, seatCountFor, timersOffFor } from '../worker/roomname';

const UUID = '11111111-2222-3333-4444-555555555555';

/** A pool built by hand, so a test says what is in it rather than hoping. */
function pool(...ids: string[]): string[] {
  return ids;
}

describe('the pack pools', () => {
  it('holds every collectible card and nothing else', () => {
    const pools = packPools();
    const inPools = new Set([...pools.C, ...pools.R, ...pools.E, ...pools.L]);
    const collectible = allCards().filter((d) => d.art && !d.uncollectible);
    expect(inPools.size).toBe(collectible.length);
    for (const def of collectible) expect(inPools.has(def.id)).toBe(true);
  });

  it('deals Ernum out of the Legendary pool, since Prismatic has no pool of its own', () => {
    const pools = packPools();
    expect(pools.L).toContain('m-ernum');
    expect(card('m-ernum').rarity).toBe('P');
    // Nothing else in the set is Prismatic, so nothing else needed rehousing.
    const prismatics = allCards().filter((d) => d.art && !d.uncollectible && d.rarity === 'P');
    expect(prismatics.map((d) => d.id)).toEqual(['m-ernum']);
  });

  it('is ordered the same way every time, so a seed reproduces a pack', () => {
    expect(packPools().C).toStrictEqual([...packPools().C].sort());
    expect(rollPacks({ state: 99 })).toStrictEqual(rollPacks({ state: 99 }));
    expect(rollPacks({ state: 99 })).not.toStrictEqual(rollPacks({ state: 100 }));
  });
});

describe('rolling packs', () => {
  it('deals ten packs of ten', () => {
    const packs = rollPacks({ state: 7 });
    expect(packs).toHaveLength(PACK_COUNT);
    for (const p of packs) expect(p).toHaveLength(PACK_SIZE);
    expect(packs.flat()).toHaveLength(PACK_COUNT * PACK_SIZE);
  });

  it('prints the odds it advertises', () => {
    const rng = { state: 4242 };
    const tally: Record<string, number> = { C: 0, R: 0, E: 0, L: 0, P: 0 };
    const rolls = 40_000;
    for (let i = 0; i < rolls / PACK_SIZE; i++) {
      for (const id of rollPack(rng)) tally[card(id).rarity ?? 'C']++;
    }
    // Prismatic comes out of the Legendary draw, so the two are counted together
    // against the 5% the table promises.
    const legendary = (tally.L + tally.P) / rolls;
    expect(legendary).toBeGreaterThan(0.04);
    expect(legendary).toBeLessThan(0.06);
    expect(tally.E / rolls).toBeGreaterThan(0.09);
    expect(tally.E / rolls).toBeLessThan(0.11);
    expect(tally.R / rolls).toBeGreaterThan(0.185);
    expect(tally.R / rolls).toBeLessThan(0.215);
    expect(tally.C / rolls).toBeGreaterThan(0.63);
    expect(tally.C / rolls).toBeLessThan(0.67);
  });

  it('reaches Ernum, which is the rarest thing a pack can print', () => {
    const rng = { state: 1 };
    let seen = false;
    for (let i = 0; i < 4000 && !seen; i++) seen = rollPack(rng).includes('m-ernum');
    expect(seen).toBe(true);
  });
});

describe('what a drafted deck may hold', () => {
  const leader = 'f1-basicfish';

  it('takes a deck cut from the pool', () => {
    const cards = Array.from({ length: DECK_SIZE }, () => 'f1-octopi');
    const p = pool(leader, ...cards);
    expect(draftProblems(leader, cards, p)).toStrictEqual([]);
    expect(draftDeckLegal(leader, cards, p)).toBe(true);
  });

  it('lifts the copy limit, since the pool is the limit now', () => {
    const cards = Array.from({ length: DECK_SIZE }, () => 'f1-octopi');
    expect(cards.length).toBeGreaterThan(COPY_LIMIT);
    expect(draftProblems(leader, cards, pool(leader, ...cards))).toStrictEqual([]);
  });

  it('lifts colour identity, so a card outside the leader takes a slot anyway', () => {
    const offColour = allCards().find(
      (d) =>
        d.art &&
        !d.uncollectible &&
        colorsOf(d).length > 0 &&
        !colorsOf(d).every((c) => deckIdentity(leader).includes(c)),
    );
    expect(offColour).toBeTruthy();
    const cards = Array.from({ length: DECK_SIZE }, () => offColour!.id);
    expect(draftProblems(leader, cards, pool(leader, ...cards))).toStrictEqual([]);
  });

  it('refuses a copy the player never opened', () => {
    const cards = Array.from({ length: DECK_SIZE }, () => 'f1-octopi');
    // One short: the pool holds 47 octopi and the deck wants 48.
    const short = pool(leader, ...cards.slice(1));
    expect(draftProblems(leader, cards, short)).toContain(
      `More copies than you opened: ${card('f1-octopi').name}.`,
    );
  });

  it('charges the leader a copy of its own, because it came out of a pack', () => {
    const cards = Array.from({ length: DECK_SIZE }, () => leader);
    // 48 in the deck plus the one standing up is 49, and the pool holds 48.
    expect(draftDeckLegal(leader, cards, pool(...cards))).toBe(false);
    expect(draftDeckLegal(leader, cards, pool(leader, ...cards))).toBe(true);
  });

  it('wants a leader, and one that can be one', () => {
    const cards = Array.from({ length: DECK_SIZE }, () => 'f1-octopi');
    const p = pool(leader, ...cards, 'f-riptide');
    expect(draftProblems(null, cards, p)[0]).toBe(
      'Pick a leader: press lead under any summon in your pool.',
    );
    expect(canBeLeader('f-riptide')).toBe(false);
    expect(draftProblems('f-riptide', cards, p)).toContain('That card cannot be a leader.');
  });

  it('wants exactly a full deck', () => {
    const cards = Array.from({ length: DECK_SIZE - 1 }, () => 'f1-octopi');
    expect(draftProblems(leader, cards, pool(leader, ...cards))).toContain(
      `${DECK_SIZE - 1}/${DECK_SIZE} cards.`,
    );
  });
});

describe('a part-built deck on its way up to the room', () => {
  const leader = 'f1-basicfish';

  it('is allowed to be unfinished but never to hold what was not opened', () => {
    const p = pool(leader, 'f1-octopi', 'f1-octopi');
    expect(withinPool(leader, ['f1-octopi'], p)).toBe(true);
    expect(withinPool('', [], p)).toBe(true);
    expect(withinPool(leader, ['f1-octopi', 'f1-octopi', 'f1-octopi'], p)).toBe(false);
    expect(withinPool(leader, ['f1-seabunny'], p)).toBe(false);
  });

  it('refuses a leader the pool never held', () => {
    expect(withinPool('f1-seabunny', [], pool('f1-octopi'))).toBe(false);
  });

  it('refuses more cards than a deck holds', () => {
    const many = Array.from({ length: DECK_SIZE + 1 }, () => 'f1-octopi');
    expect(withinPool(leader, many, pool(leader, ...many))).toBe(false);
  });
});

describe('finishing a deck the clock ran out on', () => {
  it('keeps every card already chosen and tops the rest up from the pool', () => {
    const packs = rollPacks({ state: 31 });
    const p = packs.flat();
    const leader = p.find((id) => canBeLeader(id))!;
    const started = p.filter((id) => id !== leader).slice(0, 20);
    const filled = autofill({ state: 5 }, p, leader, started);
    expect(filled.leaderId).toBe(leader);
    expect(filled.cards.slice(0, 20)).toStrictEqual(started);
    expect(filled.cards).toHaveLength(DECK_SIZE);
    expect(draftDeckLegal(filled.leaderId, filled.cards, p)).toBe(true);
  });

  it('stands a summon up when nobody picked a leader', () => {
    const p = rollPacks({ state: 88 }).flat();
    const filled = autofill({ state: 9 }, p, '', []);
    expect(canBeLeader(filled.leaderId)).toBe(true);
    expect(p).toContain(filled.leaderId);
    expect(draftDeckLegal(filled.leaderId, filled.cards, p)).toBe(true);
  });

  it('leaves a deck that was already finished exactly as it was', () => {
    const p = rollPacks({ state: 12 }).flat();
    const leader = p.find((id) => canBeLeader(id))!;
    const cards = p.filter((id) => id !== leader).slice(0, DECK_SIZE);
    const filled = autofill({ state: 2 }, p, leader, cards);
    expect(filled.cards).toStrictEqual(cards);
  });

  it('finishes any pool a full opening can produce', () => {
    for (let seed = 0; seed < 40; seed++) {
      const p = rollPacks({ state: seed }).flat();
      const filled = autofill({ state: seed + 1000 }, p, '', []);
      expect(draftDeckLegal(filled.leaderId, filled.cards, p)).toBe(true);
    }
  });
});

describe('a room reads its settings off its own name', () => {
  it('reads back what the lobby minted', () => {
    const cases: [Parameters<typeof roomName>[0], number, boolean, boolean][] = [
      [{}, 2, false, false],
      [{ noTimers: true }, 2, true, false],
      [{ draft: true }, 2, false, true],
      [{ noTimers: true, draft: true }, 2, true, true],
      [{ size: 3 }, 3, false, false],
      [{ size: 3, draft: true }, 3, false, true],
      [{ size: 4, noTimers: true, draft: true }, 4, true, true],
    ];
    for (const [settings, seats, noTimers, draft] of cases) {
      const name = roomName(settings, UUID);
      expect(seatCountFor(name)).toBe(seats);
      expect(timersOffFor(name)).toBe(noTimers);
      expect(draftFor(name)).toBe(draft);
    }
  });

  it('leaves a public room alone', () => {
    const name = `pub-${UUID}`;
    expect(seatCountFor(name)).toBe(2);
    expect(timersOffFor(name)).toBe(false);
    expect(draftFor(name)).toBe(false);
    expect(isPartyName(name)).toBe(false);
  });

  it('calls only a party room a party room, draft or not', () => {
    expect(isPartyName(roomName({ draft: true }, UUID))).toBe(false);
    expect(isPartyName(roomName({ size: 3, draft: true }, UUID))).toBe(true);
  });

  it('fits the room id the worker route accepts', () => {
    const longest = roomName({ size: 4, noTimers: true, draft: true }, UUID);
    expect(longest.length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z0-9_-]{1,64}$/.test(longest)).toBe(true);
  });
});

describe('the draft clock', () => {
  it('runs fifteen minutes', () => {
    expect(DRAFT_SECONDS).toBe(900);
  });
});

describe('a carried pack bumping against the window', () => {
  const win = { width: 1000, height: 800 };
  const box = (left: number, top: number, w = 200, h = 280) => ({
    left,
    top,
    right: left + w,
    bottom: top + h,
  });

  it('leaves a pack that is fully inside alone', () => {
    expect(windowOverflow(box(400, 260), win)).toStrictEqual({ x: 0, y: 0 });
  });

  it('pushes back by exactly how far it went past the left and the top', () => {
    expect(windowOverflow(box(-30, -12), win)).toStrictEqual({ x: -38, y: -20 });
  });

  it('pushes back off the right and the bottom too', () => {
    expect(windowOverflow(box(900, 700), win)).toStrictEqual({ x: 108, y: 188 });
  });

  it('answers both axes at once in a corner', () => {
    const over = windowOverflow(box(-50, 760), win);
    expect(over.x).toBeLessThan(0);
    expect(over.y).toBeGreaterThan(0);
  });

  it('keeps the margin off the edge', () => {
    // Sitting exactly on the margin is the closest it may come, so nothing moves.
    expect(windowOverflow(box(8, 8), win)).toStrictEqual({ x: 0, y: 0 });
    expect(windowOverflow(box(7, 8), win).x).toBe(-1);
  });

  it('reports one direction for a pack wider than the window it is in', () => {
    // Nothing can satisfy both edges, and picking a fight with both would jitter.
    const over = windowOverflow(box(0, 0, 1200, 100), win);
    expect(over.x).toBe(-8 + 208);
  });
});

describe('giving up on a connection that went quiet', () => {
  const live = { quietMs: 0, visible: true, open: true, alreadyGaveUp: false };

  it('says nothing while the room is answering', () => {
    expect(connectionLost(live)).toBe(false);
    expect(connectionLost({ ...live, quietMs: 12_000 })).toBe(false);
  });

  it('gives up once two pings in a row have gone unanswered', () => {
    expect(connectionLost({ ...live, quietMs: 24_000 })).toBe(false);
    expect(connectionLost({ ...live, quietMs: 25_000 })).toBe(true);
    expect(connectionLost({ ...live, quietMs: 90_000 })).toBe(true);
  });

  it('excuses the silence when its own check was late', () => {
    // A lid closed on a focused tab fires no visibility change, so nothing else
    // notices the machine stopped. The check running long after its own interval
    // is the evidence, and the quiet behind it is the sleep rather than the room.
    const slept = { ...live, quietMs: 40 * 60_000, lateMs: 40 * 60_000 };
    expect(connectionLost(slept)).toBe(false);
    // Ordinary scheduling jitter is not a sleep, and still reports.
    expect(connectionLost({ ...live, quietMs: 40_000, lateMs: 400 })).toBe(true);
  });

  it('never gives up on a tab that was only put away', () => {
    // A hidden tab has both the check and the ping that feeds it clamped to
    // about once a minute, so its silence says nothing. Acting on it would
    // close a healthy socket and tell an innocent opponent they had left.
    expect(connectionLost({ ...live, quietMs: 300_000, visible: false })).toBe(false);
  });

  it('leaves a socket that closed properly to the close listener', () => {
    expect(connectionLost({ ...live, quietMs: 300_000, open: false })).toBe(false);
  });

  it('reports the same silence once', () => {
    expect(connectionLost({ ...live, quietMs: 300_000, alreadyGaveUp: true })).toBe(false);
  });
});

describe('a turn that shortens for the player who is not using it', () => {
  it('runs its full length for somebody who is playing', () => {
    expect(turnSecondsFor(0)).toBe(CLOCK_SECONDS.turn);
  });

  it('loses fifteen seconds for every turn let pass', () => {
    expect(turnSecondsFor(1)).toBe(CLOCK_SECONDS.turn - SKIP_PENALTY_SECONDS);
    expect(turnSecondsFor(2)).toBe(CLOCK_SECONDS.turn - 2 * SKIP_PENALTY_SECONDS);
    expect(turnSecondsFor(3)).toBe(CLOCK_SECONDS.turn - 3 * SKIP_PENALTY_SECONDS);
  });

  it('stops shortening before it reaches nothing', () => {
    // A clock of zero fires its alarm in the instant it is set, which is a loop
    // rather than a fast turn.
    expect(turnSecondsFor(99)).toBe(MIN_TURN_SECONDS);
    expect(turnSecondsFor(99)).toBeGreaterThan(0);
  });

  it('never shortens below the floor however odd the count', () => {
    for (const n of [-5, -1, 0.4, 7.9, 1000]) {
      expect(turnSecondsFor(n)).toBeGreaterThanOrEqual(MIN_TURN_SECONDS);
      expect(turnSecondsFor(n)).toBeLessThanOrEqual(CLOCK_SECONDS.turn);
    }
  });

  it('adds the room margin on top of the window a player sees', () => {
    expect(enforcedTurnMs(0)).toBe((CLOCK_SECONDS.turn + NETWORK_GRACE_SECONDS) * 1000);
    expect(enforcedTurnMs(2)).toBe(
      (CLOCK_SECONDS.turn - 2 * SKIP_PENALTY_SECONDS + NETWORK_GRACE_SECONDS) * 1000,
    );
  });

  it('holds a seat long enough for a network to come back', () => {
    // Long enough for a handover or a reload, short enough not to hold a table.
    expect(AWAY_GRACE_SECONDS).toBeGreaterThanOrEqual(60);
    expect(AWAY_GRACE_SECONDS).toBeLessThanOrEqual(180);
  });
});
