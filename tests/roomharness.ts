/**
 * Drive a real MatchRoom with fake sockets and a clock the test owns.
 *
 * Nothing in the suite instantiated the room before this, so every claim about
 * disconnects, held seats, draft bookkeeping and the alarm rested on reading the
 * code or on driving two browsers by hand. Three defects reached players that
 * way. The room is ordinary TypeScript once `cloudflare:workers` is aliased, so
 * the only things worth faking are the socket, the storage and time.
 */
import { vi } from 'vitest';
import { MatchRoom } from '../worker/room';
import type { ClientMessage, ServerMessage } from '../worker/protocol';
import { roomName } from '../worker/roomname';
import { BUILD_VERSION } from '../src/version';

/** A starter deck every room will accept, so a test never has to build one. */
export const DECK = 'emberchoir';

/** Milliseconds the fake clock starts at. Fixed, so failures read the same twice. */
const EPOCH = 1_700_000_000_000;

type Listener = (ev: unknown) => void;

/**
 * A socket the test holds both ends of. `sent` is what the room said, in order;
 * `deliver` is the client speaking. Close listeners honour the abort signal the
 * way a real one does, because detaching on close is load-bearing in the client
 * and the room relies on the same shape.
 */
export class FakeSocket {
  readyState = 1;
  readonly sent: ServerMessage[] = [];
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, fn: Listener, opts?: { signal?: AbortSignal }): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    opts?.signal?.addEventListener('abort', () => set!.delete(fn));
  }

  send(raw: string): void {
    if (this.readyState !== 1) throw new Error('send on a socket that is not open');
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire('close', { code, wasClean: code === 1000 });
  }

  accept(): void {}

  private fire(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  /** The client sending a message up to the room. */
  raise(msg: ClientMessage): void {
    this.fire('message', { data: JSON.stringify(msg) });
  }

  /** A connection that died with nothing said, which is the common real fault. */
  drop(): void {
    this.readyState = 3;
    this.fire('close', { code: 1006, wasClean: false });
  }

  /** Every message of a kind the room has sent this socket, oldest first. */
  all<K extends ServerMessage['type']>(type: K): Extract<ServerMessage, { type: K }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: K }> => m.type === type);
  }

  /** The most recent message of a kind, or undefined if the room never sent one. */
  last<K extends ServerMessage['type']>(type: K): Extract<ServerMessage, { type: K }> | undefined {
    const all = this.all(type);
    return all[all.length - 1];
  }

  forget(): void {
    this.sent.length = 0;
  }
}

class FakeStorage {
  private data = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async setAlarm(when: number): Promise<void> {
    this.alarm = when;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

/** Let every floating promise in the room settle. Storage here never really waits. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

export interface Seated {
  socket: FakeSocket;
  /** The seat the room gave, or -1 when it refused. */
  seat: number;
  /** What a later join hands back to reclaim this seat. */
  token: string | undefined;
}

export class RoomHarness {
  room: MatchRoom;
  readonly storage = new FakeStorage();
  private now = EPOCH;
  private readonly name: string;
  private readonly kind: 'public' | 'private';
  private readonly code: string;

  constructor(name: string, kind: 'public' | 'private' = 'private', code = 'TESTRM') {
    this.name = name;
    this.kind = kind;
    this.code = code;
    vi.useFakeTimers();
    vi.setSystemTime(this.now);
    // The room rolls the deal, the opener and the draft packs off Math.random.
    // Left alone the opener alternates between runs, so a test that reasons
    // about whose turn came first passes or fails by coin toss. Pinned to a
    // value that seats player 0 first, which is what the tests below assume.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    this.room = this.build();
  }

  private build(): MatchRoom {
    const name = this.name;
    const ctx = { id: { name, toString: () => name }, storage: this.storage };
    const room = new MatchRoom(ctx as never, {} as never);
    // Set by `fetch` in the real thing, which needs a WebSocketPair and a 101
    // response that Node has no equivalent of. The room reads them and nothing
    // else about the upgrade matters to anything under test.
    Object.assign(room, { kind: this.kind, code: this.code });
    return room;
  }

  /** Open a socket and take a seat, the way a client's `connect` does. */
  async join(
    name: string,
    opts: { resume?: string; deckKey?: string; version?: string } = {},
  ): Promise<Seated> {
    const socket = new FakeSocket();
    (this.room as unknown as { attach(s: FakeSocket): void }).attach(socket);
    socket.raise({
      type: 'join',
      name,
      deckKey: opts.deckKey ?? DECK,
      version: opts.version ?? BUILD_VERSION,
      ...(opts.resume ? { resume: opts.resume } : {}),
    });
    await settle();
    const seated = socket.last('seated');
    return { socket, seat: seated?.seat ?? -1, token: seated?.token };
  }

  /** Move the clock forward, firing the alarm if it comes due on the way. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    // One alarm at a time, the way the runtime does it: it clears the alarm
    // before the handler runs and the handler arms the next one itself.
    let guard = 0;
    for (; guard < 200; guard++) {
      const due = this.storage.alarm;
      if (due === null || due > target) break;
      this.now = Math.max(this.now, due);
      vi.setSystemTime(this.now);
      this.storage.alarm = null;
      await this.room.alarm();
      await settle();
    }
    // Loudly, because a clock that re-arms in the past is exactly the runaway a
    // test here is meant to catch, and absorbing it silently would make the test
    // that guards against it pass for the wrong reason.
    if (guard >= 200) throw new Error('the alarm kept coming due: a clock is re-arming in the past');
    this.now = target;
    vi.setSystemTime(this.now);
    await settle();
  }

  /** Deliver a message and let the room finish with it. */
  async say(socket: FakeSocket, msg: ClientMessage): Promise<void> {
    socket.raise(msg);
    await settle();
  }

  async drop(socket: FakeSocket): Promise<void> {
    socket.drop();
    await settle();
  }

  /** The room's own view, for assertions no message carries. */
  peek<T = unknown>(field: string): T {
    return (this.room as unknown as Record<string, T>)[field];
  }

  /**
   * Throw the room away and build a new one over the same storage, which is what
   * a deploy or an eviction does. Only the alarm survives, because that is the
   * one thing the room persists; the seats, the state and the tokens do not.
   * This is the case `resumeFailed` was written for, and the harness could not
   * express it before.
   */
  async evict(): Promise<void> {
    this.room = this.build();
    await settle();
  }

  dispose(): void {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
}

/**
 * A room whose name asks for the shape the test wants.
 *
 * Built by `roomName` rather than by hand. A second minter here got the order of
 * the `nt-` and `dr-` segments the wrong way round, which reads back as timers
 * being on, and `worker/roomname.ts` exists precisely so there is only ever one
 * place that knows the format.
 */
export function openRoom(opts: { seats?: 3 | 4; draft?: boolean; timers?: boolean } = {}) {
  const name = roomName(
    {
      ...(opts.seats ? { size: opts.seats } : {}),
      noTimers: opts.timers === false,
      draft: opts.draft ?? false,
    },
    '00000000-0000-4000-8000-000000000000',
  );
  return new RoomHarness(name);
}
