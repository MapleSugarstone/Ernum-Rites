import { allCards, card, tryCard } from '../engine/registry';
import { canBeLeader, colorsOf, deckIdentity } from '../engine/identity';
import { DECK_SIZE, counts, deckProblems } from '../engine/decklist';
import { requestPersistence } from './prefs';

export { DECK_SIZE, counts };
import {
  COLORS,
  COLOR_ART,
  COLOR_NAME,
  COPY_LIMIT,
  RARITY_NAME,
  type CardColour,
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
  if (name.length === 0) return 'Enter a name for the deck.';
  if (name.length > DECK_NAME_MAX) return `A name is at most ${DECK_NAME_MAX} characters.`;
  return null;
}

/**
 * A free name for a copy of one. Trimmed to fit the limit, and numbered when an
 * earlier copy already holds the obvious one, so copying twice does not produce
 * two decks the player cannot tell apart in the list.
 */
export function copyName(name: string, taken: string[] = savedDecks().map((d) => d.name)): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const base = name.trim().replace(/ copy(\s+\d+)?$/i, '').trim() || 'Deck';
  const fit = (suffix: string) =>
    `${base.slice(0, Math.max(1, DECK_NAME_MAX - suffix.length)).trim()}${suffix}`;
  let candidate = fit(' copy');
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = fit(` copy ${n}`);
  return candidate;
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
  saving: 'save' | 'play' | 'copy' | null;
  /** The book shows the deck itself, card by card, instead of the collection. */
  viewingDeck: boolean;
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
    viewingDeck: false,
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
  // Everything through here is the player keeping something, which is the one
  // moment worth asking the browser to hold on to it.
  void requestPersistence();
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

/**
 * The cards on one tab, split into the groups a deckbuilder thinks in. Pass
 * 'ALL' for every collectable card at once, which is what a search runs over so
 * a tribe or a colour the current tab does not hold still turns up.
 */
export function browseSections(tab: BrowseTab | 'ALL'): Section[] {
  const pool = allCards().filter((d) => {
    if (!playable(d)) return false;
    if (tab === 'ALL') return true;
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
 * Every card in the deck, one entry per copy, ordered the way the deck list
 * beside the book orders them. The leader is not among them: it holds a seat
 * rather than one of the slots.
 */
export function deckCards(cards: readonly string[]): CardDef[] {
  const rank = (d: CardDef) =>
    d.type === 'summon' ? (d.level ?? 1) : d.type === 'spell' ? 4 : d.type === 'trap' ? 5 : 6;
  return cards
    .map((id) => card(id))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** What each card type is called where a player meets it, for the search index. */
const TYPE_WORDS: Record<CardDef['type'], string[]> = {
  summon: ['Summon'],
  spell: ['Spell'],
  trap: ['Trap'],
  stage: ['Field', 'Stage'],
};

/**
 * Everything about one card the search box looks through, lowercased and joined
 * by spaces: its name, its colours under both the names the game uses and the
 * plain ones the art is drawn in, its tribes, its type, its rarity, its level,
 * and every line printed on it including each Power and the flip.
 */
function searchIndex(d: CardDef): string {
  const parts: string[] = [d.name, d.id, ...TYPE_WORDS[d.type], RARITY_NAME[d.rarity ?? 'C']];
  const colours = colorsOf(d);
  if (colours.length === 0) parts.push(COLOR_NAME.N);
  for (const c of colours) parts.push(COLOR_NAME[c], COLOR_ART[c]);
  if (colours.length > 1) parts.push('Mixed', 'Dual');
  parts.push(...(d.factions ?? []));
  if (d.type === 'summon') parts.push(`Level ${d.level ?? 1}`);
  if (d.text) parts.push(d.text);
  if (d.note) parts.push(d.note);
  for (const p of d.powers ?? []) parts.push(p.name, p.text);
  if (d.flipText) parts.push(d.flipText);
  if (d.artist) parts.push(d.artist);
  if (d.num) parts.push(d.num);
  return parts.join(' ').toLowerCase();
}

// Card definitions never change once the registry is built, so each card is
// only ever flattened once however many keystrokes the search box takes.
const indexCache = new Map<string, string>();

function indexOf(d: CardDef): string {
  let text = indexCache.get(d.id);
  if (text === undefined) {
    text = searchIndex(d);
    indexCache.set(d.id, text);
  }
  return text;
}

/** One line of the colour tally under the deck. */
export interface ColorTally {
  color: CardColour;
  /** Cards in the deck that carry this colour. */
  n: number;
}

/**
 * The one colour a card is counted under: the colour its frame and its art are
 * drawn in. A dual card carries a second colour in its identity but is only ever
 * printed in one, so the tally adds up to the deck's own size.
 */
function primaryColor(d: CardDef): CardColour {
  return d.neutral ? 'N' : d.color;
}

/**
 * How many of the deck's cards each colour contributes, in the order the browser
 * tabs run.
 */
export function colorCounts(cards: readonly string[]): ColorTally[] {
  const tally = new Map<CardColour, number>();
  for (const id of cards) {
    const def = tryCard(id);
    if (!def) continue;
    const c = primaryColor(def);
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  return [...COLORS, 'E' as const, 'N' as const]
    .filter((c) => tally.has(c))
    .map((c) => ({ color: c, n: tally.get(c) ?? 0 }));
}

/**
 * Does a card survive the search box and the rarity chips? A query that reads as
 * a phrase on some card is taken as that phrase, so "level 3" answers with the
 * level 3 cards rather than with everything holding a 3. Only when no card
 * prints the phrase does each word have to match on its own, which is what makes
 * "pepper trap" find the Pepper traps.
 */
export function matchesSearch(d: CardDef, query: string, rarities: Rarity[]): boolean {
  if (rarities.length > 0 && !rarities.includes(d.rarity ?? 'C')) return false;
  const phrase = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!phrase) return true;
  const hay = indexOf(d);
  if (hay.includes(phrase)) return true;
  if (phraseIsPrinted(phrase)) return false;
  return phrase.split(' ').every((w) => hay.includes(w));
}

// Whether any collectable card prints the phrase, so the fallback to matching
// each word on its own only opens when no card answers the phrase itself.
const phraseCache = new Map<string, boolean>();

function phraseIsPrinted(phrase: string): boolean {
  let known = phraseCache.get(phrase);
  if (known === undefined) {
    known = allCards().some((d) => playable(d) && indexOf(d).includes(phrase));
    phraseCache.set(phrase, known);
  }
  return known;
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
