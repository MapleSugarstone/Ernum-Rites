/**
 * Turns a training run's ladder into the shipped evolved decks: the best deck
 * for each mono colour and each colour pair, written as code fragments for
 * src/cards/index.ts and csharp/Selatza.Engine/Cards/Decks.cs.
 *
 * Plain Node on purpose: it reads card data from conformance/cards.json so it
 * can run while a training process holds the repo's TS toolchain files busy.
 *
 *   node scripts/export-evolved.mjs --run runs/meta2
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COLOR_NAME = { P: 'Pepper', O: 'Oil', R: 'Robot', F: 'Fish', S: 'Solar' };

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const runDir = arg('--run', 'runs/meta2');
const outDir = arg('--out', runDir);

const cards = new Map(
  JSON.parse(readFileSync('conformance/cards.json', 'utf8')).map((c) => [c.id, c]),
);
const ladder = JSON.parse(readFileSync(join(runDir, 'ladder.json'), 'utf8'));

// Anchors are the shipped bot on starter decks; everything else competed.
const agents = ladder.agents.filter((a) => a.name.startsWith('a'));

const byIdentity = new Map();
for (const a of agents) {
  if (a.colors.length < 1 || a.colors.length > 2) continue;
  const key = [...a.colors].sort().join('');
  const cur = byIdentity.get(key);
  if (!cur || a.elo > cur.elo) byIdentity.set(key, a);
}

const picks = [...byIdentity.entries()]
  .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
  .map(([, agent]) => agent);

function counts(deck) {
  const m = new Map();
  for (const id of deck) m.set(id, (m.get(id) ?? 0) + 1);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function blurb(a) {
  const names = [...a.colors].map((c) => COLOR_NAME[c]).join(' and ');
  const perLevel = [0, 0, 0];
  let spells = 0;
  const nonSummon = new Map();
  for (const id of a.deck) {
    const def = cards.get(id);
    if (!def) continue;
    if (def.type === 'summon') perLevel[(def.level ?? 1) - 1]++;
    else {
      if (def.type === 'spell') spells++;
      nonSummon.set(def.name, (nonSummon.get(def.name) ?? 0) + 1);
    }
  }
  const top = [...nonSummon.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2);
  const level = perLevel.indexOf(Math.max(...perLevel)) + 1;
  const lean = top.length === 2 ? `, leaning on ${top[0][0]} and ${top[1][0]}` : '';
  return `${names}. Evolved: ${perLevel[level - 1]} level ${level} bodies and ${spells} spells${lean}.`;
}

function keyOf(a) {
  const file = a.leader.slice(a.leader.lastIndexOf('-') + 1).toLowerCase();
  return `evo-${a.colors.toLowerCase()}-${file}`;
}

let ts = '';
let cs = '';
for (const a of picks) {
  const name = cards.get(a.leader)?.name ?? a.leader;
  const pairs = counts(a.deck);

  ts += `  {\n    key: '${keyOf(a)}',\n    name: '${name.replace(/'/g, "\\'")}',\n`;
  ts += `    blurb: '${blurb(a).replace(/'/g, "\\'")}',\n    leaderId: '${a.leader}',\n    cards: build([\n`;
  for (const [id, n] of pairs) ts += `      ['${id}', ${n}],\n`;
  ts += '    ]),\n  },\n';

  cs += '        new()\n        {\n';
  cs += `            Key = "${keyOf(a)}",\n            Name = "${name}",\n`;
  cs += `            Blurb = "${blurb(a)}",\n            LeaderId = "${a.leader}",\n`;
  cs += '            Cards = Build(\n                ';
  const parts = pairs.map(([id, n]) => `("${id}", ${n})`);
  const lines = [];
  for (let i = 0; i < parts.length; i += 4) lines.push(parts.slice(i, i + 4).join(', '));
  cs += lines.join(',\n                ');
  cs += '),\n        },\n';
}

writeFileSync(join(outDir, 'evolved.ts.fragment'), ts);
writeFileSync(join(outDir, 'evolved.cs.fragment'), cs);

console.log(`${picks.length} decks exported to ${outDir}`);
for (const a of picks) {
  console.log(
    `  ${a.colors.padEnd(2)} ${String(Math.round(a.elo)).padStart(5)}  ` +
      `${cards.get(a.leader)?.name ?? a.leader}  ${a.wins}-${a.losses}-${a.draws}  vol ${a.volatility ?? '?'}`,
  );
}
