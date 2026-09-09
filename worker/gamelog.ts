import { DurableObject } from 'cloudflare:workers';

/**
 * One record per finished game, kept so the bot's play against people can be
 * measured and replayed. A record carries what a replay needs (seed, lists,
 * opening seat, every action) and what a comparison across updates needs
 * (app version, build, card set hash), and nothing that names a person: no
 * player names, no addresses, no account, no exact time. Deck lists stay,
 * because the analysis is about the decks.
 */
export interface GameLogRecord {
  /** Record format. */
  format: 1;
  /** Solo games are a person against the bot; multi games are people against each other. */
  kind: 'solo' | 'multi';
  /** App version and build the client that logged it ran, and the card set it saw. */
  version: string;
  build: string;
  cards: string;
  seed: number;
  startingPlayer: number;
  /** Seat the bot sat in for a solo game, -1 otherwise. */
  botSeat: number;
  /**
   * How hard the bot was set to play, for a solo game. A game against the easy
   * bot says nothing about how the hard one holds up, so a reading that mixes
   * them says nothing about either.
   */
  difficulty: 'easy' | 'hard' | null;
  decks: { leaderId: string; cards: string[] }[];
  steps: { actor: number; action: unknown }[];
  winner: number;
  winReason: string | null;
  turns: number;
}

export interface StoredGameLog extends GameLogRecord {
  id: number;
  /** UTC day the record was stored, the only time kept. */
  day: string;
}

/** Bytes a record may take once serialised; a game is a few kilobytes. */
export const LOG_MAX_BYTES = 256 * 1024;
/** Records kept; the oldest go when there are more. */
export const LOG_KEEP = 20_000;
const KEY_WIDTH = 8;

/**
 * The record a client sent, reduced to what is stored: shape checked, sizes
 * capped, and every field that could name a person dropped. Null when the
 * body is not a game record at all.
 */
export function scrubGameLog(raw: unknown): GameLogRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === 'multi' ? 'multi' : r.kind === 'solo' ? 'solo' : null;
  if (!kind) return null;
  if (!Array.isArray(r.decks) || r.decks.length < 2 || r.decks.length > 4) return null;
  if (!Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 4000) return null;
  const decks: { leaderId: string; cards: string[] }[] = [];
  for (const d of r.decks) {
    if (!d || typeof d !== 'object') return null;
    const deck = d as Record<string, unknown>;
    if (typeof deck.leaderId !== 'string' || !Array.isArray(deck.cards) || deck.cards.length > 60) return null;
    if (!deck.cards.every((id) => typeof id === 'string' && id.length <= 64)) return null;
    decks.push({ leaderId: deck.leaderId.slice(0, 64), cards: deck.cards as string[] });
  }
  const steps: { actor: number; action: unknown }[] = [];
  for (const s of r.steps) {
    if (!s || typeof s !== 'object') return null;
    const step = s as Record<string, unknown>;
    if (typeof step.actor !== 'number' || !step.action || typeof step.action !== 'object') return null;
    steps.push({ actor: step.actor, action: step.action });
  }
  const short = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');
  const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback);
  return {
    format: 1,
    kind,
    version: short(r.version, 32),
    build: short(r.build, 64),
    cards: short(r.cards, 16),
    seed: int(r.seed, 0),
    startingPlayer: int(r.startingPlayer, 0),
    botSeat: int(r.botSeat, -1),
    difficulty: r.difficulty === 'easy' ? 'easy' : r.difficulty === 'hard' ? 'hard' : null,
    decks,
    steps,
    winner: int(r.winner, -1),
    winReason: r.winReason === null || r.winReason === undefined ? null : short(r.winReason, 64),
    turns: int(r.turns, 0),
  };
}

function keyOf(id: number): string {
  return 'g:' + String(id).padStart(KEY_WIDTH, '0');
}

/**
 * The store. One instance for the deployment. Records are stored under
 * zero-padded keys so a prefix list walks them in order, and the next id is
 * its own key.
 */
export class GameLogStore extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/log') {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return Response.json({ ok: false, reason: 'not json' }, { status: 400 });
      }
      const record = scrubGameLog(raw);
      if (!record) return Response.json({ ok: false, reason: 'not a game record' }, { status: 400 });
      const text = JSON.stringify(record);
      if (text.length > LOG_MAX_BYTES) return Response.json({ ok: false, reason: 'too large' }, { status: 413 });
      const id = await this.store(record);
      return Response.json({ ok: true, id });
    }
    if (request.method === 'GET' && url.pathname === '/api/logs') {
      const after = Number(url.searchParams.get('after') ?? '0');
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '100')));
      const rows = await this.page(Number.isFinite(after) ? after : 0, limit);
      return Response.json({ ok: true, rows });
    }
    if (request.method === 'GET' && url.pathname === '/api/logs/stats') {
      return Response.json({ ok: true, ...(await this.stats()) });
    }
    return new Response('not found', { status: 404 });
  }

  private async store(record: GameLogRecord): Promise<number> {
    const next = (await this.ctx.storage.get<number>('next')) ?? 1;
    const stored: StoredGameLog = { ...record, id: next, day: new Date().toISOString().slice(0, 10) };
    await this.ctx.storage.put(keyOf(next), stored);
    await this.ctx.storage.put('next', next + 1);
    const count = ((await this.ctx.storage.get<number>('count')) ?? 0) + 1;
    if (count > LOG_KEEP) {
      // The oldest go, KEY_WIDTH digits from the first that may still exist.
      const oldest = (await this.ctx.storage.get<number>('oldest')) ?? 1;
      let dropped = 0;
      let at = oldest;
      while (count - dropped > LOG_KEEP && at < next) {
        if (await this.ctx.storage.delete(keyOf(at))) dropped++;
        at++;
      }
      await this.ctx.storage.put('oldest', at);
      await this.ctx.storage.put('count', count - dropped);
    } else {
      await this.ctx.storage.put('count', count);
    }
    return next;
  }

  private async page(after: number, limit: number): Promise<StoredGameLog[]> {
    const listed = await this.ctx.storage.list<StoredGameLog>({ prefix: 'g:', start: keyOf(after + 1), limit });
    return [...listed.values()];
  }

  private async stats(): Promise<{ count: number; next: number; days: Record<string, number>; kinds: Record<string, number> }> {
    const count = (await this.ctx.storage.get<number>('count')) ?? 0;
    const next = (await this.ctx.storage.get<number>('next')) ?? 1;
    const days: Record<string, number> = {};
    const kinds: Record<string, number> = {};
    const listed = await this.ctx.storage.list<StoredGameLog>({ prefix: 'g:' });
    for (const row of listed.values()) {
      days[row.day] = (days[row.day] ?? 0) + 1;
      kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
    }
    return { count, next, days, kinds };
  }
}
