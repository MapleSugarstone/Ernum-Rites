/**
 * The connection, driven directly.
 *
 * These are the behaviours the disconnect reports turned on: which ending gets
 * reported and once, whether a socket that was let go can still speak, and
 * whether the client can tell a machine waking up from a room that has gone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connected, rig, sockets, type Rig } from './netharness';

let r: Rig | null = null;
afterEach(() => {
  r?.dispose();
  r = null;
});

describe('what the client says when a connection ends', () => {
  it('reports an abnormal close once, naming which ending it was', async () => {
    r = rig();
    const s = connected(r);
    r.calls.length = 0;

    s.drop(1006);

    // Once, not twice: 'error' fires before 'close' on a socket that failed, and
    // reporting on both would have the app tear down while it was already
    // tearing down. And it names the ending rather than saying only that there
    // was one, which is what every report of this used to arrive without.
    expect(r.calls).toEqual(['onError("the connection died without closing")']);
  });

  it('separates a room that hung up from one that was never reached', () => {
    r = rig();
    const s = connected(r);
    r.calls.length = 0;
    s.hangUp(1000);
    expect(r.calls).toEqual(['onError("the connection closed")']);

    const r2 = (r = rig());
    r2.client.connect('room-1', 'private', 'emberchoir', 'Tester');
    // Never opened, so this is a room that could not be reached rather than a
    // connection that died: the player is told something they can act on.
    r2.socket().hangUp(1006);
    expect(r2.calls).toEqual(['onError("the room could not be reached")']);
  });

  it('lets go of a socket completely when it closes one itself', () => {
    r = rig();
    const first = connected(r);
    r.calls.length = 0;

    r.client.connect('room-1', 'private', 'emberchoir', 'Tester');

    // The old socket is closed and detached. A tail arriving from it later must
    // not reach the app: it would report a connection this client no longer
    // wants as a connection that failed, which is a match ended for nothing.
    expect(first.closedWith).not.toBeNull();
    first.drop(1006);
    expect(r.calls).toEqual([]);
  });

  it('refuses a move rather than writing it into a dead socket', () => {
    r = rig();
    const s = connected(r);
    s.readyState = 3;
    // Answered rather than thrown, and never silently accepted: `send` only
    // writes to an open socket, so a click taken here would vanish without a
    // word, which is how a lost connection used to read as "nothing happened".
    const out = r.client.play({ type: 'END_TURN' });
    expect(out.ok).toBe(false);
  });
});

describe('the join it sends', () => {
  it('carries the resume token when there is a seat to reclaim', () => {
    r = rig();
    const s = connected(r, 'token-abc');
    expect(s.last('join')?.resume).toBe('token-abc');
  });

  it('sends no resume field on an ordinary join', () => {
    r = rig();
    const s = connected(r);
    expect(s.last('join')?.resume).toBeUndefined();
  });
});

describe('a message this build does not understand', () => {
  it('says so rather than dropping it in silence', () => {
    r = rig();
    const s = connected(r);
    r.calls.length = 0;

    // What a client one deploy behind sees when the room learns a new word.
    s.say({ type: 'somethingNewer' } as never);

    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatch(/does not understand/);
  });

  it('routes a refused resume to its own handler', () => {
    r = rig();
    const s = connected(r);
    r.calls.length = 0;
    s.say({ type: 'resumeFailed', reason: 'That match is no longer running.' });
    expect(r.calls).toEqual(['onResumeFailed("That match is no longer running.")']);
  });

  it('asks for the whole state again whenever the room refuses an action', () => {
    r = rig();
    const s = connected(r);
    s.sent.length = 0;
    s.say({ type: 'rejected', reason: 'no', version: 3 });
    expect(s.last('resync')).toBeTruthy();
  });
});

describe('the watchdog that catches a socket nothing closed', () => {
  it('gives up once the room has been quiet for two pings', () => {
    r = rig();
    connected(r);
    r.calls.length = 0;

    vi.advanceTimersByTime(30_000);

    expect(r.calls).toEqual(['onError("the room stopped answering")']);
  });

  it('stays quiet while the room keeps answering', () => {
    r = rig();
    const s = connected(r);
    r.calls.length = 0;

    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(5_000);
      s.say({ type: 'pong', sent: Date.now(), now: Date.now() });
    }

    expect(r.calls).toEqual([]);
  });

  it('does not report a machine that went to sleep', () => {
    r = rig();
    connected(r);
    r.calls.length = 0;

    // A lid closed on a focused tab fires no visibility change, so nothing else
    // notices the clock stopped. Jumping the wall clock without letting the
    // timers run is exactly that: the check finds itself long overdue.
    vi.setSystemTime(Date.now() + 40 * 60_000);
    vi.advanceTimersByTime(2_500);

    expect(r.calls).toEqual([]);
  });

  it('still catches a genuinely dead socket after a sleep', () => {
    r = rig();
    connected(r);
    r.calls.length = 0;
    vi.setSystemTime(Date.now() + 40 * 60_000);
    vi.advanceTimersByTime(2_500);
    expect(r.calls).toEqual([]);

    // The excuse is for the tick that was late, not for every tick after it.
    vi.advanceTimersByTime(30_000);
    expect(r.calls).toEqual(['onError("the room stopped answering")']);
  });

  it('says nothing about a hidden tab, whose ping is clamped anyway', () => {
    r = rig({ visible: false });
    connected(r);
    r.calls.length = 0;
    vi.advanceTimersByTime(60_000);
    expect(r.calls).toEqual([]);
  });

  it('stops its timers once it has given up, so it reports only once', () => {
    r = rig();
    connected(r);
    r.calls.length = 0;
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(120_000);
    expect(r.calls).toEqual(['onError("the room stopped answering")']);
  });
});

describe('closing', () => {
  it('leaves nothing running and nothing able to speak', () => {
    r = rig();
    const s = connected(r);
    r.calls.length = 0;

    r.client.close();

    expect(s.closedWith).not.toBeNull();
    // No timer may outlive the socket it was measuring, and the socket itself
    // must not be able to reach the app any more.
    vi.advanceTimersByTime(120_000);
    s.drop(1006);
    expect(r.calls).toEqual([]);
  });

  it('opens one socket per connect and lets the previous one go', () => {
    r = rig();
    connected(r);
    connected(r);
    connected(r);
    expect(sockets).toHaveLength(3);
    // The two it moved on from were closed. Each keeps one listener on purpose,
    // off the abort signal, so a close code still reaches the diagnostics after
    // the handlers have been taken away.
    expect(sockets.slice(0, 2).every((s) => s.closedWith !== null)).toBe(true);
    r.calls.length = 0;
    sockets[0].drop(1006);
    sockets[1].drop(1006);
    expect(r.calls).toEqual([]);
  });
});
