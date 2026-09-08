// The TypeScript bot's decision at every step of a replay, one line each in
// the notation `Selatza.Sim explain` and `decide` use, so a diff against
// `Selatza.Sim decide --replay <file>` names the first step where the two
// engines part. The recorded action is applied after each decision, so both
// engines walk the same game whatever they would have played. This is the
// parity check for games the corpus does not cover, such as the human games
// pulled into replays/human.
//
//   npx tsx scripts/botdecide.ts replays/human/000006-solo-2026-09-08.json > ts.txt
//   dotnet run -c Release --project csharp/Selatza.Sim -- decide --replay replays/human/000006-solo-2026-09-08.json > cs.txt
//   diff ts.txt cs.txt
import { readFileSync } from 'node:fs';
import '../src/cards';
import { chooseAction } from '../src/ai/bot';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, type Replay } from '../src/engine/replay';
import type { Action } from '../src/engine/actions';
import type { PlayerIdx } from '../src/engine/types';

const file = process.argv[2];
const seat = Number(process.argv[3] ?? -1);
if (!file) {
  console.error('usage: npx tsx scripts/botdecide.ts <replay.json> [seat]');
  process.exit(1);
}
const replay = JSON.parse(readFileSync(file, 'utf8')) as Replay;

type Ref = { kind: string; player: number; slot?: number; index?: number };
const kindName = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
const ref = (r: Ref | undefined) => (r ? `${kindName(r.kind)}:${r.player}:${r.slot ?? r.index ?? 0}` : '?');
const pascal = (t: string) => t.toLowerCase().split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
function describe(a: Action): string {
  const act = a as unknown as Record<string, unknown>;
  const targets = () => (Array.isArray(act.targets) ? (act.targets as Ref[]).map(ref).join(',') : '');
  switch (a.type) {
    case 'CAST_SPELL':
      return `CAST h${act.handIndex}>${targets()}`;
    case 'PLAY_SUMMON':
      return `PLAY h${act.handIndex}@${act.slot}`;
    case 'DECLARE_ATTACK':
      return `ATK ${ref(act.source as Ref)}>${ref(act.target as Ref)}`;
    case 'ACTIVATE_POWER':
      return `POWER ${ref(act.source as Ref)}#${act.powerIndex}(${targets()})`;
    case 'OPEN_STORE':
      return `STORE ${ref(act.source as Ref)}`;
    default:
      return pascal(a.type);
  }
}

let state = createGame(
  replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
  replay.seed,
  replay.startingPlayer as PlayerIdx,
);
for (const [i, step] of replay.steps.entries()) {
  const choice = chooseAction(state, step.actor as PlayerIdx);
  if (seat < 0 || step.actor === seat) console.log(`${i} ${step.actor} ${describe(choice)}`);
  const res = applyAction(state, step.actor as PlayerIdx, actionFromWire(step.action));
  if (!res.ok) {
    console.log(`step ${i} refused: ${res.error}`);
    break;
  }
  state = res.state;
}
