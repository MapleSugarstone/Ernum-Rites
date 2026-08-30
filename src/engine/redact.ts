import type { GameState } from './state';
import type { CardDef, PlayerIdx } from './types';

/**
 * Stands in for anything the viewer is not allowed to see. It is a real
 * registered card so the client can render a redacted state without
 * special-casing every zone.
 */
export const HIDDEN_ID = 'hidden';

export const hiddenCard: CardDef = {
  id: HIDDEN_ID,
  name: 'Face down',
  color: 'R',
  type: 'spell',
  text: 'Hidden from you.',
};

/**
 * Strip everything `viewer` should not know before the state leaves the
 * authority. Face-down HP is hidden from both players: it was dealt off the
 * deck without either side looking at it.
 */
export function redactFor(state: GameState, viewer: PlayerIdx): GameState {
  const out: GameState = structuredClone(state);
  // The engine is deterministic from the seed, and every deck is a public list.
  // Handing a client the seed would let it replay both shuffles and read every
  // face-down card and future draw, which is exactly what the rest of this
  // function hides. The client never advances the authority itself, so it does
  // not need either value.
  out.seed = 0;
  out.rngState = 0;
  for (const idx of [0, 1] as PlayerIdx[]) {
    const p = out.players[idx];
    p.deck = p.deck.map(() => HIDDEN_ID);
    if (idx !== viewer) p.hand = p.hand.map(() => HIDDEN_ID);
    for (const s of [...p.slots, p.leader]) {
      if (!s) continue;
      s.hp = s.hp.map((h) => (h.flipped ? h : { ...h, cardId: HIDDEN_ID }));
    }
  }
  // A decision belongs to the player making it, and so does what it is looking
  // at. A flip offer names a face-down HP card, which neither side is supposed
  // to know: a declined flip has to go back to being unknown, not merely
  // unflipped. A reveal holds cards pulled off a deck for one player to choose
  // from, and the other player never sees the row.
  for (const offer of out.flipQueue) {
    if (offer.player !== viewer) offer.cardId = HIDDEN_ID;
  }
  for (const choice of out.choiceQueue) {
    if (choice.player !== viewer && choice.cards) {
      choice.cards = choice.cards.map(() => HIDDEN_ID);
    }
  }
  return out;
}

/**
 * What both players can see, and nothing else: every deck hidden, both hands
 * hidden, every face-down HP card hidden. Neither side's private information
 * survives, which is what makes it safe to digest and compare across the wire.
 *
 * This is the only projection two clients can agree on. A digest of the full
 * state would differ between them by construction, because each is holding a
 * different set of secrets.
 */
export function publicView(state: GameState): GameState {
  const out: GameState = structuredClone(state);
  // Blanked here too so the digest both sides compare does not depend on the
  // seed. redactFor already keeps it off the wire; zeroing it in the projection
  // as well is what makes the authority and a client agree once it is gone.
  out.seed = 0;
  out.rngState = 0;
  for (const idx of [0, 1] as PlayerIdx[]) {
    const p = out.players[idx];
    p.deck = p.deck.map(() => HIDDEN_ID);
    p.hand = p.hand.map(() => HIDDEN_ID);
    for (const s of [...p.slots, p.leader]) {
      if (!s) continue;
      s.hp = s.hp.map((h) => (h.flipped ? h : { ...h, cardId: HIDDEN_ID }));
    }
  }
  // Blanked for both sides, not per viewer: this is the one projection the two
  // clients have to agree on, and a value only one of them can see would make
  // every flip and every reveal look like a desync.
  for (const offer of out.flipQueue) offer.cardId = HIDDEN_ID;
  for (const choice of out.choiceQueue) {
    if (choice.cards) choice.cards = choice.cards.map(() => HIDDEN_ID);
  }
  return out;
}
