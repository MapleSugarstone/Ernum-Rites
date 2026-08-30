import { allCards } from './engine/registry';
import { DIGEST_FORMAT, digestHash } from './engine/digest';
import { costTotal, MANA_KINDS } from './engine/types';
import './cards';

/**
 * What two clients have to agree on before they can share a match.
 *
 * Two builds that disagree about a card, or about how a position is written
 * down, will diverge partway through a game rather than at the start, and the
 * first sign of it is a desync nobody can act on. So it is checked at the door.
 *
 * Derived rather than written down, because a version somebody has to remember
 * to raise is a version that will be forgotten: it covers the digest format and
 * every printed number, cost and rules line in the set.
 */
/**
 * Bumped by hand when the rules change but the printed cards do not.
 *
 * The hash below reads what a card says, which catches a retuned cost or a
 * reworded effect. It cannot see a change in what an effect does: Chipcrunch's
 * flip stopped asking about supporters that were already sapped without a
 * character of its text moving. Two builds disagreeing that way would pass the
 * check and then fall out of step mid-match, which is the thing the check exists
 * to prevent, so behaviour changes are counted here instead.
 */
const RULES_REVISION = 2;

function computeVersion(): string {
  const parts = allCards()
    .map((c) => {
      const cost = MANA_KINDS.map((k) => `${k}${c.cost?.[k] ?? 0}`).join('');
      const powers = (c.powers ?? [])
        .map((p) => `${p.name}/${costTotal(p.cost)}/${p.text}`)
        .join('|');
      return [
        c.id,
        c.level ?? 0,
        c.strength ?? 0,
        c.hp ?? 0,
        c.rarity ?? '',
        cost,
        c.text ?? '',
        c.flipText ?? '',
        powers,
      ].join('~');
    })
    .sort();
  return `${DIGEST_FORMAT}r${RULES_REVISION}.${digestHash(parts.join('\n'))}`;
}

/** Computed once: the set does not change while a page is open. */
export const BUILD_VERSION = computeVersion();
