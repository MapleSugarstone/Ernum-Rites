import { allCards, card, tryCard } from '../engine/registry';
import { canBeLeader, colorsOf, deckIdentity } from '../engine/identity';
import { DECK_SIZE, counts, deckProblems } from '../engine/decklist';

export { DECK_SIZE, counts };
import {
  COLORS,
  COLOR_NAME,
  COPY_LIMIT,
  RARITY_NAME,
  type CardDef,
  type Color,
  type Rarity,
} from '../engine/types';

/** A deck the player built and kept. Stored as plain data so it survives a reload. */
export interface SavedDeck {
  key: string;
  name: string;
  leaderId: string;
  cards: string[];
  /** A line the player writes for themselves. Older saves have none. */
  blurb?: string;
}

export const DECK_NAME_MAX = 28;
/** The longest starter blurb is Aetus Vox's at 103, so this leaves a little room. */
export const DECK_BLURB_MAX = 110;

/** Why this deck name cannot be saved, or null when it is fine. */
export function deckNameProblem(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return 'Give the deck a name.';
  if (name.length > DECK_NAME_MAX) return `A name is at most ${DECK_NAME_MAX} characters.`;
  return null;
}

/** One note about one card, collected in dev mode and exported in a batch. */
export interface Suggestion {
  cardId: string;
  note: string;
  at: string;
}

const DECKS_KEY = 'ernumrites.decks';
const NOTES_KEY = 'ernumrites.suggestions';
/** Keys used before the game was named. Read once, then migrated forward. */
const LEGACY_KEYS: Record<string, string> = {
  [DECKS_KEY]: 'selatza.decks',
  [NOTES_KEY]: 'selatza.suggestions',
};

/** The tabs across the card browser: five colours, then everything dual. */
/** A tab in the card browser: the five colours, then dual, then neutral. */
export type BrowseTab = Color | 'M' | 'N';
export const BROWSE_TABS: BrowseTab[] = [...COLORS, 'M', 'N'];

/** Rarity filter chips, in the order they print on a card. */
export const RARITY_FILTERS: Rarity[] = ['C', 'R', 'E', 'L', 'P'];

export interface BuilderState {
  name: string;
  leaderId: string;
  cards: string[];
  tab: BrowseTab;
  search: string;
  /** Rarities to show. Empty means every rarity, which is the usual case. */
  rarities: Rarity[];
  editingKey: string | null;
  dev: boolean;
  suggestFor: string | null;
  /** A line the player writes about the deck, kept alongside the name. */
  blurb: string;
  /** Which button opened the save dialog, or null while it is closed. */
  saving: 'save' | 'play' | null;
}

export function newBuilder(): BuilderState {
  return {
    name: '',
    leaderId: 'fh-thefish',
    cards: [],
    tab: 'F',
    search: '',
    rarities: [],
    editingKey: null,
    dev: false,
    suggestFor: null,
    blurb: '',
    saving: null,
  };
}

// --- storage ----------------------------------------------------------------

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(LEGACY_KEYS[key] ?? '');
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled store is not worth taking the page down for.
  }
}

export function savedDecks(): SavedDeck[] {
  // Decks saved before the rename carry heroId where leaderId now goes.
  return readJson<(SavedDeck & { heroId?: string })[]>(DECKS_KEY, []).map((d) => ({
    ...d,
    leaderId: d.leaderId ?? d.heroId ?? '',
  }));
}

export function saveDeck(d: SavedDeck): void {
  const all = savedDecks().filter((x) => x.key !== d.key);
  all.push(d);
  writeJson(DECKS_KEY, all);
}

export function deleteDeck(key: string): void {
  writeJson(
    DECKS_KEY,
    savedDecks().filter((d) => d.key !== key),
  );
}

export function suggestions(): Suggestion[] {
  return readJson<Suggestion[]>(NOTES_KEY, []);
}

export function addSuggestion(cardId: string, note: string): void {
  const all = suggestions();
  all.push({ cardId, note, at: new Date().toISOString() });
  writeJson(NOTES_KEY, all);
}

export function clearSuggestions(): void {
  writeJson(NOTES_KEY, []);
}

// --- legality ---------------------------------------------------------------




/** Everything wrong with a deck, in the order a builder would want to fix it. */
export function problems(b: BuilderState): string[] {
  return deckProblems(b.leaderId, b.cards);
}

export function isLegal(b: BuilderState): boolean {
  return problems(b).length === 0;
}

export function canAdd(b: BuilderState, id: string): boolean {
  const def = tryCard(id);
  if (!def) return false;
  if (!b.leaderId) return false;
  if (b.cards.length >= DECK_SIZE) return false;
  if ((counts(b.cards).get(id) ?? 0) >= COPY_LIMIT) return false;
  return colorsOf(def).every((c) => deckIdentity(b.leaderId).includes(c));
}

// --- the card browser -------------------------------------------------------

export interface Section {
  title: string;
  cards: CardDef[];
}

function playable(d: CardDef): boolean {
  return !!d.art && !d.uncollectible;
}

/** The cards on one tab, split into the groups a deckbuilder thinks in. */
export function browseSections(tab: BrowseTab): Section[] {
  const pool = allCards().filter((d) => {
    if (!playable(d)) return false;
    // Neutral cards carry a colour only so the frame has something to draw
    // with, so they have to be pulled off that colour's tab explicitly.
    if (tab === 'N') return !!d.neutral;
    if (d.neutral) return false;
    // Mixed is anything carrying more than one colour, however it says so: most
    // spell it with color2, but a card with more colours than that slot holds
    // writes them out in identity instead.
    const mixed = !!d.color2 || (d.identity?.length ?? 0) > 1;
    return tab === 'M' ? mixed : d.color === tab && !mixed;
  });
  const by = (fn: (d: CardDef) => boolean) =>
    pool.filter(fn).sort((a, b) => a.name.localeCompare(b.name));
  return [
    { title: 'Level 1', cards: by((d) => d.type === 'summon' && (d.level ?? 1) === 1) },
    { title: 'Level 2', cards: by((d) => d.type === 'summon' && d.level === 2) },
    {
      title: 'Level 3',
      cards: by((d) => d.type === 'summon' && d.level === 3 && !d.color3),
    },
    // Triples want a leader that brings all three colours, so they are a
    // different shopping decision from the rest of the Mixed tab.
    { title: 'Three colors', cards: by((d) => !!d.color3) },
    { title: 'Spells', cards: by((d) => d.type === 'spell') },
    { title: 'Traps', cards: by((d) => d.type === 'trap') },
    { title: 'Fields', cards: by((d) => d.type === 'stage') },
  ].filter((s) => s.cards.length > 0);
}

/**
 * Does a card survive the search box and the rarity chips? The typed query
 * matches a card's name, its rules text, or the name of its rarity, so
 * "legendary" finds the same cards the Legendary chip does.
 */
export function matchesSearch(d: CardDef, query: string, rarities: Rarity[]): boolean {
  if (rarities.length > 0 && !rarities.includes(d.rarity ?? 'C')) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    d.name.toLowerCase().includes(q) ||
    (d.text ?? '').toLowerCase().includes(q) ||
    RARITY_NAME[d.rarity ?? 'C'].toLowerCase().includes(q)
  );
}

/** Every body that may stand as a leader, grouped by the colours it brings. */
export function leaderChoices(): { label: string; cards: CardDef[] }[] {
  const groups = new Map<string, CardDef[]>();
  for (const d of allCards()) {
    if (!d.art || d.uncollectible || !canBeLeader(d.id)) continue;
    const colours = colorsOf(d);
    const label = colours.length ? colours.map((c) => COLOR_NAME[c]).join(' and ') : 'Neutral';
    const list = groups.get(label) ?? [];
    list.push(d);
    groups.set(label, list);
  }
  return [...groups.entries()]
    .map(([label, cards]) => ({
      label,
      cards: cards.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// --- export -----------------------------------------------------------------

/** The suggestion list as markdown, ready to hand to someone who can act on it. */
export function suggestionsMarkdown(notes: Suggestion[]): string {
  const lines = ['# Card change suggestions', ''];
  lines.push(`${notes.length} suggestion${notes.length === 1 ? '' : 's'}, newest last.`, '');
  const byCard = new Map<string, Suggestion[]>();
  for (const n of notes) {
    const list = byCard.get(n.cardId) ?? [];
    list.push(n);
    byCard.set(n.cardId, list);
  }
  for (const [id, list] of byCard) {
    const def = tryCard(id);
    lines.push(`## ${def ? def.name : id}`, '');
    if (def) {
      const stats =
        def.type === 'summon'
          ? `level ${def.level ?? 1}, ${def.strength ?? 0}/${def.hp ?? 0}`
          : def.type;
      lines.push(`\`${id}\` · ${COLOR_NAME[def.color]} · ${stats}`, '');
      if (def.text) lines.push(`> ${def.text}`, '');
      if (def.flipText) lines.push(`> FLIP: ${def.flipText}`, '');
    }
    for (const n of list) lines.push(`- ${n.note}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function deckMarkdown(b: BuilderState): string {
  const leader = tryCard(b.leaderId);
  const lines = [`${b.name}`, `leader: ${leader?.name ?? b.leaderId} [${b.leaderId}]`, ''];
  for (const [id, n] of [...counts(b.cards)].sort((a, c) => a[0].localeCompare(c[0]))) {
    lines.push(`  ${n}x ${card(id).name} [${id}]`);
  }
  return lines.join('\n');
}

export interface ParsedDeck {
  name: string;
  leaderId: string;
  cards: string[];
  /** Lines that named a card this build does not have, or could not be read. */
  skipped: string[];
}

/**
 * Reads back what deckMarkdown writes. The bracketed id is what is trusted, not
 * the name printed beside it: names are cosmetic and get retitled between sets,
 * while an id that no longer exists is a real problem worth reporting rather
 * than guessing around. Anything unreadable is skipped and named, so an import
 * never half-succeeds in silence.
 */
export function parseDeckList(text: string): ParsedDeck {
  const lines = text.split(/\r?\n/);
  const out: ParsedDeck = { name: '', leaderId: '', cards: [], skipped: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const leader = /^leader:\s*.*\[([^\]]+)\]\s*$/i.exec(line);
    if (leader) {
      const id = leader[1].trim();
      if (tryCard(id)) out.leaderId = id;
      else out.skipped.push(line);
      continue;
    }
    const entry = /^(\d+)\s*x\s+.*\[([^\]]+)\]\s*$/i.exec(line);
    if (entry) {
      const n = Number(entry[1]);
      const id = entry[2].trim();
      if (!tryCard(id) || !Number.isFinite(n) || n < 1) {
        out.skipped.push(line);
        continue;
      }
      for (let i = 0; i < n; i++) out.cards.push(id);
      continue;
    }
    // The first line that is neither is the deck's name.
    if (!out.name) out.name = line;
    else out.skipped.push(line);
  }
  return out;
}

/** Hands the browser a file. Only reachable from a real click, which is enough. */
export function download(filename: string, text: string, type = 'text/markdown'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
