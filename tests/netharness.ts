/**
 * Drive a real NetClient against a socket the test holds both ends of.
 *
 * The room got a harness after three of its defects reached players. The client
 * is where the rest of them lived: a dead button on an overlay, a token thrown
 * away while the seat was still held, a reply acted on after the player walked
 * away. All of it was checked by driving two browsers by hand, which is slow
 * enough that it was not checked often.
 *
 * `NetClient` only needs a `WebSocket` constructor, `window` timers and
 * `document.visibilityState`, so the whole of it fits behind these fakes.
 */
import { vi } from 'vitest';
import { NetClient, type NetHandlers } from '../src/net/client';
import type { ClientMessage, ServerMessage } from '../worker/protocol';

/** Every socket this test opened, oldest first. `connect` makes a new one. */
export const sockets: FakeSocket[] = [];

type Listener = (ev: unknown) => void;

export class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = 0;
  readonly url: string;
  /** What the client sent up, parsed, oldest first. */
  readonly sent: ClientMessage[] = [];
  closedWith: number | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: string, fn: Listener, opts?: { signal?: AbortSignal }): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    opts?.signal?.addEventListener('abort', () => set!.delete(fn));
  }

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ClientMessage);
  }

  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }

  private fire(type: string, ev: unknown): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }

  // --- what a test drives -------------------------------------------------
  /** The handshake completing, which is when the client sends its join. */
  open(): void {
    this.readyState = 1;
    this.fire('open', {});
  }

  /** The room saying something. */
  say(msg: ServerMessage): void {
    this.fire('message', { data: JSON.stringify(msg) });
  }

  /** A connection that died with nothing said, the common real fault. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.fire('error', {});
    this.fire('close', { code, wasClean: false });
  }

  /** A close that announced itself. */
  hangUp(code = 1000): void {
    this.readyState = 3;
    this.fire('close', { code, wasClean: true });
  }

  /** Whether anything is still listening, which `close` takes away. */
  get wired(): boolean {
    return [...this.listeners.values()].some((s) => s.size > 0);
  }

  last<K extends ClientMessage['type']>(type: K): Extract<ClientMessage, { type: K }> | undefined {
    const all = this.sent.filter((m): m is Extract<ClientMessage, { type: K }> => m.type === type);
    return all[all.length - 1];
  }
}

/** Everything the client told the app, in order, as `name(args)` strings. */
export type Calls = string[];

export interface Rig {
  client: NetClient;
  calls: Calls;
  /** The socket `connect` most recently opened. */
  socket: () => FakeSocket;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}

/**
 * A client wired to fakes, with every handler recording its call.
 *
 * `visible` drives `document.visibilityState`, which the silence watchdog reads:
 * a hidden tab has its ping clamped, so the quiet it wakes to says nothing.
 */
export function rig(opts: { visible?: boolean } = {}): Rig {
  sockets.length = 0;
  const calls: Calls = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
    };

  const handlers = {
    onSeated: record('onSeated'),
    onWaiting: record('onWaiting'),
    onState: record('onState'),
    onDraft: record('onDraft'),
    onDraftStatus: record('onDraftStatus'),
    onRejected: record('onRejected'),
    onResumeFailed: record('onResumeFailed'),
    onPlayerAway: record('onPlayerAway'),
    onPlayerBack: record('onPlayerBack'),
    onTimedOut: record('onTimedOut'),
    onOpponentLeft: record('onOpponentLeft'),
    onPlayerLeft: record('onPlayerLeft'),
    onError: record('onError'),
    onDesync: record('onDesync'),
  } as unknown as NetHandlers;

  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  // The whole DOM surface NetClient touches, which is four things. Stubbed
  // rather than run under jsdom so the suite keeps no browser dependency and
  // stays as fast as the rest of it. The timers delegate lazily, because fake
  // timers replace the globals after this runs.
  vi.stubGlobal('window', {
    setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number) => globalThis.clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
  });
  const docListeners = new Map<string, Set<Listener>>();
  vi.stubGlobal('document', {
    visibilityState: opts.visible === false ? 'hidden' : 'visible',
    addEventListener(type: string, fn: Listener, o?: { signal?: AbortSignal }) {
      let set = docListeners.get(type);
      if (!set) docListeners.set(type, (set = new Set()));
      set.add(fn);
      o?.signal?.addEventListener('abort', () => set!.delete(fn));
    },
    removeEventListener(type: string, fn: Listener) {
      docListeners.get(type)?.delete(fn);
    },
  });

  const client = new NetClient('http://test.invalid', handlers);
  return {
    client,
    calls,
    socket: () => {
      const s = sockets[sockets.length - 1];
      if (!s) throw new Error('no socket has been opened');
      return s;
    },
    /** Flip the tab's visibility and tell whoever is listening, as a browser does. */
    setVisible: (visible: boolean) => {
      (globalThis.document as { visibilityState: string }).visibilityState = visible
        ? 'visible'
        : 'hidden';
      for (const fn of docListeners.get('visibilitychange') ?? []) fn({});
    },
    dispose: () => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
}

/** Open a connection and let the handshake finish, which is the usual start. */
export function connected(r: Rig, resume?: string): FakeSocket {
  r.client.connect('room-1', 'private', 'emberchoir', 'Tester', 'CODE12', undefined, resume);
  const s = r.socket();
  s.open();
  return s;
}
