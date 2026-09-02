import { describe, expect, it } from 'vitest';
import '../src/cards';
import {
  coloredBanana,
  fusedRecomp,
  malwareCopy,
  oilCopy,
  oilRaise,
  pepperRobotCopy,
  robotCopy,
} from '../src/engine/generated';
import { colorsOf } from '../src/engine/identity';
import { card } from '../src/engine/registry';
import type { CardDef } from '../src/engine/types';

/**
 * A card rebuilt into a colour stops being neutral.
 *
 * Neutral is not a colour: `colorsOf` returns nothing for it so every deck may
 * run it, and it pays colourless whatever its `color` field says. So a rebuild
 * that assigns a colour and leaves the neutral flag alone produces a card that
 * claims to be Robot and behaves in every way that matters as Neutral. Download
 * pulled a Low Wizard out of the enemy's debt "rebuilt in Robot" and handed back
 * a neutral card.
 *
 * `pepperRobotCopy` already knew this and cleared the flag. The rest did not.
 */

const NEUTRAL = 'n2-LowWizard';

function rebuilt(id: string): CardDef {
  return card(id);
}

/**
 * Every builder that assigns a colour, and the colours the rebuilt card should
 * then bring. Malware spreads its pips over three and a Pepper-Robot copy over
 * two, so the list is what each one actually costs to play rather than one
 * headline colour.
 */
const recolours: [string, (src: string) => string, string[]][] = [
  ['robotCopy', robotCopy, ['R']],
  ['oilRaise', oilRaise, ['O']],
  ['oilCopy', oilCopy, ['O']],
  ['malwareCopy', malwareCopy, ['O', 'R', 'P']],
  ['pepperRobotCopy', pepperRobotCopy, ['P', 'R']],
];

describe('a neutral card rebuilt into a colour', () => {
  it('is neutral to begin with', () => {
    const src = card(NEUTRAL);
    expect(src.neutral, `${NEUTRAL} is neutral`).toBe(true);
    expect(colorsOf(src), 'so it brings no colour').toEqual([]);
  });

  it('brings the colour it was rebuilt in', () => {
    for (const [name, build, colours] of recolours) {
      const made = rebuilt(build(NEUTRAL));
      expect(made.color, `${name} sets the colour`).toBe(colours[0]);
      expect(made.neutral, `${name} stops claiming neutrality`).toBeFalsy();
      expect(colorsOf(made), `${name} brings ${colours.join('+')}`).toEqual(colours);
    }
  });

  it('does the same for a fusion', () => {
    // A Recomp is built from nothing rather than copied from a parent, so it
    // never inherited the flag. Pinned anyway: it is Pepper and Robot, which is
    // what Recompiler says it rebuilds them in.
    const made = rebuilt(fusedRecomp(NEUTRAL, NEUTRAL, 3, 4, 2));
    expect(made.neutral, 'a fusion is coloured, not neutral').toBeFalsy();
    expect(colorsOf(made)).toEqual(['P', 'R']);
  });

  it('leaves a coloured card alone', () => {
    // The guard: this must not start stripping colours off cards that had them.
    const coloured = 'o1-skeleton';
    const made = rebuilt(robotCopy(coloured));
    expect(card(coloured).neutral, 'the source was never neutral').toBeFalsy();
    expect(colorsOf(made), 'and it is Robot now').toEqual(['R']);
  });

  it('keeps a recoloured banana out of neutral too', () => {
    // Already correct, and worth pinning so it stays that way.
    const banana = coloredBanana('n-banana', 'F');
    expect(rebuilt(banana).neutral).toBeFalsy();
  });
});
