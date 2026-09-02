/**
 * Draft: a hosted online format where a player builds from cards they open
 * rather than from the whole set.
 *
 * Everything here is shared by the room and the client, because the room rolls
 * the packs and settles what a legal draft deck is, and the client has to draw
 * the same pool and grey out the same cards. One copy of each rule means the two
 * can never come to different answers about the same pool.
 */
import { canBeLeader } from './identity';
import { counts, DECK_SIZE } from './decklist';
import { allCards, tryCard } from './registry';
import { randInt, type Rng } from './rng';
import type { Rarity } from './types';

/** Packs a player opens, and cards in each, so a pool is 120 cards. */
export const PACK_COUNT = 10;
export const PACK_SIZE = 12;

/**
 * How long the whole draft runs. Opening packs and building the deck share one
 * clock rather than getting one each: a player who tears through their packs
 * has earned the time they saved.
 */
export const DRAFT_SECONDS = 8 * 60;

/**
 * When the warning sounds, counted back from the end of the draft clock. It is
 * the length of the clip rather than the match clock's ten seconds, so the
 * countdown lands on zero instead of running past a deadline that boots people.
 */
export const DRAFT_WARN_MS = 12_500;

/** The tiers a pack rolls for, richest first. What is left over is Common. */
export const PACK_ODDS: { rarity: Rarity; chance: number }[] = [
  { rarity: 'L', chance: 0.05 },
  { rarity: 'E', chance: 0.1 },
  { rarity: 'R', chance: 0.2 },
];

/** The tier a card is drawn from. Prismatic is dealt out of the Legendary pool. */
type PackTier = 'C' | 'R' | 'E' | 'L';

function tierOf(rarity: Rarity): PackTier {
  return rarity === 'P' ? 'L' : rarity;
}

let pools: Record<PackTier, string[]> | null = null;

/**
 * Every card a pack may print, grouped by the tier it is drawn from. Sorted by
 * id, because the room rolls a pack off a seed and a test has to roll the same
 * one: an order that came out of registration order would move whenever a card
 * file did.
 */
export function packPools(): Record<PackTier, string[]> {
  if (pools) return pools;
  const built: Record<PackTier, string[]> = { C: [], R: [], E: [], L: [] };
  for (const def of allCards()) {
    if (!def.art || def.uncollectible) continue;
    built[tierOf(def.rarity ?? 'C')].push(def.id);
  }
  for (const tier of Object.keys(built) as PackTier[]) built[tier].sort();
  pools = built;
  return built;
}

/** One card, rolled against the odds table. */
function rollCard(rng: Rng): string {
  const pool = packPools();
  // Rolled out of one integer draw so the tier and the card come off the same
  // stream in a fixed order, which is what makes a seed reproduce a pack.
  const roll = randInt(rng, 10_000) / 10_000;
  let floor = 0;
  for (const { rarity, chance } of PACK_ODDS) {
    floor += chance;
    if (roll < floor) {
      const tier = pool[tierOf(rarity)];
      if (tier.length > 0) return tier[randInt(rng, tier.length)];
      break;
    }
  }
  const commons = pool.C;
  return commons[randInt(rng, commons.length)];
}

/** One pack. A card can repeat inside a pack; nothing says a pack may not. */
export function rollPack(rng: Rng): string[] {
  return Array.from({ length: PACK_SIZE }, () => rollCard(rng));
}

export function rollPacks(rng: Rng, packs = PACK_COUNT): string[][] {
  return Array.from({ length: packs }, () => rollPack(rng));
}

/** How many of each card a pool holds, which is what a deck may spend. */
export function poolCounts(pool: readonly string[]): Map<string, number> {
  return counts([...pool]);
}

/**
 * How many copies of each card a build has spent. The leader spends one of its
 * own: it came out of a pack like everything else and holds a seat rather than
 * a deck slot.
 */
export function spentCounts(leaderId: string, cards: readonly string[]): Map<string, number> {
  const spent = counts([...cards]);
  if (leaderId) spent.set(leaderId, (spent.get(leaderId) ?? 0) + 1);
  return spent;
}

/** Copies of one card the pool still has to give, at or above zero. */
export function copiesLeft(
  pool: readonly string[],
  leaderId: string,
  cards: readonly string[],
  id: string,
): number {
  return Math.max(0, (poolCounts(pool).get(id) ?? 0) - (spentCounts(leaderId, cards).get(id) ?? 0));
}

/**
 * Everything wrong with a draft deck, in the order a builder would want to fix
 * it. The two constructed rules are off: a draft deck may run as many copies of
 * a card as it opened, and its colours need not sit inside its leader's
 * identity. What replaces them is the pool, which is the only thing a drafted
 * deck is allowed to be built from.
 */
export function draftProblems(
  leaderId: string | null,
  cards: string[],
  pool: readonly string[],
): string[] {
  const out: string[] = [];
  if (!leaderId) out.push('Pick a leader: press lead under any summon in your pool.');
  else if (!canBeLeader(leaderId)) out.push('That card cannot be a leader.');

  const have = poolCounts(pool);
  const spent = spentCounts(leaderId ?? '', cards);
  const over: string[] = [];
  for (const [id, n] of spent) {
    if (n <= (have.get(id) ?? 0)) continue;
    const def = tryCard(id);
    over.push(def ? def.name : id);
  }
  if (over.length > 0) out.push(`More copies than you opened: ${over.join(', ')}.`);
  if (cards.length !== DECK_SIZE) out.push(`${cards.length}/${DECK_SIZE} cards.`);
  return out;
}

export function draftDeckLegal(
  leaderId: string | null,
  cards: string[],
  pool: readonly string[],
): boolean {
  return draftProblems(leaderId, cards, pool).length === 0;
}

/**
 * Whether a build could still become a legal deck. A part-built deck the client
 * sends up while the clock runs is not legal yet, but it must never hold a card
 * the player did not open: that is the half of the rule the room has to check on
 * every message rather than only at the end.
 */
export function withinPool(
  leaderId: string | null,
  cards: string[],
  pool: readonly string[],
): boolean {
  if (leaderId && !canBeLeader(leaderId)) return false;
  if (cards.length > DECK_SIZE) return false;
  const have = poolCounts(pool);
  for (const [id, n] of spentCounts(leaderId ?? '', cards)) {
    if (n > (have.get(id) ?? 0)) return false;
  }
  return true;
}

/**
 * Finish a deck the player ran out of time on. Whatever they had built stands
 * and the rest comes off the cards they opened and did not use, so a player who
 * spent their eight minutes on forty cards keeps all forty. A leaderless build
 * is given one of its own summons.
 *
 * The result is legal whenever the pool holds a summon and enough cards, which
 * a full opening always does.
 */
export function autofill(
  rng: Rng,
  pool: readonly string[],
  leaderId: string,
  cards: string[],
): { leaderId: string; cards: string[] } {
  const out = { leaderId, cards: [...cards] };
  const spare = (): string[] => {
    const left = poolCounts(pool);
    for (const [id, n] of spentCounts(out.leaderId, out.cards)) {
      left.set(id, (left.get(id) ?? 0) - n);
    }
    const rest: string[] = [];
    for (const [id, n] of left) for (let i = 0; i < n; i++) rest.push(id);
    return rest.sort();
  };

  if (!out.leaderId || !canBeLeader(out.leaderId)) {
    const bodies = spare().filter((id) => canBeLeader(id));
    // A pool with no summon at all cannot happen at this many packs, but a deck
    // with no leader cannot start a match, so the whole set is the last resort.
    const from = bodies.length > 0 ? bodies : allCards().filter((d) => canBeLeader(d.id)).map((d) => d.id).sort();
    if (from.length > 0) out.leaderId = from[randInt(rng, from.length)];
  }

  const rest = spare();
  while (out.cards.length < DECK_SIZE && rest.length > 0) {
    out.cards.push(rest.splice(randInt(rng, rest.length), 1)[0]);
  }
  return out;
}
