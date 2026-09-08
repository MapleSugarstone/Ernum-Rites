// A logged game from a position on, played by the bot in both seats: how it
// would have finished from where a person stood, or how it would have played
// the whole matchup from the deal.
//
//   npx tsx scripts/playout.ts replays/human/000002-solo-2026-09-07.json 25
//   npx tsx scripts/playout.ts <replay> [step] [--set kitExposed=0.5,combo=24]
//
// The replay is applied up to the step (0 is the deal), then every decision
// from there is the bot's. The other seat has to be a bot too once the game
// leaves the recorded line, so both are; the weights in --set apply to both.
import { readFileSync } from 'node:fs';
import '../src/cards';
import { chooseAction, clearPlan, defaultWeights, type BotWeights } from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, type Replay } from '../src/engine/replay';
import { currentActor, isOver } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';
import { describeAction, leaderLine, QUIET, seatName } from './narration';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('usage: npx tsx scripts/playout.ts <replay.json> [step] [--set name=value,...]');
  process.exit(1);
}
const from = Number(args[1] && !args[1].startsWith('--') ? args[1] : 0);
const setAt = args.indexOf('--set');
const w: BotWeights = { ...defaultWeights };
if (setAt >= 0 && args[setAt + 1]) {
  for (const pair of args[setAt + 1].split(',')) {
    const [k, v] = pair.split('=');
    if (!(k in w)) throw new Error(`no weight named ${k}`);
    (w as unknown as Record<string, number>)[k] = Number(v);
  }
}

const replay = JSON.parse(readFileSync(file, 'utf8')) as Replay & { log?: { botSeat?: number } };
const botSeat = replay.log?.botSeat ?? -1;
let state = createGame(
  replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
  replay.seed,
  replay.startingPlayer as PlayerIdx,
);
for (let i = 0; i < Math.min(from, replay.steps.length); i++) {
  const step = replay.steps[i];
  const res = applyAction(state, step.actor as PlayerIdx, actionFromWire(step.action));
  if (!res.ok) throw new Error(`step ${i} refused: ${res.error}`);
  state = res.state;
}
console.log(`${replay.label}`);
console.log(`from step ${from}, turn ${state.turn} (leaders: ${leaderLine(state, botSeat)}); the bot plays both seats from here`);
clearPlan();
let turn = -1;
const t0 = Date.now();
for (let n = 0; n < 4000 && !isOver(state) && state.turn < 200; n++) {
  const actor = currentActor(state);
  const action = chooseAction(state, actor, w);
  if (state.turn !== turn) {
    turn = state.turn;
    console.log(`\n-- turn ${turn} (leaders: ${leaderLine(state, botSeat)})`);
  }
  if (!QUIET.has(action.type)) console.log(`  ${seatName(actor, botSeat)} ${describeAction(state, actor, action)}`);
  const res = applyAction(state, actor, action);
  if (!res.ok) {
    console.log(`  (the engine refused that: ${res.error})`);
    break;
  }
  state = res.state;
}
console.log(
  `\nresult: ${state.winner === null ? 'draw' : `${seatName(state.winner, botSeat)} wins`}${state.winReason ? ` (${state.winReason})` : ''} after ${state.turn} turns, ${((Date.now() - t0) / 1000).toFixed(0)}s of thinking`,
);
