import { describe, expect, it } from 'vitest';
import '../src/cards';
import { livingSummon } from '../src/engine/generated';
import { card, tryCard } from '../src/engine/registry';

/**
 * A card minted mid-match, read back from its id alone.
 *
 * Only the engine that ran the effect ever mints the card. Online, a client is
 * handed the finished state rather than the actions behind it, so the seat that
 * did not cast the spell holds a board naming a card its registry has never
 * seen: Living Spell kept the old portrait for the other player, and so did
 * Living Curse. Every generated id is a deterministic function of its inputs,
 * so it can be minted back.
 */

const SPELL = 'ox-graft';
const SUMMON = 'o1-skeleton';
const OTHER = 'o2-boneknown';

/**
 * Ids written out by hand, never minted in this process.
 *
 * That is the whole point: minting first and then looking up would pass with no
 * rebuilder at all, because the mint is what registers it. A client that never
 * ran the effect has only the string, so the string is all these get.
 */
describe('a minted card read back from its id', () => {
  it('rebuilds a living spell nobody in this process ever minted', () => {
    const id = `gen-live-${SPELL}-7x9L3`;
    expect(tryCard(id), 'cold, before anything asks for it').toBeDefined();
    const made = card(id);
    expect(made.name, 'it wears the spell name').toBe(card(SPELL).name);
    expect(made.art, 'and the spell art, which is the reported symptom').toBe(card(SPELL).art);
    expect(made.strength, 'and the stats the id carried').toBe(7);
    expect(made.hp).toBe(9);
    expect(made.powers?.length, 'and casts what the spell did').toBeGreaterThan(0);
  });

  it('rebuilds each of the other families cold', () => {
    for (const id of [
      `gen-hack-${SUMMON}`,
      `gen-raise-${SUMMON}`,
      `gen-oil-${SUMMON}`,
      `gen-malware-${SUMMON}`,
      `gen-virus-${SUMMON}`,
      `gen-fuse-${SUMMON}+${OTHER}-6x7L3`,
      `gen-graft-${SUMMON}+${OTHER}-5L2O`,
    ]) {
      expect(tryCard(id), `${id} rebuilds`).toBeDefined();
      expect(card(id).name, `${id} has a name`).toBeTruthy();
    }
  });

  it('agrees with the builder that would have minted it', () => {
    // The rebuilt card and the minted one have to be the same entry, or two
    // clients would be holding different cards under one id.
    const cold = card(`gen-live-${SPELL}-3x5L2`);
    const minted = card(livingSummon(SPELL, { strength: 3, hp: 5, level: 2 }));
    expect(minted).toBe(cold);
  });

  it('hands back nothing for an id it cannot read, rather than throwing', () => {
    // A client on an older build meets an id from a newer one. It should look
    // like a card it has never heard of, not like a crash mid-render.
    expect(tryCard('gen-live-not-a-real-card-9x9L9')).toBeUndefined();
    expect(tryCard('gen-nonsense-whatever')).toBeUndefined();
    expect(tryCard('gen-graft-nope+alsonope-1L1O')).toBeUndefined();
  });
});
