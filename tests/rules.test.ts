import { describe, expect, it } from 'vitest';
import { allDecks } from '../src/cards';
import type { Action, SourceRef } from '../src/engine/actions';
import {
  applyAction,
  availableMana,
  canPay,
  createGame,
  effectiveStrength,
  costFor,
  legalAttackTargets,
  manaKindFor,
  storeBlockers,
  targetCandidates,
  type DeckList,
} from '../src/engine/engine';
import {
  addWounds,
  dealDamage,
  drawCards,
  effectDamageOf,
  flipWouldFire,
  MILL_DEBT,
  millCards,
  putSummonDirect,
  RESHUFFLE_DEBT,
  RESHUFFLE_DEBT_STEP,
  reshuffleCost,
  bounceSummon,
  reviveFromDebt, toDiscard, makeEffectCtx } from '../src/engine/effects';
import { colorsOf, deckIdentity, isLegalUnder } from '../src/engine/identity';
import { fusedRecomp } from '../src/engine/generated';
import { allCards, card } from '../src/engine/registry';
import {
  currentActor,
  DEBT_LIMIT,
  HAND_LIMIT,
  isOver,
  levelOf,
  MAX_ACTIONS,
  MAX_TURNS,
  OPENING_HAND,
  OPENING_HAND_BONUS,
  remainingHp,
  type GameState,
} from '../src/engine/state';
import {
  costToString,
  type Color,
  type ManaKind,
  type PlayerIdx,
  type TargetRef,
} from '../src/engine/types';

// Vanilla dummies keep the combat maths obvious: L1 is 1/2, L2 2/4, L3 3/6.
const D1 = 'x-r-dummy-1';
const D2 = 'x-p-dummy-2';
const D3 = 'x-p-dummy-3';
const D3B = 'x-r-dummy-3';
const OIL = 'x-o-dummy-1';
const SOLAR = 'x-s-dummy-1';
const LEADER = 'x-hero-dummy-warden';

function deck(cards: string[], leaderId = LEADER): DeckList {
  return { name: 'Tester', leaderId, cards };
}

function filler(n: number, id = D1): string[] {
  return Array.from({ length: n }, () => id);
}

function game(): GameState {
  return createGame([deck(filler(60)), deck(filler(60))], 12345, 0);
}

function must(state: GameState, actor: PlayerIdx, action: Action): GameState {
  const res = applyAction(state, actor, action);
  if (!res.ok) throw new Error(`${action.type} rejected: ${res.error}`);
  return res.state;
}

/** End the current turn and keep passing until `player` is on the play again. */
function passTo(state: GameState, player: PlayerIdx): GameState {
  let s = must(state, state.active, { type: 'END_TURN' });
  let guard = 0;
  while (s.active !== player || s.phase !== 'main') {
    if (guard++ > 10) throw new Error('could not reach that turn');
    s = must(s, s.active, { type: 'END_TURN' });
  }
  return s;
}

function give(state: GameState, player: PlayerIdx, cardId: string): number {
  state.players[player].hand.push(cardId);
  return state.players[player].hand.length - 1;
}

function place(state: GameState, player: PlayerIdx, cardId: string, slot: number): GameState {
  return must(state, player, { type: 'PLAY_SUMMON', handIndex: give(state, player, cardId), slot });
}

const src = (player: PlayerIdx, slot: number): SourceRef => ({ kind: 'summon', player, slot });
const leaderSrc = (player: PlayerIdx): SourceRef => ({ kind: 'leader', player });

describe('Enthrall', () => {
  it('rebuilds the seized body and its HP cards in Robot', () => {
    let s = game();
    s = passTo(s, 1);
    s = place(s, 1, 'f3-sharkmeat', 0);
    s = passTo(s, 0);
    s.players[1].slots[0]!.hp.push({ cardId: 'f1-lilfish', flipped: false });

    const siren = card('r3-cybersiren');
    siren.powers![0].effect!(makeEffectCtx(s, 0, null, siren, [src(1, 0)]));

    const seized = s.players[0].slots.find((x) => x);
    expect(seized, 'the body changed sides').toBeTruthy();
    expect(seized!.cardId, 'the body is rebuilt in Robot').toBe('gen-hack-f3-sharkmeat');
    expect(card(seized!.cardId).color, 'a Robot body now').toBe('R');
    // The body arrives holding HP cards off the deck, so the one added here is
    // not first; every card under it has to come across rebuilt.
    expect(seized!.hp.length, 'it kept the HP cards it came with').toBeGreaterThan(1);
    expect(seized!.hp.every((h) => h.cardId.startsWith('gen-hack-')),
      'and every HP card under it is rebuilt in Robot').toBe(true);
  });
});

describe('setup', () => {
  it('deals an opening hand and puts the leader out with double HP and two more', () => {
    const s = game();
    expect(s.players[0].hand).toHaveLength(OPENING_HAND);
    expect(s.players[1].hand).toHaveLength(OPENING_HAND + OPENING_HAND_BONUS);
    const leader = s.players[0].leader!;
    expect(leader.hp).toHaveLength(card(LEADER).hp! * 2 + 2);
  });

  it('gives the extra opening card to whoever goes second', () => {
    const s = createGame([deck(filler(60)), deck(filler(60))], 12345, 1);
    expect(s.players[1].hand).toHaveLength(OPENING_HAND);
    expect(s.players[0].hand).toHaveLength(OPENING_HAND + OPENING_HAND_BONUS);
  });
});

describe('supporters and mana', () => {
  it('allows one supporter per turn and unsaps at the start of the next', () => {
    let s = game();
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: 0 });
    expect(applyAction(s, 0, { type: 'PLAY_SUPPORTER', handIndex: 0 }).ok).toBe(false);
    s = must(s, 0, { type: 'SAP_SUPPORTER', index: 0 });
    expect(s.players[0].supporters[0].sapped).toBe(true);
    s = passTo(s, 0);
    expect(s.players[0].supporters[0].sapped).toBe(false);
    expect(s.players[0].mana.R).toBe(0);
  });

  it('lets an awake-step grant pay for a second supporter', () => {
    let s = game();
    s.players[0].stage = 'sx-musicalflow';
    s = passTo(s, 0);
    // The grant fires during awake, after the turn has already reset the
    // allowance, so it has to raise it rather than clear a flag.
    expect(s.players[0].supportersLeft).toBe(2);
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, D1) });
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, D1) });
    expect(s.players[0].supporters).toHaveLength(2);
    const third = applyAction(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, D1) });
    expect(third.ok).toBe(false);
  });

  it("stacks a field grant with Aetus Vox's Comprehension", () => {
    let s = game();
    s = place(s, 0, 's3-aetusvox', 0);
    s.players[0].stage = 'sx-musicalflow';
    s = passTo(s, 0);
    expect(s.players[0].supportersLeft).toBe(2);
    s.players[0].mana.S = 1;
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: { kind: 'summon', player: 0, slot: 0 },
      powerIndex: 0,
      targets: [],
    });
    expect(s.players[0].supportersLeft).toBe(3);
    expect(s.players[0].slots[0]!.sapped).toBe(true);
  });
});

describe('summons', () => {
  it('takes HP off the top of the deck when a summon is placed', () => {
    let s = game();
    const before = s.players[0].deck.length;
    s = place(s, 0, D3, 0);
    expect(s.players[0].slots[0]!.hp).toHaveLength(5);
    expect(s.players[0].deck).toHaveLength(before - 5);
  });

  it('lets a leader card stand in a slot at printed stats', () => {
    let s = game();
    s = place(s, 0, 'fh-thefish', 0);
    const fish = s.players[0].slots[0]!;
    // Printed 2/5, not the doubled HP a leader seat grants.
    expect(fish.hp).toHaveLength(card('fh-thefish').hp!);
    expect(levelOf(fish, card(fish.cardId))).toBe(3);
  });

  it('refuses to place into an occupied slot', () => {
    let s = game();
    s = place(s, 0, D2, 0);
    const res = applyAction(s, 0, { type: 'PLAY_SUMMON', handIndex: give(s, 0, D1), slot: 0 });
    expect(res.ok).toBe(false);
  });
});

describe('battle', () => {
  it('forbids attacking on your first turn', () => {
    let s = game();
    s = place(s, 0, D2, 0);
    expect(legalAttackTargets(s, src(0, 0))).toHaveLength(0);
  });

  it('clashes both ways and saps the attacker', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D3B, 0);
    s = must(s, 1, { type: 'END_TURN' });
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });

    // Both are 3 strength into 6 HP, so both live on 3.
    expect(s.players[0].slots[0]!.sapped).toBe(true);
    expect(remainingHp(s.players[0].slots[0]!)).toBe(2);
    expect(remainingHp(s.players[1].slots[0]!)).toBe(2);
  });

  it('only exposes the leader once the slots in front of it are empty', () => {
    let s = game();
    s = place(s, 0, D2, 0);
    s = passTo(s, 0);
    expect(legalAttackTargets(s, src(0, 0))).toEqual([{ kind: 'leader', player: 1 }]);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D1, 1);
    s = must(s, 1, { type: 'END_TURN' });
    expect(legalAttackTargets(s, src(0, 0))).toEqual([{ kind: 'summon', player: 1, slot: 1 }]);
  });

  it('charges debt equal to the level of the summon that fell', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D3B, 0);
    s = must(s, 1, { type: 'END_TURN' });
    // 4 strength twice over kills a 6 HP body.
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    s = passTo(s, 0);
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    expect(s.players[1].slots[0]).toBeNull();
    expect(s.players[1].debtCount).toBe(3);
  });

  it('offers the owner an immediate replacement', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D1, 0);
    give(s, 1, D2);
    s = must(s, 1, { type: 'END_TURN' });
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    expect(s.replaceQueue[0]?.player).toBe(1);
    const idx = s.players[1].hand.indexOf(D2);
    s = must(s, 1, { type: 'REPLACE_SUMMON', handIndex: idx });
    expect(s.players[1].slots[0]).not.toBeNull();
    expect(s.replaceQueue).toHaveLength(0);
  });

  it('skips the replace prompt when a summon dies on its own turn', () => {
    let s = game();
    s = place(s, 0, D1, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D3B, 0);
    s = must(s, 1, { type: 'END_TURN' });
    give(s, 0, D2);
    // The 2/2 swings into the 4-strength wall and dies to the counter-hit.
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    expect(s.players[0].slots[0]).toBeNull();
    expect(s.replaceQueue).toHaveLength(0);
    // The main phase refills the slot without any prompt.
    const idx = s.players[0].hand.indexOf(D2);
    s = must(s, 0, { type: 'PLAY_SUMMON', handIndex: idx, slot: 0 });
    expect(s.players[0].slots[0]).not.toBeNull();
  });
});

describe('scry', () => {
  it('shows an empty scry as a choice its owner acknowledges', () => {
    let s = game();
    s = place(s, 0, 'p1-minimage', 0);
    give(s, 0, D2);
    const sup = s.players[0].hand.indexOf(D2);
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: sup });
    const deckBefore = s.players[0].deck.length;
    // Cantrip scries 3 for a spell; the dummy deck holds only summons.
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.choiceQueue).toHaveLength(1);
    expect(s.choiceQueue[0].cards).toHaveLength(3);
    expect(s.choiceQueue[0].legal).toHaveLength(0);
    s = must(s, 0, { type: 'RESOLVE_CHOICE' });
    expect(s.choiceQueue).toHaveLength(0);
    expect(s.players[0].deck).toHaveLength(deckBefore);
  });
});

describe('the leader in combat', () => {
  it('lets the leader attack once the board allows it', () => {
    let s = game();
    s = passTo(s, 0);
    // Nothing on either side, so the leader can swing at the enemy leader.
    expect(legalAttackTargets(s, leaderSrc(0))).toEqual([{ kind: 'leader', player: 1 }]);
  });

  it('makes an attacking leader take the counter-hit', () => {
    let s = game();
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D3B, 0);
    s = must(s, 1, { type: 'END_TURN' });
    const before = remainingHp(s.players[0].leader!);
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: leaderSrc(0), target: { kind: 'summon', player: 1, slot: 0 } });
    // The 3 strength dummy hits back for full.
    expect(remainingHp(s.players[0].leader!)).toBe(before - 3);
    expect(s.players[0].leader!.sapped).toBe(true);
  });

  it('still has a defending leader deal nothing back', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = passTo(s, 0);
    const before = remainingHp(s.players[0].slots[0]!);
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'leader', player: 1 } });
    expect(remainingHp(s.players[0].slots[0]!)).toBe(before);
    expect(remainingHp(s.players[1].leader!)).toBe(card(LEADER).hp! * 2 + 2 - 3);
  });
});

describe('traps', () => {
  it('opens a response window only when the defender holds one', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D3B, 0);
    give(s, 1, 'fx-scooba');
    s.players[1].supporters.push(
      { cardId: 'f1-basicfish', sapped: false },
      { cardId: 'f1-basicfish', sapped: false },
    );
    s = must(s, 1, { type: 'END_TURN' });

    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    expect(s.pending?.player).toBe(1);

    const trapIdx = s.players[1].hand.indexOf('fx-scooba');
    s = must(s, 1, { type: 'CAST_TRAP', handIndex: trapIdx, targets: [] });
    // Scooba shuffles the attacker into its owner's deck, so the clash never
    // happens and the body is not replayable this turn.
    expect(s.players[0].slots[0]).toBeNull();
    expect(s.players[0].hand).not.toContain(D3);
    expect(s.players[0].deck).toContain(D3);
    expect(remainingHp(s.players[1].slots[0]!)).toBe(5);
    expect(s.pending).toBeNull();
  });

  it('rejects a trap on your own turn', () => {
    const s = game();
    const idx = give(s, 0, 'fx-scooba');
    expect(applyAction(s, 0, { type: 'CAST_TRAP', handIndex: idx, targets: [] }).ok).toBe(false);
  });
});

describe('keywords', () => {
  it('pulls every attack onto a Redirection body', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, 'x-n-redirect', 0);
    s = place(s, 1, D1, 1);
    s = must(s, 1, { type: 'END_TURN' });

    const targets = legalAttackTargets(s, src(0, 0));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({ kind: 'summon', player: 1, slot: 0 });
  });

  it('exposes a Redirection leader even with its slots full', () => {
    // The usual rule is that a leader hides behind its slots. Redirection
    // overrides it: the leader is the only legal target, full board or not.
    let s = createGame(
      [
        { name: 'A', leaderId: 'x-hero-dummy-warden', cards: Array(60).fill(D1) },
        { name: 'B', leaderId: 'x-n-redirect-leader', cards: Array(60).fill(D1) },
      ],
      12345,
      0,
    );
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D1, 0);
    s = must(s, 1, { type: 'END_TURN' });

    const targets = legalAttackTargets(s, src(0, 0));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual({ kind: 'leader', player: 1 });
  });

  it('refuses spells at a Spell Immunity body from either side', () => {
    let s = game();
    s = place(s, 0, 'x-n-immune', 0);
    const bolt = card('x-p-bolt');
    const spec = bolt.targets![0];
    const mine = { kind: 'summon', player: 0, slot: 0 } as const;

    expect(targetCandidates(s, 1, spec, bolt)).not.toContainEqual(mine);
    expect(targetCandidates(s, 0, spec, bolt)).not.toContainEqual(mine);

    // Combat still reaches it, which is the whole point of the keyword.
    const before = remainingHp(s.players[0].slots[0]!);
    dealDamage(s, mine, 2);
    expect(remainingHp(s.players[0].slots[0]!)).toBe(before - 2);
  });
});

describe('wounds', () => {
  it('converts every two wounds into one flipped HP card', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s.players[1].supporters.push({ cardId: 'o1-ghost', sapped: false }, { cardId: 'o1-ghost', sapped: false });
    const spell = give(s, 1, 'o2-witch');
    // Witch is a summon, so use the Hex power after it lands. Curse is power 0.
    s = must(s, 1, { type: 'PLAY_SUMMON', handIndex: spell, slot: 0 });
    s = must(s, 1, {
      type: 'ACTIVATE_POWER',
      source: src(1, 0),
      powerIndex: 1,
      targets: [{ kind: 'summon', player: 0, slot: 0 }],
    });
    const target = s.players[0].slots[0]!;
    expect(remainingHp(target)).toBe(4);
    expect(target.wounds).toBe(1);
  });
});

describe('Seer Altine punishes small allies you play', () => {
  const SEER = 'm-bgy-seeraltine';

  it('annihilates a level 1 ally, chips a level 2, and spares enemies', () => {
    let s = game();
    s = place(s, 0, SEER, 0);

    // A level 1 ally played under Seer is annihilated on the spot.
    s = place(s, 0, D1, 1);
    expect(s.players[0].slots[1], 'level 1 ally gone').toBeNull();

    // A level 2 ally survives, one HP lighter.
    s = place(s, 0, D2, 1);
    const two = s.players[0].slots[1]!;
    expect(two, 'level 2 ally stands').toBeTruthy();
    expect(remainingHp(two)).toBe((card(D2).hp ?? 0) - 1);

    // An enemy playing a level 1 is untouched: only your own board.
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D1, 0);
    expect(s.players[1].slots[0], 'enemy level 1 stands').toBeTruthy();
  });
});

describe('Ghost costs no debt however it dies', () => {
  it('charges nothing when a spell kills it at zero debt', () => {
    let s = game();
    s = place(s, 0, 'o1-ghost', 0);
    expect(s.players[0].debtCount).toBe(0);
    // A spell kill at 0 debt is the reported case: the old clearDebt was wasted
    // and the level debt landed anyway.
    makeEffectCtx(s, 0, null, card('kx-DarkCandy'), []).damage(
      { kind: 'summon', player: 0, slot: 0 },
      9,
    );
    expect(s.players[0].slots[0]).toBeNull();
    expect(s.players[0].debtCount, 'no debt charged').toBe(0);
    // Spent to discard, never owed for.
    expect(s.players[0].debt).not.toContain('o1-ghost');
    expect(s.players[0].discard).toContain('o1-ghost');
  });

  it('still charges nothing when the owner already carries debt', () => {
    let s = game();
    s = place(s, 0, 'o1-ghost', 0);
    s.players[0].debtCount = 5;
    const before = s.players[0].debtCount;
    makeEffectCtx(s, 0, null, card('kx-DarkCandy'), []).damage(
      { kind: 'summon', player: 0, slot: 0 },
      9,
    );
    // The whole death is free: it neither bills nor refunds standing debt.
    expect(s.players[0].debtCount).toBe(before);
  });
});

describe("Skeleton's fading recursion", () => {
  it('bills the final combat death once', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    // The worn-to-1 printing stands for the enemy and falls to the attack.
    putSummonDirect(s, 1, 'gen-wither-gen-wither-o1-skeleton', 0, {
      asPrinted: true,
      strength: 1,
      color: 'O',
      hp: 1,
    });
    s = must(s, 1, { type: 'END_TURN' });
    const debt0 = s.players[1].debtCount;
    s = must(s, 0, {
      type: 'DECLARE_ATTACK',
      source: src(0, 0),
      target: { kind: 'summon', player: 1, slot: 0 },
    });
    const bills = s.log.filter((l) => l.text?.includes('dies for')).length;
    expect(s.players[1].slots[0]).toBeNull();
    expect(s.players[1].debtCount - debt0, 'one death, one bill').toBe(1);
    expect(bills, 'and one line saying so').toBe(1);
  });


  it('returns one HP smaller each death and stays down at zero', () => {
    let s = game();
    s = place(s, 0, 'o1-skeleton', 0);
    const kill = (st: GameState) => {
      makeEffectCtx(st, 1, null, card('x-r-dummy-1'), []).destroy({
        kind: 'summon',
        player: 0,
        slot: 0,
      });
    };
    const debt0 = s.players[0].debtCount;
    kill(s);
    expect(s.players[0].debtCount - debt0, 'lap 1 bills the level alone').toBe(1);
    const first = s.players[0].hand[s.players[0].hand.length - 1];
    expect(first).toBe('gen-wither-o1-skeleton');
    expect(card(first).hp).toBe(2);

    s.replaceQueue = [];
    s = must(s, 0, { type: 'PLAY_SUMMON', handIndex: s.players[0].hand.length - 1, slot: 0 });
    kill(s);
    const second = s.players[0].hand[s.players[0].hand.length - 1];
    expect(second).toBe('gen-wither-gen-wither-o1-skeleton');
    expect(card(second).hp).toBe(1);

    s.replaceQueue = [];
    s = must(s, 0, { type: 'PLAY_SUMMON', handIndex: s.players[0].hand.length - 1, slot: 0 });
    const handBefore = s.players[0].hand.length;
    const debtLast = s.players[0].debtCount;
    kill(s);
    // A copy that would print 0 HP is not returned: the bone stays down.
    expect(s.players[0].hand.length).toBe(handBefore);
    expect(s.players[0].debt).toContain('gen-wither-gen-wither-o1-skeleton');
    expect(s.players[0].debtCount - debtLast, 'the last lap bills once').toBe(1);
  });
});

describe('spell immunity against casts', () => {
  // Hateful Jelly is the smallest printed immune body: 2/4, Spell Immunity.
  const JELLY = 'm-bp-hatefuljely';

  it('keeps spells off the body, targeted and untargeted alike', () => {
    let s = game();
    s = place(s, 0, JELLY, 0);
    s = place(s, 0, D3, 1);
    const jelly = { kind: 'summon', player: 0, slot: 0 } as const;

    // A heal spell cannot choose it, from its own side either.
    s.players[0].slots[0]!.hp[0].flipped = true;
    s.players[0].supporters.push(
      { cardId: 's1-fluterat', sapped: false },
      { cardId: 'f1-basicfish', sapped: false },
    );
    const idx = give(s, 0, 'm-yb-skypaint');
    const res = applyAction(s, 0, { type: 'CAST_SPELL', handIndex: idx, targets: [jelly] });
    expect(res.ok).toBe(false);
    s.players[0].hand.pop();

    // An untargeted spell sweep skips it and still hits its neighbour.
    const before = remainingHp(s.players[0].slots[0]!);
    const spell = makeEffectCtx(s, 1, null, card('kx-DarkCandy'), []);
    spell.damage(jelly, 3);
    spell.damage({ kind: 'summon', player: 0, slot: 1 }, 1);
    expect(remainingHp(s.players[0].slots[0]!)).toBe(before);
    expect(remainingHp(s.players[0].slots[1]!)).toBeLessThan(5);

    // A Power is not a cast: the same damage from a body's power lands.
    const power = makeEffectCtx(s, 1, null, card('m-bp-hatefuljely'), []);
    power.damage(jelly, 1);
    expect(remainingHp(s.players[0].slots[0]!)).toBe(before - 1);
  });

  it('keeps field auras off the body while other auras still land', () => {
    let s = game();
    s = place(s, 0, JELLY, 0);
    const jellyBody = s.players[0].slots[0]!;
    // The enemy field's -1 never lands on it.
    s.players[1].stage = 'm-pg-Doortonowhere';
    expect(effectiveStrength(s, jellyBody)).toBe(2);
    // A body's aura is not a cast and still applies: the enemy Obelisks'
    // "All enemies have -1 attack" lands where the field's could not.
    s.players[1].stage = null;
    putSummonDirect(s, 1, 'm-rg-obelisks', 0, { asPrinted: true, strength: 1, color: 'P', hp: 2 });
    expect(effectiveStrength(s, jellyBody)).toBe(1);
  });
});

describe('a store placed mid-turn', () => {
  it('sells to the active player at once: only self-use waits a turn', () => {
    let s = game();
    // The enemy's shop arrives during MY turn, the way a replacement does.
    const placed = putSummonDirect(s, 1, 'k1-apprentice', 0, {
      asPrinted: true,
      strength: 3,
      color: 'K',
      hp: 3,
    });
    expect(placed).toBeTruthy();
    const src = { kind: 'summon', player: 1, slot: 0 } as const;
    expect(storeBlockers(s, 0, src)).toBeNull();
    s = must(s, 0, { type: 'OPEN_STORE', source: src });
    expect(s.pending?.kind).toBe('store');
    // The owner's own use still waits: it entered this turn.
    expect(storeBlockers(s, 1, src)).toBeTruthy();
  });
});

describe('a spell that annihilates itself', () => {
  it('resolves Cuffed, then removes it from the game instead of discarding it', () => {
    let s = game();
    s = passTo(s, 1);
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    s.players[0].supporters.push(
      { cardId: 'k1-SugarBug', sapped: false },
      { cardId: 'k1-SugarBug', sapped: false },
    );
    const idx = give(s, 0, 'kx-cuffed');
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: idx,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(s.players[1].slots[0]!.rooted).toBe(true);
    expect(s.players[0].discard).not.toContain('kx-cuffed');
    expect(s.players[0].hand).not.toContain('kx-cuffed');
  });
});

describe('new structural verbs', () => {
  it('turns flipped HP cards back down without adding new ones', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s.players[0].slots[0]!.hp[0].flipped = true;
    s.players[0].slots[0]!.hp[1].flipped = true;
    expect(remainingHp(s.players[0].slots[0]!)).toBe(3);
    s.players[0].supporters.push(
      { cardId: 's1-fluterat', sapped: false },
      { cardId: 's1-fluterat', sapped: false },
    );
    const idx = give(s, 0, 'sx-aetalglob');
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: idx,
      targets: [{ kind: 'summon', player: 0, slot: 0 }],
    });
    const summon = s.players[0].slots[0]!;
    expect(remainingHp(summon)).toBe(5);
    expect(summon.hp).toHaveLength(5);
  });

  it('moves HP cards between summons, felling a donor stripped to zero', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    s.players[0].supporters.push(
      { cardId: 'r1-slicebot', sapped: false },
      { cardId: 'r1-slicebot', sapped: false },
    );
    // Grab moves HP cards off an enemy summon onto one of yours.
    const idx = give(s, 0, 'rx-grab');
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: idx,
      targets: [
        { kind: 'summon', player: 1, slot: 0 },
        { kind: 'summon', player: 0, slot: 0 },
      ],
    });
    // Stripped of both HP cards, the donor falls.
    expect(s.players[1].slots[0]).toBeNull();
    expect(s.players[1].debtCount).toBe(1);
    expect(remainingHp(s.players[0].slots[0]!)).toBe(6);
  });

  it('transforms a summon while keeping its HP cards', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D3B, 0);
    s.players[1].supporters.push(
      { cardId: 'f1-basicfish', sapped: false },
      { cardId: 'f1-basicfish', sapped: false },
    );
    const idx = give(s, 1, 'fx-fishify');
    s = must(s, 1, {
      type: 'CAST_SPELL',
      handIndex: idx,
      targets: [{ kind: 'summon', player: 0, slot: 0 }],
    });
    const t = s.players[0].slots[0]!;
    expect(t.cardId).toBe('f1-basicfish');
    expect(t.hp).toHaveLength(5);
  });

  it('destroys a sapped summon and refunds a debt card with The Orb', () => {
    let s = game();
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D2, 0);
    s = passTo(s, 0);
    s.players[1].slots[0]!.sapped = true;
    s.players[0].debt.push(D3B);
    s.players[0].supporters.push(
      { cardId: 'f1-basicfish', sapped: false },
      { cardId: 'o1-ghost', sapped: false },
    );
    const idx = give(s, 0, 'm-bp-orb');
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: idx,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(s.players[1].slots[0]).toBeNull();
    expect(s.players[1].debtCount).toBe(2);
    expect(s.players[0].debt).toHaveLength(0);
    expect(s.players[0].hand).toContain(D3B);
  });

  it('refuses The Orb when no summon is sapped', () => {
    let s = game();
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D2, 0);
    s = passTo(s, 0);
    s.players[0].supporters.push(
      { cardId: 'f1-basicfish', sapped: false },
      { cardId: 'o1-ghost', sapped: false },
    );
    const idx = give(s, 0, 'm-bp-orb');
    const res = applyAction(s, 0, {
      type: 'CAST_SPELL',
      handIndex: idx,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(res.ok).toBe(false);
  });

  it('sap lock holds a summon down through one refresh', () => {
    let s = game();
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D2, 0);
    s = passTo(s, 0);
    s.players[1].slots[0]!.sapped = true;
    // With a sapped enemy on the board, the battlecry demands its target.
    const idx = give(s, 0, 'r1-pointer');
    const skipped = applyAction(s, 0, { type: 'PLAY_SUMMON', handIndex: idx, slot: 0 });
    expect(skipped.ok).toBe(false);
    s = must(s, 0, {
      type: 'PLAY_SUMMON',
      handIndex: idx,
      slot: 0,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(s.players[1].slots[0]!.sapLock).toBe(true);
    s = passTo(s, 1);
    expect(s.players[1].slots[0]!.sapped).toBe(true);
    expect(s.players[1].slots[0]!.sapLock).toBeFalsy();
    s = passTo(s, 1);
    expect(s.players[1].slots[0]!.sapped).toBe(false);
  });

  it('skips a battlecry with no legal target', () => {
    let s = game();
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D2, 0);
    s = passTo(s, 0);
    // Nothing is sapped, so Pointer arrives without a prompt and without effect.
    s = place(s, 0, 'r1-pointer', 0);
    expect(s.players[1].slots[0]!.sapLock).toBeFalsy();
  });

  it('lets a battlecry pick its beneficiary', () => {
    let s = game();
    s = place(s, 0, D1, 0);
    s = place(s, 0, D2, 1);
    // The Admirer must aim at one of the two allies already down, not itself.
    const idx = give(s, 0, 's2-admirer');
    const self = applyAction(s, 0, {
      type: 'PLAY_SUMMON',
      handIndex: idx,
      slot: 2,
      targets: [{ kind: 'summon', player: 0, slot: 2 }],
    });
    expect(self.ok).toBe(false);
    s = must(s, 0, {
      type: 'PLAY_SUMMON',
      handIndex: idx,
      slot: 2,
      targets: [{ kind: 'summon', player: 0, slot: 1 }],
    });
    expect(effectiveStrength(s, s.players[0].slots[1]!)).toBe(4);
  });

  it('pays a colourless power cost with any supporters', () => {
    let s = game();
    s = place(s, 0, 'n3-Seam', 0);
    s.players[0].supporters.push(
      { cardId: 'r1-slicebot', sapped: false },
      { cardId: 'r1-slicebot', sapped: false },
      { cardId: 'r1-slicebot', sapped: false },
    );
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(effectiveStrength(s, s.players[0].slots[0]!)).toBe(4);
    expect(s.players[0].supporters.filter((x) => x.sapped)).toHaveLength(3);
  });

  it('heals the debt when a summon leaves the debt pile', () => {
    const s = game();
    s.players[0].debt.push(D2);
    s.players[0].debtCount = 5;
    reviveFromDebt(s, 0, (d) => d.type === 'summon');
    expect(s.players[0].debtCount).toBe(3);
    expect(s.players[0].hand).toContain(D2);
    expect(s.players[0].debt).toHaveLength(0);
  });

  it('lets debt move across the table', () => {
    // M-Xalbriss's Anti-Abstraction is the debt-transfer power now.
    let s = game();
    s.players[0].debtCount = 4;
    s = place(s, 0, 'm-yp-m-xalbriss', 0);
    s.players[0].supporters.push(
      { cardId: 's1-fluterat', sapped: false },
      { cardId: 'o1-ghost', sapped: false },
    );
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.players[0].debtCount).toBe(3);
    expect(s.players[1].debtCount).toBe(1);
  });
});

describe('triggers', () => {
  it('fires when a summon enters play', () => {
    let s = game();
    s = must(s, 0, { type: 'END_TURN' });
    s = place(s, 1, D2, 0);
    s = must(s, 1, { type: 'END_TURN' });
    // Xyuz Drone deals 1 to every enemy summon as it lands.
    s = place(s, 0, 'm-rg-xyuzdrone', 0);
    expect(remainingHp(s.players[1].slots[0]!)).toBe(card(D2).hp! - 1);
  });

  it('fires when a summon falls', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    // Skeleton returns to hand when it falls, one HP smaller each time.
    s = place(s, 1, 'o1-skeleton', 0);
    s = must(s, 1, { type: 'END_TURN' });
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    expect(s.players[1].hand).toContain('gen-wither-o1-skeleton');
  });

  it('fires on defence, before damage is dealt', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = must(s, 0, { type: 'END_TURN' });
    // Urchin deals 2 to whoever swings at it.
    s = place(s, 1, 'f1-urchin', 0);
    s = must(s, 1, { type: 'END_TURN' });
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    // 2 from the trigger plus 1 from the clash, off a 5 HP body.
    expect(remainingHp(s.players[0].slots[0]!)).toBe(2);
  });

  it('applies a static strength aura from a summon in play', () => {
    let s = game();
    s = place(s, 0, 's1-livingtree', 0);
    // Living Flowers asks its Battlecry for a target now.
    s = must(s, 0, {
      type: 'PLAY_SUMMON',
      handIndex: give(s, 0, 's1-livingflowers'),
      slot: 1,
      targets: [{ kind: 'summon', player: 0, slot: 0 }],
    });
    // Living Flowers prints 1 strength and Living Tree gives other Living +1.
    s = must(s, 0, { type: 'END_TURN' });
    s = must(s, 1, { type: 'END_TURN' });
    expect(legalAttackTargets(s, src(0, 1)).length).toBeGreaterThan(0);
    const before = remainingHp(s.players[1].leader!);
    s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 1), target: { kind: 'leader', player: 1 } });
    expect(remainingHp(s.players[1].leader!)).toBe(before - 2);
  });
});

describe('fatigue', () => {
  it('bills a whole deck-out, and more for the one after it', () => {
    const s = game();
    s.players[0].deck = [D1];
    s.players[0].discard = [];
    const after = passTo(s, 0);
    expect(after.players[0].debtCount).toBe(RESHUFFLE_DEBT);
    // Nothing to turn over, so the next draw runs dry again at the higher rate.
    expect(passTo(after, 0).players[0].debtCount).toBe(
      RESHUFFLE_DEBT * 2 + RESHUFFLE_DEBT_STEP,
    );
  });

  it('ends the game when fatigue reaches the debt limit', () => {
    const s = game();
    s.players[0].deck = [];
    s.players[0].debtCount = DEBT_LIMIT - 2;
    const after = passTo(s, 0);
    expect(after.winner).toBe(1);
    expect(after.winReason).toContain('debt');
  });
});

describe('losing', () => {
  it('ends the game when the leader runs out of HP', () => {
    let s = game();
    s = place(s, 0, D3, 0);
    s = passTo(s, 0);
    for (let i = 0; i < 4 && s.winner === null; i++) {
      s = must(s, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'leader', player: 1 } });
      if (s.winner !== null) break;
      s = passTo(s, 0);
    }
    expect(s.winner).toBe(0);
    expect(s.winReason).toContain('leader');
  });

  it('ends the game at the debt limit', () => {
    const s = game();
    s.players[1].debtCount = DEBT_LIMIT - 1;
    let g = place(s, 0, D3, 0);
    g = must(g, 0, { type: 'END_TURN' });
    g = place(g, 1, D1, 0);
    g = must(g, 1, { type: 'END_TURN' });
    g = must(g, 0, { type: 'DECLARE_ATTACK', source: src(0, 0), target: { kind: 'summon', player: 1, slot: 0 } });
    expect(g.winner).toBe(0);
    expect(g.winReason).toContain('debt');
  });
});

describe('minted cards', () => {
  function fund(state: GameState, player: PlayerIdx): void {
    const m = state.players[player].mana;
    m.P = 5;
    m.O = 5;
    m.R = 5;
    m.F = 5;
    m.S = 5;
    m.C = 5;
  }

  function enemyAt(state: GameState, cardId: string, slot: number): void {
    putSummonDirect(state, 1, cardId, slot, {
      strength: card(cardId).strength ?? 1,
      color: card(cardId).color,
      hp: card(cardId).hp ?? 1,
      asPrinted: true,
    });
  }

  it('splits a recompiled Power cost half Robot half Pepper, Robot taking the odd pip', () => {
    const g = card(fusedRecomp('m-rp-theking', D1, 4, 6, 3));
    expect(g.color).toBe('P');
    expect(g.color2).toBe('R');
    expect(g.factions).toContain('Machine');
    // Decree is printed POOC: three coloured pips come back as one P, two R, C kept.
    expect(costToString(g.powers?.[0].cost)).toBe('PRRC');
  });

  it('recompiler fuses two allies into a Recomp in hand', () => {
    let s = game();
    s = place(s, 0, D2, 0);
    s = place(s, 0, D1, 1);
    fund(s, 0);
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'm-rg-recompiler'),
      targets: [
        { kind: 'summon', player: 0, slot: 0 },
        { kind: 'summon', player: 0, slot: 1 },
      ],
    });
    // Both parts leave the board and the product is a card to play later.
    expect(s.players[0].slots.filter(Boolean)).toHaveLength(0);
    expect(s.players[0].hand.some((id) => id.startsWith('gen-fuse-'))).toBe(true);
    // The parts go home whole: into the discard pile, never into debt.
    expect(s.players[0].discard).toContain(D2);
    expect(s.players[0].debtCount).toBe(0);
  });

  it('carries both parents’ triggers onto the fusion', () => {
    // r3-NerveLite has a Power and no triggers, p3-Pod has the Deathrattle.
    // The Power always came across; the Deathrattle used to be dropped.
    const g = card(fusedRecomp('n3-NerveLite', 'p3-Pod', 3, 7, 3));
    expect(g.triggers?.onDeath).toBeDefined();
    expect(g.powers?.some((p) => p.name === 'Reclaim')).toBe(true);
    expect(g.text).toContain('Deathrattle');
  });

  it('sums the keyword lines of both halves of a fusion', () => {
    // p3-Slicer prints Effect Damage +1 and a Battlecry.
    const g = card(fusedRecomp('p3-Slicer', 'p3-Pod', 3, 7, 3));
    expect(g.effectDamage).toBe(1);
    expect(g.triggers?.onEnter).toBeDefined();
    expect(g.triggers?.onDeath).toBeDefined();
  });

  it('keeps a fusion off the aura it inherited', () => {
    // The King's anthem names itself by id so it does not buff itself. The
    // fusion carries a different id, so the exclusion has to be re-applied.
    const g = card(fusedRecomp('m-rp-theking', 'p3-Pod', 4, 7, 3));
    // Source is the body radiating the bonus, and the engine always passes it:
    // it is how a self-buff recognises itself once a mint has taken its printed
    // id away. Leaving it out asks the merge a question the game never asks.
    const carrier = { uid: 'u1', cardId: g.id, owner: 0 };
    const other = { uid: 'u2', cardId: 'p3-Pod', owner: 0 };
    const args = (summon: unknown) =>
      ({ state: {}, controller: 0, summon, def: g, source: carrier }) as never;
    expect(g.triggers?.strengthBonus?.(args(carrier))).toBe(0);
    expect(g.triggers?.strengthBonus?.(args(other))).toBeGreaterThan(0);
  });

  it('rejects the same summon picked for both halves of the fuse', () => {
    let s = game();
    s = place(s, 0, D2, 0);
    fund(s, 0);
    const res = applyAction(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'm-rg-recompiler'),
      targets: [
        { kind: 'summon', player: 0, slot: 0 },
        { kind: 'summon', player: 0, slot: 0 },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('same target');
  });

  it('fuses enemy bodies even with the caster board full', () => {
    let s = game();
    s = place(s, 0, D1, 0);
    s = place(s, 0, D1, 1);
    s = place(s, 0, D1, 2);
    enemyAt(s, D1, 0);
    enemyAt(s, D2, 1);
    fund(s, 0);
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'm-rg-recompiler'),
      targets: [
        { kind: 'summon', player: 1, slot: 0 },
        { kind: 'summon', player: 1, slot: 1 },
      ],
    });
    // Nothing needs a slot any more: the product is a card, not a body.
    expect(s.players[1].slots[0]).toBeNull();
    expect(s.players[1].slots[1]).toBeNull();
    expect(s.players[0].hand.some((id) => id.startsWith('gen-fuse-'))).toBe(true);
    expect(s.players[0].slots.filter(Boolean)).toHaveLength(3);
  });

  it('virus rebuilds its kill in Pepper and Robot on the caster side', () => {
    let s = game();
    enemyAt(s, D1, 0);
    fund(s, 0);
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'm-rg-virus'),
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    const stolen = s.players[0].slots.find(Boolean)!;
    expect(stolen.cardId).toBe(`gen-virus-${D1}`);
    // A real card in its own right, not an override of the old one.
    expect(stolen.override).toBeUndefined();
    const g = card(stolen.cardId);
    expect(g.color).toBe('P');
    expect(g.color2).toBe('R');
    expect(g.factions).toEqual(['Machine']);
    // The theft heals the debt the death charged.
    expect(s.players[1].debtCount).toBe(0);
    expect(s.players[1].debt).toHaveLength(0);
  });

  it('graft borrows another summon\'s Powers, activated from the new body', () => {
    let s = game();
    s = place(s, 0, 'm-rp-falsehumanity', 0);
    s = place(s, 0, D1, 1);
    s = passTo(s, 0);
    fund(s, 0);
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'ox-graft'),
      targets: [
        { kind: 'summon', player: 0, slot: 0 },
        { kind: 'summon', player: 0, slot: 1 },
      ],
    });
    // The graft mints a card, so the borrowed Power is printed on the face
    // rather than tracked beside it.
    const host = s.players[0].slots[1]!;
    expect(host.cardId.startsWith('gen-graft-')).toBe(true);
    expect(card(host.cardId).powers?.map((p) => p.name)).toContain('Haunt');
    const before = remainingHp(s.players[1].leader!);
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 1),
      powerIndex: 0,
      targets: [],
    });
    expect(remainingHp(s.players[1].leader!)).toBe(before - 2);
    // Haunt saps as part of its cost, and the borrowed copy keeps that.
    expect(s.players[0].slots[1]!.sapped).toBe(true);
  });

  it('graft cannot point a summon at itself', () => {
    let s = game();
    s = place(s, 0, 'm-rp-falsehumanity', 0);
    fund(s, 0);
    const res = applyAction(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'ox-graft'),
      targets: [
        { kind: 'summon', player: 0, slot: 0 },
        { kind: 'summon', player: 0, slot: 0 },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('same target');
  });

  it('graft borrows from a card minted mid-match', () => {
    let s = game();
    s = place(s, 0, 'm-rp-falsehumanity', 0);
    s = place(s, 0, D1, 1);
    s = passTo(s, 0);
    fund(s, 0);
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'm-rg-recompiler'),
      targets: [
        { kind: 'summon', player: 0, slot: 0 },
        { kind: 'summon', player: 0, slot: 1 },
      ],
    });
    // The fuse hands the Recomp over as a card, so it has to be played first.
    const inHand = s.players[0].hand.findIndex((id) => id.startsWith('gen-fuse-'));
    expect(inHand).toBeGreaterThanOrEqual(0);
    // Haunt came through the fuse with its pips rebuilt half Robot half Pepper.
    expect(costToString(card(s.players[0].hand[inHand]).powers?.[0].cost)).toBe('PR');
    s = must(s, 0, { type: 'PLAY_SUMMON', handIndex: inHand, slot: 0 });
    const recompSlot = 0;
    const destSlot = 1;
    s = place(s, 0, D1, destSlot);
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'ox-graft'),
      targets: [
        { kind: 'summon', player: 0, slot: recompSlot },
        { kind: 'summon', player: 0, slot: destSlot },
      ],
    });
    const before = remainingHp(s.players[1].leader!);
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, destSlot),
      powerIndex: 0,
      targets: [],
    });
    expect(remainingHp(s.players[1].leader!)).toBe(before - 2);
  });

  it('wiretap counters the spell and hands over a Robot rebuild', () => {
    let s = game();
    s = passTo(s, 1);
    give(s, 0, 'rx-siphon');
    fund(s, 1);
    s = must(s, 1, {
      type: 'CAST_SPELL',
      handIndex: give(s, 1, 'rx-npcgenerator'),
      targets: [],
    });
    expect(s.pending?.spell).toBeTruthy();
    fund(s, 0);
    s = must(s, 0, {
      type: 'CAST_TRAP',
      handIndex: s.players[0].hand.indexOf('rx-siphon'),
      targets: [],
    });
    // Countered: no Automotons arrive, the spell lands in its caster's discard.
    expect(s.players[1].slots.every((x) => x === null)).toBe(true);
    expect(s.players[1].discard).toContain('rx-npcgenerator');
    const copyId = 'gen-hack-rx-npcgenerator';
    expect(s.players[0].hand).toContain(copyId);
    expect(costToString(card(copyId).cost)).toBe('RC');
  });
});

describe("Chipcrunch's flip", () => {
  /** Put a named card face down under a body, so damage will flip that one. */
  function armour(state: GameState, player: PlayerIdx, slot: number, cardId: string): void {
    // A second card behind it, so the body survives the point of damage.
    state.players[player].slots[slot]!.hp = [
      { cardId, flipped: false },
      { cardId: D1, flipped: false },
    ];
  }

  it('empties the pool and saps a supporter when it flips', () => {
    let s = game();
    s = place(s, 0, D2, 0);
    armour(s, 0, 0, 'r1-chipcrunch');
    s.players[1].supporters = [
      { cardId: D1, sapped: false },
      { cardId: OIL, sapped: false },
    ];
    s.players[1].mana = { P: 2, O: 0, R: 1, F: 0, S: 0, K: 0, C: 3, E: 0 };
    dealDamage(s, { kind: 'summon', player: 0, slot: 0 }, 1);
    expect(s.players[0].slots[0]!.hp[0].flipped).toBe(true);
    // The pool goes the moment it flips; the sap waits on a pick.
    expect(Object.values(s.players[1].mana).every((n) => n === 0)).toBe(true);
    expect(s.players[1].supporters.some((x) => x.sapped)).toBe(false);
    s = must(s, 0, {
      type: 'RESOLVE_CHOICE',
      pick: { kind: 'supporter', player: 1, index: 1 },
    });
    expect(s.players[1].supporters[1].sapped).toBe(true);
    expect(s.players[1].supporters[0].sapped).toBe(false);
  });

  it('still empties the pool when the enemy has no supporters to sap', () => {
    let s = game();
    s = place(s, 0, D2, 0);
    armour(s, 0, 0, 'r1-chipcrunch');
    s.players[1].mana = { P: 1, O: 0, R: 0, F: 0, S: 0, K: 0, C: 0, E: 0 };
    dealDamage(s, { kind: 'summon', player: 0, slot: 0 }, 1);
    expect(s.players[1].mana.P).toBe(0);
  });
});

describe('Pepper level 3s', () => {
  it('eats an ally as HP and charges no debt for it', () => {
    let s = game();
    s = place(s, 0, 'p3-stareater', 0);
    s = place(s, 0, D2, 1);
    s = passTo(s, 0);
    const eater = s.players[0].slots[0]!;
    const before = eater.hp.length;
    const debtBefore = s.players[0].debtCount;
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [{ kind: 'summon', player: 0, slot: 1 }],
    });
    const after = s.players[0].slots[0]!;
    expect(s.players[0].slots[1]).toBeNull();
    // The eaten card is the new HP, face down, and never reaches the debt zone.
    expect(after.hp.length).toBe(before + 1);
    expect(after.hp.at(-1)!.cardId).toBe(D2);
    expect(after.hp.at(-1)!.flipped).toBe(false);
    expect(s.players[0].debtCount).toBe(debtBefore);
    expect(s.players[0].debt).not.toContain(D2);
    expect(after.sapped).toBe(true);
  });

  it('will not let Star Eater eat itself', () => {
    let s = game();
    s = place(s, 0, 'p3-stareater', 0);
    s = passTo(s, 0);
    const res = applyAction(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [{ kind: 'summon', player: 0, slot: 0 }],
    });
    expect(res.ok && res.state.players[0].slots[0] !== null).toBe(true);
  });

  it('Kapigras reforms as an Oil copy of the enemy leader', () => {
    let s = createGame(
      [deck(filler(60), 'o1-Kapigras'), deck(filler(60), 'p3-heavenknows')],
      7,
      0,
    );
    s = passTo(s, 0);
    const leader = s.players[0].leader!;
    const copy = card(leader.cardId);
    expect(copy.name).toBe('Heaven Knows');
    expect(copy.color).toBe('O');
    expect(copy.color2 ?? null).toBeNull();
    // A mirror is worth nothing at 1/1, so it takes the copied body's HP.
    expect(leader.hp.length).toBe((card('p3-heavenknows').hp ?? 0) * 2 + 2);
  });

  it('an Oil copy reprices the powers it carries, not just the card', () => {
    // Aetus Vox pays Solar for Comprehension. Copied into a mono-Oil deck the
    // button has to be payable, or it is printed and dead.
    let s = createGame([deck(filler(60), 'o1-Kapigras'), deck(filler(60), 's3-aetusvox')], 11, 0);
    s = passTo(s, 0);
    const copy = card(s.players[0].leader!.cardId);
    expect(copy.powers?.[0].name).toBe('Comprehension');
    expect(copy.powers?.[0].cost.S ?? 0).toBe(0);
    expect(copy.powers?.[0].cost.O ?? 0).toBe(1);
  });

  it('Leader gates the effect: Kapigras played as a body does not reform', () => {
    let s = game();
    s = place(s, 0, 'o1-Kapigras', 0);
    expect(s.players[0].slots[0]!.cardId).toBe('o1-Kapigras');
  });

  it('Infinite Mind voids its own discard, and only its own', () => {
    let s = game();
    s = place(s, 0, 'r3-infinitemind', 0);
    const mine = s.players[0].discard.length;
    const theirs = s.players[1].discard.length;
    toDiscard(s, 0, D1);
    toDiscard(s, 1, D1);
    expect(s.players[0].discard.length).toBe(mine);
    expect(s.players[1].discard.length).toBe(theirs + 1);
  });

  it('pings every character when its controller ends the turn', () => {
    let s = game();
    s = place(s, 0, D3, 1);
    const mine = remainingHp(s.players[0].slots[1]!);
    s = place(s, 0, 'p3-heavenknows', 0);
    expect(remainingHp(s.players[0].slots[1]!)).toBe(mine);
    s = must(s, 0, { type: 'END_TURN' });
    expect(remainingHp(s.players[0].slots[1]!)).toBe(mine - 1);
    s = place(s, 1, D3B, 0);
    const theirs = remainingHp(s.players[1].slots[0]!);
    // Their end step is not "your turn", so nothing fires.
    s = must(s, 1, { type: 'END_TURN' });
    expect(remainingHp(s.players[1].slots[0]!)).toBe(theirs);
    s = must(s, 0, { type: 'END_TURN' });
    expect(remainingHp(s.players[1].slots[0]!)).toBe(theirs - 1);
  });
});

describe('board choices', () => {
  it('anchors a trigger choice to the body asking, so the client can aim it', () => {
    let s = game();
    s = place(s, 0, 's3-maestro', 1);
    s = passTo(s, 0);
    const ch = s.choiceQueue.find((c) => c.source === 's3-maestro');
    expect(ch, 'The Maestro queued no choice').toBeTruthy();
    // Without this the targeting arrow has no start and springs from the corner.
    expect(ch!.at).toEqual({ kind: 'summon', player: 0, slot: 1 });
  });

  it('actually adds the HP when that choice resolves', () => {
    let s = game();
    s = place(s, 0, 's3-maestro', 1);
    s = place(s, 0, D2, 0);
    s = passTo(s, 0);
    const target: TargetRef = { kind: 'summon', player: 0, slot: 0 };
    const before = remainingHp(s.players[0].slots[0]!);
    s = must(s, 0, { type: 'RESOLVE_CHOICE', pick: target });
    expect(remainingHp(s.players[0].slots[0]!)).toBe(before + 1);
  });
});

describe('awkward interactions the fuzzer went looking for', () => {
  it('will not raise a spell out of the debt zone as a body', () => {
    // A discard flip cost puts the card into debt, so a spell can be sitting
    // there. Necromancer's Raise says "a summon" and has to mean it.
    let s = game();
    s = place(s, 0, 'o2-necromancer', 0);
    s = passTo(s, 1);
    s.players[1].debt.push('px-firebolt');
    s = passTo(s, 0);
    s.players[0].mana = { P: 9, O: 9, R: 9, F: 9, S: 9, K: 0, C: 9, E: 0 };
    const res = applyAction(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [{ kind: 'debt', player: 1, index: 0 }],
    });
    expect(res.ok).toBe(false);
  });

  it('will not let Living Spell become a spell with no effect', () => {
    let s = game();
    // Oil shuffles curses into your deck, and a curse is an effect-less spell.
    s.players[0].deck = [...filler(5), 'o-curse-rot', 'o-curse-dread', ...filler(10)];
    s = place(s, 0, 'm-yr-livingspell', 0);
    const ch = s.choiceQueue[0];
    if (ch) expect(ch.legal ?? []).toEqual([]);
  });

  it('sends a Banana back through the supporter row and out again', () => {
    let s = game();
    s = place(s, 0, 'r2-forklift', 0);
    s.players[0].supporters = [{ cardId: 'n-banana', sapped: false }];
    s = passTo(s, 0);
    s.players[0].mana = { P: 9, O: 9, R: 9, F: 9, S: 9, K: 0, C: 9, E: 0 };
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [{ kind: 'supporter', player: 0, index: 0 }],
    });
    expect(s.players[0].hand).toContain('n-banana');
    expect(s.players[0].supporters).toHaveLength(0);
    // And it can be faced again, because the row is what a Banana is for.
    const back = applyAction(s, 0, {
      type: 'PLAY_SUPPORTER',
      handIndex: s.players[0].hand.indexOf('n-banana'),
    });
    expect(back.ok).toBe(true);
  });
});

describe('running out of cards', () => {
  it('turns the discard over and charges debt rather than ending the game', () => {
    const s = game();
    const p = s.players[0];
    p.deck = [];
    p.discard = [D1, D2, D1, D2];
    const debtBefore = p.debtCount;
    const handBefore = p.hand.length;
    const drawn = drawCards(s, 0, 1);
    expect(drawn).toBe(1);
    expect(p.debtCount).toBe(debtBefore + RESHUFFLE_DEBT);
    expect(p.hand.length).toBe(handBefore + 1);
    // The pile went into the deck, less the card just drawn off it.
    expect(p.discard).toHaveLength(0);
    expect(p.deck).toHaveLength(3);
  });

  it('charges the reshuffle once for a multi-card draw, not once a card', () => {
    const s = game();
    const p = s.players[0];
    p.deck = [];
    p.discard = [D1, D2, D1, D2, D1];
    const before = p.debtCount;
    drawCards(s, 0, 3);
    expect(p.debtCount).toBe(before + RESHUFFLE_DEBT);
  });

  it('still charges when there is nothing to turn over', () => {
    // Otherwise two empty decks deadlock: nothing to draw, nothing to shuffle,
    // and no clock left running to end the game.
    const s = game();
    const p = s.players[0];
    p.deck = [];
    p.discard = [];
    const before = p.debtCount;
    expect(drawCards(s, 0, 1)).toBe(0);
    expect(p.debtCount).toBe(before + RESHUFFLE_DEBT);
  });

  it('charges more every time round, so cycling cannot go on forever', () => {
    const s = game();
    const p = s.players[0];
    let expected = RESHUFFLE_DEBT;
    let total = 0;
    for (let round = 0; round < 3; round++) {
      p.deck = [];
      p.discard = [D1, D2];
      expect(reshuffleCost(s, 0)).toBe(expected);
      const before = p.debtCount;
      drawCards(s, 0, 1);
      expect(p.debtCount - before, `deck-out ${round + 1}`).toBe(expected);
      total += expected;
      expected += RESHUFFLE_DEBT_STEP;
    }
    expect(p.deckOuts).toBe(3);
    expect(total).toBe(RESHUFFLE_DEBT * 3 + RESHUFFLE_DEBT_STEP * 3);
  });

  it('counts deck-outs for each player separately', () => {
    const s = game();
    for (const seat of [0, 1] as const) {
      s.players[seat].deck = [];
      s.players[seat].discard = [D1, D2];
    }
    drawCards(s, 0, 1);
    drawCards(s, 0, 0);
    // Seat 1 has not run dry yet, so its first bill is still the base.
    expect(reshuffleCost(s, 1)).toBe(RESHUFFLE_DEBT);
    expect(reshuffleCost(s, 0)).toBe(RESHUFFLE_DEBT + RESHUFFLE_DEBT_STEP);
  });
});

describe('milling an empty deck', () => {
  it('charges debt for every card it could not take', () => {
    const s = game();
    const p = s.players[1];
    p.deck = [];
    const before = p.debtCount;
    millCards(s, 1, 3);
    expect(p.debtCount).toBe(before + 3 * MILL_DEBT);
  });

  it('mills what it can and charges only for the rest', () => {
    const s = game();
    const p = s.players[1];
    p.deck = [D1];
    p.discard = [];
    const before = p.debtCount;
    expect(millCards(s, 1, 3)).toBe(1);
    expect(p.discard).toHaveLength(1);
    expect(p.debtCount).toBe(before + 2 * MILL_DEBT);
  });

  it('never turns the discard over: that is the draw rule, not this one', () => {
    const s = game();
    const p = s.players[1];
    p.deck = [];
    p.discard = [D1, D2];
    millCards(s, 1, 1);
    expect(p.deck).toHaveLength(0);
    expect(p.discard).toHaveLength(2);
  });
});

describe('the hand limit', () => {
  it('sends everything drawn past the limit to the discard pile', () => {
    const s = game();
    const p = s.players[0];
    p.hand = filler(HAND_LIMIT, D2);
    p.deck = filler(4, D1);
    p.discard = [];
    expect(drawCards(s, 0, 3)).toBe(3);
    expect(p.hand).toHaveLength(HAND_LIMIT);
    // Drawn all the same: they left the deck, they just did not stay.
    expect(p.deck).toHaveLength(1);
    expect(p.discard).toEqual([D1, D1, D1]);
  });

  it('fills the hand to the limit and discards only the rest', () => {
    const s = game();
    const p = s.players[0];
    p.hand = filler(HAND_LIMIT - 1, D2);
    p.deck = filler(3, D1);
    p.discard = [];
    drawCards(s, 0, 3);
    expect(p.hand).toHaveLength(HAND_LIMIT);
    expect(p.discard).toEqual([D1, D1]);
  });

  it('discards a bounced body when there is no room for it', () => {
    let s = game();
    s = place(s, 0, D1, 0);
    const p = s.players[0];
    p.hand = filler(HAND_LIMIT, D2);
    p.discard = [];
    expect(bounceSummon(s, { kind: 'summon', player: 0, slot: 0 })).toBe(true);
    expect(p.slots[0]).toBeNull();
    expect(p.hand).toHaveLength(HAND_LIMIT);
    expect(p.discard).toContain(D1);
  });
});

describe('leader health', () => {
  it('seats a leader at double its printed HP plus two', () => {
    let s = game();
    const printed = card(LEADER).hp ?? 0;
    expect(s.players[0].leader!.hp).toHaveLength(printed * 2 + 2);
    // The other seat fills on that player's first turn, not at deal.
    s = passTo(s, 1);
    expect(s.players[1].leader!.hp).toHaveLength(printed * 2 + 2);
  });
});

describe('flips worth asking about', () => {
  /** A costed flip waiting on its owner, as the client would find it. */
  function offer(cardId: string, holder: TargetRef) {
    return { player: 0 as PlayerIdx, holder, cardId, pending: 0, depth: 0 };
  }

  const leaderRef: TargetRef = { kind: 'leader', player: 0 };

  it('asks about a debt recursion flip only when a summon is in the debt zone', () => {
    const s = game();
    const seabunny = offer('f1-seabunny', leaderRef);
    expect(flipWouldFire(s, seabunny)).toBe(false);
    s.players[0].debt.push(D2);
    expect(flipWouldFire(s, seabunny)).toBe(true);
  });

  it('counts only summons in the debt zone, not spells', () => {
    const s = game();
    s.players[0].debt.push('fx-fishgoop');
    expect(flipWouldFire(s, offer('f1-seabunny', leaderRef))).toBe(false);
  });

  it('asks about a board sweep only when the enemy has bodies to sweep', () => {
    let s = game();
    const castle = offer('px-castle', leaderRef);
    expect(flipWouldFire(s, castle)).toBe(false);
    s = place(passTo(s, 1), 1, D1, 0);
    expect(flipWouldFire(s, castle)).toBe(true);
  });

  it('will not trade a mill for a draw off an empty deck', () => {
    const s = game();
    const rat = offer('s1-fluterat', leaderRef);
    s.players[0].deck = [D1];
    expect(flipWouldFire(s, rat)).toBe(false);
    s.players[0].deck = [D1, D1];
    expect(flipWouldFire(s, rat)).toBe(true);
  });

  it('never asks once the summon the card was protecting has fallen', () => {
    const s = game();
    s.players[0].debt.push(D2);
    const gone: TargetRef = { kind: 'summon', player: 0, slot: 2 };
    expect(flipWouldFire(s, offer('f1-seabunny', gone))).toBe(false);
  });

  it('asks about a flip that prints no opinion of its own', () => {
    const s = game();
    expect(card('s2-ragick').flipUseful).toBeUndefined();
    expect(flipWouldFire(s, offer('s2-ragick', leaderRef))).toBe(true);
  });
});

describe('card triggers', () => {
  it('draws for Krazbot only when the summon played is a Hedron', () => {
    let s = game();
    s = place(s, 0, 'm-yg-krazbot', 0);
    const before = s.players[0].hand.length;
    // place() puts the card in hand before playing it, so a play nets zero.
    s = place(s, 0, 'm-yg-pilgrim', 1);
    expect(s.players[0].hand).toHaveLength(before + 1);
    s = place(s, 0, D1, 2);
    expect(s.players[0].hand).toHaveLength(before + 1);
  });

  it('pumps the Hedrons already out when Hedronic Gateway lands', () => {
    let s = game();
    s = place(s, 0, 'm-yg-pilgrim', 0);
    const str = effectiveStrength(s, s.players[0].slots[0]!);
    const hp = remainingHp(s.players[0].slots[0]!);
    s = place(s, 0, 'm-yg-hedronicgateway', 1);
    expect(effectiveStrength(s, s.players[0].slots[0]!)).toBe(str + 1);
    expect(remainingHp(s.players[0].slots[0]!)).toBe(hp + 1);
    // Its own battlecry passes over it, so it stands on its printed line and
    // lands sapped.
    const gate = s.players[0].slots[1]!;
    expect(effectiveStrength(s, gate)).toBe(2);
    expect(remainingHp(gate)).toBe(3);
    expect(gate.sapped).toBe(true);
  });

  it('sweeps Wounds off both sides for Park Ranger and keeps the attack', () => {
    let s = game();
    s = passTo(s, 1);
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    s = place(s, 0, 'o2-parkranger', 0);
    s = place(s, 0, D1, 1);
    addWounds(s, { kind: 'summon', player: 1, slot: 0 }, 1);
    addWounds(s, { kind: 'summon', player: 0, slot: 1 }, 1);
    s = passTo(s, 0);
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, OIL) });
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.players[1].slots[0]!.wounds).toBe(0);
    expect(s.players[0].slots[1]!.wounds).toBe(0);
    expect(effectiveStrength(s, s.players[0].slots[0]!)).toBe(2 + 2);
  });

  it('raises the enemy dead in Oil, two bigger and a Spirit', () => {
    let s = game();
    s = place(s, 0, 'o2-necromancer', 0);
    s = passTo(s, 1);
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    dealDamage(s, { kind: 'summon', player: 1, slot: 0 }, 9);
    s = must(s, 1, { type: 'DECLINE_REPLACE' });
    expect(s.players[1].debt).toContain(D1);
    const owed = s.players[1].debtCount;
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, OIL) });
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [{ kind: 'debt', player: 1, index: s.players[1].debt.indexOf(D1) }],
    });
    const raised = s.players[0].slots.find((x) => x?.cardId.startsWith('gen-raise-'))!;
    expect(raised).toBeTruthy();
    const def = card(raised.cardId);
    expect(def.color).toBe('O');
    expect(def.factions).toContain('Spirit');
    expect(def.strength).toBe((card(D1).strength ?? 0) + 2);
    expect(remainingHp(raised)).toBe((card(D1).hp ?? 0) + 2);
    // Pulling the body out of their pile pays their debt down with it.
    expect(s.players[1].debtCount).toBeLessThan(owed);
  });

  it('lets the spell resolve behind Lemon Aid', () => {
    let s = game();
    s = passTo(s, 1);
    s = place(s, 1, D3, 0);
    s = must(s, 1, { type: 'PLAY_SUPPORTER', handIndex: give(s, 1, SOLAR) });
    give(s, 1, 'sx-lemonaid');
    s = passTo(s, 0);
    dealDamage(s, { kind: 'summon', player: 1, slot: 0 }, 3);
    expect(remainingHp(s.players[1].slots[0]!)).toBe(2);
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, D2) });
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: give(s, 0, 'x-p-bolt'),
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(s.pending?.spell).toBeTruthy();
    s = must(s, 1, {
      type: 'CAST_TRAP',
      handIndex: s.players[1].hand.indexOf('sx-lemonaid'),
      targets: [],
    });
    // Heals back to full, then the bolt it did not counter lands for 2.
    expect(remainingHp(s.players[1].slots[0]!)).toBe(3);
  });

  it('heals The Count only for a kill inside its own battle', () => {
    let s = game();
    s = place(s, 0, 'o2-thecount', 0);
    s = passTo(s, 1);
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    dealDamage(s, { kind: 'summon', player: 0, slot: 0 }, 1);
    expect(remainingHp(s.players[0].slots[0]!)).toBe(2);
    s = must(s, 0, {
      type: 'DECLARE_ATTACK',
      source: src(0, 0),
      target: { kind: 'summon', player: 1, slot: 0 },
    });
    expect(s.players[1].slots[0]).toBeNull();
    // 3 HP, minus the dummy's 1 counter-damage, plus the 2 the kill heals back.
    expect(remainingHp(s.players[0].slots[0]!)).toBe(3);
  });

  it('sweeps the enemy board with Ultimate Novelty and takes Gold Wild with it', () => {
    let s = game();
    s = place(s, 0, 's3-goldwild', 0);
    s = passTo(s, 1);
    s = place(s, 1, D3, 0);
    s = place(s, 1, D1, 1);
    s = passTo(s, 0);
    s.players[0].mana = { P: 0, O: 0, R: 0, F: 0, S: 6, K: 0, C: 0, E: 0 };
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.players[1].slots.filter(Boolean)).toHaveLength(0);
    // It pays for the sweep with itself, so the slot it stood in is empty too.
    expect(s.players[0].slots[0]).toBeNull();
    expect(s.players[0].debtCount).toBeGreaterThan(0);
  });

  it('fires Scientist for no mana at all', () => {
    let s = game();
    s = place(s, 0, 'o2-scientist', 0);
    s = passTo(s, 0);
    const before = s.players[0].hand.length;
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.players[0].hand).toHaveLength(before + 1);
  });
});

describe('triple-colour legends', () => {
  const OVERKNOWER = 'm-bgp-overknower';
  const SCREENER = 'm-bgr-screener';
  const MALWARE = 'm-grp-horriblemalware';
  const SLIME = 'm-gpy-obscureslime';
  const GRINKLE = 'm-brp-decayinggrinklegod';
  const BOLT = 'x-p-bolt';

  it('prints one level 3 legend per three-colour combination', () => {
    // Level 3 is what makes a triple a legend; a triple at any other level is
    // an ordinary card the set may print freely. Six colours make twenty
    // combinations, and every one of them now has its legend.
    const triples = allCards().filter((d) => d.color3);
    const legends = triples.filter((d) => d.level === 3);
    expect(legends).toHaveLength(20);
    expect(new Set(legends.map((d) => [...new Set(colorsOf(d))].sort().join('')))).toHaveProperty(
      'size',
      20,
    );
    for (const d of legends) expect(d.rarity).toBe('L');
    for (const d of triples) expect(new Set(colorsOf(d)).size).toBe(3);
  });

  it('frames each one in the colour it pays as a supporter', () => {
    const frames: Record<string, Color> = {
      'm-bgp-overknower': 'F',
      'm-bgr-screener': 'R',
      'm-bgy-seeraltine': 'F',
      'm-bpy-bananamage': 'S',
      'm-brp-decayinggrinklegod': 'O',
      'm-bry-drownedwanderer': 'F',
      'm-gpy-obscureslime': 'O',
      'm-grp-horriblemalware': 'R',
      'm-gry-spiritofsolstice': 'P',
      'm-ryp-livingcurse': 'P',
      // Most Candy trios frame Candy; Vier wears Fish and the Sweetling Robot.
      'm-mbp-vier': 'F',
      'm-mbr-saraza': 'K',
      'm-mby-wellworthit': 'K',
      'm-mgb-codeinfestedsweetling': 'R',
      'm-mgp-godofmisfortune': 'K',
      'm-mgr-ransomwareartist': 'K',
      'm-mgy-thethorn': 'K',
      'm-mpr-humanitysdefender': 'K',
      'm-mpy-sopapli': 'K',
      'm-myr-hellmage': 'K',
    };
    const s = game();
    for (const [id, color] of Object.entries(frames)) {
      expect(card(id).color, id).toBe(color);
      expect(manaKindFor(s.players[0], card(id)), `${id} as a supporter`).toBe(color);
    }
  });

  it('keeps a triple card out of a deck whose leader brings only two colours', () => {
    expect(isLegalUnder(card(OVERKNOWER), deckIdentity('m-bg-machineblue'))).toBe(false);
    expect(isLegalUnder(card(OVERKNOWER), deckIdentity(OVERKNOWER))).toBe(true);
  });

  it('makes spells free for an Overknower leader with an empty board, and only then', () => {
    let s = createGame([deck(filler(60), OVERKNOWER), deck(filler(60))], 999, 0);
    s = passTo(s, 1);
    s = place(s, 1, D1, 0);
    s = passTo(s, 0);
    const bolt = give(s, 0, 'x-p-bolt');
    s = place(s, 0, D1, 0);
    // One body on the board is enough to switch the leader's own line off.
    expect(costToString(costFor(s.players[0], card('x-p-bolt')))).toBe('P');
    s.players[0].slots[0] = null;
    expect(costFor(s.players[0], card('x-p-bolt'))).toBeUndefined();
    s = must(s, 0, {
      type: 'CAST_SPELL',
      handIndex: bolt,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    expect(s.players[0].mana).toEqual({ P: 0, O: 0, R: 0, F: 0, S: 0, K: 0, C: 0, E: 0 });
  });

  it('leaves Overknower in a slot paying full price, because it is a summon it controls', () => {
    let s = createGame([deck(filler(60), LEADER), deck(filler(60))], 999, 0);
    s = passTo(s, 0);
    s = place(s, 0, OVERKNOWER, 0);
    expect(costToString(costFor(s.players[0], card('x-p-bolt')))).toBe('P');
  });

  it('casts Virus through Infect, rebuilding the kill on your side', () => {
    let s = game();
    s = place(s, 0, MALWARE, 0);
    s = passTo(s, 1);
    s = place(s, 1, 'r1-lightbolbe', 0);
    // Lightbolbe prints 2 HP now, so it is softened to one first.
    dealDamage(s, { kind: 'summon', player: 1, slot: 0 }, card('r1-lightbolbe').hp! - 1);
    s = passTo(s, 0);
    s.players[0].mana = { P: 1, O: 1, R: 1, F: 0, S: 0, K: 0, C: 0, E: 0 };
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [{ kind: 'summon', player: 1, slot: 0 }],
    });
    // On its last HP, Virus's ping kills it and it comes back mine.
    expect(s.players[1].slots[0]).toBeNull();
    expect(s.players[0].slots[1]?.cardId).toBe('gen-virus-r1-lightbolbe');
    expect(card('gen-virus-r1-lightbolbe').color).toBe('P');
  });

  it('lifts Effect Damage for each ally Machine down to its last HP', () => {
    let s = game();
    s = place(s, 0, SCREENER, 0);
    // Lightbolbe prints 2 HP now, so it has to be knocked to its last one.
    s = place(s, 0, 'r1-lightbolbe', 1);
    dealDamage(s, { kind: 'summon', player: 0, slot: 1 }, card('r1-lightbolbe').hp! - 1);
    expect(effectDamageOf(s, 0)).toBe(1);
    // Defender is a Machine with room to spare: nothing until it is down to 1.
    s = place(s, 0, 'r1-defender', 2);
    expect(effectDamageOf(s, 0)).toBe(1);
    dealDamage(s, { kind: 'summon', player: 0, slot: 2 }, card('r1-defender').hp! - 1);
    expect(effectDamageOf(s, 0)).toBe(2);
    // Screener is a Machine too, but "ally" never means the card itself.
    s.players[0].slots[1] = null;
    s.players[0].slots[2] = null;
    expect(effectDamageOf(s, 0)).toBe(0);
  });

  it('takes a card out of the enemy deck with Static and hands back the rest', () => {
    let s = game();
    s = place(s, 0, SCREENER, 0);
    s = passTo(s, 0);
    const theirDeck = s.players[1].deck.length;
    const top = s.players[1].deck[0];
    s.players[0].mana = { P: 1, O: 0, R: 1, F: 1, S: 0, K: 0, C: 0, E: 0 };
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.choiceQueue[0].cards).toHaveLength(5);
    s = must(s, 0, { type: 'RESOLVE_CHOICE', index: 0 });
    // The pick arrives rebuilt in Robot, and the other four go back where they came from.
    expect(s.players[0].hand.at(-1)).toBe(`gen-hack-${top}`);
    expect(card(s.players[0].hand.at(-1)!).color).toBe('R');
    expect(s.players[1].deck).toHaveLength(theirDeck - 1);
  });

  it('mints an Oil copy for Horrible Malware whenever the other side casts', () => {
    let s = game();
    s = place(s, 0, MALWARE, 0);
    s = passTo(s, 1);
    s = place(s, 1, D1, 0);
    const before = s.players[0].hand.length;
    s.players[1].mana = { P: 1, O: 0, R: 0, F: 0, S: 0, K: 0, C: 0, E: 0 };
    s = must(s, 1, {
      type: 'CAST_SPELL',
      handIndex: give(s, 1, BOLT),
      targets: [{ kind: 'summon', player: 0, slot: 0 }],
    });
    expect(s.players[0].hand).toHaveLength(before + 1);
    const copy = card(s.players[0].hand.at(-1)!);
    expect(copy.color).toBe('O');
    // One coloured pip on the bolt, so Oil takes the odd one and nothing else.
    expect(costToString(copy.cost)).toBe('O');
  });

  it("hands the enemy a Banana supporter with Joke, in the enemy leader's own colour", () => {
    let s = game();
    s = place(s, 0, 'm-bpy-bananamage', 0);
    s = passTo(s, 0);
    const debt = s.players[1].debtCount;
    s.players[0].mana = { P: 0, O: 0, R: 0, F: 0, S: 1, K: 0, C: 0, E: 0 };
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.players[1].supporters).toHaveLength(1);
    // The Dummy Warden is Robot, so the gift is a Robot Banana, not a colourless one:
    // it pays the colour that player actually spends.
    const given = s.players[1].supporters[0].cardId;
    expect(card(given).name).toBe('Banana');
    expect(manaKindFor(s.players[1], card(given))).toBe('R');
    expect(s.players[1].debtCount).toBe(debt + 3);
  });

  it('keeps the Banana out of every deck pool and the builder', () => {
    expect(card('n-banana').uncollectible).toBe(true);
    expect(card('n-banana').text).toBe('Supporter');
    for (const d of allDecks) expect(d.cards, d.key).not.toContain('n-banana');
  });

  it("gives back a supporter and the turn allowance with Forklift", () => {
    let s = game();
    s = place(s, 0, 'r2-forklift', 0);
    s = passTo(s, 0);
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, D1) });
    expect(s.players[0].supportersLeft).toBe(0);
    const hand = s.players[0].hand.length;
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [{ kind: 'supporter', player: 0, index: 0 }],
    });
    // The card comes back and so does the one supporter the turn allows.
    expect(s.players[0].supporters).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(hand + 1);
    expect(s.players[0].supportersLeft).toBe(1);
    s = must(s, 0, { type: 'PLAY_SUPPORTER', handIndex: give(s, 0, D1) });
    expect(s.players[0].supporters).toHaveLength(1);
  });

  it('sends a supporter to debt with Melt and closes the row behind it', () => {
    let s = game();
    s = place(s, 0, SLIME, 0);
    s = passTo(s, 1);
    s = must(s, 1, { type: 'PLAY_SUPPORTER', handIndex: give(s, 1, SOLAR) });
    s = passTo(s, 0);
    const supporter = s.players[1].supporters[0].cardId;
    s.players[0].mana = { P: 0, O: 1, R: 2, F: 0, S: 1, K: 0, C: 0, E: 0 };
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 1,
      targets: [{ kind: 'supporter', player: 1, index: 0 }],
    });
    expect(s.players[1].supporters).toHaveLength(0);
    expect(s.players[1].debt).toContain(supporter);
  });

  it('slides exactly one scried card under an ally with Long Sight', () => {
    let s = game();
    s = place(s, 0, 'm-bgy-seeraltine', 0);
    s = passTo(s, 0);
    s = place(s, 0, D3, 1);
    const target: TargetRef = { kind: 'summon', player: 0, slot: 1 };
    dealDamage(s, target, 2);
    const before = s.players[0].slots[1]!.hp.length;
    const spent = remainingHp(s.players[0].slots[1]!);
    const deck = s.players[0].deck.length;
    s.players[0].mana = { P: 0, O: 0, R: 1, F: 1, S: 1, K: 0, C: 0, E: 0 };
    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [target],
    });
    // The heal lands first, then five come off the deck and wait for a pick.
    expect(remainingHp(s.players[0].slots[1]!)).toBe(spent + 2);
    expect(s.choiceQueue[0].cards).toHaveLength(5);
    s = must(s, 0, { type: 'RESOLVE_CHOICE', index: 2 });
    // One card lands as HP; the other four go back to the bottom of the deck.
    expect(s.players[0].slots[1]!.hp).toHaveLength(before + 1);
    expect(s.players[0].slots[1]!.hp.at(-1)!.flipped).toBe(false);
    expect(s.players[0].deck).toHaveLength(deck - 1);
  });

  it('wins outright on Grinkle Rot, past the summons guarding the leader', () => {
    let s = game();
    s = place(s, 0, GRINKLE, 0);
    s = passTo(s, 1);
    s = place(s, 1, D3, 0);
    s = passTo(s, 0);
    s.players[0].mana = { P: 3, O: 3, R: 0, F: 3, S: 0, K: 0, C: 0, E: 0 };
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.winner).toBe(0);
  });
});

describe('a match cannot run forever', () => {
  it('ends in a draw on the action that reaches the cap', () => {
    // A real game resolves on debt long before the cap, so the cap is set up
    // directly. It exists to catch a lock, not to decide ordinary games.
    const s = game();
    s.actions = MAX_ACTIONS - 1;
    const r = applyAction(s, currentActor(s), { type: 'END_TURN' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.drawn).toBe(true);
    expect(isOver(r.state)).toBe(true);
    expect(r.state.winner).toBeNull();
    expect(r.state.winReason).toContain('draw');
  });

  it('ends in a draw on the turn that reaches the cap', () => {
    const s = game();
    s.turn = MAX_TURNS;
    const r = applyAction(s, currentActor(s), { type: 'END_TURN' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.drawn).toBe(true);
    expect(r.state.winReason).toContain(String(MAX_TURNS));
  });

  it('does not fire in an ordinary game', () => {
    let s = game();
    for (let i = 0; i < 400 && !isOver(s); i++) {
      const r = applyAction(s, currentActor(s), { type: 'END_TURN' });
      if (!r.ok) break;
      s = r.state;
    }
    // The debt clock resolves it first, which is the point.
    expect(s.drawn).toBe(false);
    expect(s.winner).not.toBeNull();
  });

  it('refuses further actions once it has ended', () => {
    let s = game();
    s.drawn = true;
    const r = applyAction(s, currentActor(s), { type: 'END_TURN' });
    expect(r.ok).toBe(false);
  });

  it('leaves a real winner alone rather than overwriting it with a draw', () => {
    const s = game();
    s.players[0].debtCount = DEBT_LIMIT;
    s.actions = MAX_ACTIONS - 1;
    const r = applyAction(s, currentActor(s), { type: 'END_TURN' });
    expect(r.ok).toBe(true);
    if (r.ok && r.state.winner !== null) expect(r.state.drawn).toBe(false);
  });
});

describe('Drowned Wanderer', () => {
  it('lands what it washes ashore with the attack it promises, not only the HP', () => {
    // The Power reads "+1 attack and 1 extra HP". The extra HP always arrived
    // and the attack never did: the bonus was passed as an override, and an
    // override is exactly what asPrinted discards.
    let s = game();
    s = place(s, 0, 'm-bry-drownedwanderer', 0);
    s = passTo(passTo(s, 1), 0);

    const washed = 'o1-skeleton';
    const printed = card(washed);
    const me = s.players[0];
    me.deck = [washed, ...filler(30)];
    me.mana.F = 1;
    me.mana.P = 1;
    me.mana.S = 1;

    s = must(s, 0, {
      type: 'ACTIVATE_POWER',
      source: src(0, 0),
      powerIndex: 0,
      targets: [],
    });

    const landed = s.players[0].slots.find((b, i) => i !== 0 && b && b.cardId === washed);
    expect(landed, 'the summon came ashore').toBeTruthy();
    expect(effectiveStrength(s, landed!), 'printed attack plus one')
      .toBe((printed.strength ?? 0) + 1);
    expect(remainingHp(landed!), 'printed HP plus one').toBe((printed.hp ?? 1) + 1);
  });
});

describe('Ernum mana', () => {
  const pool = (over: Partial<Record<ManaKind, number>> = {}): Record<ManaKind, number> => ({
    P: 0,
    O: 0,
    R: 0,
    F: 0,
    S: 0,
    K: 0,
    C: 0,
    E: 0,
    ...over,
  });

  it('is what Ernum pays when it is faced as a supporter', () => {
    const s = game();
    s.players[0].supporters = [{ cardId: 'm-ernum', sapped: false }];
    expect(manaKindFor(s.players[0], card('m-ernum'))).toBe('E');
    expect(availableMana(s.players[0]).E).toBe(1);
  });

  it('covers a pip of any colour, one pip per mana', () => {
    const p = game().players[0];
    p.mana = pool({ E: 2 });
    expect(canPay(p, { P: 1, S: 1 })).toBe(true);
    expect(canPay(p, { C: 2 })).toBe(true);
    expect(canPay(p, { P: 2 })).toBe(true);
    expect(canPay(p, { P: 1, S: 1, C: 1 })).toBe(false);
  });

  it('is the last mana spent when something else could pay', () => {
    let s = game();
    s = place(s, 0, 'r2-hobbyist', 0);
    s = passTo(s, 0);
    s.players[0].mana = pool({ R: 1, E: 1 });
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.players[0].mana.R).toBe(0);
    expect(s.players[0].mana.E).toBe(1);
  });

  it('pays the pip on its own when nothing else can', () => {
    let s = game();
    s = place(s, 0, 'r2-hobbyist', 0);
    s = passTo(s, 0);
    s.players[0].mana = pool({ E: 1 });
    s = must(s, 0, { type: 'ACTIVATE_POWER', source: src(0, 0), powerIndex: 0, targets: [] });
    expect(s.players[0].mana.E).toBe(0);
  });
});
