// Pull finished games out of the worker's game log into replays/human/, one
// replay file per game in the same shape as replays/*.json, so the bot can be
// re-run over positions people actually reached (scripts/botexplain.ts and
// `Selatza.Sim analyze` both read that shape).
//
//   npm run logs:pull
//
// The token is read from LOG_TOKEN in the environment, else from the
// gitignored .env.local at the repo root (`LOG_TOKEN=...`), which is where the
// deployment's token lives on the maintainer's machine. The worker is the
// deployed one unless a URL is given as the first argument. Only games newer
// than the highest id already on disk are fetched, so this can run as often
// as wanted.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEPLOYED = 'https://ernum-rites-server.maplesugarstone.workers.dev';

function localToken(): string {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return '';
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^LOG_TOKEN=(.+)$/.exec(line.trim());
    if (m) return m[1].trim();
  }
  return '';
}

const base = (process.argv[2] ?? process.env.WORKER_URL ?? DEPLOYED).replace(/\/$/, '');
const token = process.env.LOG_TOKEN || localToken();
if (!base || !token) {
  console.error('no token: set LOG_TOKEN or put LOG_TOKEN=... in .env.local');
  process.exit(1);
}
const dir = join(process.cwd(), 'replays', 'human');
mkdirSync(dir, { recursive: true });
let after = 0;
for (const name of readdirSync(dir)) {
  const m = /^(\d+)-/.exec(name);
  if (m) after = Math.max(after, Number(m[1]));
}

interface Row {
  id: number;
  day: string;
  kind: string;
  version: string;
  build: string;
  cards: string;
  seed: number;
  startingPlayer: number;
  botSeat: number;
  decks: { leaderId: string; cards: string[] }[];
  steps: { actor: number; action: unknown }[];
  winner: number;
  winReason: string | null;
  turns: number;
}

let pulled = 0;
for (;;) {
  const res = await fetch(`${base}/api/logs?after=${after}&limit=200`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error(`the worker answered ${res.status}`);
    process.exit(1);
  }
  const { rows } = (await res.json()) as { rows: Row[] };
  if (rows.length === 0) break;
  for (const row of rows) {
    const replay = {
      format: 1,
      label: `${row.kind} ${row.day} v${row.version} ${row.build} cards ${row.cards}${row.botSeat >= 0 ? ` bot seat ${row.botSeat}` : ''}`,
      seed: row.seed,
      startingPlayer: row.startingPlayer,
      decks: row.decks.map((d, i) => ({ name: row.botSeat === i ? 'Bot' : `Player ${i + 1}`, leaderId: d.leaderId, cards: d.cards })),
      setupDigest: '',
      steps: row.steps.map((s) => ({ actor: s.actor, action: s.action, digest: '' })),
      finalDigest: '',
      winner: row.winner,
      winReason: row.winReason,
      log: { id: row.id, day: row.day, kind: row.kind, version: row.version, build: row.build, cards: row.cards, botSeat: row.botSeat, turns: row.turns },
    };
    writeFileSync(join(dir, `${String(row.id).padStart(6, '0')}-${row.kind}-${row.day}.json`), JSON.stringify(replay));
    after = Math.max(after, row.id);
    pulled++;
  }
}
console.log(`${pulled} games pulled into replays/human, highest id ${after}`);
