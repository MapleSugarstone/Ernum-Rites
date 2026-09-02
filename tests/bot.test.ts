import { describe, expect, it } from 'vitest';
import { allDecks, everyDeck, starterDecks, testDecks } from '../src/cards';
import { chooseAction } from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { canBeLeader, deckIdentity, isLegalUnder } from '../src/engine/identity';
import { allCards, card, isGenerated, tryCard } from '../src/engine/registry';
import {
  currentActor,
  isOver,
  type GameState,
} from '../src/engine/state';
import type { CardDef } from '../src/engine/types';

interface Outcome {
  state: GameState;
  actions: number;
}

/** Drive both seats with the bot until someone wins or the caps trip. */
function playOut(state: GameState, maxActions = 6000, maxTurns = 300): Outcome {
  let s = state;
  let actions = 0;
  while (!isOver(s) && actions < maxActions && s.turn < maxTurns) {
    const actor = currentActor(s);
    const action = chooseAction(s, actor);
    const res = applyAction(s, actor, action);
    if (!res.ok) {
      throw new Error(`bot produced an illegal ${action.type}: ${res.error}`);
    }
    s = res.state;
    actions++;
  }
  return { state: s, actions };
}

describe('decks', () => {
  it('every deck references real cards and a real leader', () => {
    for (const d of allDecks) {
      expect(tryCard(d.leaderId), `${d.key} leader`).toBeDefined();
      expect(canBeLeader(d.leaderId), `${d.key} leader is playable`).toBe(true);
      for (const id of d.cards) {
        expect(tryCard(id), `${d.key} contains ${id}`).toBeDefined();
      }
      expect(card(d.leaderId).hp, `${d.key} leader hp`).toBeGreaterThan(0);
    }
  });

  it('keeps every deck in a playable size band', () => {
    for (const d of allDecks) {
      expect(d.cards.length, `${d.key} size`).toBeGreaterThanOrEqual(40);
      expect(d.cards.length, `${d.key} size`).toBeLessThanOrEqual(60);
    }
  });

  it('separates starter decks from labelled test decks', () => {
    expect(starterDecks.every((d) => !d.test)).toBe(true);
    expect(testDecks.every((d) => d.test)).toBe(true);
    expect(new Set(everyDeck.map((d) => d.key)).size).toBe(everyDeck.length);
  });

});

describe('bot', () => {
  it('plays a starter matchup to a decision', () => {
    const [a, b] = starterDecks;
    const game = createGame(
      [
        { name: a.name, leaderId: a.leaderId, cards: a.cards },
        { name: b.name, leaderId: b.leaderId, cards: b.cards },
      ],
      7,
      0,
    );
    const { state, actions } = playOut(game);
    expect(isOver(state), `unresolved after ${actions} actions, turn ${state.turn}`).toBe(true);
    expect(state.winReason).toBeTruthy();
  });

  it('finishes every deck pairing', () => {
    const unresolved: string[] = [];
    for (const a of allDecks) {
      for (const b of allDecks) {
        if (a.key >= b.key) continue;
        const game = createGame(
          [
            { name: a.name, leaderId: a.leaderId, cards: a.cards },
            { name: b.name, leaderId: b.leaderId, cards: b.cards },
          ],
          a.key.length * 31 + b.key.length,
          0,
        );
        const { state } = playOut(game);
        if (!isOver(state)) unresolved.push(`${a.key} vs ${b.key} (turn ${state.turn})`);
      }
    }
    expect(unresolved).toEqual([]);
    // Every deck against every other in the slow engine, and the length of a
    // game is a rules constant: raising the debt limit pushed this past the
    // five second default, and grafted Powers repriced into Oil pushed it
    // again by making more of them affordable. Giving the bot a turn search
    // pushed it a third time, since it now plans a turn and the opponent's
    // reply to it instead of picking an action.
  }, 900_000);

  it('grinds an empty board to a finish rather than deadlocking', () => {
    // The position that used to deadlock: nothing in either deck, hand or slot.
    const s = createGame(
      [
        { name: 'A', leaderId: 'x-hero-dummy-warden', cards: ['x-r-dummy-1'] },
        { name: 'B', leaderId: 'x-hero-dummy-warden', cards: ['x-r-dummy-1'] },
      ],
      1,
      0,
    );
    s.players.forEach((p) => {
      p.hand = [];
      p.deck = [];
      p.debtCount = 0;
    });
    const { state } = playOut(s, 400, 60);
    expect(isOver(state)).toBe(true);
    // Deliberately not asserting which clock ran out. Fatigue debt used to be
    // the only route because the bot passed; a bot that swings its leader when
    // it has nothing else finishes by combat instead, and either is a finish.
    expect(state.winReason).toBeTruthy();
  });

  it('develops its board rather than passing every turn', () => {
    const [a, b] = starterDecks;
    let s = createGame(
      [
        { name: a.name, leaderId: a.leaderId, cards: a.cards },
        { name: b.name, leaderId: b.leaderId, cards: b.cards },
      ],
      99,
      0,
    );
    // Six full rounds is enough to see a supporter row and bodies on the board.
    for (let i = 0; i < 400 && s.turn < 12 && !isOver(s); i++) {
      const actor = currentActor(s);
      const res = applyAction(s, actor, chooseAction(s, actor));
      if (!res.ok) throw new Error(res.error);
      s = res.state;
    }
    // A game can finish well before turn 12, and one supporter a turn is the
    // cap, so the bar scales with the turns a player actually got.
    const ownTurns = Math.ceil(s.turn / 2);
    for (const p of s.players) {
      expect(p.supporters.length).toBeGreaterThanOrEqual(Math.min(2, ownTurns - 1));
    }
    const bodies = s.players.flatMap((p) => p.slots.filter(Boolean)).length;
    const debt = s.players.reduce((n, p) => n + p.debtCount, 0);
    expect(bodies + debt).toBeGreaterThan(0);
  });

  it('springs a trap when the trap saves the summon', () => {
    // Hollow Ring blanks the attack outright, so passing is strictly worse.
    let s = createGame(
      [
        { name: 'Attacker', leaderId: 'x-hero-dummy-warden', cards: Array(50).fill('x-r-dummy-1') },
        { name: 'Defender', leaderId: 'x-hero-dummy-warden', cards: Array(50).fill('x-r-dummy-1') },
      ],
      3,
      0,
    );
    s.players[0].hand.push('x-r-dummy-3');
    s.players[1].hand.push('x-r-dummy-1', 'sx-hollowring');
    s.players[1].supporters.push({ cardId: 's1-fluterat', sapped: false });

    const step = (actor: 0 | 1, action: Parameters<typeof applyAction>[2]) => {
      const res = applyAction(s, actor, action);
      if (!res.ok) throw new Error(`${action.type}: ${res.error}`);
      s = res.state;
    };
    step(0, { type: 'PLAY_SUMMON', handIndex: s.players[0].hand.length - 1, slot: 0 });
    step(0, { type: 'END_TURN' });
    step(1, {
      type: 'PLAY_SUMMON',
      handIndex: s.players[1].hand.indexOf('x-r-dummy-1'),
      slot: 0,
    });
    step(1, { type: 'END_TURN' });
    step(0, {
      type: 'DECLARE_ATTACK',
      source: { kind: 'summon', player: 0, slot: 0 },
      target: { kind: 'summon', player: 1, slot: 0 },
    });

    expect(s.pending?.player).toBe(1);
    const choice = chooseAction(s, 1);
    expect(choice.type).toBe('CAST_TRAP');
  });
});

describe('triple-colour legends in play', () => {
  /**
   * The triples are in no shipped deck, because no shipped leader brings three
   * colours. Building one deck per triple is the only way the bot ever sees
   * their powers, and every new engine hook they carry rides on this.
   */
  function deckLedBy(def: CardDef) {
    const identity = deckIdentity(def.id);
    const pool = allCards().filter(
      (d) => d.art && !d.uncollectible && isLegalUnder(d, identity) && d.id !== def.id,
    );
    const cards = [def.id, def.id];
    for (let i = 0; cards.length < 48; i++) {
      cards.push(pool[i % pool.length].id);
    }
    return { name: def.name, leaderId: def.id, cards };
  }

  it('plays out a bot game led by each three-colour card', () => {
    const triples = allCards().filter((d) => d.color3 && !isGenerated(d.id));
    expect(triples.filter((d) => d.level === 3)).toHaveLength(10);
    for (const def of triples) {
      const deck = deckLedBy(def);
      const out = playOut(createGame([deck, deck], 4242, 0));
      expect(isOver(out.state), `${def.id} finished`).toBe(true);
    }
  }, 600_000);
});
