// The TypeScript bot's ranking at one step of a replay: the leaves the search
// gathers, each with its line, beam score, the position after the opponent's
// reply, what fell in that reply, and the outlook. The C# simulator prints the
// same for its bot with `Selatza.Sim explain --replay <file> --step <n>`, so a
// replay the two engines stop agreeing on (scripts/botparity.ts names the step)
// can be lined up leaf by leaf.
//
//   npx tsx scripts/botexplain.ts 012-sweetshop-store.json 25
//
// The bot decides every earlier step too, so the caches it fills along the way
// hold what they held when the replay was recorded, and the ranking is read
// off the redacted table the search actually sees, not the real one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards';
import { card } from '../src/engine/registry';
import {
  burn,
  chooseAction,
  clearPlan,
  defaultWeights,
  evaluate,
  fallenWorth,
  findLethal,
  leafOutlook,
  LETHAL_SLACK,
  nextTurn,
  readTable,
  redactTable,
  searchLimits,
  searchTurn,
} from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { digestOf } from '../src/engine/digest';
import { actionFromWire, actionToWire, type Replay } from '../src/engine/replay';
import type { Action } from '../src/engine/actions';
import { isOver, remainingHp, type GameState } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';

const file = process.argv[2] ?? '012-sweetshop-store.json';
const stop = Number(process.argv[3] ?? 0);
const replay = JSON.parse(readFileSync(join(process.cwd(), 'replays', file), 'utf8')) as Replay;
let state = createGame(
  replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
  replay.seed,
  replay.startingPlayer as PlayerIdx,
);
for (let i = 0; i < stop && i < replay.steps.length; i++) {
  const step = replay.steps[i];
  chooseAction(state, step.actor as PlayerIdx);
  const res = applyAction(state, step.actor as PlayerIdx, actionFromWire(step.action));
  if (!res.ok) throw new Error(`step ${i} refused: ${res.error}`);
  state = res.state;
}
const seat = replay.steps[stop].actor as PlayerIdx;
const w = defaultWeights;
clearPlan();
const pick = chooseAction(state, seat, w);
console.log(
  `step ${stop} turn ${state.turn} seat ${seat}; recorded ${JSON.stringify(replay.steps[stop].action)}; chose ${JSON.stringify(actionToWire(pick))}`,
);

const root = redactTable(state, seat);
for (let side = 0; side < root.players.length; side++) {
  const p = root.players[side];
  const body = (x: { cardId: string; sapped: boolean } | null) =>
    x ? `${card(x.cardId).name}${x.sapped ? '*' : ''} ${remainingHp(x as never)}hp` : '-';
  console.log(
    `  seat ${side}: L ${body(p.leader)} | ${p.slots.map(body).join(' | ')} | mana ${p.supporters.filter((x) => !x.sapped).length}/${p.supporters.length} debt ${p.debtCount} | hand ${p.hand.map((id) => card(id).name).join(',')}`,
  );
}

const describe = (line: Action[]): string =>
  line.length === 0 ? 'stand' : line.map((a) => JSON.stringify(actionToWire(a))).join(' ; ');

// The kill checks that run before the beam at the table, so a kill the beam
// never gathers is still shown.
{
  const race = burn(root, seat, searchLimits().maxBurnSteps, w);
  const built = burn(root, seat, searchLimits().maxBurnSteps, w, searchLimits().maxSetupSteps, true);
  let kill = race.state.winner === seat ? `race: ${describe(race.line)}` : built.state.winner === seat ? `built: ${describe(built.line)}` : '';
  const foeHp = Math.min(...root.players.filter((_, i) => i !== seat && !root.players[i].eliminated).map((p) => (p.leader ? remainingHp(p.leader) : 0)));
  if (!kill && Math.max(race.damage, built.damage) + LETHAL_SLACK >= foeHp) {
    const found = findLethal(root, seat, searchLimits().lethalDepth, { left: searchLimits().lethalBudget });
    if (found) kill = `exhaustive: ${describe([found])} ...`;
  }
  console.log(`  kill checks: race ${race.damage}, built ${built.damage} against ${foeHp} HP${kill ? `; kill found by ${kill}` : '; no kill found'}`);
}

// The gather, exactly as chooseAction builds it: standing still, then the
// beam's best leaves by score, one per distinct position.
const leaves = searchTurn(root, seat, w, readTable(root, seat));
const gathered: { state: GameState; line: Action[]; score: number }[] = [
  { state: root, line: [], score: evaluate(root, seat, w) },
];
const seen = new Set<string>([digestOf(root)]);
for (const leaf of leaves) {
  if (gathered.length > 6) break;
  const key = digestOf(leaf.state);
  if (seen.has(key)) continue;
  seen.add(key);
  gathered.push(leaf);
}
gathered.sort((a, b) => b.score - a.score);
console.log(`  leaves ${leaves.length}, gathered ${gathered.length}`);
for (const leaf of gathered) {
  const next = isOver(leaf.state) ? leaf.state : nextTurn(leaf.state, seat, w);
  const after = next ? evaluate(next, seat, w) : NaN;
  const fallen = next && !isOver(leaf.state) ? fallenWorth(leaf.state, next, seat, w) : 0;
  const total = leafOutlook(root, leaf, seat, w);
  console.log(
    `    ${leaf.score.toFixed(2).padStart(9)} std | ${after.toFixed(2).padStart(9)} after | ${fallen.toFixed(2).padStart(7)} fallen | ${total.toFixed(2).padStart(9)} outlook | ${describe(leaf.line)}`,
  );
}
console.log('  every leaf, best first:');
for (const leaf of leaves.slice(0, 14)) {
  console.log(`    ${leaf.score.toFixed(2)} risk ${leaf.risk.toFixed(2)} ${describe(leaf.line)}`);
}
