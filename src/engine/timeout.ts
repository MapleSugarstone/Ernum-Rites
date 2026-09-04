/**
 * What the room plays for a player whose clock ran out.
 *
 * The rule is always the same: take the most passive legal option. A player who
 * ran out of time did not choose anything, so the game must not choose something
 * for them that a thinking player might not have picked. Declining a trap costs
 * nothing that was not already lost; springing one would spend a card they were
 * still deciding about.
 *
 * The order below is `currentActor`'s order and has to stay that way. The engine
 * refuses an answer to a window that something else is queued in front of, and a
 * refused answer is a clock the room has already spent with the position exactly
 * where it was.
 */
import type { Action } from './actions';
import { tryCard } from './registry';
import { currentActor, findSummon, type GameState } from './state';

/**
 * The action to force. Returns null only when the position asks something that
 * has no passive answer, which the caller should treat as a loss on time rather
 * than guess at.
 */
export function timeoutAction(state: GameState): Action | null {
  const me = currentActor(state);

  // A costed flip holds the blow that revealed it, so it is answered before the
  // window that blow opened. Letting the card lie is the passive read, and it is
  // what a player who stopped responding would get anyway.
  if (state.flipQueue.length > 0 && state.flipQueue[0].player === me) {
    return { type: 'DECLINE_FLIP' };
  }

  // A Store window. The buyer walking away is the passive answer. The seller
  // has no walk-away: the rules guarantee a buyer can always buy at the top of
  // the slider, so a silent seller is taken to have said exactly that.
  if (state.pending?.kind === 'store') {
    const w = state.pending;
    if (me === w.buyer) return { type: 'STORE_REJECT' };
    const s = findSummon(state, w.source);
    const surcharge = (s && tryCard(s.cardId)?.store?.surcharge) || 0;
    return { type: 'STORE_OFFER', price: 4 + surcharge, final: true };
  }

  // A trap window or a spell response: let it through unanswered.
  if (state.pending?.player === me) return { type: 'PASS_RESPONSE' };

  // A deferred pick. Resolving with no pick is legal when the choice is optional
  // and the engine says so; otherwise the first offered target is the only way
  // out, and taking it beats hanging the match.
  const choice = state.choiceQueue[0];
  if (choice && choice.player === me) {
    if (choice.optional) return { type: 'RESOLVE_CHOICE' };
    if (choice.cards && choice.legal && choice.legal.length > 0) {
      return { type: 'RESOLVE_CHOICE', index: choice.legal[0] };
    }
    if (choice.refs && choice.refs.length > 0) {
      return { type: 'RESOLVE_CHOICE', pick: choice.refs[0] };
    }
    return { type: 'RESOLVE_CHOICE' };
  }

  // A hole to fill: leaving it open is the passive read, and it is what a player
  // who stopped responding would get anyway.
  if (state.replaceQueue.length > 0 && state.replaceQueue[0].player === me) {
    return { type: 'DECLINE_REPLACE' };
  }

  // Nothing queued, so it is their main phase and the passive move is to end it.
  return { type: 'END_TURN' };
}
