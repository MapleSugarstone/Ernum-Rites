import { battleAttacker, levelOf } from '../engine/state';
import { card } from '../engine/registry';
import type { CardDef } from '../engine/types';
import { T, holderRef, neutralKit, selfRef } from './build';

// Neutral belongs to no colour, so every deck may run it. Vanilla bodies sit
// at or a point above the colour baseline, because carrying no text is itself
// the price; anything with text sits a point under it instead.
const n = neutralKit();

export const neutralCards: CardDef[] = [
  n.summon(1, 'BeautifulBug', 'Beautiful Bug', ['Beast'], {
    str: 2,
    hp: 4,
  }),
  n.summon(1, 'BucketGuardian', 'Bucket Guardian', ['Hedron'], {
    str: 1,
    hp: 3,
    redirect: true,
    text: 'Redirection.',
  }),
  n.summon(1, 'CorruptGrinkling', 'Corrupt Grinkling', ['Beast'], {
    str: 3,
    hp: 3,
    text: 'Deathrattle: You take 1 debt.',
    triggers: { onDeath: (c) => c.addDebt(c.me, 1) },
  }),
  n.summon(1, 'FishBones', 'Fish Bones', ['Fish'], {
    str: 1,
    hp: 4,
    flipText: 'Shuffle 2 random cards from your discard pile into your deck.',
    flip: (c) => c.recycleDiscard(c.me, 2),
  }),
  n.summon(1, 'LittleBunny', 'Little Bunny', ['Beast'], {
    str: 1,
    hp: 2,
    text: 'Strike: Gains +1 attack.',
    triggers: {
      onAttack: (c) => {
        const me = selfRef(c);
        if (me) c.buffStrength(me, 1, 'permanent');
      },
    },
  }),
  n.summon(1, 'Thing', 'Thing', [], {
    str: 2,
    hp: 3,
    flipText: 'Heal the attached character for 3.',
    flipCost: { mana: { C: 1 } },
    flip: (c) => c.unflip(holderRef(c), 3),
  }),
  n.summon(1, 'Wallguy', 'Wallguy', ['Hedron'], {
    str: 1,
    hp: 7,
    redirect: true,
    stationary: true,
    text: 'Redirection. Stationary.',
  }),
  n.summon(1, 'lizard', 'Lizard', ['Beast'], {
    str: 2,
    hp: 4,
  }),
  n.summon(1, 'mammal', 'Mammal', ['Beast'], {
    str: 2,
    hp: 5,
  }),
  n.summon(1, 'weirdBird', 'Weird Bird', ['Beast'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Scry 2 for any card.',
    triggers: { onEnter: (c) => c.dig(c.me, 2, () => true) },
  }),
  n.summon(2, 'Deedsigner', 'Deedsigner', ['Mortal'], {
    str: 2,
    hp: 2,
    text: 'Battlecry: Heal 1 debt.',
    triggers: { onEnter: (c) => c.clearDebt(c.me, 1) },
  }),
  n.summon(2, 'HonorableKnight', 'Honorable Knight', ['Mortal'], {
    flipText: 'Discard this card, then heal the attached character 1.',
    flip: (c) => {
      if (c.discardThis()) c.unflip(holderRef(c), 1);
    },
    str: 3,
    hp: 3,
  }),
  n.summon(2, 'LesserGrinkle', 'Lesser Grinkle', ['Beast', 'Grinkle'], {
    str: 2,
    hp: 4,
  }),
  n.summon(2, 'LowWizard', 'Low Wizard', ['Mortal', 'Scholar'], {
    str: 3,
    hp: 3,
    flipText: 'Deal 2 to the attacking summon.',
    flip: (c) => {
      const a = battleAttacker(c.state);
      if (a) c.damage(a, 2);
      else c.log('No one to zap.');
    },
  }),
  n.summon(2, 'NobodysFriend', 'Nobody\'s Friend', ['Mortal'], {
    str: 2,
    hp: 4,
    text: 'At the start of your turn, if you control no other summons, gains +2 attack and heals 1.',
    triggers: {
      onAwake: (c) => {
        const me = selfRef(c);
        const s = me ? c.summonAt(me) : null;
        if (!me || !s) return;
        const others = c.state.players[c.me].slots.filter((x) => x !== null && x !== s).length;
        if (others > 0) return;
        c.buffStrength(me, 2, 'permanent');
        c.unflip(me, 1);
      },
    },
  }),
  n.summon(2, 'SecretLetter', 'Secret Letter', [], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Draw a card.',
    triggers: { onEnter: (c) => c.draw(c.me, 1) },
  }),
  n.summon(2, 'Smithee', 'Smithee', ['Mortal'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Heal an ally for 2.',
    targets: [
      {
        kind: 'summon',
        side: 'ally',
        includeLeader: true,
        label: 'an ally with flipped HP',
        filter: (a) => !!a.summon && a.summon.hp.some((h) => h.flipped),
      },
    ],
    triggers: { onEnter: (c) => {
        if (c.targets[0]) c.unflip(c.targets[0], 2);
      } },
  }),
  n.summon(2, 'Sorter', 'Sorter', ['Mortal'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Scry 3 for any card.',
    triggers: { onEnter: (c) => c.dig(c.me, 3, () => true) },
  }),
  n.summon(2, 'Starfly', 'Starfly', ['Star'], {
    str: 3,
    hp: 1,
    flipText: 'Spend this card to gain a colorless supporter.',
    flip: (c) => {
      const at = c.holder.hp.findIndex((h) => h.cardId === c.card.id && h.flipped);
      if (at < 0) return;
      c.holder.hp.splice(at, 1);
      c.state.players[c.me].supporters.push({ cardId: c.card.id, sapped: false });
      c.log('Starfly flutters into the supporter row.');
    },
  }),
  n.summon(2, 'UngratefulBeast', 'Ungrateful Beast', ['Beast'], {
    str: 4,
    hp: 3,
    text: 'Deathrattle: You take 1 debt.',
    triggers: { onDeath: (c) => c.addDebt(c.me, 1) },
  }),
  n.summon(3, 'AcolyteofGrinkle', 'Acolyte of Grinkle', ['Grinkle', 'Scholar'], {
    str: 3,
    hp: 6,
  }),
  n.summon(3, 'FlyingCastle', 'Flying Castle', [], {
    str: 2,
    hp: 5,
    redirect: true,
    text: 'Redirection.',
  }),
  n.summon(3, 'GambleLord', 'Gamble Lord', ['Mortal'], {
    str: 3,
    hp: 4,
    powers: [
      {
        name: 'Gamble',
        cost: {},
        sapSelf: true,
        text: 'Discard 2 cards, then draw 2 cards.',
        targets: [T.handCard('a card to throw in'), T.handCard('another card to throw in')],
        effect: (c) => {
          const a = c.targets[0];
          const b = c.targets[1];
          if (a?.kind !== 'hand' || b?.kind !== 'hand' || a.index === b.index) return;
          c.discard(c.me, Math.max(a.index, b.index));
          c.discard(c.me, Math.min(a.index, b.index));
          c.draw(c.me, 2);
        },
      },
    ],
  }),
  n.summon(3, 'GrinkleBeast', 'Grinkle Beast', ['Beast', 'Grinkle'], {
    text: 'Whenever an ally Grinkle dies, gains +1 attack.',
    triggers: {
      onOtherDeath: (c) => {
        if (c.state.dyingOwner !== c.me) return;
        const dead = c.state.dyingCardId;
        if (!dead || !card(dead).factions?.includes('Grinkle')) return;
        const me = selfRef(c);
        if (me) c.buffStrength(me, 1, 'permanent');
      },
    },
    str: 3,
    hp: 5,
  }),
  n.summon(3, 'IneptRuler', 'Inept Ruler', ['Mortal'], {
    str: 4,
    hp: 6,
    text: 'At the start of your turn, you take 1 debt.',
    triggers: { onAwake: (c) => c.addDebt(c.me, 1) },
    powers: [
      {
        name: 'Misrule',
        cost: { C: 2 },
        text: 'Shuffle 2 random cards from your discard pile into your deck.',
        effect: (c) => c.recycleDiscard(c.me, 2),
      },
    ],
  }),
  n.summon(3, 'Ivy', 'Ivy', ['Living'], {
    str: 4,
    hp: 3,
    text: 'Choral: Your level 1 summons have +1 attack and gain 1 HP at the start of your turn.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && !summon.isLeader && levelOf(summon, def) === 1 ? 1 : 0,
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me)) {
          const s = c.summonAt(ref);
          if (s && levelOf(s, card(s.cardId)) === 1) c.reinforce(ref, 1);
        }
      },
    },
  }),
  n.summon(3, 'NerveLite', 'Nerve Lite', ['Hedron'], {
    str: 3,
    hp: 5,
    powers: [
      {
        name: 'Reclaim',
        cost: { C: 3 },
        text: 'Return a card from your discard pile to your hand.',
        sapSelf: true,
        targets: [
          {
            kind: 'discard',
            side: 'ally',
            label: 'a card in your discard pile',
          },
        ],
        effect: (c) => {
          if (c.targets[0]) c.reclaim(c.targets[0]);
        },
      },
    ],
  }),
  n.summon(3, 'PowerBird', 'Power Bird', ['Beast', 'Star'], {
    str: 3,
    hp: 4,
    flipText: 'The attached character gains +1 attack.',
    flip: (c) => c.buffStrength(holderRef(c), 1, 'permanent'),
  }),
  n.summon(3, 'Relica', 'Relica', [], {
    str: 2,
    hp: 4,
    powers: [
      {
        name: 'Attune',
        cost: {},
        text: 'Give an ally +1/+1.',
        sapSelf: true,
        targets: [T.allyOrLeader()],
        effect: (c) => {
          c.reinforce(c.targets[0], 1);
          c.buffStrength(c.targets[0], 1, 'permanent');
        },
      },
    ],
  }),
  n.summon(3, 'Seam', 'Seam', ['Machine', 'Hedron'], {
    str: 2,
    hp: 7,
    powers: [
      {
        name: 'Compress',
        cost: { C: 3 },
        text: 'Gains +2 attack.',
        effect: (c) => {
          const me = selfRef(c);
          if (me) c.buffStrength(me, 2, 'permanent');
        },
      },
    ],
  }),
  n.spell('Bucket', 'Bucket', { C: 1 }, {
    text: 'An ally gains 2 HP off your deck.',
    targets: [T.allyOrLeader()],
    effect: (c) => c.reinforce(c.targets[0], 2),
  }),
  n.spell('ColdBread', 'Cold Bread', {}, {
    text: 'Draw a card.',
    effect: (c) => c.draw(c.me, 1),
  }),
  n.stage('HomeOnAHill', 'Field: Home on a Hill', { C: 1 }, {
    text: "At the start of your turn, your leader heals 2.",
    stageHooks: { onAwake: (c) => c.unflip({ kind: 'leader', player: c.me }, 2) },
  }),
  n.trap('Mousetrap', 'Trap: Mousetrap', { C: 1 }, {
    text: 'The attacking summon loses 2 attack.',
    effect: (c) => {
      const a = battleAttacker(c.state);
      if (a) c.buffStrength(a, -2, 'permanent');
    },
  }),
  n.spell('RockThrow', 'Rock Throw', { C: 2 }, {
    text: 'Deal 2 to an enemy summon.',
    targets: [T.enemy()],
    effect: (c) => c.damage(c.targets[0], 2),
  }),
];
