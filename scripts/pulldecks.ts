// Lift the decks people actually played out of the human game log, into the
// text format `versus --decks dir:<folder>` reads.
//
//   npx tsx scripts/pulldecks.ts p3-helemy runs/decks-helemy
//
// The point is to ask whether the bot can pilot a deck a person wins with. If
// it cannot, the evolution will never select that deck either, because the
// evolution keeps what wins.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/cards';
import { card } from '../src/engine/registry';
import type { Replay } from '../src/engine/replay';

const wantLeader = process.argv[2];
const outDir = process.argv[3];
if (!wantLeader || !outDir) {
  console.error('usage: npx tsx scripts/pulldecks.ts <leaderId> <out folder>');
  process.exit(1);
}

const dir = join(process.cwd(), 'replays', 'human');
mkdirSync(outDir, { recursive: true });
const seen = new Set<string>();
let written = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const replay = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Replay & {
    log?: { botSeat?: number; id?: number };
  };
  const botSeat = replay.log?.botSeat ?? -1;
  for (let seat = 0; seat < replay.decks.length; seat++) {
    const d = replay.decks[seat];
    if (d.leaderId !== wantLeader) continue;
    // The bot's own copy of a leader says nothing about how a person built it.
    if (seat === botSeat) continue;
    const key = `${d.leaderId}|${[...d.cards].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const counts = new Map<string, number>();
    for (const id of d.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
    const lines = [
      `${wantLeader} from game ${replay.log?.id ?? '?'}`,
      `leader: ${card(d.leaderId).name} [${d.leaderId}]`,
      '',
    ];
    for (const [id, n] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const def = card(id);
      lines.push(`  ${n}x ${def.name} [${id}] ${def.type} L${def.level}`);
    }
    written++;
    writeFileSync(join(outDir, `${String(written).padStart(2, '0')}-game${replay.log?.id ?? 0}.txt`), lines.join('\n'));
  }
}
console.log(`${written} distinct ${wantLeader} decks written to ${outDir}`);
