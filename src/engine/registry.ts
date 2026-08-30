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

export function card(id: string): CardDef {
  const c = registry.get(id);
  if (!c) throw new Error(`unknown card id: ${id}`);
  return c;
}

export function tryCard(id: string): CardDef | undefined {
  return registry.get(id);
}

export function allCards(): CardDef[] {
  return [...registry.values()];
}

/** Test helper. Not used by the client. */
export function resetRegistry(): void {
  registry.clear();
}
