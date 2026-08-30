/**
 * Suggests swaps for one deck in a round-robin field, by round-robin score.
 *
 * Reads the current standing, picks the deck named, and writes out one candidate
 * deck file per legal swap: each drops the pair that is pulling least and adds a
 * pair of something in colour that the deck is not already running. The caller
 * plays them and keeps whatever wins; this only builds the ballot.
 *
 *   npm run tune -- runs/mono1 "The Fish" 12
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import '../src/cards';
import { deckIdentity, isLegalUnder } from '../src/engine/identity';
import { allCards, card } from '../src/engine/registry';
import { COPY_LIMIT } from '../src/engine/types';

const RUN = process.argv[2] ?? 'runs/mono1';
const TARGET = process.argv[3] ?? '';
const WIDTH = Number(process.argv[4] ?? 12);

type Deck = { file: string; leaderId: string; leader: string; counts: Map<string, number> };

function readDeck(path: string): Deck {
  const text = readFileSync(path, 'utf8');
  const lead = text.match(/leader: (.+?) \[([^\]]+)\]/);
  if (!lead) throw new Error(`${path} names no leader`);
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/^\s*(\d+)x .+? \[([^\]]+)\]/gm)) {
    counts.set(m[2], (counts.get(m[2]) ?? 0) + Number(m[1]));
  }
  return { file: path, leaderId: lead[2], leader: lead[1], counts };
}

const dir = `${RUN}/polished`;
const decks = readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => readDeck(`${dir}/${f}`));
const target = decks.find((d) => d.leader === TARGET);
if (!target) {
  console.error(`no deck led by "${TARGET}". Have: ${decks.map((d) => d.leader).join(', ')}`);
  process.exit(1);
}

const identity = deckIdentity(target.leaderId);
const present = new Set(target.counts.keys());

/**
 * What the other decks behind this same leader converged on during training.
 * Ranking against the rest of the field instead would only ever surface neutral
 * cards, since no other colour can legally run this one's.
 */
const fieldUse = new Map<string, number>();
{
  const ladder = JSON.parse(readFileSync(`${RUN}/ladder.json`, 'utf8'));
  for (const a of ladder.agents as { name: string; leader: string; deck: string[] }[]) {
    if (!a.name.startsWith('a') || a.leader !== target.leaderId) continue;
    for (const id of a.deck) fieldUse.set(id, (fieldUse.get(id) ?? 0) + 1);
  }
}

const onColour = (id: string) => card(id).color === identity[0] && !card(id).neutral;

const additions = allCards()
  .filter((c) => !c.uncollectible && !c.id.startsWith('x-') && !present.has(c.id))
  .filter((c) => isLegalUnder(c, identity))
  .sort(
    (a, b) =>
      (fieldUse.get(b.id) ?? 0) - (fieldUse.get(a.id) ?? 0) ||
      Number(onColour(b.id)) - Number(onColour(a.id)) ||
      a.name.localeCompare(b.name),
  )
  .slice(0, WIDTH);

// Drop the pair its own colour wanted least: a card the other nine decks behind
// this leader passed over is the cheapest thing to give up.
const drops = [...target.counts.keys()]
  .filter((id) => id !== target.leaderId)
  .sort(
    (a, b) =>
      (fieldUse.get(a) ?? 0) - (fieldUse.get(b) ?? 0) ||
      Number(onColour(a)) - Number(onColour(b)) ||
      card(a).name.localeCompare(card(b).name),
  )
  .slice(0, WIDTH);

const out = `${RUN}/candidates`;
mkdirSync(out, { recursive: true });
let n = 0;
for (const drop of drops.slice(0, 7)) {
  for (const add of additions.slice(0, 7)) {
    const counts = new Map(target.counts);
    counts.delete(drop);
    counts.set(add.id, COPY_LIMIT);
    const lines = [
      `candidate: -${card(drop).name} +${add.name}`,
      `leader: ${target.leader} [${target.leaderId}] (${identity.join('')})`,
      '',
    ];
    for (const [id, q] of counts) lines.push(`  ${q}x ${card(id).name} [${id}]`);
    const slug = `${target.leader.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${n
      .toString()
      .padStart(2, '0')}`;
    writeFileSync(`${out}/${slug}.txt`, lines.join('\n') + '\n');
    n++;
  }
}
console.log(`${n} candidates for ${target.leader} written to ${out}`);
console.log(`  dropping one of: ${drops.slice(0, 7).map((id) => card(id).name).join(', ')}`);
console.log(`  adding one of:   ${additions.slice(0, 7).map((c) => c.name).join(', ')}`);
