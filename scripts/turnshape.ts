// What a real turn contains, so the reply model can be judged against it.
//
//   npx tsx scripts/turnshape.ts
//
// The reply gives every other seat a hand of blank traps, so the turn it
// simulates for them can never play a summon, cast a spell or set a supporter.
// This counts what people and the bot actually do with a turn in the human game
// log, which says how much that model leaves out.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards';
import { actionFromWire, type Replay } from '../src/engine/replay';

const dir = join(process.cwd(), 'replays', 'human');
type Row = { turns: number; withSummon: number; withSpell: number; withAny: number; cards: number };
const rows = new Map<string, Row>();
const get = (k: string): Row => {
  let r = rows.get(k);
  if (!r) rows.set(k, (r = { turns: 0, withSummon: 0, withSpell: 0, withAny: 0, cards: 0 }));
  return r;
};

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const replay = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Replay & {
    log?: { botSeat?: number };
  };
  const botSeat = replay.log?.botSeat ?? -1;
  if (botSeat < 0) continue;
  let active = replay.startingPlayer as number;
  let summon = false;
  let spell = false;
  let played = 0;
  const close = () => {
    const who = active === botSeat ? 'bot' : 'person';
    const r = get(who);
    r.turns++;
    if (summon) r.withSummon++;
    if (spell) r.withSpell++;
    if (summon || spell || played > 0) r.withAny++;
    r.cards += played;
    summon = false;
    spell = false;
    played = 0;
  };
  for (const step of replay.steps) {
    const a = actionFromWire(step.action);
    if (step.actor === active) {
      if (a.type === 'PLAY_SUMMON') {
        summon = true;
        played++;
      } else if (a.type === 'CAST_SPELL') {
        spell = true;
        played++;
      } else if (a.type === 'PLAY_SUPPORTER' || a.type === 'PLAY_STAGE') {
        played++;
      }
    }
    if (a.type === 'END_TURN') {
      close();
      active = 1 - active;
    }
  }
}

console.log('what a turn actually contains, over the human game log');
for (const [who, r] of [...rows].sort()) {
  console.log(
    `  ${who.padEnd(7)} ${String(r.turns).padStart(4)} turns; ` +
      `plays a summon in ${((r.withSummon / r.turns) * 100).toFixed(0)}%, ` +
      `a spell in ${((r.withSpell / r.turns) * 100).toFixed(0)}%, ` +
      `something from hand in ${((r.withAny / r.turns) * 100).toFixed(0)}%, ` +
      `${(r.cards / r.turns).toFixed(2)} cards a turn`,
  );
}
console.log('  the reply model plays nothing from hand on any of them.');
