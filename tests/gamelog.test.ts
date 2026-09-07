// The game log: what a finished game is stored as, what is stripped from it,
// and that the store pages records back in order. The store is a Durable
// Object; here it runs over a fake storage the way the match room does.
import { describe, expect, it } from 'vitest';
import { GameLogStore, LOG_KEEP, scrubGameLog } from '../worker/gamelog';

class FakeStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async list<T>(opts: { prefix?: string; start?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const keys = [...this.data.keys()]
      .filter((k) => (opts.prefix ? k.startsWith(opts.prefix) : true))
      .filter((k) => (opts.start ? k >= opts.start : true))
      .sort();
    const out = new Map<string, T>();
    for (const k of keys.slice(0, opts.limit ?? keys.length)) out.set(k, this.data.get(k) as T);
    return out;
  }
}

function store(): { store: GameLogStore; storage: FakeStorage } {
  const storage = new FakeStorage();
  const ctx = { id: { name: 'game-log', toString: () => 'game-log' }, storage };
  return { store: new GameLogStore(ctx as never, {} as never), storage };
}

const record = (over: Record<string, unknown> = {}) => ({
  format: 1,
  kind: 'solo',
  version: '0.1.0',
  build: 'abc1234',
  cards: 'deadbeef',
  seed: 12345,
  startingPlayer: 1,
  botSeat: 1,
  decks: [
    { name: 'Maple', leaderId: 'p3-helemy', cards: ['p2-warmateer', 'n1-lizard'] },
    { name: 'Bot', leaderId: 'kh-PinkDeus', cards: ['k1-apprentice'] },
  ],
  steps: [
    { actor: 1, action: { type: 'END_TURN' } },
    { actor: 0, action: { type: 'PLAY_SUMMON', handIndex: 0, slot: 0 } },
  ],
  winner: 0,
  winReason: 'leader',
  turns: 9,
  ...over,
});

describe('the game log', () => {
  it('keeps what a replay and a comparison across updates need, and nothing that names a person', () => {
    const scrubbed = scrubGameLog({ ...record(), player: 'Maple', ip: '203.0.113.9', email: 'x@y.z', when: '2026-09-07T12:00:00Z' });
    expect(scrubbed).not.toBeNull();
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain('Maple');
    expect(text).not.toContain('203.0.113.9');
    expect(text).not.toContain('x@y.z');
    expect(text).not.toContain('2026-09-07T12');
    expect(scrubbed!.decks.map((d) => d.leaderId)).toEqual(['p3-helemy', 'kh-PinkDeus']);
    expect(scrubbed!.version).toBe('0.1.0');
    expect(scrubbed!.build).toBe('abc1234');
    expect(scrubbed!.cards).toBe('deadbeef');
    expect(scrubbed!.steps).toHaveLength(2);
    expect(scrubbed!.botSeat).toBe(1);
  });

  it('refuses what is not a game record', () => {
    expect(scrubGameLog(null)).toBeNull();
    expect(scrubGameLog({ kind: 'solo' })).toBeNull();
    expect(scrubGameLog(record({ kind: 'weird' }))).toBeNull();
    expect(scrubGameLog(record({ steps: [] }))).toBeNull();
    expect(scrubGameLog(record({ decks: [{ leaderId: 'x', cards: [1, 2] }] }))).toBeNull();
  });

  it('stores records in order, stamps the day only, and pages them back after an id', async () => {
    const { store: log } = store();
    const post = (body: unknown) =>
      log.fetch(new Request('https://x/api/log', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    for (let i = 0; i < 3; i++) {
      const res = await post(record({ seed: 100 + i }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { id: number }).id).toBe(i + 1);
    }
    const bad = await post({ nope: true });
    expect(bad.status).toBe(400);

    const page = (await (await log.fetch(new Request('https://x/api/logs?after=1&limit=10'))).json()) as { rows: { id: number; seed: number; day: string }[] };
    expect(page.rows.map((r) => r.id)).toEqual([2, 3]);
    expect(page.rows[0].seed).toBe(101);
    expect(page.rows[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const stats = (await (await log.fetch(new Request('https://x/api/logs/stats'))).json()) as { count: number; kinds: Record<string, number> };
    expect(stats.count).toBe(3);
    expect(stats.kinds.solo).toBe(3);
  });

  it('drops the oldest once more than the cap are kept', async () => {
    const { store: log, storage } = store();
    // Pretend the store is already at the cap, then add one more.
    await storage.put('next', LOG_KEEP + 1);
    await storage.put('count', LOG_KEEP);
    await storage.put('oldest', 1);
    await storage.put('g:' + String(1).padStart(8, '0'), { id: 1 });
    await storage.put('g:' + String(2).padStart(8, '0'), { id: 2 });
    const res = await log.fetch(new Request('https://x/api/log', { method: 'POST', body: JSON.stringify(record()), headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(200);
    expect(await storage.get('g:' + String(1).padStart(8, '0'))).toBeUndefined();
    expect(await storage.get('g:' + String(2).padStart(8, '0'))).toBeDefined();
    expect(await storage.get<number>('count')).toBe(LOG_KEEP);
  });
});
