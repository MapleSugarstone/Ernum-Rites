import { battleAttacker, strengthOf } from '../engine/state';
import type { CardDef } from '../engine/types';
import { T, colorKit, holderRef, selfRef } from './build';

// Yellow is Solar: Living things, Stars, ramp, and buffs that stick.
const k = colorKit('S', 's', 'Yellow', 'Yellow/spells');

export const yellowCards: CardDef[] = [
  k.starter('thejudge', 'The Judge', ['Star', 'Mortal'], {
    str: 5,
    hp: 3,
    powers: [
      {
        name: 'Reincarnate',
        cost: { S: 1 },
        text: 'Draw a card.',
        sapSelf: true,
        effect: (c) => c.draw(c.me, 1),
      },
      {
        name: 'Verdict',
        cost: { S: 2 },
        text: 'An ally gains +2 attack.',
        sapSelf: true,
        targets: [T.allyOrLeader()],
        effect: (c) => c.buffStrength(c.targets[0], 2, 'permanent'),
      },
    ],
  }),

  // --- level 1 --------------------------------------------------------------
  k.summon(1, 'fluterat', 'Flute Rat', ['Beast', 'Living'], {
    str: 1,
    hp: 2,
    flipText: 'Mill 1: draw 2 cards.',
    flipCost: { mill: 1 },
    // One card left is the mill itself, and the draw behind it would be off an
    // empty deck: paying that costs debt rather than buying a card.
    flipUseful: (c) => c.deckLeft(c.me) >= 2,
    flip: (c) => c.draw(c.me, 2),
  }),
  k.summon(1, 'livingboot', 'Living Boot', ['Living'], { str: 2, hp: 4,
    flipText: 'The attached character gains 2 HP.',
    flip: (c) => c.reinforce(holderRef(c), 2),
  }),
  k.summon(1, 'livingflowers', 'Living Flowers', ['Living'], {
    text: 'Battlecry: Heal an ally 3.',
    targets: [T.allyOrLeader()],
    triggers: { onEnter: (c) => { if (c.targets[0]) c.unflip(c.targets[0], 3); } },
    str: 1,
    hp: 2,
    flipText: 'The attached character gains 2 HP.',
    flip: (c) => c.reinforce(holderRef(c), 2),
  }),
  k.summon(1, 'livingraincloud', 'Living Raincloud', ['Living', 'Star'], {
    str: 0,
    hp: 4,
    text: 'At the start of your turn, an ally heals 2. Battlecry: Heal an ally for 2.',
    targets: [
      {
        kind: 'summon',
        side: 'ally',
        includeLeader: true,
        label: 'an ally with flipped HP',
        filter: (a) => !!a.summon && a.summon.hp.some((h) => h.flipped),
      },
    ],
    triggers: {
      onEnter: (c) => {
        if (c.targets[0]) c.unflip(c.targets[0], 2);
      },
      onAwake: (c) => {
        const refs = c.summonsOf(c.me, true).filter((ref) => {
          const s = c.summonAt(ref);
          return !!s && s.hp.some((h) => h.flipped);
        });
        c.choose('heal-2', refs, 'Heal which ally for 2?');
      },
    },
    flipText: 'Heal the attached character for 2.',
    flipCost: { mana: { S: 1 } },
    flip: (c) => c.unflip(holderRef(c), 2),
  }),
  k.summon(1, 'livingrock', 'Living Rock', ['Living'], { str: 1, hp: 5,
    flipText: 'The attached character gains +1 attack.',
    flip: (c) => c.buffStrength(holderRef(c), 1, 'permanent'),
  }),
  k.summon(1, 'livingsong', 'Living Song', ['Living'], {
    hp: 2,
    str: 1,
    text: 'Battlecry: You may play another supporter this turn.',
    triggers: {
      onEnter: (c) => {
        c.state.players[c.me].supportersLeft += 1;
        c.log('The song frees another supporter drop.');
      },
    },
    flipText: 'Destroy the attached summon, and the top card of your deck becomes a supporter.',
    flipCost: { mana: { S: 1 } },
    // With nothing left to feed the row it is a body destroyed for nothing.
    flipUseful: (c) => c.deckLeft(c.me) > 0,
    flip: (c) => {
      c.supporterFromDeck(c.me, false);
      // Named 'the attached summon': a leader is never the thing it eats.
      if (!c.holder.isLeader) c.destroyHolder();
    },
  }),
  k.summon(1, 'livingtree', 'Living Tree', ['Living'], {
    str: 1,
    hp: 4,
    text: 'Ally Living have +1 attack.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller &&
        def.factions?.includes('Living') &&
        summon.cardId !== 's1-livingtree'
          ? 1
          : 0,
    },
  }),
  k.summon(1, 'shrubbunny', 'Shrub Bunny', ['Living', 'Beast'], {
    text: 'Battlecry: Shuffle the top card of your discard pile into your deck.',
    triggers: { onEnter: (c) => { c.recycleTopDiscard(c.me); } },
    str: 1,
    hp: 2,
    flipText: 'The attached character gains 2 HP.',
    flip: (c) => c.reinforce(holderRef(c), 2),
  }),
  k.summon(1, 'starbird', 'Starbird', ['Star', 'Beast'], {
    str: 2,
    hp: 2,
    text: 'Deathrattle: Draw a card.',
    triggers: { onDeath: (c) => c.draw(c.me, 1) },
    flipText: 'Destroy the attached summon, and the top card of your deck becomes a sapped supporter.',
    flipCost: { mana: { S: 1 } },
    // With nothing left to feed the row it is a body destroyed for nothing.
    flipUseful: (c) => c.deckLeft(c.me) > 0,
    flip: (c) => {
      c.supporterFromDeck(c.me);
      // Named 'the attached summon': a leader is never the thing it eats.
      if (!c.holder.isLeader) c.destroyHolder();
    },
  }),
  k.summon(1, 'starsprite', 'Star Sprite', ['Star', 'Spirit'], {
    hp: 2,
    str: 1,
    powers: [
      {
        name: 'Twinkle',
        cost: { S: 1 },
        text: 'An ally gains +2 attack until end of turn.',
        targets: [T.allyOrLeader()],
        effect: (c) => c.buffStrength(c.targets[0], 2, 'turn'),
      },
    ],
  }),

  // --- level 2 --------------------------------------------------------------
  k.summon(2, 'admirer', 'The Admirer', ['Mortal'], {
    hp: 3,
    str: 2,
    text: 'Battlecry: An ally gains +2 attack.',
    targets: [T.ally()],
    triggers: {
      onEnter: (c) => {
        if (c.targets[0]) c.buffStrength(c.targets[0], 2, 'permanent');
      },
    },
    powers: [
      {
        name: 'Devotion',
        cost: { S: 1 },
        text: 'Heal an ally 2.',
        sapSelf: true,
        targets: [T.allyOrLeader()],
        effect: (c) => {
          c.unflip(c.targets[0], 2);
        },
      },
    ],
  }),
  k.summon(2, 'bubblemancer', 'Bubblemancer', ['Mortal', 'Scholar'], {
    hp: 3,
    str: 3,
    powers: [
      {
        name: 'Bubble',
        cost: { S: 1 },
        text: 'An ally gains 2 HP off your deck.',
        targets: [T.allyOrLeader()],
        effect: (c) => c.reinforce(c.targets[0], 2),
      },
      {
        name: 'Bubblewave',
        cost: { S: 1 },
        text: 'Deal 1 damage to all enemy summons.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
        },
      },
    ],
  }),
  k.summon(2, 'bugleist', 'Bugleist', ['Mortal'], {
    str: 1,
    hp: 4,
    text: 'At the start of your turn, each of your characters gains +1 attack until end of turn and heals 1.',
    triggers: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me, true)) {
          c.buffStrength(ref, 1, 'turn');
          c.unflip(ref, 1);
        }
      },
    },
  }),
  k.summon(2, 'druid', 'Druid', ['Mortal', 'Scholar'], {
    hp: 3,
    str: 3,
    powers: [
      {
        name: 'Grow',
        cost: { S: 1 },
        text: 'Scry 4 for a Living card.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 4, (d) => !!d.factions?.includes('Living'));
        },
      },
      {
        name: 'Pacify Mind',
        cost: { S: 2 },
        text: 'Destroy an enemy summon with 3 or more attack.',
        sapSelf: true,
        targets: [
          {
            kind: 'summon',
            side: 'enemy',
            label: 'an enemy summon with 3 or more attack',
            filter: (a) => !!a.summon && !!a.card && strengthOf(a.summon, a.card) >= 3,
          },
        ],
        effect: (c) => c.destroy(c.targets[0]),
      },
    ],
  }),
  k.summon(2, 'happybard', 'Happy Bard', ['Mortal'], {
    hp: 3,
    str: 3,
    powers: [
      {
        name: 'Standing Ovation',
        cost: { S: 4 },
        text: 'Unsap each of your characters.',
        effect: (c) => {
          for (const ref of c.summonsOf(c.me, true)) c.unsap(ref);
        },
      },
      {
        name: 'Encore',
        cost: { S: 2 },
        text: 'Unsap one of your summons.',
        targets: [T.allyOrLeader()],
        effect: (c) => c.unsap(c.targets[0]),
      },
    ],
  }),
  k.summon(2, 'hiker', 'Hiker', ['Mortal'], {
    hp: 3,
    str: 3,
    text: 'Battlecry: You may play another supporter this turn.',
    triggers: {
      onEnter: (c) => {
        c.state.players[c.me].supportersLeft += 1;
        c.log('The hiker finds another road.');
      },
    },
    powers: [
      {
        name: 'Trailblaze',
        cost: { S: 1 },
        text: 'The top card of your deck becomes a sapped supporter.',
        sapSelf: true,
        effect: (c) => {
          c.supporterFromDeck(c.me);
        },
      },
    ],
    flipText: 'The attached character gains 2 HP.',
    flipCost: { mana: { S: 1 } },
    flipUseful: (c) => c.deckLeft(c.me) > 0 || c.discardLeft(c.me) > 0,
    flip: (c) => c.reinforce(holderRef(c), 2),
  }),
  k.summon(2, 'livingruin', 'Living Ruin', ['Living'], {
    str: 2,
    hp: 5,
    text:
      'Battlecry: Deal 1 to every summon. ' +
      'When an ally summon dies, gain 1 Solar mana this turn.',
    triggers: {
      onEnter: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
        for (const ref of c.summonsOf(c.me)) c.damage(ref, 1);
      },
      onOtherDeath: (c) => {
        if (c.state.dyingOwner !== c.me) return;
        c.state.players[c.me].mana.S += 1;
      },
    },
    powers: [
      {
        name: 'Overgrow',
        cost: { S: 1 },
        text: 'An ally gains 2 HP off your deck.',
        sapSelf: true,
        targets: [T.allyOrLeader()],
        effect: (c) => c.reinforce(c.targets[0], 2),
      },
    ],
  }),
  k.summon(2, 'orangefarmer', 'Orange Farmer', ['Mortal', 'Living'], {
    str: 3,
    hp: 4,
    powers: [
      {
        name: 'Harvest',
        cost: { S: 1 },
        text: 'Draw a card, then put a card from your hand under an ally as HP.',
        targets: [T.allyOrLeader(), T.handCard('a card to spend as armor')],
        effect: (c) => {
          c.draw(c.me, 1);
          const h = c.targets[1];
          if (h?.kind === 'hand') c.stackHp(c.targets[0], h.index);
        },
      },
      {
        name: 'Juice Flood',
        cost: { S: 4 },
        text: 'Deal 3 to every enemy character.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp, true)) c.damage(ref, 3);
        },
      },
    ],
    flipText: 'Heal the attached character for 2.',
    flipCost: { mana: { S: 1 } },
    flip: (c) => c.unflip(holderRef(c), 2),
  }),
  k.summon(2, 'ragick', 'Ragick', ['Spirit', 'Living'], {
    str: 3,
    hp: 4,
    text: 'Strike: Scry 5 for a spell.',
    triggers: {
      onAttack: (c) => {
        c.dig(c.me, 5, (d) => d.type === 'spell');
      },
    },
    flipText: 'Each of your characters gains +2 attack.',
    flipCost: { mana: { S: 2 } },
    flip: (c) => {
      for (const t of c.summonsOf(c.me, true)) c.buffStrength(t, 2, 'permanent');
    },
  }),
  k.summon(2, 'sunwalker', 'Sunwalker', ['Star', 'Mortal'], {
    str: 2,
    hp: 3,
    text: 'Your Stars have +1 attack.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Star') ? 1 : 0,
    },
  }),

  // --- level 3 --------------------------------------------------------------
  k.summon(3, 'aetusvox', 'Aetus Vox', ['Star', 'Scholar'], {
    str: 3,
    hp: 4,
    text: 'At the start of your turn, draw a card.',
    triggers: {
      onAwake: (c) => c.draw(c.me, 1),
    },
    powers: [
      {
        name: 'Comprehension',
        cost: { S: 1 },
        text: 'You may play another supporter this turn.',
        sapSelf: true,
        effect: (c) => {
          c.state.players[c.me].supportersLeft += 1;
        },
      },
    ],
  }),
  k.summon(3, 'brokensun', 'Broken Sun', ['Star'], {
    str: 3,
    hp: 3,
    text: 'Battlecry: Ally summons gain +1 attack.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        for (const ref of c.summonsOf(c.me)) {
          if (JSON.stringify(ref) === JSON.stringify(me)) continue;
          c.buffStrength(ref, 1, 'permanent');
        }
      },
    },
    powers: [
      {
        name: 'Blaze',
        cost: { S: 3 },
        text: 'Deal 2 to a character.',
        sapSelf: true,
        targets: [T.anyOrLeader()],
        effect: (c) => c.damage(c.targets[0], 2),
      },
    ],
  }),
  k.summon(3, 'divergentlight', 'Divergent Light', ['Star'], {
    str: 2,
    hp: 5,
    text: 'When you cast a spell, gains +1 attack.',
    triggers: {
      onSpellCast: (c) => {
        const me = selfRef(c);
        if (me) c.buffStrength(me, 1, 'permanent');
      },
    },
    powers: [
      {
        name: 'Refract',
        cost: { S: 1, C: 1 },
        text: 'Your next spell has +1 effect this turn. Draw a card.',
        sapSelf: true,
        effect: (c) => {
          c.grantSpellBonus(1);
          c.draw(c.me, 1);
        },
      },
    ],
  }),
  k.summon(3, 'goldwild', 'Gold Wild', ['Living', 'Beast'], {
    str: 3,
    hp: 4,
    text:
      'At the start of your turn, the top card of your deck becomes a sapped supporter ' +
      'and you take 1 debt.',
    triggers: {
      onAwake: (c) => {
        c.supporterFromDeck(c.me);
        c.addDebt(c.me, 1, 'The gold runs wild.');
      },
    },
    powers: [
      {
        // Five Solar is the brake, and the body pays for it with itself.
        name: 'Ultimate Novelty',
        cost: { S: 6 },
        text: 'Destroy every enemy summon, then destroy this summon.',
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp)) c.destroy(ref);
          const me = selfRef(c);
          if (me && me.kind !== 'leader') c.destroy(me);
        },
      },
    ],
  }),
  k.summon(3, 'maestro', 'The Maestro', ['Mortal', 'Scholar'], {
    str: 3,
    hp: 5,
    text: 'At the start of your turn, an ally gains 1 HP.',
    triggers: {
      onAwake: (c) => {
        c.choose('gain-hp-1', c.summonsOf(c.me, true), 'Which ally gains 1 HP?');
      },
    },
    powers: [
      {
        name: 'Crescendo',
        cost: { S: 2 },
        text: 'Each of your characters gains +1 attack.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.me, true)) c.buffStrength(ref, 1, 'permanent');
        },
      },
      {
        name: 'Grand Finale',
        cost: { S: 4 },
        text: 'Each of your characters gains +2 attack.',
        effect: (c) => {
          for (const ref of c.summonsOf(c.me, true)) c.buffStrength(ref, 2, 'permanent');
        },
      },
    ],
  }),
  k.summon(3, 'oldgod', 'The Old Gods', ['Star', 'Spirit'], {
    str: 5,
    hp: 5,
    text: 'All allies have +2 attack. Whenever an ally summon dies, you take 3 debt.',
    triggers: {
      strengthBonus: ({ controller, summon }) =>
        summon.owner === controller && summon.cardId !== 's3-oldgod' ? 2 : 0,
      // Billed while it stands, so leading with it is not a way to dodge the price.
      onOtherDeath: (c) => {
        if (c.state.dyingOwner !== c.me) return;
        c.addDebt(c.me, 3, 'The old gods take their tithe.');
      },
    },
  }),
  k.summon(3, 'smallgod', 'The Small God', ['Star', 'Spirit'], {
    str: 3,
    hp: 5,
    text: 'At the start of your turn, an ally gains 2 HP.',
    powers: [
      {
        name: 'Miracle',
        cost: { S: 4 },
        text: 'Fully heal each of your characters.',
        effect: (c) => {
          for (const ref of c.summonsOf(c.me, true)) c.unflip(ref, 99);
        },
      },
    ],
    triggers: {
      onAwake: (c) => {
        c.choose('gain-hp-2', c.summonsOf(c.me, true), 'Which ally gains 2 HP?');
      },
    },
  }),
  k.summon(3, 'solusdetteri', 'Solus Detteri', ['Star', 'Scholar'], {
    str: 3,
    hp: 5,
    powers: [
      {
        name: 'Ascend',
        cost: { S: 1 },
        text: 'Scry 5 for any card.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 5, () => true);
        },
      },
    ],
  }),
  k.summon(3, 'yellowplanet', 'Yellow Planet', ['Star'], {
    str: 2,
    hp: 6,
    redirect: true,
    stationary: true,
    text: 'Redirection. Stationary. At the start of your turn, each of your characters gains 1 HP.',
    triggers: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me, true)) c.reinforce(ref, 1);
      },
    },
  }),

  // --- spells, traps and stages ---------------------------------------------
  k.spell('plusfifty', 'Plus Fifty', { S: 3 }, {
    text: 'An ally gains +9 attack.',
    targets: [T.allyOrLeader()],
    effect: (c) => c.buffStrength(c.targets[0], 9, 'permanent'),
  }),
  k.trap('lemonaid', 'Trap: Lemon Aid', { S: 1 }, {
    spellTrap: true,
    letSpellResolve: true,
    text: 'Spell Trap. Heal each of your characters for 4. The spell still resolves.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.me, true)) c.unflip(ref, 4);
    },
  }),
  k.spell('celebrate', 'Celebrate', {}, {
    text: 'The top card of your deck becomes a sapped supporter, then draw a card. Heal your leader for 2.',
    effect: (c) => {
      c.supporterFromDeck(c.me);
      c.draw(c.me, 1);
      c.unflip({ kind: 'leader', player: c.me }, 2);
    },
  }),
  k.spell('flowerpower', 'Flower Power', { S: 2, C: 1 }, {
    text: 'Each of your characters gains +2 attack.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.me, true)) c.buffStrength(ref, 2, 'permanent');
    },
    flipText: 'Each of your characters gains +2 attack.',
    flipCost: { mana: { S: 2 } },
    flip: (c) => {
      for (const t of c.summonsOf(c.me, true)) c.buffStrength(t, 2, 'permanent');
    },
  }),
  k.spell('inkybook', 'Inky Book', { S: 1 }, {
    text: 'Scry 5 for any card.',
    effect: (c) => {
      c.dig(c.me, 5, () => true);
    },
  }),
  k.spell('aetalglob', 'Aetal Glob', { S: 1, C: 1 }, {
    text: 'Heal an ally for 4 and draw a card.',
    targets: [T.allyOrLeader()],
    effect: (c) => {
      c.unflip(c.targets[0], 4);
      c.draw(c.me, 1);
    },
  }),
  k.spell('aetuscollection', 'Aetus Collection', { S: 1 }, {
    text: 'The top 2 cards of your deck become sapped supporters.',
    effect: (c) => {
      for (let i = 0; i < 2; i++) c.supporterFromDeck(c.me);
    },
  }),
  k.trap('hollowring', 'Trap: Hollow Ring', { S: 1 }, {
    text: 'The attacking summon deals no damage in this battle. Deal 2 to every enemy summon.',
    effect: (c) => {
      const a = battleAttacker(c.state);
      if (a) c.buffStrength(a, -99, 'turn');
      for (const ref of c.summonsOf(c.opp)) c.damage(ref, 2);
    },
  }),
  k.stage('party', 'Field: Party', { S: 4 }, {
    text: 'When played, each of your characters gains +1 attack. At the start of your turn, each of your characters gains +1 attack and heals 1.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.me, true)) c.buffStrength(ref, 1, 'permanent');
    },
    stageHooks: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me, true)) {
          c.buffStrength(ref, 1, 'permanent');
          c.unflip(ref, 1);
        }
      },
    },
    flipText: 'Heal the attached character for 2.',
    flipCost: { mana: { S: 1 } },
    flip: (c) => c.unflip(holderRef(c), 2),
  }),
  k.stage('musicalflow', 'Field: Musical Flow', { S: 1, C: 1 }, {
    text: 'At the start of your turn, you may play an extra supporter.',
    stageHooks: {
      onAwake: (c) => {
        c.state.players[c.me].supportersLeft += 1;
      },
    },
  }),
];
