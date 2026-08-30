import { canBeLeader, colorsOf, deckIdentity } from './identity';
import { tryCard } from './registry';
import { COPY_LIMIT } from './types';

/** How many cards a legal deck holds. */
export const DECK_SIZE = 48;

/** How many of each card sit in a list, keyed by card id. */
export function counts(cards: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of cards) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/**
 * Everything wrong with a deck, in the order a builder would want to fix it.
 *
 * Lives in the engine rather than beside the builder because the room checks
 * decks too: a deck the player built travels with their join, and the authority
 * cannot take a client's word that it is legal. One copy of the rule means the
 * two can never come to different answers about the same list.
 */
export function deckProblems(leaderId: string | null, cards: string[]): string[] {
  const out: string[] = [];
  if (!leaderId) out.push('Pick a leader: drag any summon onto the leader slot.');
  else if (!canBeLeader(leaderId)) out.push('That card cannot be a leader.');
  const identity = leaderId ? deckIdentity(leaderId) : [];
  const off = new Set<string>();
  for (const [id, n] of counts(cards)) {
    const def = tryCard(id);
    if (!def) continue;
    if (!colorsOf(def).every((c) => identity.includes(c))) off.add(def.name);
    if (n > COPY_LIMIT) out.push(`${def.name}: ${n} copies (limit ${COPY_LIMIT}).`);
  }
  if (off.size > 0) out.push(`Outside your leader's colors: ${[...off].join(', ')}.`);
  if (cards.length !== DECK_SIZE) out.push(`${cards.length}/${DECK_SIZE} cards.`);
  return out;
}
