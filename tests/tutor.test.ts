import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame, type DeckList } from '../src/engine/engine';
import { card } from '../src/engine/registry';
import type { GameState } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';

/**
 * "From your deck" means the deck, not the top of it.
 *
 * Digital Rabbits names no number, so it searches. It used to look at six cards and
 * call that a search, which failed whenever the other copy had not floated near the
 * top. Only the matches are shown: a tutor gives away what it could have found and
 * nothing else about the order the rest are in.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const RABBIT = 'r2-digitalrabbits';

function deck(): DeckList {
  return { name: 'Tester', leaderId: LEADER, cards: Array.from({ length: 60 }, () => FILLER) };
}

/** Both leaders out, seat 0 to act with mana to spare. */
function board(): GameState {
  let s = createGame([deck(), deck()], 4, 1);
  for (let i = 0; i < 3; i++) {
    const r = applyAction(s, s.active, { type: 'END_TURN' });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  for (const k of Object.keys(s.players[0].mana)) {
    (s.players[0].mana as Record<string, number>)[k] = 9;
  }
  return s;
}

/** Play a Digital Rabbits from hand into slot 0. */
function play(s: GameState): GameState {
  s.players[0].hand[0] = RABBIT;
  const r = applyAction(s, 0 as PlayerIdx, { type: 'PLAY_SUMMON', handIndex: 0, slot: 0 });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe('Digital Rabbits searching the deck', () => {
  it('finds the copy sitting at the very bottom', () => {
    const s = board();
    // Three come off the top as HP when it lands, so the rabbit stays far past
    // any six-card look.
    s.players[0].deck = [...Array.from({ length: 39 }, () => FILLER), RABBIT];
    const after = play(s);
    const ch = after.choiceQueue[0];
    expect(ch, 'a choice is waiting').toBeTruthy();
    expect(ch.cards, 'only the match is shown').toEqual([RABBIT]);
    expect(ch.legal, 'and it is takeable').toEqual([0]);
  });

  it('offers both copies when both are in there', () => {
    const s = board();
    // Clear of the top three, which come off as HP when the body lands.
    s.players[0].deck = [
      ...Array.from({ length: 5 }, () => FILLER),
      RABBIT,
      ...Array.from({ length: 25 }, () => FILLER),
      RABBIT,
    ];
    const after = play(s);
    expect(after.choiceQueue[0]?.cards).toEqual([RABBIT, RABBIT]);
  });

  it('shows nothing but the matches, so the deck stays secret', () => {
    const s = board();
    s.players[0].deck = [...Array.from({ length: 39 }, () => FILLER), RABBIT];
    const after = play(s);
    expect(after.choiceQueue[0]?.cards).not.toContain(FILLER);
  });

  it('leaves the order of everything else alone', () => {
    const s = board();
    s.players[0].deck = [...Array.from({ length: 39 }, () => FILLER), RABBIT];
    const after = play(s);
    const rest = after.players[0].deck;
    expect(rest.every((id) => id === FILLER), 'the rabbit came out, nothing else moved').toBe(true);
  });

  it('asks nothing when the deck holds no copy', () => {
    const s = board();
    s.players[0].deck = Array.from({ length: 40 }, () => FILLER);
    const after = play(s);
    expect(after.choiceQueue, 'no prompt with nothing to answer').toHaveLength(0);
  });

  it('puts the copy it finds onto the board', () => {
    const s = board();
    s.players[0].deck = [...Array.from({ length: 39 }, () => FILLER), RABBIT];
    const found = play(s);
    const r = applyAction(found, 0 as PlayerIdx, { type: 'RESOLVE_CHOICE', index: 0 });
    if (!r.ok) throw new Error(r.error);
    const filled = r.state.players[0].slots.filter((x) => x?.cardId === RABBIT).length;
    expect(filled, 'the one played and the one it fetched').toBe(2);
  });
});

describe('The Visitor saying what it does', () => {
  it('mentions that what it seizes is sapped', () => {
    expect(card('m-bp-visitor').text, 'the body arrives unable to act').toMatch(/sap/i);
  });
});
