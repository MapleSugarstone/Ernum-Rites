// Decision time for the build you are standing on, position by position, so
// two builds can be compared. bottime.ts answers what one weight costs; this
// answers what a whole commit range costs, which is the only way to see a
// change that carries no weight to toggle.
//
//   npx tsx scripts/decisiontime.ts runs/dt-head.json
//
// Positions are the same ones bottime uses: one mid-game board per logged
// human game, where the boards are full. Run it on two worktrees and compare
// the arrays element by element, since the positions are identical.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards';
import { chooseAction, clearPlan, defaultWeights } from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, type Replay } from '../src/engine/replay';
import type { PlayerIdx } from '../src/engine/types';

const out = process.argv[2];
const want = Number(process.argv[3] ?? 33);
if (!out) throw new Error('usage: decisiontime.ts <out.json> [positions]');

const dir = join(process.cwd(), 'replays', 'human');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

type Spot = { file: string; state: ReturnType<typeof createGame>; seat: PlayerIdx };
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
  const at = Math.floor(replay.steps.length * 0.6);
  for (let i = 0; i < replay.steps.length; i++) {
    const step = replay.steps[i];
    if (i === at && step.actor === botSeat) {
      spots.push({ file: f, state, seat: botSeat as PlayerIdx });
      break;
    }
    const res = applyAction(state, step.actor as PlayerIdx, actionFromWire(step.action));
    if (!res.ok) break;
    state = res.state;
  }
}

const time = (s: Spot) => {
  clearPlan();
  const t0 = performance.now();
  chooseAction(s.state, s.seat, { ...defaultWeights });
  return performance.now() - t0;
};

for (const s of spots.slice(0, 3)) time(s);

const rows = spots.map((s) => ({ file: s.file, ms: Math.round(time(s)) }));
writeFileSync(out, JSON.stringify(rows, null, 1));
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const median = ms[Math.floor(ms.length / 2)];
console.log(`${rows.length} positions, median ${median} ms, total ${(ms.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s`);
console.log(`worst ${ms[ms.length - 1]} ms, wrote ${out}`);
