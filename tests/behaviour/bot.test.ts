// Decision-level tests of the bot: what it chooses on a hand-built board.
// These pin choices to particular cards and search settings, so a card change
// or a search change can move them without anything being wrong. They run on
// demand with `npm run test:behaviour` and are not part of the deploy gate,
// which keeps only the invariants: legality, termination, and parity.
import { describe, expect, it } from 'vitest';
import '../../src/cards';
import { chooseAction, clearPlan, evaluate } from '../../src/ai/bot';
import { applyAction, createGame } from '../../src/engine/engine';
import {
  currentActor,
  type GameState,
  type SummonInstance,
} from '../../src/engine/state';
import type { Action } from '../../src/engine/actions';
import type { PlayerIdx } from '../../src/engine/types';

describe('bot decisions', () => {
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

  it('gives a turn-length attack buff no credit on a body that cannot swing', () => {
    let s = createGame(
      [
        { name: 'A', leaderId: 'x-hero-dummy-warden', cards: Array(50).fill('x-r-dummy-1') },
        { name: 'B', leaderId: 'x-hero-dummy-warden', cards: Array(50).fill('x-r-dummy-1') },
      ],
      5,
      0,
    );
    s.players[0].hand.push('x-r-dummy-3');
    const res = applyAction(s, 0, {
      type: 'PLAY_SUMMON',
      handIndex: s.players[0].hand.length - 1,
      slot: 0,
    });
    if (!res.ok) throw new Error(res.error);
    s = res.state;

    // Turn one: nobody may attack yet, so the buff expires unused and the
    // evaluator must not pay for it. This is the Candy Cane waste.
    const body = s.players[0].slots[0]!;
    const before = evaluate(s, 0);
    body.strengthMods.push({ amount: 2, duration: 'turn' });
    expect(evaluate(s, 0)).toBe(before);

    // A permanent buff on the same idle body is real board and still counts.
    body.strengthMods.push({ amount: 2, duration: 'permanent' });
    expect(evaluate(s, 0)).toBeGreaterThan(before);
  });
});

describe('store negotiation', () => {
  /**
   * The shop half of Candy, from both chairs. Every position is built by hand,
   * because a Store only matters once one is on the board with stock left and
   * the other player has something to do with the effect, and waiting for a
   * shuffle to arrange that is not a test. The prices are the engine's slider:
   * 1 to 4 plus the Store's surcharge.
   */
  const FILLER = 'x-r-dummy-1';
  const BODY = 'x-r-dummy-3';
  const LEADER = 'x-hero-dummy-warden';
  /** Store: Draw 2 cards. */
  const SHOP = 'k1-apprentice';
  /** Store: Put a CandyGuard into an empty slot. */
  const GUARD = 'k2-CandyGuardSeller';
  /** Store: Heal 3 debt. */
  const RELIEF = 'k3-DebtReliever';

  function body(s: GameState, cardId: string, owner: PlayerIdx, hp: number, isLeader = false): SummonInstance {
    return {
      uid: `u${s.nextUid++}`,
      cardId,
      owner,
      isLeader,
      hp: Array.from({ length: hp }, () => ({ cardId: FILLER, flipped: false })),
      sapped: false,
      wounds: 0,
      shields: 0,
      strengthMods: [],
      effectDamageMod: 0,
      powerUses: {},
      enteredTurn: 0,
    };
  }

  /** Seat 0 on its main step with empty slots, facing one shop on seat 1. */
  function shopFacing(storeId: string): GameState {
    const s = createGame(
      [
        { name: 'Buyer', leaderId: LEADER, cards: Array(40).fill(BODY) },
        { name: 'Seller', leaderId: LEADER, cards: Array(40).fill(FILLER) },
      ],
      1,
      0,
    );
    for (const p of s.players) {
      p.hand = [];
      p.slots = [null, null, null];
      p.supporters = [];
      p.debt = [];
      p.debtCount = 0;
      p.mana = { P: 0, O: 0, R: 0, F: 0, S: 0, K: 0, C: 0, E: 0 };
      p.turnsTaken = 5;
      p.supportersLeft = 1;
      p.leaderPlayed = true;
    }
    s.turn = 6;
    s.phase = 'main';
    s.active = 0;
    s.pending = null;
    s.choiceQueue = [];
    s.flipQueue = [];
    s.replaceQueue = [];
    s.players[0].leader = body(s, LEADER, 0, 8, true);
    s.players[1].leader = body(s, LEADER, 1, 8, true);
    s.players[0].deck = Array(30).fill(BODY);
    s.players[1].slots[0] = body(s, storeId, 1, 4);
    s.players[1].slots[0]!.storeStock = 1;
    clearPlan();
    return s;
  }

  function step(s: GameState, actor: PlayerIdx, action: Action): GameState {
    const res = applyAction(s, actor, action);
    if (!res.ok) throw new Error(`${action.type}: ${res.error}`);
    clearPlan();
    return res.state;
  }

  const shopRef = { kind: 'summon', player: 1, slot: 0 } as const;

  it('opens an enemy shop worth buying from', () => {
    // Two cards for the floor price, with three slots waiting for whatever
    // comes off the deck. Standing still is one of the candidates the search
    // ranks, so this only passes if the purchase beats doing nothing.
    const s = shopFacing(SHOP);
    expect(chooseAction(s, 0).type).toBe('OPEN_STORE');
  });

  it('leaves a shop alone when the effect does nothing for it', () => {
    // Same shop, but every slot is taken and the hand is already full of the
    // cards it would draw, so two more are worth less than the debt they cost.
    const s = shopFacing(SHOP);
    s.players[0].slots = [body(s, BODY, 0, 4), body(s, BODY, 0, 4), body(s, BODY, 0, 4)];
    s.players[0].hand = Array(6).fill(BODY);
    clearPlan();
    expect(chooseAction(s, 0).type).not.toBe('OPEN_STORE');
  });

  it('sells at a counter below its ask', () => {
    // The bot opens at 3 and the buyer counters 2, which is the price the shop
    // charges its owner to run it. Taking it beats holding out for one debt.
    let s = shopFacing(SHOP);
    s = step(s, 0, { type: 'OPEN_STORE', source: shopRef });

    const ask = chooseAction(s, 1);
    expect(ask).toEqual({ type: 'STORE_OFFER', price: 3, final: false });
    s = step(s, 1, ask);

    s = step(s, 0, { type: 'STORE_COUNTER', price: 2 });
    expect(chooseAction(s, 1).type).toBe('STORE_ACCEPT');

    s = step(s, 1, { type: 'STORE_ACCEPT' });
    expect(s.pending).toBeNull();
    expect(s.players[0].debtCount).toBe(2);
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[1].love).toBe(1);
  });

  it('pays the top of the slider for a final offer it cannot better', () => {
    // A 1/7 Redirection body into an empty slot is worth several times the top
    // price, and a final offer leaves nothing to haggle over.
    let s = shopFacing(GUARD);
    s = step(s, 0, { type: 'OPEN_STORE', source: shopRef });
    s = step(s, 1, { type: 'STORE_OFFER', price: 4, final: true });

    expect(chooseAction(s, 0).type).toBe('STORE_ACCEPT');
    s = step(s, 0, { type: 'STORE_ACCEPT' });
    expect(s.players[0].debtCount).toBe(4);
    expect(s.players[0].slots.filter(Boolean)).toHaveLength(1);
    expect(s.players[1].love).toBe(1);
  });

  it('refuses to pay more debt than a shop takes off', () => {
    // Heal 3 debt for 4 debt is a loss however the passes fall, and the shop
    // that sells it never goes below what it heals either.
    let s = shopFacing(RELIEF);
    s.players[0].debtCount = 8;
    clearPlan();
    s = step(s, 0, { type: 'OPEN_STORE', source: shopRef });
    s = step(s, 1, { type: 'STORE_OFFER', price: 4, final: true });
    expect(chooseAction(s, 0).type).toBe('STORE_REJECT');
  });

  it('walks away from a final offer the effect is not worth', () => {
    // Two draws off an empty deck are two reshuffles, which cost debt of their
    // own, so the shop is selling something worse than nothing at any price.
    let s = shopFacing(SHOP);
    s.players[0].hand = Array(6).fill(BODY);
    s.players[0].deck = [];
    clearPlan();
    s = step(s, 0, { type: 'OPEN_STORE', source: shopRef });
    s = step(s, 1, { type: 'STORE_OFFER', price: 4, final: true });
    expect(chooseAction(s, 0).type).toBe('STORE_REJECT');
  });

  it('buys the piece that completes a kill', () => {
    // The enemy leader is a shopkeeper selling +2 attack, on 5 HP, and the only
    // attacker on the table swings for 3. Nothing kills without the purchase,
    // and the haggle would never make it: two points of attack are worth less
    // to the evaluator than the debt. The kill search buys at the top of the
    // slider and swings.
    const s = shopFacing(SHOP);
    s.players[1].slots[0] = null;
    s.players[1].leader = body(s, 'k2-HotcakeSeller', 1, 5, true);
    s.players[1].leader.storeStock = 1;
    s.players[0].slots[0] = body(s, BODY, 0, 5);
    clearPlan();
    expect(chooseAction(s, 0)).toEqual({
      type: 'OPEN_STORE',
      source: { kind: 'leader', player: 1 },
    });
    // Played out with the bot in both chairs, the haggle closes and the swing
    // lands before the turn ends.
    let at = s;
    for (let i = 0; i < 12 && at.winner === null; i++) {
      const actor = currentActor(at);
      at = step(at, actor, chooseAction(at, actor));
    }
    expect(at.winner).toBe(0);
  });

  it('haggles from the floor and closes inside the pass cap', () => {
    // Both chairs on the bot. Nothing in the window may stall: the seller has
    // no walk-away, so a silent one hangs the game.
    let s = shopFacing(SHOP);
    s = step(s, 0, { type: 'OPEN_STORE', source: shopRef });
    const line: Action[] = [];
    while (s.pending && line.length < 10) {
      const actor = currentActor(s);
      const action = chooseAction(s, actor);
      line.push(action);
      s = step(s, actor, action);
    }
    expect(s.pending).toBeNull();
    expect(line.map((a) => a.type)).toEqual([
      'STORE_OFFER',
      'STORE_COUNTER',
      'STORE_OFFER',
      'STORE_ACCEPT',
    ]);
    // Countered at the floor and settled one over it.
    expect(line[1]).toEqual({ type: 'STORE_COUNTER', price: 1 });
    expect(s.players[0].debtCount).toBe(2);
  });
});
