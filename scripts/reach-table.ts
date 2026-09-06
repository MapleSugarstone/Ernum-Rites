// Prints every card's reach on the probe board, highest first, for a leader.
// Usage: npx tsx scripts/reach-table.ts [leaderId] [limit]
import { starterDecks } from '../src/cards';
import { cardReach, clearPlan } from '../src/ai/bot';
import { createGame } from '../src/engine/engine';
import { allCards } from '../src/engine/registry';
import { deckIdentity, isLegalUnder } from '../src/engine/identity';

const leaderId = process.argv[2] ?? 'kh-PinkDeus';
const limit = Number(process.argv[3] ?? 40);
const filler = starterDecks[0].cards;
const s = createGame(
  [
    { name: 'A', leaderId, cards: filler },
    { name: 'B', leaderId: 'x-hero-dummy-warden', cards: filler },
  ],
  1,
  0,
);
clearPlan();
const identity = deckIdentity(leaderId);
const rows: [string, number][] = [];
const t0 = Date.now();
for (const def of allCards()) {
  if (def.uncollectible || !def.art || !isLegalUnder(def, identity)) continue;
  rows.push([def.id, cardReach(s, 0, def.id)]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log(`${rows.length} cards probed for ${leaderId} in ${((Date.now() - t0) / 1000).toFixed(0)}s; nonzero: ${rows.filter((r) => r[1] > 0).length}`);
for (const [id, reach] of rows.slice(0, limit)) console.log(`${reach.toFixed(2)}  ${id}`);
