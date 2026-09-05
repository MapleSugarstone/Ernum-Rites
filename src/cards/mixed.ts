import { card } from '../engine/registry';
import { registerChoiceResolver } from '../engine/choices';
import { findSummon } from '../engine/state';
import { log, toHand } from '../engine/effects';
import { effectiveStrength } from '../engine/effects';
import {
  fusedRecomp,
  hedronCopy,
  livingSummon,
  pepperRobotCopy,
  robotColorlessCopy,
} from '../engine/generated';
import {
  battleAttacker,
  battleDefender,
  levelOf,
  livingOpponents,
  remainingHp,
} from '../engine/state';
import { costTotal, type CardDef, type TargetSpec } from '../engine/types';
import { T, artPath, dualKit, selfRef } from './build';

// Dual-colour cards are where the factions actually pay off.
const bg = dualKit('BG', 'F', 'R');
const bp = dualKit('BP', 'F', 'O');
const pg = dualKit('PG', 'O', 'R');
const rb = dualKit('RB', 'P', 'F');
const rg = dualKit('RG', 'P', 'R');
const rp = dualKit('RP', 'P', 'O');
const yb = dualKit('YB', 'S', 'F');
const yg = dualKit('YG', 'S', 'R');
const yp = dualKit('YP', 'S', 'O');
const yr = dualKit('YR', 'S', 'P');
// Candy pairs with each of the other five. The frame is Candy on most of
// them, so the folder letter leads with M and the kit reads K first.
const mb = dualKit('MB', 'K', 'F');
const mg = dualKit('MG', 'K', 'R');
const mp = dualKit('MP', 'K', 'O');
const mr = dualKit('MR', 'K', 'P');
const my = dualKit('MY', 'K', 'S');
// Reversed frames on the same folders: the folder names the art, the kit
// names the colours, so Loanshark prints Fish and Red Sweets prints Pepper.
const bm = dualKit('MB', 'F', 'K');
const rm = dualKit('MR', 'P', 'K');

/** A character with something to heal, which is the only one worth pointing at. */
function damagedCharacter(label: string): TargetSpec {
  return {
    kind: 'summon',
    side: 'any',
    includeLeader: true,
    label,
    filter: (a) => !!a.summon && a.summon.hp.some((h) => h.flipped),
  };
}

/**
 * The five-colour leader. Its art sits outside the Mixed tree and it carries
 * more colours than color2 and color3 can hold, so it is spelled out here
 * rather than run through a pair kit.
 *
 * A leader whose identity is every colour makes every card legal in its deck,
 * which is the point: the ritual has to be paid in all five. What it prints is
 * Ernum, a colour of its own, so facing it as a supporter pays Ernum mana and
 * that one covers a pip of any colour.
 */
const ernum: CardDef = {
  id: 'm-ernum',
  name: 'Ernum',
  color: 'E',
  identity: ['P', 'O', 'R', 'F', 'S'],
  type: 'summon',
  level: 3,
  strength: 1,
  hp: 2,
  factions: ['Ernum'],
  art: artPath('Ernum/Ernum'),
  artist: 'klabss',
  num: '000',
  text: 'At the start of your turn, loses 1 HP.',
  triggers: {
    // Raw, so its own Effect Damage does not amplify the burn it pays.
    onAwake: (c) => {
      const me = selfRef(c);
      if (me) c.rawDamage(me, 1);
    },
  },
  powers: [
    {
      name: 'Novelty Ritual',
      cost: { P: 1, O: 1, R: 1, F: 1, S: 1, C: 1 },
      text: 'Gains 6 HP, +6 attack and Effect Damage +3, then heal 6 debt.',
      sapSelf: true,
      effect: (c) => {
        const me = selfRef(c);
        if (!me) return;
        c.reinforce(me, 6);
        c.buffStrength(me, 6, 'permanent');
        c.grantEffectDamage(me, 3);
        c.clearDebt(c.me, 6);
      },
    },
    {
      // The Candy pip is what folds the sixth colour into Ernum's leader
      // identity: deckIdentity reads power costs, so this line alone is what
      // lets an Ernum deck run the Candy cards.
      name: 'Sentimental',
      cost: { K: 1 },
      text: 'Gain 1 Love.',
      sapSelf: true,
      effect: (c) => c.gainLove(c.me, 1),
    },
  ],
};

export const mixedCards: CardDef[] = [
  ernum,
  // --- Fish and Machine -----------------------------------------------------
  bg.summon(2, 'robotfish', 'Robotfish', ['Fish', 'Machine'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Filter',
        cost: { F: 1, R: 1 },
        text: 'Catch a spent HP card off an ally, and this character gains a Power Shield.',
        sapSelf: true,
        targets: [
          {
            kind: 'summon',
            side: 'ally',
            includeLeader: true,
            label: 'an ally with spent HP',
            filter: (a) => !!a.summon && a.summon.hp.some((h) => h.flipped),
          },
        ],
        effect: (c) => {
          c.catch(c.targets[0], 1);
          const me = selfRef(c);
          if (me) c.shield(me, 1);
        },
      },
    ],
  }),
  bg.summon(3, 'machineblue', 'Machine Blue', ['Machine', 'Fish'], {
    str: 2,
    hp: 3,
    text: 'Has +1 attack for each other summon you control.',
    triggers: {
      strengthBonus: ({ state, controller, summon }) => {
        if (summon.cardId !== 'm-bg-machineblue' || summon.owner !== controller) return 0;
        let n = 0;
        for (const s of state.players[controller].slots) {
          if (s && s.cardId !== 'm-bg-machineblue') n++;
        }
        return n;
      },
    },
    powers: [
      {
        name: 'Assembly Line',
        cost: { F: 1, R: 1 },
        text: 'Fill an empty slot with a Minnowling.',
        sapSelf: true,
        effect: (c) => {
          const slot = c.emptySlot(c.me);
          if (slot === null) {
            c.log('No room on the line.');
            return;
          }
          c.putSummon(c.me, 'f1-basicfish', slot, {
            strength: 0,
            color: 'F',
            hp: card('f1-basicfish').hp ?? 1,
            asPrinted: true,
          });
        },
      },
    ],
  }),
  bg.summon(3, 'hedronheart', 'Hedron Heart', ['Hedron'], {
    str: 2,
    hp: 6,
    text: 'Battlecry: Gains a Power Shield. At the start of your turn, gains 1 HP.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (me) c.shield(me, 1);
      },
      onAwake: (c) => {
        const me = selfRef(c);
        if (me) c.reinforce(me, 1);
      },
    },
    powers: [
      {
        name: 'Bulwark',
        cost: { F: 1, R: 1 },
        text: 'Gains a Power Shield and 1 HP off your deck.',
        sapSelf: true,
        effect: (c) => {
          const me = selfRef(c);
          if (!me) return;
          c.shield(me, 1);
          c.reinforce(me, 1);
        },
      },
    ],
  }),
  bg.spell('fishcode', 'Fishcode', { F: 1, R: 1 }, {
    text: 'Turn an enemy summon into a Minnowling, then draw a card.',
    targets: [T.enemy()],
    effect: (c) => {
      c.transform(c.targets[0], 'f1-basicfish');
      c.draw(c.me, 1);
    },
  }),
  bg.spell('greenorblue', 'Green or Blue', { F: 1, R: 1 }, {
    text: 'Scry 6 for a Fish or a Machine.',
    effect: (c) => {
      c.dig(
        c.me,
        6,
        (d) => !!d.factions?.includes('Fish') || !!d.factions?.includes('Machine'),
      );
    },
  }),

  // --- Fish and Spirit ------------------------------------------------------
  bp.summon(2, 'hatefuljely', 'Hateful Jelly', ['Fish', 'Spirit'], {
    str: 2,
    hp: 4,
    spellImmune: true,
    text: 'Spell Immunity. When attacked, put 2 Wounds on the attacker.',
    triggers: {
      onDefend: (c) => {
        const a = battleAttacker(c.state);
        if (a) c.wound(a, 2);
      },
    },
    powers: [
      {
        name: 'Sting',
        cost: { F: 1, O: 1 },
        text: 'Put 2 Wounds on an enemy summon.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => c.wound(c.targets[0], 2),
      },
    ],
  }),
  bp.summon(3, 'enigmastelf', 'Enigmastelf', ['Spirit', 'Scholar'], {
    str: 3,
    hp: 5,
    spellImmune: true,
    text: 'Spell Immunity. At the start of your turn, Mill 2.',
    triggers: {
      onAwake: (c) => c.mill(c.me, 2),
    },
    powers: [
      {
        name: 'Dark Vision',
        cost: { F: 1, O: 1 },
        text: 'Swap all HP cards between one of your summons and an enemy summon.',
        targets: [T.ally('your summon'), T.enemy()],
        effect: (c) => {
          const mine = c.summonAt(c.targets[0]);
          const theirs = c.summonAt(c.targets[1]);
          if (!mine || !theirs) return;
          const swap = mine.hp;
          mine.hp = theirs.hp;
          theirs.hp = swap;
          c.log('The two of them trade skins.');
        },
      },
    ],
  }),
  bp.summon(3, 'voidbug', 'Void Bug', ['Spirit', 'Beast'], {
    str: 4,
    hp: 5,
    spellImmune: true,
    text: 'Spell Immunity. At the start of your turn, you take 1 debt. Deathrattle: Deal 2 debt.',
    triggers: {
      onAwake: (c) => c.addDebt(c.me, 1, 'The void bug feeds on its keeper.'),
      onDeath: (c) => c.addDebt(c.opp, 2, 'The void bug bills the other side.'),
    },
    powers: [
      {
        name: 'Feed',
        cost: { F: 1, O: 1 },
        text: 'Deal 1 debt.',
        sapSelf: true,
        effect: (c) => c.addDebt(c.opp, 1, 'The void bug bills ahead of schedule.'),
      },
    ],
  }),
  bp.spell('orb', 'The Orb', { F: 1, O: 1 }, {
    text: 'Destroy a sapped summon and return a summon from your debt to your hand.',
    targets: [
      {
        kind: 'summon',
        side: 'any',
        label: 'a sapped summon',
        filter: (a) => !!a.summon?.sapped,
      },
    ],
    effect: (c) => {
      c.destroy(c.targets[0]);
      c.choose('debt-summon-to-hand', c.debtSummons(c.me), 'Return which summon to hand?');
    },
  }),
  bp.spell('visitor', 'The Visitor', { F: 1, O: 2 }, {
    text: 'Take control of an enemy summon with 2 or less HP left, and sap it.',
    targets: [
      {
        kind: 'summon',
        side: 'enemy',
        label: 'a weakened enemy summon',
        filter: (a) => !!a.summon && a.summon.hp.filter((h) => !h.flipped).length <= 2,
      },
    ],
    effect: (c) => c.takeControl(c.targets[0]),
  }),

  // --- Pepper and Fish ------------------------------------------------------
  rb.summon(2, 'sordidbeast', 'Sordid Beast', ['Beast'], {
    str: 3,
    hp: 2,
    text: 'Strike: Deal 1 to the defender first. If it dies, draw a card.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (!d) return;
        c.damage(d, 1);
        if (!c.summonAt(d)) c.draw(c.me, 1);
      },
    },
    powers: [
      {
        name: 'Maul',
        cost: { P: 1, F: 1, C: 1 },
        text: 'Deal 2 to an enemy summon. If it dies, draw a card.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => {
          c.damage(c.targets[0], 2);
          if (!c.summonAt(c.targets[0])) c.draw(c.me, 1);
        },
      },
    ],
  }),
  rb.summon(3, 'xyliss', 'Xyliss', ['Spirit', 'Scholar'], {
    str: 2,
    hp: 5,
    powers: [
      {
        name: 'Sordid Folk',
        cost: { P: 1, F: 1 },
        text: 'Turn one of your summons into any summon sitting in your debt zone.',
        targets: [T.ally('your summon'), T.myDebt('a summon in your debt')],
        effect: (c) => {
          const d = c.targets[1];
          if (d?.kind !== 'debt') return;
          const id = c.removeFromDebt(c.me, d.index);
          if (id) c.transform(c.targets[0], id);
        },
      },
      {
        name: 'Foresight',
        cost: { F: 1 },
        text: 'Draw a card, then pay off 1 debt.',
        sapSelf: true,
        effect: (c) => {
          c.draw(c.me, 1);
          c.clearDebt(c.me, 1);
        },
      },
    ],
  }),
  rb.spell('savetheuniverse', 'Save the Universe', { P: 2, F: 2 }, {
    text: 'Fully heal each of your characters.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.me, true)) c.unflip(ref, 99);
    },
  }),
  rb.spell('sordidfruit', 'Sordid Fruit', { P: 1, F: 1 }, {
    text: 'Return a spell from your discard pile to your hand, then draw a card.',
    effect: (c) => {
      c.choose('sordid-fruit', c.discardSpells(c.me), 'Return which spell to hand?');
    },
  }),
  rb.trap('sordidmark', 'Trap: Sordid Mark', { P: 1, F: 1 }, {
    text: 'The attacking summon becomes Stationary. Deal 2 to it.',
    effect: (c) => {
      const a = battleAttacker(c.state);
      if (!a) return;
      const s = c.summonAt(a);
      if (s) s.rooted = true;
      c.damage(a, 2);
    },
  }),

  // --- Pepper and Machine ---------------------------------------------------
  rg.summon(2, 'xyuzdrone', 'Xyuz Drone', ['Machine'], {
    str: 2,
    hp: 2,
    text: 'Battlecry: Deal 1 to every enemy summon.',
    triggers: {
      onEnter: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
      },
    },
    powers: [
      {
        name: 'Laser Sweep',
        cost: { P: 1, R: 1 },
        text: 'Deal 1 to every enemy summon.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
        },
      },
    ],
  }),
  rg.summon(3, 'professorpistachio', 'Professor Pistachio', ['Scholar', 'Machine'], {
    str: 1,
    hp: 2,
    text: 'Your Scholars have +1 attack, and you draw a card at the start of your turn.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Scholar') ? 1 : 0,
      onAwake: (c) => c.draw(c.me, 1),
    },
    powers: [
      {
        name: 'Xyuz Technology',
        cost: { P: 1, R: 1 },
        text: 'Scry 3 for a spell or Machine.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 3, (d) => d.type === 'spell' || !!d.factions?.includes('Machine'));
        },
      },
    ],
  }),
  rg.summon(3, 'obelisks', 'The Obelisks', ['Machine'], {
    str: 1,
    hp: 2,
    stationary: true,
    text:
      'Stationary. All enemies have -1 attack. ' +
      'At the start of your turn, loses 1 HP.',
    triggers: {
      strengthBonus: ({ controller, summon }) => (summon.owner === controller ? 0 : -1),
      // Raw, so no Effect Damage bonus inflates the upkeep it pays.
      onAwake: (c) => {
        const me = selfRef(c);
        if (me) c.rawDamage(me, 1);
      },
    },
    powers: [
      {
        name: 'Oppress',
        cost: { P: 1, R: 1, C: 1 },
        text: 'Every enemy summon loses 1 attack.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp)) c.buffStrength(ref, -1, 'permanent');
        },
      },
    ],
  }),
  rg.spell('recompiler', 'Recompiler', { P: 1, R: 1 }, {
    text: 'Fuse 2 summons into a Recomp in your hand: the higher of each stat, their factions, and their Powers rebuilt in Pepper and Robot. Draw a card.',
    targets: [T.any('the first summon'), T.any('the second summon')],
    effect: (c) => {
      const a = c.summonAt(c.targets[0]);
      const b = c.summonAt(c.targets[1]);
      if (!a || !b || a === b) return;
      const str = Math.max(effectiveStrength(c.state, a), effectiveStrength(c.state, b));
      const hp = Math.max(remainingHp(a), remainingHp(b));
      const lvl = Math.max(levelOf(a, card(a.cardId)), levelOf(b, card(b.cardId)));
      const genId = fusedRecomp(a.cardId, b.cardId, str, hp, lvl);
      // The parts go home to their owners' discard piles whole: fusing is not dying.
      for (const x of [a, b]) {
        const owner = c.state.players[x.owner];
        const i = owner.slots.indexOf(x);
        if (i >= 0) owner.slots[i] = null;
        owner.discard.push(x.cardId);
        for (const h of x.hp) owner.discard.push(h.cardId);
      }
      c.toHand(c.me, genId);
      c.draw(c.me, 1);
    },
  }),
  // The fusion product. Its stats are whatever the fuse averaged, so the
  // printed line is only a fallback.
  {
    id: 'm-rg-recomp',
    name: 'Recomp',
    color: 'P',
    color2: 'R',
    type: 'summon',
    level: 2,
    strength: 3,
    hp: 4,
    uncollectible: true,
    factions: ['Machine'],
    art: 'Cardgame/Extras/Recomp.png',
    artist: 'klabss',
    num: 'CRC',
  },
  rg.spell('virus', 'Virus', { P: 1, R: 1 }, {
    text: 'Deal 1 to an enemy summon. If it dies, rebuild it in Pepper and Robot on your side.',
    targets: [T.enemy()],
    effect: (c) => {
      const victim = c.summonAt(c.targets[0]);
      if (!victim) return;
      const id = victim.cardId;
      c.damage(c.targets[0], 1);
      if (c.summonAt(c.targets[0])) return;
      const slot = c.emptySlot(c.me);
      const at = c.state.players[c.opp].debt.lastIndexOf(id);
      if (slot === null || at < 0) return;
      c.removeFromDebt(c.opp, at);
      const genId = pepperRobotCopy(id);
      const d = card(genId);
      c.putSummon(c.me, genId, slot, {
        strength: d.strength ?? 1,
        color: 'P',
        hp: d.hp ?? 1,
        asPrinted: true,
      });
    },
  }),

  // --- Pepper and Oil -------------------------------------------------------
  rp.summon(2, 'falsehumanity', 'False Humanity', ['Mortal', 'Spirit'], {
    str: 2,
    hp: 3,
    text: 'Deathrattle: Deal 2 to the enemy leader.',
    triggers: {
      onDeath: (c) => c.damage({ kind: 'leader', player: c.opp }, 2),
    },
    powers: [
      {
        name: 'Haunt',
        cost: { P: 1, O: 1 },
        text: 'Deal 2 to the enemy leader.',
        sapSelf: true,
        effect: (c) => c.damage({ kind: 'leader', player: c.opp }, 2),
      },
    ],
  }),
  rp.summon(3, 'theking', 'The King', ['Mortal'], {
    str: 1,
    hp: 2,
    text: 'Ally Mortals have +2 attack. Deathrattle: Deal 2 debt.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller &&
        def.factions?.includes('Mortal') &&
        summon.cardId !== 'm-rp-theking'
          ? 2
          : 0,
      onDeath: (c) => c.addDebt(c.opp, 2, 'The king does not fall alone.'),
    },
    powers: [
      {
        name: 'Decree',
        cost: { P: 1, O: 2, C: 1 },
        text: "An ally gains this card's Deathrattle.",
        sapSelf: true,
        targets: [
          {
            kind: 'summon',
            side: 'ally',
            label: 'an ally summon',
            filter: (a) => a.card?.id !== 'm-rp-theking',
          },
        ],
        effect: (c) => {
          const s = c.summonAt(c.targets[0]);
          if (s) s.bestowed = 'm-rp-theking';
        },
      },
    ],
  }),
  rp.spell('alchemy', 'Alchemy', { P: 1, O: 1 }, {
    text: 'Put a card from your hand under an ally as HP, then draw 2 cards.',
    targets: [T.allyOrLeader(), T.handCard('a card to spend as armor')],
    effect: (c) => {
      const h = c.targets[1];
      if (h?.kind === 'hand') c.stackHp(c.targets[0], h.index);
      c.draw(c.me, 2);
    },
  }),
  rp.spell('annihilate', 'Annihilate', { P: 1, O: 2 }, {
    text: 'Annihilate an enemy summon. Its Deathrattle does not fire and it never reaches their debt.',
    targets: [T.enemy()],
    effect: (c) => c.annihilate(c.targets[0]),
  }),
  rp.spell('greedandfear', 'Greed and Fear', { P: 1, O: 1 }, {
    text: 'Draw 3 cards, then take 1 debt.',
    effect: (c) => {
      c.draw(c.me, 3);
      c.addDebt(c.me, 1, 'Greed has a price.');
    },
  }),

  // --- Solar and Fish --------------------------------------------------------
  yb.summon(2, 'livingriver', 'Living River', ['Living', 'Fish'], {
    str: 1,
    hp: 5,
    text: 'At the start of your turn, each of your characters heals 1.',
    triggers: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me, true)) c.unflip(ref, 1);
      },
    },
    powers: [
      {
        name: 'Flow',
        cost: { S: 1, F: 1 },
        text: 'Heal an ally for 2.',
        sapSelf: true,
        targets: [T.allyOrLeader()],
        effect: (c) => c.unflip(c.targets[0], 2),
      },
    ],
  }),
  yb.summon(3, 'themoon', 'The Moon', ['Star'], {
    str: 1,
    hp: 5,
    text: 'Your Stars have +1 attack. At the start of your turn, your leader heals 1.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Star') ? 1 : 0,
      onAwake: (c) => c.unflip({ kind: 'leader', player: c.me }, 1),
    },
    powers: [
      {
        name: 'Moonrise',
        cost: { S: 2, F: 1 },
        text: 'Deal 3 debt.',
        sapSelf: true,
        effect: (c) => c.addDebt(c.opp, 3),
      },
    ],
  }),
  yb.summon(3, 'ambrosia', 'Ambrosia', ['Living', 'Star'], {
    str: 2,
    hp: 5,
    text: 'Battlecry: Each of your characters gains 2 HP.',
    triggers: {
      onEnter: (c) => {
        for (const ref of c.summonsOf(c.me, true)) c.reinforce(ref, 2);
      },
    },
    powers: [
      {
        name: 'Nectar',
        cost: { S: 1, F: 1 },
        text: 'Heal your leader for 2, then draw a card.',
        sapSelf: true,
        effect: (c) => {
          c.unflip({ kind: 'leader', player: c.me }, 2);
          c.draw(c.me, 1);
        },
      },
    ],
  }),
  yb.spell('fishsong', 'Fish Song', { S: 1, F: 1 }, {
    text: 'Scry 6 for a Fish or a Living card, then draw a card.',
    effect: (c) => {
      c.dig(c.me, 6, (d) => !!d.factions?.includes('Fish') || !!d.factions?.includes('Living'));
      c.draw(c.me, 1);
    },
  }),
  yb.spell('skypaint', 'Skypaint', { S: 1, F: 1 }, {
    text: 'Heal an ally for 4.',
    targets: [T.allyOrLeader()],
    effect: (c) => c.unflip(c.targets[0], 4),
  }),

  // --- Solar and Machine -----------------------------------------------------
  yg.summon(2, 'krazbot', 'Krazbot', ['Machine', 'Living'], {
    str: 2,
    hp: 1,
    text: 'Whenever you play a Machine or a Hedron, draw a card.',
    triggers: {
      onSummonPlayed: (c) => {
        const played = c.summonAt(c.targets[0]);
        if (!played || played.owner !== c.me) return;
        const f = card(played.cardId).factions;
        if (f?.includes('Machine') || f?.includes('Hedron')) c.draw(c.me, 1);
      },
    },
    powers: [
      {
        name: 'Pragmist Power',
        cost: { S: 1, R: 1 },
        text: 'Unsap an ally summon, then pay off 1 debt.',
        sapSelf: true,
        targets: [
          {
            kind: 'summon',
            side: 'ally',
            label: 'a sapped ally summon',
            filter: (a) => !!a.summon?.sapped,
          },
        ],
        effect: (c) => c.unsap(c.targets[0]),
      },
    ],
  }),
  yg.summon(2, 'pilgrim', 'Pilgrim', ['Mortal', 'Hedron'], {
    str: 3,
    hp: 4,
    text: 'At the start of your turn, put the top card of your deck under it as HP.',
    triggers: {
      onAwake: (c) => {
        const me = selfRef(c);
        if (me) c.reinforce(me, 1);
      },
    },
    powers: [
      {
        name: 'Aetus Spent',
        cost: { S: 1, R: 1 },
        text: "Move 2 of this character's HP cards to an ally, then draw a card.",
        sapSelf: true,
        targets: [T.allyOrLeader()],
        effect: (c) => {
          const me = selfRef(c);
          if (me) c.moveHp(me, c.targets[0], 2);
          c.draw(c.me, 1);
        },
      },
    ],
  }),
  yg.summon(3, 'hedronicgateway', 'Hedronic Gateway', ['Hedron'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Your other Hedrons gain +1/+1. Arrives sapped.',
    triggers: {
      onEnter: (c) => {
        for (const ref of c.summonsOf(c.me, true)) {
          const s = c.summonAt(ref);
          if (!s || s === c.source) continue;
          if (!card(s.cardId).factions?.includes('Hedron')) continue;
          c.buffStrength(ref, 1, 'permanent');
          c.reinforce(ref, 1);
        }
        const me = selfRef(c);
        if (me) c.sap(me);
      },
    },
    powers: [
      {
        name: 'Open Gate',
        cost: { S: 1, R: 1 },
        text: 'Deal damage to a character equal to the number of Hedrons under your control.',
        sapSelf: true,
        targets: [T.anyOrLeader('a character')],
        effect: (c) => c.damage(c.targets[0], c.countFaction(c.me, 'Hedron')),
      },
    ],
  }),
  yg.spell('hedronshard', 'Hedron Shard', { S: 1, R: 1 }, {
    text: 'Put the top 3 cards of your deck under an ally as HP.',
    targets: [T.allyOrLeader()],
    effect: (c) => c.reinforce(c.targets[0], 3),
  }),
  yg.stage('pragmistlaw', 'Field: Pragmist Law', { S: 1, R: 1 }, {
    text: 'At the start of your turn, an ally gains 1 HP off your deck.',
    stageHooks: {
      onAwake: (c) => {
        c.choose('gain-hp-1', c.summonsOf(c.me, true), 'Which ally gains 1 HP?');
      },
    },
  }),

  // --- Solar and Oil ---------------------------------------------------------
  yp.summon(2, 'gardener', 'The Gardener', ['Spirit'], {
    str: 1,
    hp: 4,
    text: 'At the start of your turn, an ally heals 1.',
    triggers: {
      onAwake: (c) => {
        const refs = c.summonsOf(c.me, true).filter((ref) => {
          const s = c.summonAt(ref);
          return !!s && s.hp.some((h) => h.flipped);
        });
        c.choose('heal-1', refs, 'Heal which ally for 1?');
      },
    },
    powers: [
      {
        name: 'Prune',
        cost: { S: 1, O: 1 },
        text: 'Put a Wound on an enemy summon and heal an ally for 1.',
        sapSelf: true,
        targets: [T.enemy(), T.allyOrLeader()],
        effect: (c) => {
          c.wound(c.targets[0], 1);
          c.unflip(c.targets[1], 1);
        },
      },
    ],
  }),
  yp.summon(2, 'molly', 'Molly', ['Hedron'], {
    str: 2,
    hp: 4,
    powers: [
      {
        name: 'Eternal Rest',
        cost: { O: 1, S: 1 },
        text: "Annihilate 10 cards from the enemy's discard pile.",
        effect: (c) => {
          c.annihilateDiscard(c.opp, 10);
        },
      },
      {
        name: 'Parthult Aid',
        cost: {},
        text: 'Draw a random card from your discard pile.',
        sapSelf: true,
        effect: (c) => {
          if (!c.drawRandomFromDiscard(c.me)) c.log('The pile is empty.');
        },
      },
      {
        name: 'Interment',
        cost: { O: 1 },
        text: 'Pay off 2 debt.',
        sapSelf: true,
        effect: (c) => c.clearDebt(c.me, 2),
      },
    ],
  }),
  yp.summon(3, 'm-xalbriss', 'M-Xalbriss', ['Spirit', 'Star'], {
    str: 3,
    hp: 5,
    powers: [
      {
        name: 'Anti-Abstraction',
        cost: { S: 1, O: 1 },
        text: 'Move 1 of your debt onto your opponent.',
        sapSelf: true,
        effect: (c) => {
          if (c.state.players[c.me].debtCount === 0) {
            c.log('Nothing owed, nothing to pass on.');
            return;
          }
          c.clearDebt(c.me, 1);
          c.addDebt(c.opp, 1, 'The reckoning changes hands.');
        },
      },
    ],
  }),
  yp.spell('crotalbell', 'Crotal Bell', { S: 1, O: 1 }, {
    text: 'Put a Wound on every summon in play, then return a card from your discard pile to your hand.',
    targets: [
      {
        kind: 'discard',
        side: 'ally',
        label: 'a card in your discard pile',
        optional: true,
      },
    ],
    effect: (c) => {
      for (const ref of [...c.summonsOf(c.me), ...c.summonsOf(c.opp)]) c.wound(ref, 1);
      if (c.targets[0]) c.reclaim(c.targets[0]);
    },
  }),
  yp.spell('parthultfanatic', 'Parthult Fanatic', { S: 1, O: 1 }, {
    text: 'Annihilate one of your summons, then draw 3 cards.',
    targets: [T.ally('one of your summons')],
    effect: (c) => {
      c.annihilate(c.targets[0]);
      c.draw(c.me, 3);
    },
  }),

  // --- Solar and Pepper ------------------------------------------------------
  yr.summon(2, 'scarletbloom', 'Scarlet Bloom', ['Living'], {
    str: 2,
    hp: 3,
    text: 'Deathrattle: Deal 2 to every enemy character.',
    triggers: {
      onDeath: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.damage(ref, 2);
        c.damage({ kind: 'leader', player: c.opp }, 2);
      },
    },
    powers: [
      {
        name: 'Flare',
        cost: { S: 1, P: 1 },
        text: 'Deal 2 to an enemy summon.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 2),
      },
    ],
  }),
  yr.summon(3, 'sasparsol', 'Saspar-Sol', ['Star'], {
    str: 2,
    hp: 5,
    text: 'At the start of your turn, an ally gains +1 attack.',
    triggers: {
      onAwake: (c) => {
        c.choose('buff-1', c.summonsOf(c.me, true), 'Which ally gains +1 attack?');
      },
    },
    powers: [
      {
        name: 'Lifesong',
        cost: { P: 2, S: 1 },
        text: 'Play a spell from your hand as a 2/1 summon, with twice its cost added as HP and its effect as a free Power.',
        targets: [T.handCard('a spell in your hand', (t) => t === 'spell')],
        effect: (c) => {
          const ref = c.targets[0];
          if (!ref || ref.kind !== 'hand') return;
          const slot = c.emptySlot(c.me);
          if (slot === null) {
            c.log('No open slot for the lifesong.');
            return;
          }
          const id = c.takeFromHand(c.me, ref.index);
          if (!id) return;
          // A 2/1 floor means a free spell still arrives as a body.
          const hp = 1 + costTotal(card(id).cost) * 2;
          const genId = livingSummon(id, { strength: 2, hp, level: 1, free: true });
          c.state.players[c.me].discard.push(id);
          c.putSummon(c.me, genId, slot, { strength: 2, color: 'S', hp, asPrinted: true });
        },
      },
    ],
  }),
  yr.summon(2, 'livingspell', 'Living Spell', ['Living', 'Spirit'], {
    str: 0,
    hp: 5,
    text: 'Scry 6 for a spell, if any are found, gain its Mana cost as attack, and gain its effect as a power, then discard the spell.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (!me) return;
        c.dig(c.me, 6, (d) => d.type === 'spell' && !!d.effect, {
          effect: 'living-spell',
          prompt: 'Become a spell',
          at: me,
        });
      },
    },
    powers: [
      {
        name: 'Charge',
        cost: { P: 1, S: 1 },
        text: 'Your next spell has +1 effect this turn.',
        effect: (c) => c.grantSpellBonus(1),
      },
    ],
  }),
  yr.spell('burnsong', 'Burnsong', { S: 1, P: 1 }, {
    text: 'Deal 3 to an enemy summon, then each of your characters gains +1 attack until end of turn.',
    targets: [T.enemy()],
    effect: (c) => {
      c.damage(c.targets[0], 3);
      for (const ref of c.summonsOf(c.me, true)) c.buffStrength(ref, 1, 'turn');
    },
  }),
  yr.stage('sasparsparadise', "Field: Saspar's Paradise", { S: 1, P: 1 }, {
    text: 'Your Living allies have +1 attack.',
    stageHooks: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Living') ? 1 : 0,
    },
  }),
  // --- Oil and Robot: corrosion, wounds and rust -----------------------------
  pg.summon(3, 'Slimewitch', 'Slimewitch', ['Spirit', 'Machine'], {
    str: 3,
    hp: 4,
    cursePotency: true,
    text: "Rot and Dread in the enemy's deck have double effect.",
    powers: [
      {
        name: 'Corrupt',
        cost: { O: 2 },
        text: "Shuffle 2 Rot into the enemy's deck.",
        sapSelf: true,
        effect: (c) => c.curse(c.opp, 'o-curse-rot', 2),
      },
      {
        name: 'Ferment',
        cost: { O: 1, R: 1 },
        text: "Shuffle 1 Rot and 1 Dread into the enemy's deck.",
        sapSelf: true,
        effect: (c) => {
          c.curse(c.opp, 'o-curse-rot', 1);
          c.curse(c.opp, 'o-curse-dread', 1);
        },
      },
    ],
  }),
  pg.summon(3, 'Cybergore', 'Cybergore', ['Machine', 'Spirit'], {
    str: 2,
    hp: 3,
    text: 'Strike: The defender loses 2 attack.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (d) c.buffStrength(d, -2, 'permanent');
      },
    },
    powers: [
      {
        name: 'Rend',
        cost: { O: 1, R: 1 },
        text: 'An enemy summon loses 2 attack and takes a Wound.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => {
          c.buffStrength(c.targets[0], -2, 'permanent');
          c.wound(c.targets[0], 1);
        },
      },
    ],
  }),
  pg.summon(2, 'AncientVirus', 'Ancient Virus', ['Machine', 'Spirit'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Propagate',
        cost: { O: 1, R: 1 },
        text: 'Put a Wound on every enemy summon.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp)) c.wound(ref, 1);
        },
      },
    ],
  }),
  pg.spell('vilebrew', 'Vile Brew', { O: 1, R: 1 }, {
    text: 'Put 3 Wounds on an enemy summon, then draw a card.',
    targets: [T.enemy()],
    effect: (c) => {
      c.wound(c.targets[0], 3);
      c.draw(c.me, 1);
    },
  }),
  pg.stage('Doortonowhere', 'Field: Door to Nowhere', { O: 1, R: 1 }, {
    text: 'All enemies have -1 attack.',
    stageHooks: {
      strengthBonus: ({ controller, summon }) => (summon.owner === controller ? 0 : -1),
    },
  }),

  // --- Candy and Fish: the shop floor and the water ---------------------------
  mb.summon(2, 'CandyCraver', 'Candy Craver', ['Mortal'], {
    str: 2,
    hp: 3,
    text: 'Whenever you buy from a Store, draw a card.',
    triggers: {
      onStoreBought: (c) => c.draw(c.me, 1),
    },
    powers: [
      {
        name: 'Sweet Tooth',
        cost: { K: 1, F: 1 },
        text: 'Gain 1 Love, then draw a card.',
        sapSelf: true,
        effect: (c) => {
          c.gainLove(c.me, 1);
          c.draw(c.me, 1);
        },
      },
    ],
  }),
  mb.summon(2, 'CandyFish', 'Candy Fish', ['Saccharine', 'Fish'], {
    str: 2,
    hp: 4,
    powers: [
      {
        name: 'Bubblegum Stream',
        cost: { K: 1, F: 1 },
        text: 'Scry 3 for a Fish or a Saccharine.',
        sapSelf: true,
        effect: (c) => {
          c.dig(
            c.me,
            3,
            (d) => !!d.factions?.includes('Fish') || !!d.factions?.includes('Saccharine'),
          );
        },
      },
    ],
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  bm.summon(3, 'loanshark', 'Loanshark', ['Fish', 'Beast'], {
    str: 3,
    hp: 5,
    debtAmplify: true,
    text: 'Whenever a player takes debt, they take 1 more.',
    powers: [
      {
        name: 'Collect',
        cost: { K: 1, F: 1 },
        text: 'Deal 1 debt.',
        sapSelf: true,
        effect: (c) => c.addDebt(c.opp, 1, 'The loanshark collects.'),
      },
    ],
  }),
  mb.spell('IcecubeCandy', 'Icecube Candy', { K: 1, F: 1 }, {
    text: 'Shuffle 8 cards from your discard pile into your deck. Draw a card.',
    effect: (c) => {
      c.recycleDiscard(c.me, 8);
      c.draw(c.me, 1);
    },
  }),
  mb.spell('TropicalBlueDrink', 'Tropical Blue Drink', { K: 1, F: 1 }, {
    text: 'Heal an ally for 3. Love: Heal 1 more.',
    targets: [T.allyOrLeader()],
    effect: (c) => {
      const n = c.spendLove(c.me);
      c.unflip(c.targets[0], 3 + n);
    },
  }),

  // --- Candy and Robot: the graduate scheme ----------------------------------
  mg.summon(2, 'CuriousPilgrim', 'Curious Pilgrim', ['Mortal', 'Hedron'], {
    str: 2,
    hp: 4,
    text: 'Store: Scry 2 for any card.',
    store: {
      useful: (state, user) => state.players[user].deck.length > 0,
      effect: (c) => c.dig(c.me, 2, () => true),
    },
    powers: [
      {
        name: 'Wander',
        cost: { K: 1, R: 1 },
        text: 'Draw a card, then heal 1 debt.',
        sapSelf: true,
        effect: (c) => {
          c.draw(c.me, 1);
          c.clearDebt(c.me, 1);
        },
      },
    ],
  }),
  mg.summon(2, 'NewGrad', 'New Grad', ['Mortal', 'Scholar'], {
    str: 2,
    hp: 3,
    text: "Store: Draw the top card of another player's deck, rebuilt in Robot with its cost turned colorless.",
    store: {
      // The deck is named by its owner's leader, the way Loan names a player.
      targets: [
        {
          kind: 'summon',
          side: 'enemy',
          includeLeader: true,
          label: 'a player, by their leader',
          filter: (a) => a.ref.kind === 'leader',
        },
      ],
      useful: (state, user) =>
        livingOpponents(state, user).some((p) => state.players[p].deck.length > 0),
      effect: (c) => {
        const t = c.targets[0];
        if (t?.kind !== 'leader') return;
        const id = c.state.players[t.player].deck.shift();
        if (!id) {
          c.log('That deck is empty.');
          return;
        }
        c.toHand(c.me, robotColorlessCopy(id));
      },
    },
    powers: [
      {
        name: 'Job Application Fees',
        cost: { K: 1, R: 1 },
        text: 'Draw 2 cards, then take 1 debt.',
        sapSelf: true,
        effect: (c) => {
          c.draw(c.me, 2);
          c.addDebt(c.me, 1, 'The hours are billed back.');
        },
      },
    ],
  }),
  mg.spell('AbsurdlySourCandy', 'Absurdly Sour Candy', { K: 1, R: 1 }, {
    text: 'Deal 2 to an enemy summon and it loses 2 attack.',
    targets: [T.enemy()],
    effect: (c) => {
      c.damage(c.targets[0], 2);
      c.buffStrength(c.targets[0], -2, 'permanent');
    },
  }),
  mg.spell('CandyVirus', 'Candy Virus', { K: 1, R: 1 }, {
    text: 'Deal 2 to an enemy summon. If it dies, gain 2 Love.',
    targets: [T.enemy()],
    effect: (c) => {
      c.damage(c.targets[0], 2);
      if (!c.summonAt(c.targets[0])) c.gainLove(c.me, 2);
    },
  }),
  mg.spell('HedronFragments', 'Hedron Fragments', { K: 1, R: 1 }, {
    text: 'Each of your summons gains 1 HP off your deck. Affected summons are permanently Hedrons.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.me)) {
        c.reinforce(ref, 1);
        const s = c.summonAt(ref);
        if (!s || card(s.cardId).factions?.includes('Hedron')) continue;
        c.transform(ref, hedronCopy(s.cardId));
      }
    },
  }),

  // --- Candy and Oil: the toll and the bones ---------------------------------
  mp.summon(3, 'LenAphelion', 'Len-Aphelion', ['Spirit', 'Scholar'], {
    str: 2,
    hp: 5,
    text: 'Your Beasts have +1 attack. At the start of your turn, Scry 2 for any card.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Beast') ? 1 : 0,
      onAwake: (c) => c.dig(c.me, 2, () => true),
    },
    powers: [
      {
        name: 'Umbral Slash',
        cost: { K: 1, O: 1 },
        text: 'Deal 1 to every enemy summon, and gain 1 Love for each that dies.',
        sapSelf: true,
        effect: (c) => {
          // Every seat, not just one: "every enemy" reaches the whole party.
          const refs = livingOpponents(c.state, c.me).flatMap((foe) => c.summonsOf(foe));
          for (const ref of refs) c.damage(ref, 1);
          let dead = 0;
          for (const ref of refs) {
            if (!c.summonAt(ref)) dead++;
          }
          if (dead > 0) c.gainLove(c.me, dead);
        },
      },
    ],
  }),
  mp.summon(2, 'PairOfCritters', 'Pair of Critters', ['Saccharine', 'Beast'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Gain 1 Love. Deathrattle: Gain 1 Love.',
    triggers: {
      onEnter: (c) => c.gainLove(c.me, 1),
      onDeath: (c) => c.gainLove(c.me, 1),
    },
    powers: [
      {
        name: 'Nibble',
        cost: { K: 1, O: 1 },
        text: 'Put a Wound on every enemy summon.',
        sapSelf: true,
        effect: (c) => {
          for (const foe of livingOpponents(c.state, c.me)) {
            for (const ref of c.summonsOf(foe)) c.wound(ref, 1);
          }
        },
      },
    ],
  }),
  mp.spell('MarkOfTheFalseKing', 'Mark of the False King', { K: 1, O: 1 }, {
    text: 'An enemy summon loses 2 attack. Its controller takes 1 debt.',
    targets: [T.enemy()],
    effect: (c) => {
      const t = c.targets[0];
      c.buffStrength(t, -2, 'permanent');
      if (t?.kind === 'summon') c.addDebt(t.player, 1, 'The false king marks his own.');
    },
  }),
  mp.spell('RottenCandy', 'Rotten Candy', { K: 1, O: 1 }, {
    text: "Shuffle 3 Rot into the enemy's deck. Gain 1 Love.",
    effect: (c) => {
      c.curse(c.opp, 'o-curse-rot', 3);
      c.gainLove(c.me, 1);
    },
  }),
  mp.spell('SoldBones', 'Sold Bones', { K: 1, O: 1 }, {
    text: 'Return a summon from your discard pile to your hand. Gain 1 Love.',
    targets: [
      {
        kind: 'discard',
        side: 'ally',
        label: 'a summon in your discard pile',
        optional: true,
        filter: (a) => a.card?.type === 'summon',
      },
    ],
    effect: (c) => {
      if (c.targets[0]) c.reclaim(c.targets[0]);
      c.gainLove(c.me, 1);
    },
  }),

  // --- Candy and Pepper: the stall that sells heat ----------------------------
  mr.summon(2, 'CandyAxeman', 'Candy Axeman', ['Saccharine', 'Mortal'], {
    str: 3,
    hp: 3,
    text: 'Strike: Gain 1 Love.',
    triggers: {
      onAttack: (c) => c.gainLove(c.me, 1),
    },
    powers: [
      {
        name: 'Chop',
        cost: { K: 1, P: 1 },
        text: 'Deal 2 to an enemy summon.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 2),
      },
    ],
  }),
  rm.summon(3, 'RedSweets', 'Red Sweets', ['Mortal', 'Scholar'], {
    str: 3,
    hp: 4,
    text: 'Store: Take any card from your deck into your hand. Store costs +8. Leader: Store costs 5 less.',
    store: {
      surcharge: 8,
      leaderDiscount: 5,
      useful: (state, user) => state.players[user].deck.length > 0,
      effect: (c) => c.search(c.me, () => true),
    },
    powers: [
      {
        name: 'Pummel',
        cost: { K: 1, P: 1 },
        text: 'Deal 1 to a character and gain 1 Love.',
        sapSelf: true,
        targets: [T.anyOrLeader('a character')],
        effect: (c) => {
          c.damage(c.targets[0], 1);
          c.gainLove(c.me, 1);
        },
      },
    ],
  }),
  mr.spell('AbsurdlySpicyCandy', 'Absurdly Spicy Candy', { K: 2, P: 2 }, {
    text: 'Deal 1 to a character. Love: Effect Damage +1.',
    targets: [T.anyOrLeader('a character')],
    effect: (c) => {
      const n = c.spendLove(c.me);
      c.damage(c.targets[0], 1 + n);
    },
  }),
  mr.spell('DeflateCurrency', 'Deflate Currency', { K: 1, P: 1 }, {
    text: 'Deal 2 debt, then gain 1 Love.',
    effect: (c) => {
      c.addDebt(c.opp, 2);
      c.gainLove(c.me, 1);
    },
  }),
  mr.spell('RedTape', 'Red Tape', { K: 1, P: 1 }, {
    text: 'Sap an enemy summon. It does not unsap the next time it would.',
    targets: [T.enemy()],
    effect: (c) => {
      c.sap(c.targets[0]);
      const s = c.summonAt(c.targets[0]);
      if (s) s.sapLock = true;
    },
  }),

  // --- Candy and Solar: the lemonade stand ------------------------------------
  my.summon(2, 'LittleGummyBear', 'Little Gummy Bear', ['Saccharine', 'Beast'], {
    str: 2,
    hp: 4,
    text: 'Battlecry: Gain 1 Love.',
    triggers: {
      onEnter: (c) => c.gainLove(c.me, 1),
    },
    powers: [
      {
        name: 'Squish',
        cost: { K: 1, S: 1 },
        text: 'Heal a character for 3.',
        sapSelf: true,
        targets: [damagedCharacter('a character to heal')],
        effect: (c) => {
          if (c.targets[0]) c.unflip(c.targets[0], 3);
        },
      },
    ],
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  my.summon(3, 'PinkLemonader', 'Pink Lemonader', ['Beast'], {
    str: 3,
    hp: 4,
    text: 'Store: Each of your summons heals 4.',
    store: {
      useful: (state, user) =>
        state.players[user].slots.some((s) => !!s && s.hp.some((h) => h.flipped)),
      effect: (c) => {
        for (const ref of c.summonsOf(c.me)) c.unflip(ref, 4);
      },
    },
    powers: [
      {
        name: 'Fresh Squeeze',
        cost: { K: 1, S: 1 },
        text: 'Heal your leader for 2 and gain 1 Love.',
        sapSelf: true,
        effect: (c) => {
          c.unflip({ kind: 'leader', player: c.me }, 2);
          c.gainLove(c.me, 1);
        },
      },
    ],
  }),
  my.spell('CandySun', 'Candy Sun', { K: 1, S: 1 }, {
    text: 'Each of your characters heals 2, then gain 2 Love.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.me, true)) c.unflip(ref, 2);
      c.gainLove(c.me, 2);
    },
  }),
  my.spell('MoltenCandyBolt', 'Molten Candy Bolt', { K: 1, S: 1 }, {
    text: 'Deal 3 to a summon, then heal an ally for 2.',
    targets: [T.any(), T.allyOrLeader()],
    effect: (c) => {
      c.damage(c.targets[0], 3);
      c.unflip(c.targets[1], 2);
    },
  }),
  my.spell('SourSoda', 'Sour Soda', { K: 1, S: 1 }, {
    text: 'Unsap an ally summon, then heal it for 3.',
    targets: [
      {
        kind: 'summon',
        side: 'ally',
        label: 'a sapped ally summon',
        filter: (a) => !!a.summon?.sapped,
      },
    ],
    effect: (c) => {
      c.unsap(c.targets[0]);
      c.unflip(c.targets[0], 3);
    },
  }),
];

// Living Spell's other half: the picked spell is discarded and the body becomes
// a freshly minted summon of that spell, carrying its cost as attack.
registerChoiceResolver('living-spell', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  const p = state.players[choice.player];
  if (pick.index !== undefined && choice.at) {
    const [id] = cards.splice(pick.index, 1);
    const self = findSummon(state, choice.at);
    if (!self) toHand(state, choice.player, id);
    else {
      p.discard.push(id);
      self.cardId = livingSummon(id, { strength: costTotal(card(id).cost), hp: 6, level: 2 });
      log(state, choice.player, `${card(id).name} stands up and looks around.`);
    }
  }
  p.deck.push(...cards);
});
