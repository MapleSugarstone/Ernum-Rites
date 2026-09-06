// Prints the kits the scan finds in the Scientist test list.
import '../src/cards';
import { chooseAction, clearPlan, kitsFor } from '../src/ai/bot';
import { createGame } from '../src/engine/engine';
const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const kit = [
  ...Array(38).fill(FILLER),
  'p3-helemy', 'p3-helemy', 'o2-boneknown', 'o2-boneknown', 'o2-scientist', 'o2-scientist',
  'p1-beast', 'p1-beast', 'x-p-bolt', 'x-p-bolt',
];
const s = createGame(
  [
    { name: 'A', leaderId: LEADER, cards: kit },
    { name: 'B', leaderId: LEADER, cards: Array(48).fill(FILLER) },
  ],
  1,
  0,
);
clearPlan();
chooseAction(s, 0);
for (const k of kitsFor(s, 0)) console.log(k.reach.toFixed(2), k.cards.join(' + '));
