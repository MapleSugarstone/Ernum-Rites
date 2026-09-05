// How often the TypeScript bot plays the move the C# bot recorded. The replays
// under replays/ were recorded by the C# simulator's bot, and the C# bot is what
// trains and measures, so every step where the two disagree is a decision the
// measurements never saw the shipped bot make.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards';
import { chooseAction, clearPlan } from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, actionToWire, type Replay } from '../src/engine/replay';
import type { PlayerIdx } from '../src/engine/state';

const file = process.argv[2] ?? '012-sweetshop-store.json';
const limit = Number(process.argv[3] ?? 100000);
const replay = JSON.parse(readFileSync(join(process.cwd(), 'replays', file), 'utf8')) as Replay;
let state = createGame(
  replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
  replay.seed,
  replay.startingPlayer as PlayerIdx,
);
clearPlan();
let agree = 0;
let seen = 0;
const byType = new Map<string, { n: number; miss: number }>();
const firstMisses: string[] = [];
const t0 = Date.now();
for (let i = 0; i < Math.min(limit, replay.steps.length); i++) {
  const step = replay.steps[i];
  const recorded = actionFromWire(step.action);
  const mine = chooseAction(state, step.actor as PlayerIdx);
  const a = JSON.stringify(actionToWire(recorded));
  const b = JSON.stringify(actionToWire(mine));
  const same = a === b;
  seen++;
  if (same) agree++;
  const slot = byType.get(recorded.type) ?? { n: 0, miss: 0 };
  slot.n++;
  if (!same) slot.miss++;
  byType.set(recorded.type, slot);
  if (!same && firstMisses.length < 12) {
    firstMisses.push(`step ${i} turn ${state.turn} seat ${step.actor}: recorded ${a} chose ${b}`);
  }
  const res = applyAction(state, step.actor as PlayerIdx, recorded);
  if (!res.ok) throw new Error(`step ${i} refused: ${res.error}`);
  state = res.state;
}
console.log(`${file}: ${agree}/${seen} steps agree (${((100 * agree) / seen).toFixed(1)}%) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const [type, s] of [...byType.entries()].sort((x, y) => y[1].miss - x[1].miss)) {
  if (s.miss > 0) console.log(`  ${type.padEnd(16)} ${s.miss}/${s.n} differ`);
}
for (const line of firstMisses) console.log('  ' + line);
