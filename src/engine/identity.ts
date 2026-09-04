import { card, tryCard } from './registry';
import { COLORS, type CardDef, type Color, type Cost } from './types';

/**
 * A card's colour identity. Dual cards carry both of theirs and triples all
 * three; a card may also declare a wider identity than its frame, which is how
 * the colourless test leader works.
 */
export function colorsOf(def: CardDef): Color[] {
  // A neutral card drags in no colour, so the subset test passes under any leader
  // and every deck may run it.
  if (def.color === 'N' || def.neutral) return [];
  if (def.identity && def.identity.length) return def.identity;
  // Ernum is not one of the six, so a card printed in it brings whatever identity
  // it spells out and nothing more.
  if (def.color === 'E') return [];
  const out: Color[] = [def.color];
  if (def.color2) out.push(def.color2);
  if (def.color3) out.push(def.color3);
  return out;
}

/**
 * The colours a deck may play, taken from whatever is standing as its leader.
 *
 * A leader brings its own colours plus every colour its costs are written in. The
 * Maestro is Solar and its power is paid in Pepper: without this it could never
 * legally run a card that pays for its own power. The rule reads off the card,
 * so a leader cannot demand mana its deck is forbidden to supply.
 */
export function deckIdentity(leaderId: string): Color[] {
  const def = tryCard(leaderId);
  if (!def) return [];
  const identity = [...colorsOf(def)];
  const add = (cost: Cost | undefined) => {
    if (!cost) return;
    for (const c of COLORS) {
      if ((cost[c] ?? 0) > 0 && !identity.includes(c)) identity.push(c);
    }
  };
  add(def.cost);
  for (const power of def.powers ?? []) add(power.cost);
  return identity;
}

/**
 * Colour identity works like a subset, not an overlap: every colour on a card
 * has to be one the leader already brings. A mono leader therefore cannot play dual
 * cards at all, and a dual leader unlocks both of its colours plus everything
 * inside them.
 */
export function isLegalUnder(def: CardDef, identity: Color[]): boolean {
  return colorsOf(def).every((c) => identity.includes(c));
}

export interface DeckLegality {
  ok: boolean;
  identity: Color[];
  /** Card ids that bring a colour the leader does not. */
  offColor: string[];
}

export function checkDeckColors(leaderId: string, cards: string[]): DeckLegality {
  const identity = deckIdentity(leaderId);
  const offColor: string[] = [];
  for (const id of new Set(cards)) {
    const def = tryCard(id);
    if (!def) continue;
    if (!isLegalUnder(def, identity)) offColor.push(id);
  }
  return { ok: offColor.length === 0, identity, offColor };
}

/** Anything with a body can stand as a leader, not just the dedicated leader cards. */
export function canBeLeader(cardId: string): boolean {
  const def = tryCard(cardId);
  if (!def) return false;
  return def.type === 'summon' && (def.hp ?? 0) > 0;
}

/** Every card in the pool that a given leader could legally run. */
export function legalPoolFor(leaderId: string, pool: CardDef[]): CardDef[] {
  const identity = deckIdentity(leaderId);
  return pool.filter((d) => isLegalUnder(d, identity));
}

export function identityLabel(identity: Color[]): string {
  return identity.join('') || '-';
}

export { card };
