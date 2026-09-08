// A replay told turn by turn: who did what, with card names, and the leader
// HP after each turn. For reading a pulled human game before analysing it.
//
//   npx tsx scripts/narrate.ts replays/human/000001-solo-2026-09-07.json
import { readFileSync } from 'node:fs';
import '../src/cards';
import { card } from '../src/engine/registry';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, type Replay } from '../src/engine/replay';
import type { PlayerIdx } from '../src/engine/types';
import { describeAction, leaderLine, QUIET, seatName } from './narration';

const file = process.argv[2];
if (!file) {
  console.error('usage: npx tsx scripts/narrate.ts <replay.json>');
  process.exit(1);
}
const replay = JSON.parse(readFileSync(file, 'utf8')) as Replay & { log?: { botSeat?: number } };
const botSeat = replay.log?.botSeat ?? -1;
let state = createGame(
  replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
  replay.seed,
  replay.startingPlayer as PlayerIdx,
);
console.log(replay.label);
console.log(replay.decks.map((d, i) => `${seatName(i, botSeat)}: ${card(d.leaderId).name} leads ${d.cards.length} cards`).join(' | '));
let turn = 0;
for (const [i, step] of replay.steps.entries()) {
  const action = actionFromWire(step.action);
  if (state.turn !== turn) {
    turn = state.turn;
    console.log(`\n-- turn ${turn} (leaders: ${leaderLine(state, botSeat)})`);
  }
  if (!QUIET.has(action.type)) console.log(`  ${String(i).padStart(3)}  ${seatName(step.actor, botSeat)} ${describeAction(state, step.actor, action)}`);
  const res = applyAction(state, step.actor as PlayerIdx, action);
  if (!res.ok) {
    console.log(`  (the engine refused that: ${res.error})`);
    break;
  }
  state = res.state;
}
console.log(`\nresult: ${state.winner === null ? 'draw' : `${seatName(state.winner, botSeat)} wins`}${state.winReason ? ` (${state.winReason})` : ''} after ${state.turn} turns`);
