// Decision time for one weight, measured so a busy machine cannot favour
// either side: every position is timed with the weight on and with it off,
// back to back, and the order alternates so drift lands on both arms equally.
//
//   npx tsx scripts/bottime.ts storeReach 40
//
// Positions come from the human game log, which is where the client's real
// boards are. The plan cache is cleared before each timing, so what is measured
// is a whole decision rather than a step of a plan already made.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards';
import { chooseAction, clearPlan, defaultWeights, type BotWeights } from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, type Replay } from '../src/engine/replay';
import type { PlayerIdx } from '../src/engine/types';

const name = process.argv[2] ?? 'storeReach';
const want = Number(process.argv[3] ?? 40);
if (!(name in defaultWeights)) throw new Error(`no weight named ${name}`);

const dir = join(process.cwd(), 'replays', 'human');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();

type Spot = { state: ReturnType<typeof createGame>; seat: PlayerIdx };
const spots: Spot[] = [];
for (const f of files) {
  if (spots.length >= want) break;
  const replay = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Replay & {
    log?: { botSeat?: number };
  };
  const botSeat = replay.log?.botSeat ?? -1;
  if (botSeat < 0) continue;
  let state = createGame(
    replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
    replay.seed,
    replay.startingPlayer as PlayerIdx,
  );
  // One position a game, taken mid-game where boards are full and a Store has
  // had time to land.
  const at = Math.floor(replay.steps.length * 0.6);
  for (let i = 0; i < replay.steps.length; i++) {
    const step = replay.steps[i];
    if (i === at && step.actor === botSeat) {
      spots.push({ state, seat: botSeat as PlayerIdx });
      break;
    }
    const res = applyAction(state, step.actor as PlayerIdx, actionFromWire(step.action));
    if (!res.ok) break;
    state = res.state;
  }
}

const on: BotWeights = { ...defaultWeights };
const off: BotWeights = { ...defaultWeights, [name]: 0 } as BotWeights;

function timeOne(spot: Spot, w: BotWeights): number {
  clearPlan();
  const t0 = performance.now();
  chooseAction(spot.state, spot.seat, w);
  return performance.now() - t0;
}

// Warm the runtime so the first position does not carry the JIT.
for (const spot of spots.slice(0, 3)) {
  timeOne(spot, on);
  timeOne(spot, off);
}

const onMs: number[] = [];
const offMs: number[] = [];
for (let i = 0; i < spots.length; i++) {
  if (i % 2 === 0) {
    onMs.push(timeOne(spots[i], on));
    offMs.push(timeOne(spots[i], off));
  } else {
    offMs.push(timeOne(spots[i], off));
    onMs.push(timeOne(spots[i], on));
  }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const total = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

console.log(`${spots.length} positions from the human log, ${name} on against off`);
console.log(`  on  : median ${median(onMs).toFixed(0)} ms, total ${(total(onMs) / 1000).toFixed(1)} s`);
console.log(`  off : median ${median(offMs).toFixed(0)} ms, total ${(total(offMs) / 1000).toFixed(1)} s`);
// Each position is timed both ways, so the per-position difference cancels
// whatever else the machine was doing at that moment. Comparing two medians
// throws that pairing away and reads mostly noise on a busy machine.
const deltas = onMs.map((ms, i) => ms - offMs[i]);
const ratios = onMs.map((ms, i) => ms / offMs[i]);
const slower = deltas.filter((d) => d > 0).length;
console.log(
  `  paired: median difference ${median(deltas).toFixed(0)} ms, ` +
    `median ratio ${median(ratios).toFixed(2)}x, on is slower at ${slower} of ${deltas.length} positions`,
);
// The slowest decisions are what a player actually notices.
const worst = (xs: number[]): number => [...xs].sort((a, b) => b - a)[0];
console.log(`  worst decision: on ${worst(onMs).toFixed(0)} ms, off ${worst(offMs).toFixed(0)} ms`);
