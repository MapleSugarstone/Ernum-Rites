// How often a player actually fills a hole, by how many cards they hold.
//
//   npx tsx scripts/refillrate.ts
//
// The believed hand needs a prior for "can they answer a slot I clear". The
// deck's summon share overstates it, because bodies get played and a hand is
// enriched in what its owner does not cast. This reads the answer off the human
// game log instead: every replacement window, the holder's hand size at that
// moment, and whether they filled it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, type Replay } from '../src/engine/replay';
import type { PlayerIdx } from '../src/engine/types';

const dir = join(process.cwd(), 'replays', 'human');
const bySize = new Map<number, { filled: number; declined: number }>();
let windows = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const replay = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Replay;
  let state = createGame(
    replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
    replay.seed,
    replay.startingPlayer as PlayerIdx,
  );
  for (const step of replay.steps) {
    const action = actionFromWire(step.action);
    if (action.type === 'REPLACE_SUMMON' || action.type === 'DECLINE_REPLACE') {
      // The hand as it stood when the question was asked.
      const held = state.players[step.actor as PlayerIdx].hand.length;
      const row = bySize.get(held) ?? { filled: 0, declined: 0 };
      if (action.type === 'REPLACE_SUMMON') row.filled++;
      else row.declined++;
      bySize.set(held, row);
      windows++;
    }
    const res = applyAction(state, step.actor as PlayerIdx, action);
    if (!res.ok) break;
    state = res.state;
  }
}

console.log(`${windows} replacement windows over the human game log`);
console.log('  cards held   filled   declined   fill rate');
let filled = 0;
let declined = 0;
for (const size of [...bySize.keys()].sort((a, b) => a - b)) {
  const row = bySize.get(size)!;
  filled += row.filled;
  declined += row.declined;
  const n = row.filled + row.declined;
  console.log(
    `  ${String(size).padStart(10)} ${String(row.filled).padStart(8)} ${String(row.declined).padStart(10)} ` +
      `${((row.filled / n) * 100).toFixed(0).padStart(10)}%`,
  );
}
console.log(`  overall fill rate ${((filled / (filled + declined)) * 100).toFixed(1)}%`);
// The smallest hand at which filling is the better guess is where the believed
// body should start being believed.
let cut: number | null = null;
for (const size of [...bySize.keys()].sort((a, b) => a - b)) {
  const row = bySize.get(size)!;
  if (row.filled > row.declined && cut === null) cut = size;
}
console.log(`  filling becomes the better guess from ${cut ?? 'never'} cards held`);
