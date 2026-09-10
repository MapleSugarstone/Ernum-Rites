// Does the client's easy setting actually play worse than hard?
//
// The client picks between quickSearch and fullSearch in src/ai/botworker.ts,
// so this pits those two profiles against each other on the same deals, with
// the seats swapped every other game so seat order cannot decide it.
//
//   npx tsx scripts/levelcheck.ts 200
import '../src/cards';
import { chooseAction, clearPlan, fullSearch, quickSearch, setSearchLimits, warm } from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { currentActor, isOver } from '../src/engine/state';
import { starterDecks } from '../src/cards';
import type { PlayerIdx } from '../src/engine/types';

const games = Number(process.argv[2] ?? 100);
const decks = starterDecks;

let hardWins = 0;
let easyWins = 0;
let draws = 0;
let turnsTotal = 0;

for (let g = 0; g < games; g++) {
  // Seat 0 is hard on even games and easy on odd ones, same deal both ways.
  const hardSeat: PlayerIdx = (g % 2) as PlayerIdx;
  const a = decks[g % decks.length];
  const b = decks[(g + 1 + Math.floor(g / decks.length)) % decks.length];
  let state = createGame(
    [a, b].map(d => ({ name: d.name, leaderId: d.leaderId, cards: [...d.cards] })),
    1000 + Math.floor(g / 2),
    0,
  );

  let level: 'hard' | 'easy' | null = null;
  const use = (seat: PlayerIdx) => {
    const want = seat === hardSeat ? 'hard' : 'easy';
    if (want === level) return;
    level = want;
    setSearchLimits(want === 'easy' ? quickSearch : fullSearch);
    warm(state, seat);
  };

  clearPlan();
  for (let n = 0; n < 4000 && !isOver(state) && state.turn < 200; n++) {
    const actor = currentActor(state);
    use(actor);
    const action = chooseAction(state, actor);
    if (!action) break;
    const res = applyAction(state, actor, action);
    if (!res.ok) break;
    state = res.state;
  }
  turnsTotal += state.turn;
  if (state.winner === null) draws++;
  else if (state.winner === hardSeat) hardWins++;
  else easyWins++;

  if ((g + 1) % 5 === 0) {
    process.stdout.write(`  ${g + 1}/${games}: hard ${hardWins} easy ${easyWins} drawn ${draws}\n`);
  }
}

const played = hardWins + easyWins;
const rate = played ? hardWins / played : 0;
const se = played ? Math.sqrt((rate * (1 - rate)) / played) : 0;
console.log(`\nhard ${hardWins} - easy ${easyWins}, drawn ${draws}, avg ${(turnsTotal / games).toFixed(1)} turns`);
console.log(`hard wins ${(100 * rate).toFixed(1)}%, 95% interval ${(100 * (rate - 1.96 * se)).toFixed(1)}% to ${(100 * (rate + 1.96 * se)).toFixed(1)}%`);
