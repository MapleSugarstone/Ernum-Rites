/**
 * The match room, driven directly.
 *
 * Every case here is a defect that reached a player. Nothing in the suite built
 * a room before this, so the disconnect, held-seat and draft bookkeeping were
 * only ever checked by reading the code or by driving two browsers by hand, and
 * that missed all of them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openRoom, type FakeSocket, type RoomHarness } from './roomharness';
import { autofill, DRAFT_SECONDS, PACK_COUNT } from '../src/engine/draft';
import {
  AWAY_GRACE_SECONDS,
  CLOCK_SECONDS,
  MIN_TURN_SECONDS,
  NETWORK_GRACE_SECONDS,
  enforcedTurnMs,
} from '../src/engine/timing';

let h: RoomHarness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

/** A legal deck out of what a seat opened, so a test never hand-builds one. */
function buildFrom(packs: string[][]): { leaderId: string; cards: string[] } {
  const pool = packs.flat();
  return autofill({ state: 12345 }, pool, '', []);
}

/** Open every pack and send a finished deck, the way a client does. */
async function finishDraft(room: RoomHarness, s: FakeSocket): Promise<void> {
  const dealt = s.last('draft');
  if (!dealt) throw new Error('no packs were dealt');
  const deck = buildFrom(dealt.packs);
  await room.say(s, { type: 'draftOpened', opened: PACK_COUNT });
  await room.say(s, {
    type: 'draftDeck',
    leaderId: deck.leaderId,
    cards: deck.cards,
    done: true,
    opened: PACK_COUNT,
  });
}

describe('a match that outlives the connection', () => {
  it('holds the seat instead of ending the match', async () => {
    h = openRoom();
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    a.socket.forget();

    await h.drop(b.socket);

    // The old behaviour, and the whole ghost-disconnect report: a socket dying
    // was reported to the other player as their opponent walking out.
    expect(a.socket.last('opponentLeft')).toBeUndefined();
    expect(a.socket.last('playerAway')?.name).toBe('Bob');
    expect(h.peek<unknown[]>('seats')[1]).not.toBeNull();
  });

  it('gives the same seat back to whoever holds its token', async () => {
    h = openRoom();
    await h.join('Alice');
    const b = await h.join('Bob');
    const before = b.socket.last('state')!.publicDigest;
    await h.drop(b.socket);

    const again = await h.join('Bob', { resume: b.token });

    expect(again.seat).toBe(1);
    // The same game, not a new one. A fresh deal would digest differently.
    expect(again.socket.last('state')!.publicDigest).toBe(before);
    expect(h.peek<{ awayAt: number | null }[]>('seats')[1].awayAt).toBeNull();
  });

  it('gives up on a seat nobody came back to, and not a moment early', async () => {
    h = openRoom();
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    await h.drop(b.socket);
    a.socket.forget();

    // The whole point of the grace is the waiting, so the waiting is the test.
    await h.advance((AWAY_GRACE_SECONDS - 5) * 1000);
    expect(a.socket.last('opponentLeft')).toBeUndefined();

    await h.advance(10 * 1000);
    expect(a.socket.last('opponentLeft')).toBeTruthy();
  });

  it('will not hand a held seat to a stranger with the wrong token', async () => {
    h = openRoom();
    await h.join('Alice');
    const b = await h.join('Bob');
    await h.drop(b.socket);

    const stranger = await h.join('Mallory', { resume: 'not-the-token-for-that-seat' });

    expect(stranger.seat).toBe(-1);
    expect(stranger.socket.last('resumeFailed')).toBeTruthy();
    // And the seat is still there for whoever actually holds its token.
    const back = await h.join('Bob', { resume: b.token });
    expect(back.seat).toBe(1);
  });

  it('refuses to seat anyone from a room that lost its memory', async () => {
    // A deploy or an eviction empties the object while both clients are still
    // holding tokens. Both reconnect within a second of each other, and before
    // `resumeFailed` they were handed fresh chairs and dealt a second match.
    h = openRoom();
    const a = await h.join('Alice');
    const b = await h.join('Bob');

    await h.evict();

    const backA = await h.join('Alice', { resume: a.token });
    const backB = await h.join('Bob', { resume: b.token });
    expect(backA.socket.last('resumeFailed')).toBeTruthy();
    expect(backB.socket.last('resumeFailed')).toBeTruthy();
    expect(backA.socket.last('state')).toBeUndefined();
    expect(backB.socket.last('state')).toBeUndefined();
  });

  it('refuses a token it never issued rather than dealing a new game', async () => {
    // The live bug. A room that lost its memory, which a deploy does, met two
    // clients reconnecting a second apart, gave them both fresh chairs, filled
    // up and dealt a second match over the top: new hands, new opening roll.
    h = openRoom();
    const a = await h.join('Alice', { resume: 'a-token-from-a-room-that-is-gone' });

    expect(a.socket.last('resumeFailed')?.reason).toContain('no longer running');
    expect(a.seat).toBe(-1);
    expect(h.peek<unknown[]>('seats').filter(Boolean)).toHaveLength(0);
  });

  it('never deals a second match over a game in progress', async () => {
    h = openRoom();
    const a = await h.join('Alice');
    await h.join('Bob');
    const dealt = a.socket.last('state')!.publicDigest;

    // Whatever route a third join takes, the board the players hold cannot move
    // under them.
    await h.join('Interloper');
    await h.join('Interloper', { resume: 'not-a-real-token' });

    expect(a.socket.last('state')!.publicDigest).toBe(dealt);
  });
});

describe('a turn that shortens for the player not using it', () => {
  const oneTurn = (CLOCK_SECONDS.turn + 10) * 1000;

  it('grants each turn exactly the budget its skip count earns', async () => {
    h = openRoom();
    await h.join('Alice');
    await h.join('Bob');
    expect(h.peek<number[]>('skips')).toEqual([0, 0]);

    // Nobody acts, so turns keep timing out and the counts keep climbing. The
    // budget a turn is granted has to track the count of whoever is on it,
    // whichever seat that is and whatever the opening roll did.
    let sawAShortening = false;
    for (let i = 0; i < 6; i++) {
      await h.advance(oneTurn);
      const actor = h.peek<number | null>('turnActor');
      if (actor === null) continue;
      const owed = h.peek<number[]>('skips')[actor];
      expect(h.peek<number>('turnTotalMs')).toBe(enforcedTurnMs(owed));
      if (owed > 0) sawAShortening = true;
    }
    expect(sawAShortening).toBe(true);
  });

  it('gives a player their full turn back the moment they act', async () => {
    h = openRoom();
    const a = await h.join('Alice');
    const b = await h.join('Bob');

    // Wait for a plain turn clock belonging to someone who has let one pass.
    // The opening runs through response windows, so which seat that is and when
    // is not something a test should be asserting.
    let on = -1;
    for (let i = 0; i < 6 && on < 0; i++) {
      await h.advance(oneTurn);
      const clock = a.socket.last('state')?.clock;
      if (clock?.kind === 'turn' && h.peek<number[]>('skips')[clock.player] > 0) on = clock.player;
    }
    expect(on).toBeGreaterThanOrEqual(0);

    const who = on === 0 ? a : b;
    who.socket.forget();
    await h.say(who.socket, { type: 'action', action: { type: 'END_TURN' }, version: 0 });

    expect(who.socket.last('rejected')).toBeUndefined();
    expect(h.peek<number[]>('skips')[on]).toBe(0);
  });

  it('never shortens a turn to nothing however many pass', async () => {
    // A clock of zero fires its alarm in the instant it is set, which is a loop
    // rather than a fast turn.
    h = openRoom();
    const a = await h.join('Alice');
    await h.join('Bob');
    const floor = (MIN_TURN_SECONDS + NETWORK_GRACE_SECONDS) * 1000;

    for (let i = 0; i < 10; i++) {
      await h.advance(oneTurn);
      if (a.socket.last('state')?.clock == null) break;
      expect(h.peek<number>('turnTotalMs')).toBeGreaterThanOrEqual(floor);
    }
    expect(Math.max(...h.peek<number[]>('skips'))).toBeGreaterThan(1);
  });
});

describe('the draft', () => {
  it('takes a seat off the finished list when it goes back to editing', async () => {
    // Pressing Done and then Keep editing used to leave the seat counted as
    // ready. The last player finishing dealt the match out from under them, and
    // `finishDraft` skipped the autofill and booted them for a deck it had
    // declined to fill, naming a reason that was not even true.
    h = openRoom({ draft: true });
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    await finishDraft(h, b.socket);
    expect(a.socket.last('draftStatus')?.done).toBe(1);

    await h.say(b.socket, {
      type: 'draftDeck',
      leaderId: '',
      cards: [],
      done: false,
      opened: PACK_COUNT,
    });

    expect(a.socket.last('draftStatus')?.done).toBe(0);
    expect(a.socket.last('draftStatus')?.waiting).toContain('Bob');

    // And the other player finishing must not now deal the match.
    await finishDraft(h, a.socket);
    expect(a.socket.last('state')).toBeUndefined();
  });

  it('keeps the opened count when the message announcing it is lost', async () => {
    // `draftOpened` is sent once per pack and `send` drops anything not on an
    // open socket, so one lost frame booted a player who had opened every pack
    // and built a legal deck. The count rides on the build as well now.
    h = openRoom({ draft: true });
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    const deck = buildFrom(b.socket.last('draft')!.packs);

    // No `draftOpened` at all: the build is the only thing that says so.
    await h.say(b.socket, {
      type: 'draftDeck',
      leaderId: deck.leaderId,
      cards: deck.cards,
      done: true,
      opened: PACK_COUNT,
    });

    expect(h.peek<{ draft?: { opened: number } }[]>('seats')[1].draft!.opened).toBe(PACK_COUNT);

    await finishDraft(h, a.socket);
    expect(b.socket.last('error')).toBeUndefined();
    expect(b.socket.last('state')).toBeTruthy();
  });

  it('deals the match to a drafter whose connection went while they waited', async () => {
    // The grace held the seat and then `finishDraft` filtered it out for having
    // no socket, so a blip during a draft ended the draft for everyone: in a
    // two-seat room the survivor was ejected for want of a second player.
    h = openRoom({ draft: true });
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    await finishDraft(h, b.socket);
    await h.drop(b.socket);

    await finishDraft(h, a.socket);

    expect(a.socket.last('error')).toBeUndefined();
    expect(a.socket.last('state')).toBeTruthy();
    // And the seat is still theirs to walk back into.
    const again = await h.join('Bob', { resume: b.token });
    expect(again.seat).toBe(1);
    expect(again.socket.last('state')).toBeTruthy();
  });

  it('deals as soon as the last player anybody was waiting on is given up on', async () => {
    // Giving up on a drafter left the rest reading "everyone is finished" with
    // an empty waiting list until the full eight minutes ran out.
    h = openRoom({ seats: 3, draft: true });
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    const c = await h.join('Carol');
    await finishDraft(h, a.socket);
    await finishDraft(h, b.socket);
    await h.drop(c.socket);
    expect(a.socket.last('state')).toBeUndefined();

    await h.advance((AWAY_GRACE_SECONDS + 5) * 1000);

    expect(a.socket.last('state')).toBeTruthy();
    void c;
  });

  it('holds a drafter seat with the pool it opened', async () => {
    h = openRoom({ draft: true });
    await h.join('Alice');
    const b = await h.join('Bob');
    const packs = b.socket.last('draft')!.packs;

    await h.drop(b.socket);
    const again = await h.join('Bob', { resume: b.token });

    expect(again.socket.last('draft')?.packs).toEqual(packs);
  });
});

describe('the shape of the room', () => {
  it('runs a booted three-seat draft on as a head-to-head match', async () => {
    // `finishDraft` shrinks `seats` to the survivors and `startMatch` builds the
    // game from those same seats, so the seat array and the player list cannot
    // disagree. The room reads the count off the game because that is the
    // authoritative one, and this holds the two in step: a three-seat draft that
    // boots a player has to behave in every way like a duel afterwards.
    h = openRoom({ seats: 3, draft: true });
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    const c = await h.join('Carol');

    // Carol never opens a pack, so the clock running out boots her and the room
    // starts a two-seat match with three seats' worth of history behind it.
    await finishDraft(h, a.socket);
    await finishDraft(h, b.socket);
    expect(c.seat).toBe(2);
    await h.advance((DRAFT_SECONDS + 10) * 1000);

    expect(a.socket.last('state')).toBeTruthy();
    expect(h.peek<unknown[]>('seats')).toHaveLength(2);

    a.socket.forget();
    await h.drop(b.socket);
    await h.advance((AWAY_GRACE_SECONDS + 5) * 1000);

    // Two players left means head to head, whatever the seat array once was.
    expect(a.socket.last('opponentLeft')).toBeTruthy();
  });

  it('answers a resync mid-draft instead of ending the session', async () => {
    // Every `rejected` makes the client resync, and a resync with no match used
    // to fall through to `not seated in a running match`, which is fatal.
    h = openRoom({ draft: true });
    await h.join('Alice');
    const b = await h.join('Bob');
    b.socket.forget();

    await h.say(b.socket, { type: 'resync' });

    expect(b.socket.last('error')).toBeUndefined();
    expect(b.socket.last('draft')).toBeTruthy();
  });

  it('ignores a build that arrives after the draft is over', async () => {
    // The client batches its build, so one can still be in flight when the last
    // player finishes. Answering it with an error ejected somebody out of the
    // match that had just been dealt to them.
    h = openRoom({ draft: true });
    const a = await h.join('Alice');
    const b = await h.join('Bob');
    await finishDraft(h, a.socket);
    await finishDraft(h, b.socket);
    b.socket.forget();

    await h.say(b.socket, {
      type: 'draftDeck',
      leaderId: '',
      cards: [],
      done: false,
      opened: PACK_COUNT,
    });

    expect(b.socket.last('error')).toBeUndefined();
    expect(b.socket.last('rejected')).toBeUndefined();
  });
});
