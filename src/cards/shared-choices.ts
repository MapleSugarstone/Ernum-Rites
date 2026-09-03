import { registerChoiceResolver } from '../engine/choices';
import { chooseBoard, discardSpellRefs, drawCards } from '../engine/effects';
import {
  addWounds,
  assignHp,
  catchHp,
  dealDamage,
  effectDamageOf,
  log,
  removeFromDebt,
  toHand,
  unflipHp,
} from '../engine/effects';
import { oilCopy, robotCopy } from '../engine/generated';
import { card } from '../engine/registry';
import { findSummon, type GameState } from '../engine/state';
import type { TargetRef } from '../engine/types';

function reinforce(state: GameState, ref: TargetRef, count: number): void {
  const s = findSummon(state, ref);
  if (s) assignHp(state, s, count);
}

function buffPermanent(
  state: GameState,
  ref: TargetRef,
  amount: number,
  source: string,
): void {
  const s = findSummon(state, ref);
  if (s) s.strengthMods.push({ amount, duration: 'permanent', source });
}

/**
 * The small vocabulary of deferred board picks the set shares. Each key is
 * registered under the same name in the C# engine; a card only stores the key.
 */

/**
 * Kapigras takes the seat it was pointed at and wears that leader's card. The
 * seat is read rather than the body, so a leader that has not entered yet is
 * copied from the card its deck names.
 */
registerChoiceResolver('kapigras', (state, choice, pick) => {
  if (pick.ref?.kind !== 'leader' || !choice.at) return;
  const body = findSummon(state, choice.at);
  if (!body) return;
  const copyId = oilCopy(state.players[pick.ref.player].leaderCardId);
  body.cardId = copyId;
  const want = (card(copyId).hp ?? 0) * 2 + 2;
  if (body.hp.length < want) assignHp(state, body, want - body.hp.length);
  log(state, choice.player, `Kapigras shakes apart and reforms as ${card(copyId).name}.`);
});

registerChoiceResolver('deal-1', (state, choice, pick) => {
  if (pick.ref) dealDamage(state, pick.ref, 1 + effectDamageOf(state, choice.player));
});

registerChoiceResolver('wound-1', (state, _choice, pick) => {
  if (pick.ref) addWounds(state, pick.ref, 1);
});

registerChoiceResolver('gain-hp-1', (state, _choice, pick) => {
  if (pick.ref) reinforce(state, pick.ref, 1);
});

registerChoiceResolver('gain-hp-2', (state, _choice, pick) => {
  if (pick.ref) reinforce(state, pick.ref, 2);
});

registerChoiceResolver('buff-1', (state, choice, pick) => {
  if (pick.ref) buffPermanent(state, pick.ref, 1, choice.source);
});

registerChoiceResolver('heal-1', (state, _choice, pick) => {
  if (pick.ref) unflipHp(state, pick.ref, 1);
});

registerChoiceResolver('heal-2', (state, _choice, pick) => {
  if (pick.ref) unflipHp(state, pick.ref, 2);
});

registerChoiceResolver('catch-1', (state, _choice, pick) => {
  if (pick.ref) catchHp(state, pick.ref, 1);
});

registerChoiceResolver('shield-1', (state, choice, pick) => {
  if (!pick.ref) return;
  const s = findSummon(state, pick.ref);
  if (!s) return;
  s.shields += 1;
  log(state, choice.player, `${card(s.cardId).name} raises 1 Power Shield.`);
});

registerChoiceResolver('sap-supporter', (state, choice, pick) => {
  if (pick.ref?.kind !== 'supporter') return;
  const row = state.players[pick.ref.player].supporters;
  const s = row[pick.ref.index];
  if (!s || s.sapped) return;
  s.sapped = true;
  log(state, choice.player, `${card(s.cardId).name} is sapped.`);
});

registerChoiceResolver('debt-summon-to-hand', (state, choice, pick) => {
  if (pick.ref?.kind !== 'debt') return;
  const p = state.players[choice.player];
  if (pick.ref.index < 0 || pick.ref.index >= p.debt.length) return;
  const id = removeFromDebt(state, choice.player, pick.ref.index);
  if (!id) return;
  if (toHand(state, choice.player, id)) {
    log(state, choice.player, `${card(id).name} comes back from the debt zone.`);
  }
});

/** Download: the chosen card leaves their debt and arrives rebuilt in Robot. */
registerChoiceResolver('download', (state, choice, pick) => {
  if (pick.ref?.kind !== 'debt') return;
  const from = pick.ref.player;
  if (pick.ref.index < 0 || pick.ref.index >= state.players[from].debt.length) return;
  const id = removeFromDebt(state, from, pick.ref.index);
  if (!id) return;
  if (toHand(state, choice.player, robotCopy(id))) {
    log(state, choice.player, `${card(id).name} is pulled out of the scrap and rebuilt in Robot.`);
  }
});

// The Pod's rattle: one chosen revive, then a second with fresh indices.
registerChoiceResolver('pod-revive', (state, choice, pick) => {
  if (pick.ref?.kind === 'discard') {
    const p = state.players[choice.player];
    if (pick.ref.index >= 0 && pick.ref.index < p.discard.length) {
      const [id] = p.discard.splice(pick.ref.index, 1);
      if (toHand(state, choice.player, id)) {
        log(state, choice.player, `${card(id).name} comes back from the discard pile.`);
      }
    }
  }
  chooseBoard(
    state,
    choice.player,
    choice.source,
    'discard-spell-to-hand',
    discardSpellRefs(state, choice.player),
    'Return which spell to hand?',
  );
});

registerChoiceResolver('discard-spell-to-hand', (state, choice, pick) => {
  if (pick.ref?.kind !== 'discard') return;
  const p = state.players[choice.player];
  if (pick.ref.index < 0 || pick.ref.index >= p.discard.length) return;
  const [id] = p.discard.splice(pick.ref.index, 1);
  if (toHand(state, choice.player, id)) {
    log(state, choice.player, `${card(id).name} comes back from the discard pile.`);
  }
});

/**
 * Sordid Fruit: the same return, with its draw on the far side of the pick.
 *
 * Drawing beside the choice rather than after it let a draw that emptied the
 * deck shuffle the discard pile back in, and the refs the choice was built from
 * then named a pile that had moved. The card reads "return a spell, then draw",
 * and doing it in that order is also the only order the refs survive.
 */
registerChoiceResolver('sordid-fruit', (state, choice, pick) => {
  const p = state.players[choice.player];
  if (pick.ref?.kind === 'discard' && pick.ref.index >= 0 && pick.ref.index < p.discard.length) {
    const [id] = p.discard.splice(pick.ref.index, 1);
    if (toHand(state, choice.player, id)) {
      log(state, choice.player, `${card(id).name} comes back from the discard pile.`);
    }
  }
  drawCards(state, choice.player, 1);
});

// The draw lands before this fires, so a freshly drawn card is pickable.
registerChoiceResolver('stack-hp-from-hand', (state, choice, pick) => {
  if (pick.ref?.kind !== 'hand' || !choice.at) return;
  const body = findSummon(state, choice.at);
  if (!body) return;
  const hand = state.players[choice.player].hand;
  if (pick.ref.index < 0 || pick.ref.index >= hand.length) return;
  const [id] = hand.splice(pick.ref.index, 1);
  body.hp.push({ cardId: id, flipped: false });
  log(state, choice.player, `A card from hand slides under ${card(body.cardId).name} as HP.`);
});
