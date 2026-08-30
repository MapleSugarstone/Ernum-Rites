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
  for (const idx of [0, 1] as PlayerIdx[]) {
    const p = out.players[idx];
    p.deck = p.deck.map(() => HIDDEN_ID);
    if (idx !== viewer) p.hand = p.hand.map(() => HIDDEN_ID);
    for (const s of [...p.slots, p.leader]) {
      if (!s) continue;
      s.hp = s.hp.map((h) => (h.flipped ? h : { ...h, cardId: HIDDEN_ID }));
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
  for (const idx of [0, 1] as PlayerIdx[]) {
    const p = out.players[idx];
    p.deck = p.deck.map(() => HIDDEN_ID);
    p.hand = p.hand.map(() => HIDDEN_ID);
    for (const s of [...p.slots, p.leader]) {
      if (!s) continue;
      s.hp = s.hp.map((h) => (h.flipped ? h : { ...h, cardId: HIDDEN_ID }));
    }
  }
  return out;
}
