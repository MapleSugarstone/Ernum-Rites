import { tryCard } from '../engine/registry';
import { COLOR_NAME, COLORS, type CardDef, type Color, type PlayerIdx } from '../engine/types';
import { holderRef } from './build';

// The test leader is deliberately every colour, so lab decks can mix freely.
const ALL_COLORS: Color[] = [...COLORS];

/**
 * Vanilla cards with no text, for testing combat maths and as templates when
 * writing real ones. The stat line per level is the baseline everything else
 * should be measured against.
 */
const LEVEL_STATS: Record<number, { strength: number; hp: number; roman: string }> = {
  1: { strength: 1, hp: 1, roman: 'I' },
  2: { strength: 2, hp: 3, roman: 'II' },
  3: { strength: 3, hp: 5, roman: 'III' },
};

function dummy(color: Color, level: 1 | 2 | 3): CardDef {
  const { strength, hp, roman } = LEVEL_STATS[level];
  return {
    id: `x-${color.toLowerCase()}-dummy-${level}`,
    name: `${COLOR_NAME[color]} Dummy ${roman}`,
    color,
    type: 'summon',
    level,
    strength,
    hp,
    // Always common, so a test deck can run four of anything.
    num: `T${level}${color}`,
    text: 'No abilities.',
  };
}

function testBolt(color: Color): CardDef {
  return {
    id: `x-${color.toLowerCase()}-bolt`,
    name: `${COLOR_NAME[color]} Test Bolt`,
    color,
    type: 'spell',
    cost: { [color]: 1 },
    num: `TX${color}`,
    text: 'Deal 2 to an enemy summon.',
    targets: [{ kind: 'summon', side: 'enemy', label: 'an enemy summon' }],
    effect: (ctx) => ctx.damage(ctx.targets[0], 2),
  };
}

/**
 * Oil's curses. They carry no art because they are never in anyone's deck to
 * begin with: Oil puts them there mid-game, and from then on they are drawn
 * like any other card and turn up as face-down HP like any other card. Each one
 * is a bad thing waiting for the moment it flips.
 */
function curse(
  file: string,
  name: string,
  flipText: string,
  flip: CardDef['flip'],
  art?: string,
): CardDef {
  return {
    id: `o-curse-${file}`,
    name,
    color: 'O',
    type: 'spell',
    level: 1,
    uncollectible: true,
    num: `C${file.slice(0, 2).toUpperCase()}`,
    text: 'Does nothing in your hand.',
    flipText,
    flip,
    ...(art ? { art, artist: 'klabss' } : {}),
  };
}

/** Whether the victim's opponent fields a card that doubles curse effects. */
function potent(c: { state: import('../engine/state').GameState; me: PlayerIdx }): boolean {
  const foe = c.state.players[c.me === 0 ? 1 : 0];
  for (const s of [...foe.slots, foe.leader]) {
    if (s && tryCard(s.cardId)?.cursePotency) return true;
  }
  return false;
}

export const curseCards: CardDef[] = [
  curse('rot', 'Rot', 'You take 1 debt.', (c) => c.addDebt(c.me, potent(c) ? 2 : 1),
    'Cardgame/Extras/Rot.png'),
  curse('dread', 'Dread', 'The attached character takes a Wound.', (c) =>
    c.wound(holderRef(c), potent(c) ? 2 : 1), 'Cardgame/Extras/Dread.png'),
  curse('ruin', 'Ruin', 'Mill 1.', (c) => c.mill(c.me, potent(c) ? 2 : 1)),
  curse('spite', 'Spite', 'The enemy draws a card.', (c) => c.draw(c.opp, potent(c) ? 2 : 1)),
];

/** Bodies that carry one keyword and nothing else, for testing it. */
function keyworded(
  file: string,
  name: string,
  text: string,
  extra: Partial<CardDef> = {},
): CardDef {
  return {
    id: `x-n-${file}`,
    name,
    color: 'R',
    type: 'summon',
    level: 2,
    strength: 1,
    hp: 3,
    num: `TK${file.slice(0, 2).toUpperCase()}`,
    identity: ALL_COLORS,
    text,
    ...extra,
  };
}

export const keywordCards: CardDef[] = [
  keyworded('redirect', 'Lightning Rod', 'Redirection.', { redirect: true }),
  keyworded('redirect-leader', 'Rod Warden', 'Redirection.', {
    redirect: true,
    starter: true,
    level: 3,
  }),
  keyworded('immune', 'Warded Dummy', 'Spell Immunity.', { spellImmune: true }),
];

export const placeholderCards: CardDef[] = [
  ...curseCards,
  ...keywordCards,
  {
    // The `hero` in the id predates the rename to leaders and stays: changing it
    // would orphan every saved deck and recorded replay that names it.
    id: 'x-hero-dummy-warden',
    name: 'Dummy Warden',
    color: 'R',
    type: 'summon',
    starter: true,
    strength: 1,
    hp: 3,
    level: 3,
    num: 'T000',
    identity: ALL_COLORS,
    text: 'No powers. Every color.',
  },
  ...COLORS.flatMap((c) => [dummy(c, 1), dummy(c, 2), dummy(c, 3)]),
  ...COLORS.map(testBolt),
];
