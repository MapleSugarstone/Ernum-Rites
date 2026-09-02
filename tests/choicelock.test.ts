import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame } from '../src/engine/engine';
import { card } from '../src/engine/registry';
import { choiceIsLive, currentActor, type GameState } from '../src/engine/state';
import { candidateActions, chooseAction } from '../src/ai/bot';

/**
 * A reveal that turns up nothing you may take.
 *
 * "Scry 5 for a spell" digs five cards and offers the spells among them. When
 * there are none, the choice is mandatory and has no legal pick, so there is
 * nothing that resolves it: picking is refused because no index is legal, and
 * resolving with no pick was refused because the choice was not optional. The
 * board sat there with a Continue button that did nothing.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const SCRIER = 's2-ragick';

function game(): GameState {
  const s = createGame(
    [
      { name: 'A', leaderId: LEADER, cards: Array(40).fill(FILLER) },
      { name: 'B', leaderId: LEADER, cards: Array(40).fill(FILLER) },
    ],
    5,
    0,
  );
  return s;
}

/** A mandatory reveal with nothing legal in it, which is the deadlock exactly. */
function stuck(s: GameState): GameState {
  s.choiceQueue = [
    {
      player: 0,
      source: SCRIER,
      effect: 'scry',
      prompt: 'Take a spell.',
      cards: [FILLER, FILLER, FILLER],
      legal: [],
    },
  ];
  return s;
}

describe('a reveal with no legal pick', () => {
  it('names a real card that can cause it', () => {
    expect(card(SCRIER).text, `${SCRIER} scries`).toContain('Scry');
  });

  it('resolves rather than locking the board', () => {
    const s = stuck(game());
    expect(currentActor(s), 'the choice belongs to the player it was queued for').toBe(0);

    const res = applyAction(s, 0, { type: 'RESOLVE_CHOICE' });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    expect(res.ok && res.state.choiceQueue.length, 'the queue cleared').toBe(0);
  });

  it('still refuses a bare resolve while something legal is on offer', () => {
    const s = stuck(game());
    s.choiceQueue[0].legal = [1];

    const res = applyAction(s, 0, { type: 'RESOLVE_CHOICE' });
    expect(res.ok, 'a mandatory choice with a legal pick has to be answered').toBe(false);
  });

  it('does not leave the bot producing an illegal action either', () => {
    const s = stuck(game());
    const action = chooseAction(s, 0);
    const res = applyAction(s, 0, action);
    expect(res.ok, res.ok ? '' : `bot offered ${action.type}: ${res.error}`).toBe(true);
  });
});

describe('a choice queued behind a response window', () => {
  it('is not the live question while the window is open', () => {
    // Ragick's Strike fires as the attack is declared and queues a scry for the
    // attacker. The trap window then opens for the defender, so the game is
    // waiting on the defender and the scry at the head of the queue is not
    // theirs to answer. A client that drew it anyway put a prompt on their
    // screen that no action of theirs could resolve, over the top of the trap
    // window they were actually being asked about.
    const s = stuck(game());
    expect(choiceIsLive(s), 'with no window open the choice is the question').toBe(true);

    s.pending = {
      kind: 'response',
      player: 1,
      battle: { attacker: { kind: 'summon', player: 0, slot: 0 },
                defender: { kind: 'summon', player: 1, slot: 0 }, trapUsed: false },
      spell: null,
    };
    expect(choiceIsLive(s), 'the window outranks it').toBe(false);
    expect(currentActor(s), 'and the game is waiting on the defender').toBe(1);
  });

  it('leaves the defender their trap rather than no move at all', () => {
    // The bot read the queues in the opposite order to the engine, so a player
    // whose window was open while somebody else's choice sat at the head was
    // handed no candidates at all and passed on a trap it was holding.
    const s = stuck(game());
    s.players[1].hand = ['px-banner'];
    s.pending = {
      kind: 'response',
      player: 1,
      battle: { attacker: { kind: 'summon', player: 0, slot: 0 },
                defender: { kind: 'summon', player: 1, slot: 0 }, trapUsed: false },
      spell: null,
    };
    const acts = candidateActions(s, 1);
    expect(
      acts.every((a) => a.type !== 'RESOLVE_CHOICE'),
      'it is not offered a choice belonging to the other seat',
    ).toBe(true);
  });
});
