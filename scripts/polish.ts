/**
 * Turns a training run's winners into decks a new player can read.
 *
 * An evolved deck is a pile of one-offs: the search never had a reason to prefer
 * two of a card over one of each of two, so a winner arrives with a dozen
 * singletons and thirty distinct cards. That is unreadable as a first deck, and
 * it hides the plan. This rebuilds each winner as a fixed number of cards, two
 * of everything, choosing which cards by what all the decks behind that leader
 * agreed on rather than by what the single winner happened to hold.
 *
 *   npm run polish -- runs/mono1
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import '../src/cards';
import { canBeLeader, deckIdentity, isLegalUnder } from '../src/engine/identity';
import { card, tryCard } from '../src/engine/registry';
import { COPY_LIMIT } from '../src/engine/types';

const RUN = process.argv[2] ?? 'runs/mono1';
const SIZE = Number(process.argv[3] ?? 48);
const PAIRS = SIZE / COPY_LIMIT;

type Agent = { name: string; leader: string; elo: number; deck: string[] };
const agents: Agent[] = JSON.parse(readFileSync(`${RUN}/ladder.json`, 'utf8')).agents.filter(
  (a: Agent) => a.name.startsWith('a'),
);

const byLeader = new Map<string, Agent[]>();
for (const a of agents) {
  if (!byLeader.has(a.leader)) byLeader.set(a.leader, []);
  byLeader.get(a.leader)!.push(a);
}

function counts(deck: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of deck) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** A card's standing in its colour: copies run across every deck behind the leader. */
function popularity(group: Agent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of group) {
    for (const id of a.deck) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

const out: { leaderId: string; leader: string; elo: number; cards: string[] }[] = [];
for (const [leaderId, group] of byLeader) {
  const sorted = [...group].sort((a, b) => b.elo - a.elo);
  const winner = sorted[0];
  const pop = popularity(group);
  const mine = counts(winner.deck);
  const identity = deckIdentity(leaderId);

  // The winner's own copies break ties, so a card it doubled beats a card its
  // rivals liked equally but it only ran one of.
  const rank = (id: string) => (pop.get(id) ?? 0) * 10 + (mine.get(id) ?? 0);
  const eligible = [...pop.keys()].filter((id) => {
    const def = tryCard(id);
    return def && !def.uncollectible && isLegalUnder(def, identity);
  });
  eligible.sort((a, b) => rank(b) - rank(a) || card(a).name.localeCompare(card(b).name));

  const picked = eligible.slice(0, PAIRS);
  const cards: string[] = [];
  for (const id of picked) for (let i = 0; i < COPY_LIMIT; i++) cards.push(id);
  out.push({ leaderId, leader: card(leaderId).name, elo: Math.round(winner.elo), cards });
}

out.sort((a, b) => b.elo - a.elo);

const dir = `${RUN}/polished`;
mkdirSync(dir, { recursive: true });
for (const d of out) {
  const slug = d.leader.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const lines = [
    `polished from ${RUN}, winner rated ${d.elo}`,
    `leader: ${d.leader} [${d.leaderId}] (${deckIdentity(d.leaderId).join('')})`,
    '',
  ];
  for (const [id, n] of counts(d.cards)) lines.push(`  ${n}x ${card(id).name} [${id}]`);
  writeFileSync(`${dir}/${slug}.txt`, lines.join('\n') + '\n');
}

console.log(`${out.length} decks polished to ${SIZE} cards, ${PAIRS} distinct, ${COPY_LIMIT} of each`);
console.log(`written to ${dir}\n`);

for (const d of out) {
  const kept = counts(d.cards);
  const before = counts(byLeader.get(d.leaderId)!.sort((a, b) => b.elo - a.elo)[0].deck);
  const dropped = [...before.keys()].filter((id) => !kept.has(id));
  const added = [...kept.keys()].filter((id) => !before.has(id));
  const lv = [0, 0, 0];
  let spells = 0;
  let traps = 0;
  let stages = 0;
  for (const id of d.cards) {
    const def = card(id);
    if (def.type === 'summon') lv[(def.level ?? 1) - 1]++;
    else if (def.type === 'spell') spells++;
    else if (def.type === 'trap') traps++;
    else stages++;
  }
  console.log(
    `${d.leader.padEnd(24)}rated ${String(d.elo).padStart(4)}  ` +
      `L1/2/3 ${lv[0]}/${lv[1]}/${lv[2]}  spells ${spells}  traps ${traps}  fields ${stages}`,
  );
  console.log(`  legal leader: ${canBeLeader(d.leaderId)}`);
  if (dropped.length) {
    console.log(`  dropped: ${dropped.map((id) => card(id).name).join(', ')}`);
  }
  if (added.length) console.log(`  added:   ${added.map((id) => card(id).name).join(', ')}`);
  console.log('');
}
