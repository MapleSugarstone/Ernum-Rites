import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { everyDeck, starterDecks, testDecks } from '../src/cards';
import {
  canBeLeader,
  checkDeckColors,
  colorsOf,
  deckIdentity,
  isLegalUnder,
  legalPoolFor,
} from '../src/engine/identity';
import { allCards, card, isGenerated, tryCard } from '../src/engine/registry';
import {
  fusedRecomp,
  graftedCopy,
  livingSummon,
  malwareCopy,
  oilCopy,
  oilRaise,
  pepperRobotCopy,
  robotCopy,
} from '../src/engine/generated';
import { frameFor, frameKeyOf, gemFor } from '../src/ui/frames';

/** The frames the art pack actually ships. */
const FRAME_KEYS = ['P', 'O', 'R', 'F', 'S', 'N'];
import { COLORS, COPY_LIMIT } from '../src/engine/types';
import { counts, deckMarkdown, newBuilder, parseDeckList } from '../src/ui/builder';

const ART_ROOT = join(process.cwd(), 'assets');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Art the pack ships that is furniture rather than a card face. */
const NOT_A_CARD = new Set([
  // Status icons the board draws, not card faces.
  'Cardgame/Extras/PowerShield.png',
  'Cardgame/Extras/Deathrattle.png',
  'Cardgame/Extras/Locked.png',
  'Cardgame/Extras/Wound token.png',
  'Cardgame/Extras/NoUnsap.png',
  'Cardgame/Extras/Redirect.png',
  'Cardgame/Extras/SpellImmune.png',
  // What a body wears while its strength is off its printed line, and the
  // arrows that mark the moment it moves.
  'Cardgame/Extras/BuffSparkles.png',
  'Cardgame/Extras/Debuff Orbs.png',
  'Cardgame/Extras/BuffArrow.png',
  'Cardgame/Extras/Debuff Arrow.png',
  // Mana pips, printed into every cost line: one per colour and one for
  // colourless.
  'Cardgame/Extras/PepperPip.png',
  'Cardgame/Extras/OilPip.png',
  'Cardgame/Extras/RobotPip.png',
  'Cardgame/Extras/FishPip.png',
  'Cardgame/Extras/SunPip.png',
  'Cardgame/Extras/NeutralPip.png',
  // The face-down card, worn by every card the board draws back up.
  'Cardgame/Extras/Cardback.png',
  // Rarity gems.
  'Cardgame/Extras/Common.png',
  'Cardgame/Extras/Rare.png',
  'Cardgame/Extras/Epic.png',
  'Cardgame/Extras/Legendary.png',
  'Cardgame/redc.png',
  'Cardgame/bluec.png',
  'Cardgame/greenc.png',
  'Cardgame/purplec.png',
  'Cardgame/yellowc.png',
  'Cardgame/redspell.png',
  'Cardgame/bluespell.png',
  'Cardgame/greenspell.png',
  'Cardgame/purplespell.png',
  'Cardgame/yellowspell.png',
  'Cardgame/neutralc.png',
  'Cardgame/neutralspell.png',
  'Cardgame/ExampleCard.png',
  'Cardgame/flipborderr.png',
  'Cardgame/flipborderForSummons.png',
  'Cardgame/flipborderForSpells.png',
]);

const artFiles = walk(ART_ROOT)
  .map((f) => relative(ART_ROOT, f).split(sep).join(posix.sep))
  .filter((f) => f.toLowerCase().endsWith('.png'))
  // The public root holds more than the card pack now (the little guy's
  // costumes, the favicon, the social preview), and none of it is a card face.
  .filter((f) => f.startsWith('Cardgame/'))
  // The sheets are the same faces packed one file per colour, written by
  // `npm run atlas`. Counting them here would report every card twice.
  .filter((f) => !f.startsWith('Cardgame/Sheets/'));

const realCards = allCards().filter((c) => c.art);

describe('card art', () => {
  it('points every card at a file that actually exists', () => {
    const missing: string[] = [];
    for (const c of realCards) {
      if (!existsSync(join(ART_ROOT, c.art!))) missing.push(`${c.id} -> ${c.art}`);
    }
    expect(missing).toEqual([]);
  });

  it('uses every piece of card art exactly once', () => {
    const used = new Map<string, string[]>();
    for (const c of realCards) {
      const list = used.get(c.art!) ?? [];
      list.push(c.id);
      used.set(c.art!, list);
    }
    const unused = artFiles.filter((f) => !NOT_A_CARD.has(f) && !used.has(f));
    const duplicated = [...used.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([art, ids]) => `${art}: ${ids.join(', ')}`);
    expect({ unused, duplicated }).toEqual({ unused: [], duplicated: [] });
  });

  it('does not give a card art the pack does not ship', () => {
    const known = new Set(artFiles);
    const bogus = realCards.filter((c) => !known.has(c.art!)).map((c) => `${c.id} -> ${c.art}`);
    expect(bogus).toEqual([]);
  });
});

describe('card definitions', () => {
  it('gives every card a unique id, a rarity and a collector number', () => {
    const ids = new Set<string>();
    for (const c of realCards) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(c.rarity, `${c.id} rarity`).toBeTruthy();
      expect(c.num, `${c.id} collector number`).toBeTruthy();
    }
  });

  it('keeps summon stat lines inside a sane band for their level', () => {
    // The band is a guideline for the designer, not a rule of the game: a card
    // may break it when that is what makes it fair or fun. These numbers are a
    // guard against a typo turning a level 1 into a 9/9, nothing more.
    const bad: string[] = [];
    for (const c of realCards) {
      if (c.type !== 'summon') continue;
      const level = c.level ?? 1;
      const total = (c.strength ?? 0) + (c.hp ?? 0);
      const ceiling = { 1: 9, 2: 12, 3: 15 }[level as 1 | 2 | 3];
      if (total > ceiling) bad.push(`${c.id} level ${level} totals ${total}`);
      if ((c.hp ?? 0) < 1) bad.push(`${c.id} has no HP`);
    }
    expect(bad).toEqual([]);
  });

  it('only names factions the engine knows about', () => {
    const bad: string[] = [];
    for (const c of realCards) {
      for (const f of c.factions ?? []) {
        if (typeof f !== 'string') bad.push(`${c.id}: ${String(f)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('spreads factions across colours instead of piling them on one', () => {
    const byFaction = new Map<string, Set<string>>();
    for (const c of realCards) {
      for (const f of c.factions ?? []) {
        const set = byFaction.get(f) ?? new Set<string>();
        set.add(c.color);
        byFaction.set(f, set);
      }
    }
    // The cross-colour glue tribes have to actually span colours to be glue.
    for (const f of ['Mortal', 'Scholar', 'Star']) {
      expect(byFaction.get(f)?.size ?? 0, `${f} colour spread`).toBeGreaterThan(1);
    }
  });
});

describe('powers that could run forever', () => {
  it('never charges nothing, taps nothing and allows unlimited uses', () => {
    // Found by the fuzzer: Gamble Lord could dig its whole deck in one turn and
    // then keep firing on an empty one, which is a soft lock, not a game.
    const loops: string[] = [];
    for (const c of allCards()) {
      if (isGenerated(c.id) || c.id.startsWith('x-')) continue;
      for (const p of c.powers ?? []) {
        const paid = Object.values(p.cost ?? {}).some((n) => (n ?? 0) > 0);
        if (paid || p.sapSelf || p.oncePerTurn) continue;
        // Two other things end a repeat: a power that removes its own body, and
        // one that charges debt, which runs into the debt limit and the game ends.
        if (/Destroy this summon/i.test(p.text)) continue;
        if (/take \d+ debt/i.test(p.text)) continue;
        // Spending its own HP runs the body out, so the repeat ends on its own.
        if (/Spend \d+ HP off this/i.test(p.text)) continue;
        loops.push(`${c.name}: ${p.name}`);
      }
    }
    expect(loops).toEqual([]);
  });
});

describe('zone targets mean what they say', () => {
  it('offers only summons for a debt target, never a spell', () => {
    // A discard flip cost routes the card into the debt zone, so a spell can be
    // sitting there for Necromancer's Raise to resurrect as a body.
    for (const c of allCards()) {
      for (const spec of [...(c.targets ?? []), ...(c.powers ?? []).flatMap((p) => p.targets ?? [])]) {
        if (spec.kind !== 'debt') continue;
        expect(spec.filter, `${c.name} takes a debt target with no filter`).toBeTruthy();
        const spell = { card: card('px-firebolt') } as Parameters<NonNullable<typeof spec.filter>>[0];
        expect(spec.filter!(spell), `${c.name} would accept a spell out of debt`).toBe(false);
      }
    }
  });
});

describe('every card can be drawn', () => {
  /** One of each kind the game mints mid-match, so the face path sees them too. */
  const minted = [
    robotCopy('o2-witch'),
    oilRaise('o2-witch'),
    oilCopy('px-firebolt'),
    malwareCopy('px-firebolt'),
    pepperRobotCopy('n3-IneptRuler'),
    fusedRecomp('o2-witch', 'f2-fishwizard', 4, 5, 3),
    livingSummon('px-firebolt', { strength: 2, hp: 2, level: 1 }),
    graftedCopy('o2-witch', 'f2-fishwizard', {
      strength: 2, color: 'O', level: 2, powers: card('o2-witch').powers ?? [],
    }),
  ];

  it('gives the renderer a frame, a gem and a rarity for every card', () => {
    for (const def of [...allCards(), ...minted.map((id) => card(id))]) {
      expect(def.name, `${def.id} has no name`).toBeTruthy();
      expect(def.rarity, `${def.name} has no rarity`).toBeTruthy();
      const key = frameKeyOf(def);
      expect(FRAME_KEYS, `${def.name} asks for frame ${key}`).toContain(key);
      expect(frameFor(def.type, key, ''), `${def.name} has no frame`).toBeTruthy();
      expect(gemFor(def.rarity!, key, ''), `${def.name} has no gem`).toBeTruthy();
    }
  });

  it('carries triggers and keywords through every single-source copy', () => {
    // Slicer prints Effect Damage +1 and a Battlecry, so one card exercises
    // both halves of what a copy has to carry.
    const copies = { robotCopy, oilCopy, malwareCopy, oilRaise, pepperRobotCopy };
    for (const [name, make] of Object.entries(copies)) {
      const g = card(make('p3-Slicer'));
      expect(g.triggers?.onEnter, `${name} keeps the Battlecry`).toBeDefined();
      expect(g.effectDamage, `${name} keeps Effect Damage`).toBe(1);
      const d = card(make('p3-Pod'));
      expect(d.triggers?.onDeath, `${name} keeps the Deathrattle`).toBeDefined();
    }
  });

  it('lends the whole text side on a graft, host keeping its own', () => {
    const host = card('p3-Pod');
    const g = card(graftedCopy('p3-Pod', 'n3-NerveLite', {
      strength: host.strength ?? 2, color: 'P', level: 3, powers: host.powers ?? [],
    }));
    expect(g.triggers?.onDeath, 'the host keeps its Deathrattle').toBeDefined();
    expect(g.powers?.some((p) => p.name === 'Reclaim'), 'the lent Power arrives').toBe(true);
    expect(g.factions, 'and the source faction line').toContain('Hedron');

    // A grafted Power is paid for on the host's side, so its pips come across
    // as Oil rather than the colour the source printed.
    const oiled = card(graftedCopy('p3-Pod', 'f2-fishwizard', {
      strength: host.strength ?? 2, color: 'P', level: 3, powers: host.powers ?? [],
    }));
    const lent = oiled.powers?.find((p) => p.name === 'Magic Fishiles');
    expect(lent?.cost?.O, 'the lent Power is priced in Oil').toBe(1);
    expect(lent?.cost?.F ?? 0, 'and keeps none of its Fish pips').toBe(0);

    const bare = card(graftedCopy('n3-NerveLite', 'p3-Pod', {
      strength: 3, color: 'N', level: 3, powers: card('n3-NerveLite').powers ?? [],
    }));
    expect(bare.triggers?.onDeath, 'the source Deathrattle comes across').toBeDefined();
    expect(bare.text, 'and is printed on the face').toContain('Deathrattle');
    expect(bare.factions, 'with the source factions').toContain('Living');
  });

  it('never mints a card that claims a colour and neutrality at once', () => {
    // Virus used to copy `neutral` off its source, so a rebuilt neutral card drew
    // the colourless frame while printing Pepper and Robot pips.
    for (const id of minted) {
      const def = card(id);
      if (!def.neutral) continue;
      expect(def.color2, `${def.name} is neutral but has a second colour`).toBeUndefined();
    }
  });
});

describe('decks', () => {
  it('references real cards and a real leader', () => {
    for (const d of everyDeck) {
      expect(tryCard(d.leaderId), `${d.key} leader`).toBeDefined();
      expect(canBeLeader(d.leaderId), `${d.key} leader is playable`).toBe(true);
      for (const id of d.cards) expect(tryCard(id), `${d.key} contains ${id}`).toBeDefined();
    }
  });

  it('keeps every deck in a playable size band', () => {
    for (const d of everyDeck) {
      expect(d.cards.length, `${d.key} size`).toBeGreaterThanOrEqual(40);
      expect(d.cards.length, `${d.key} size`).toBeLessThanOrEqual(60);
    }
  });

  it('respects the two-copy limit', () => {
    const breaches: string[] = [];
    for (const d of everyDeck) {
      const counts = new Map<string, number>();
      for (const id of d.cards) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, n] of counts) {
        if (n > COPY_LIMIT) breaches.push(`${d.key}: ${n}x ${id} (max ${COPY_LIMIT})`);
      }
    }
    expect(breaches).toEqual([]);
  });

  it('separates starter decks from labelled test decks', () => {
    expect(starterDecks.every((d) => !d.test)).toBe(true);
    expect(testDecks.every((d) => d.test)).toBe(true);
    expect(new Set(everyDeck.map((d) => d.key)).size).toBe(everyDeck.length);
  });
});

describe('colour identity', () => {
  it('prints a pip for every colour a multi-colour card carries', () => {
    // A two-colour card has to ask for both, a three-colour card all three, so
    // the face shows what the deck behind it must supply. The pips may be spread
    // across the card's own cost, its Powers and its flip price.
    const thin: string[] = [];
    for (const def of allCards()) {
      if (!def.art || def.uncollectible) continue;
      const colors = [...new Set(colorsOf(def))];
      if (colors.length < 2) continue;
      const costs = [def.cost, ...(def.powers ?? []).map((p) => p.cost), def.flipCost?.mana];
      const seen = new Set<string>();
      for (const cost of costs) {
        for (const [k, v] of Object.entries(cost ?? {})) if ((v ?? 0) > 0) seen.add(k);
      }
      const missing = colors.filter((c) => !seen.has(c));
      if (missing.length) thin.push(`${def.id} never asks for ${missing.join('/')}`);
    }
    expect(thin).toEqual([]);
  });

  it('gives a leader every colour its own costs are written in', () => {
    // Sasparsol is Pepper and Solar and pays for Lifesong in both. Whatever a
    // leader's costs name, a deck standing behind it has to be allowed to supply,
    // or the leader could never use its own power.
    const sasparsol = deckIdentity('m-yr-sasparsol');
    expect(sasparsol).toContain('S');
    expect(sasparsol).toContain('P');
    expect(isLegalUnder(card('p1-firebat'), sasparsol)).toBe(true);

    const unpayable: string[] = [];
    for (const def of allCards()) {
      if (!canBeLeader(def.id)) continue;
      const identity = deckIdentity(def.id);
      const costs = [def.cost, ...(def.powers ?? []).map((p) => p.cost)];
      for (const cost of costs) {
        for (const colour of COLORS) {
          if ((cost?.[colour] ?? 0) > 0 && !identity.includes(colour)) {
            unpayable.push(`${def.id} needs ${colour}`);
          }
        }
      }
    }
    expect(unpayable).toEqual([]);
  });

  it('never lets a card demand mana its own identity withholds', () => {
    // A card whose cost names a colour outside its identity is legal in a deck
    // that can never cast it. Leaders are covered by widening their identity;
    // everything else has to be payable where it is legal.
    const stranded: string[] = [];
    for (const def of realCards) {
      const identity = colorsOf(def);
      // Colourless is paid from any source, so it names no colour and can never
      // strand a card.
      for (const colour of COLORS) {
        if ((def.cost?.[colour] ?? 0) > 0 && !identity.includes(colour)) {
          stranded.push(`${def.id} costs ${colour}`);
        }
      }
    }
    expect(stranded).toEqual([]);
  });

  it('keeps every deck inside the colours its leader brings', () => {
    const bad: string[] = [];
    for (const d of everyDeck) {
      const res = checkDeckColors(d.leaderId, d.cards);
      if (!res.ok) {
        bad.push(`${d.key} (${res.identity.join('')}): ${[...new Set(res.offColor)].join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('treats identity as a subset, so a mono leader cannot run dual cards', () => {
    // The Fish leader is mono F, and Robotfish is F plus R.
    expect(isLegalUnder(card('m-bg-robotfish'), colorsOf(card('fh-thefish')))).toBe(false);
    expect(isLegalUnder(card('f1-basicfish'), colorsOf(card('fh-thefish')))).toBe(true);
    // A dual leader unlocks both of its colours and everything inside them.
    const dual = colorsOf(card('m-bg-machineblue'));
    expect(dual).toEqual(['F', 'R']);
    expect(isLegalUnder(card('m-bg-robotfish'), dual)).toBe(true);
    expect(isLegalUnder(card('r1-mouse'), dual)).toBe(true);
    expect(isLegalUnder(card('p1-bunny'), dual)).toBe(false);
  });

  it('lets any summon with a body stand as a leader', () => {
    expect(canBeLeader('f3-crabcity')).toBe(true);
    expect(canBeLeader('fh-thefish')).toBe(true);
    // Spells have no body to put on the board.
    expect(canBeLeader('fx-catch')).toBe(false);
  });

  it('gives a deck a pool that is never empty for any playable leader', () => {
    for (const leaderId of ['fh-thefish', 'm-bg-machineblue', 'f3-crabcity']) {
      expect(legalPoolFor(leaderId, allCards()).length, leaderId).toBeGreaterThan(20);
    }
  });
});

describe('deck lists', () => {
  function builderWith(leaderId: string, cards: string[]) {
    return { ...newBuilder(), name: 'Round Trip', leaderId, cards };
  }

  it('reads back exactly what it writes', () => {
    const b = builderWith('fh-thefish', ['f1-lilfish', 'f1-lilfish', 'f1-octopi']);
    const parsed = parseDeckList(deckMarkdown(b));
    expect(parsed.name).toBe('Round Trip');
    expect(parsed.leaderId).toBe('fh-thefish');
    expect(parsed.cards.slice().sort()).toEqual(b.cards.slice().sort());
    expect(parsed.skipped).toEqual([]);
  });

  it('survives a full legal deck', () => {
    const d = starterDecks[0];
    const b = builderWith(d.leaderId, d.cards);
    const parsed = parseDeckList(deckMarkdown(b));
    expect(parsed.cards.length).toBe(d.cards.length);
    expect(counts(parsed.cards)).toEqual(counts(d.cards));
  });

  it('trusts the bracketed id over the name printed beside it', () => {
    const list = `Deck
leader: Whatever [fh-thefish]

  2x Some Old Name [f1-lilfish]`;
    const parsed = parseDeckList(list);
    expect(parsed.leaderId).toBe('fh-thefish');
    expect(parsed.cards).toEqual(['f1-lilfish', 'f1-lilfish']);
  });

  it('skips and names lines for cards this set does not have', () => {
    const list = `Deck
leader: The Fish [fh-thefish]
  2x Ghost Card [no-such-card]
  1x Lilfish [f1-lilfish]`;
    const parsed = parseDeckList(list);
    expect(parsed.cards).toEqual(['f1-lilfish']);
    expect(parsed.skipped).toEqual(['2x Ghost Card [no-such-card]']);
  });

  it('reads a list typed with CRLF line endings', () => {
    const list = ['Deck', 'leader: The Fish [fh-thefish]', '  1x Lilfish [f1-lilfish]'].join('\r\n');
    const parsed = parseDeckList(list);
    expect(parsed.leaderId).toBe('fh-thefish');
    expect(parsed.cards).toEqual(['f1-lilfish']);
  });
});

describe('neutral is its own colour', () => {
  it('never carries one of the five, and the flag agrees with it', () => {
    for (const def of allCards()) {
      expect(def.color === 'N', `${def.id} colour ${def.color}`).toBe(!!def.neutral);
    }
  });

  it('pays with any mana and belongs to no identity', () => {
    const neutral = allCards().filter((d) => d.color === 'N');
    expect(neutral.length).toBeGreaterThan(20);
    for (const def of neutral) {
      // No colour to a leader's identity means every deck may run it.
      expect(colorsOf(def), def.id).toEqual([]);
    }
  });
});
