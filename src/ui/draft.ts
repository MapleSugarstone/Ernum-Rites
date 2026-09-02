/**
 * The client's half of a draft: the packs the room dealt, what has been opened
 * out of them, and the deck being cut from the result.
 *
 * The rules themselves are not here. Which cards a pool may spend and when a
 * deck is finished both live in src/engine/draft.ts, because the room settles
 * the same questions and the two must never disagree.
 */
import { copiesLeft, PACK_COUNT, poolCounts, spentCounts } from '../engine/draft';
import { canBeLeader } from '../engine/identity';
import { card, tryCard } from '../engine/registry';
import type { CardDef, Rarity } from '../engine/types';

export interface DraftState {
  /** Every pack the room dealt, exactly as it dealt them. */
  packs: string[][];
  /** The pack on the table, counting from zero. */
  pack: number;
  /** The ten cards showing, or null while the pack is still shut. */
  revealed: string[] | null;
  /** Every card out of every pack opened so far: what the deck is cut from. */
  pool: string[];
  leaderId: string;
  cards: string[];
  /** The room's deadline and the length it granted, both for the bar. */
  endsAt: number;
  totalMs: number;
  /** Set once the deck has gone up as finished and the wait is on. */
  done: boolean;
  status: { done: number; needed: number; waiting: string[] } | null;
  /** The book's own controls, the two the deckbuilder has. */
  search: string;
  rarities: Rarity[];
  /** The book shows the deck itself, card by card, instead of the pool. */
  viewingDeck: boolean;
  /** A card being read close up, or null. */
  inspect: string | null;
  /** True while the pointer is held on the pack and it is coming apart. */
  holding: boolean;
  /** The white wash over the whole screen, drawn for one moment per pack. */
  flashing: boolean;
}

export function newDraft(): DraftState {
  return {
    packs: [],
    pack: 0,
    revealed: null,
    pool: [],
    leaderId: '',
    cards: [],
    endsAt: 0,
    totalMs: 0,
    done: false,
    status: null,
    search: '',
    rarities: [],
    viewingDeck: false,
    inspect: null,
    holding: false,
    flashing: false,
  };
}

/** Whether every pack has been opened, which is what the room boots over. */
export function packsAllOpen(d: DraftState): boolean {
  return d.pack >= Math.min(PACK_COUNT, d.packs.length) && d.revealed === null;
}

/** How long the pointer must stay down for a pack to come apart. */
export const PACK_HOLD_MS = 1100;

/** The wash over the screen as the cards arrive, and the time it takes to clear. */
export const PACK_FLASH_MS = 420;

/** Copies of one card the pool has left to give. */
export function leftOf(d: DraftState, id: string): number {
  return copiesLeft(d.pool, d.leaderId, d.cards, id);
}

/** Whether one more copy can go into the deck. */
export function canTake(d: DraftState, id: string, deckSize: number): boolean {
  if (d.cards.length >= deckSize) return false;
  return leftOf(d, id) > 0;
}

export interface Section {
  title: string;
  cards: CardDef[];
}

/**
 * The pool as a book, one cell per distinct card, in the groups a builder thinks
 * in. It is the deckbuilder's own grouping less the colour tabs, which a pool
 * this size has no use for.
 */
export function draftSections(pool: readonly string[]): Section[] {
  const seen = [...poolCounts(pool).keys()]
    .map((id) => tryCard(id))
    .filter((d): d is CardDef => !!d);
  const by = (fn: (d: CardDef) => boolean) =>
    seen.filter(fn).sort((a, b) => a.name.localeCompare(b.name));
  return [
    { title: 'Level 1', cards: by((d) => d.type === 'summon' && (d.level ?? 1) === 1) },
    { title: 'Level 2', cards: by((d) => d.type === 'summon' && d.level === 2) },
    { title: 'Level 3', cards: by((d) => d.type === 'summon' && d.level === 3) },
    { title: 'Spells', cards: by((d) => d.type === 'spell') },
    { title: 'Traps', cards: by((d) => d.type === 'trap') },
    { title: 'Fields', cards: by((d) => d.type === 'stage') },
  ].filter((s) => s.cards.length > 0);
}

/** Every copy in the deck, one entry each, in the order the deck list uses. */
export function deckCopies(cards: readonly string[]): CardDef[] {
  const rank = (d: CardDef) =>
    d.type === 'summon' ? (d.level ?? 1) : d.type === 'spell' ? 4 : d.type === 'trap' ? 5 : 6;
  return cards
    .map((id) => card(id))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Leader-capable cards in the pool, grouped the way the deckbuilder groups them. */
export function draftLeaders(
  pool: readonly string[],
  label: (id: string) => string,
): { label: string; cards: CardDef[] }[] {
  const groups = new Map<string, CardDef[]>();
  for (const id of poolCounts(pool).keys()) {
    const def = tryCard(id);
    if (!def || !canBeLeader(id)) continue;
    const key = label(id);
    const list = groups.get(key) ?? [];
    list.push(def);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([k, cards]) => ({ label: k, cards: cards.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The deck as rows, one per distinct card, in the order the deckbuilder uses. */
export function deckRows(cards: readonly string[]): { def: CardDef; n: number }[] {
  const rank = (d: CardDef) =>
    d.type === 'summon' ? (d.level ?? 1) : d.type === 'spell' ? 4 : d.type === 'trap' ? 5 : 6;
  return [...spentCounts('', cards)]
    .map(([id, n]) => ({ def: card(id), n }))
    .sort((a, b) => rank(a.def) - rank(b.def) || a.def.name.localeCompare(b.def.name));
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * How far to push a carried pack back so it sits inside the window.
 *
 * Returned as a correction to apply to the offset rather than a new offset,
 * because the caller measures the pack after it has been drawn: a pack that is
 * still growing covers more ground under the same offset, so where its edges
 * ended up is the only thing worth reading. Dragging it at a corner therefore
 * comes to rest against two sides at once instead of stopping at one.
 */
export function windowOverflow(
  rect: Box,
  win: { width: number; height: number },
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.min(0, rect.left - margin) + Math.max(0, rect.right - (win.width - margin)),
    y: Math.min(0, rect.top - margin) + Math.max(0, rect.bottom - (win.height - margin)),
  };
}

/** Minutes and seconds, for the number beside the draft bar. */
export function clockText(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
