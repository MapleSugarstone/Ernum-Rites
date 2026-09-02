import { rarityForCard, type CardDef, type Rarity } from './types';

const registry = new Map<string, CardDef>();

/**
 * Every card is classified here rather than at its definition, so no card file
 * can print a rarity its rules text does not earn.
 */
export function registerCards(cards: CardDef[]): void {
  for (const c of cards) {
    if (registry.has(c.id)) throw new Error(`duplicate card id: ${c.id}`);
    c.rarity = rarityForCard(c);
    registry.set(c.id, c);
  }
}

/**
 * Cards the game builds mid-match: fusions, hacked copies, spells given legs.
 * Ids are deterministic functions of their inputs, so both engines and every
 * replay of the same game mint the same card, and re-registering the same id
 * is a no-op rather than an error.
 */
export function registerGenerated(def: CardDef, rarity?: Rarity): string {
  if (!registry.has(def.id)) {
    // Rarity is normally read off the card's own text, which a minted card has
    // no say in. One passed in here overrides that, for the few whose standing
    // is a fact about what they are rather than about how much they print.
    def.rarity = rarity ?? rarityForCard(def);
    registry.set(def.id, def);
  }
  return def.id;
}

export function isGenerated(id: string): boolean {
  return id.startsWith('gen-');
}

/**
 * Rebuilds a card the game minted mid-match, from its id alone.
 *
 * Only the engine that ran the effect ever minted the card. Online a client is
 * handed the finished state rather than the actions behind it, so the seat that
 * did not cast the spell holds a board naming a card its own registry has never
 * seen: no art, no name, no printed Powers. Rebuilding from the id closes that,
 * and it works precisely because a generated id carries everything its mint
 * took.
 *
 * Set by generated.ts at load, because the builders live there and importing
 * them here would be a cycle.
 */
let rebuildGenerated: ((id: string) => void) | null = null;

export function setGeneratedRebuilder(fn: (id: string) => void): void {
  rebuildGenerated = fn;
}

/** The card, minting it first if it is a generated one this build can rebuild. */
function found(id: string): CardDef | undefined {
  const hit = registry.get(id);
  if (hit || !rebuildGenerated || !isGenerated(id)) return hit;
  try {
    rebuildGenerated(id);
  } catch {
    // An id this build cannot read is not worth throwing over here; the caller
    // sees the same miss it would have seen anyway.
    return undefined;
  }
  return registry.get(id);
}

export function card(id: string): CardDef {
  const c = found(id);
  if (!c) throw new Error(`unknown card id: ${id}`);
  return c;
}

export function tryCard(id: string): CardDef | undefined {
  return found(id);
}

export function allCards(): CardDef[] {
  return [...registry.values()];
}

/** Test helper. Not used by the client. */
export function resetRegistry(): void {
  registry.clear();
}
