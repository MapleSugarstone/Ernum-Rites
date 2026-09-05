import { battleAttacker, battleDefender } from '../engine/state';
import { effectiveStrength } from '../engine/effects';
import type { CardDef } from '../engine/types';
import { T, colorKit, selfRef } from './build';

// Red is Pepper: burn, spell recursion, and bodies that cash themselves in.
const k = colorKit('P', 'p', 'Red', 'Red/spells');

export const redCards: CardDef[] = [
  k.starter('archlife', 'Archlife', ['Spirit', 'Star'], {
    str: 2,
    hp: 3,
    effectDamage: 1,
    text: 'Effect Damage +1. At the start of your turn, loses 1 HP.',
    triggers: {
      // Raw, so its own Effect Damage does not double the burn it pays.
      onAwake: (c) => {
        const me = selfRef(c);
        if (me) c.rawDamage(me, 1);
      },
    },
    powers: [
      {
        name: 'Kindle',
        cost: { P: 1 },
        text: 'Deal 1 to an enemy summon.',
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 1),
      },
      {
        name: 'Rekindle',
        cost: { P: 2 },
        text: 'Shuffle your discard pile, then Scry 3 of it for a spell.',
        sapSelf: true,
        effect: (c) => c.scryDiscard(c.me, 3, (d) => d.type === 'spell'),
      },
    ],
  }),

  // --- level 1 --------------------------------------------------------------
  k.summon(1, 'beast', 'Red Beast', ['Beast'], { str: 3, hp: 2 }),
  k.summon(1, 'beetle', 'Ember Beetle', ['Beast'], {
    str: 1,
    hp: 2,
    flipText: 'Deal 1 to an enemy summon.',
    flip: (c) => {
      c.choose('deal-1', c.summonsOf(c.opp), 'Deal 1 to which enemy summon?');
    },
  }),
  k.summon(1, 'bugbert', 'Bugbert', ['Beast'], {
    text: 'Deathrattle: Costs no debt.',
    triggers: { onDeath: (c) => c.clearDebt(c.me, 1) },
    str: 1,
    hp: 3,
  }),
  k.summon(1, 'bunny', 'Cinder Bunny', ['Beast'], {
    text: 'Battlecry: Deal 1 to an enemy summon.',
    targets: [T.enemy()],
    triggers: { onEnter: (c) => { if (c.targets[0]) c.damage(c.targets[0], 1); } },
    str: 2,
    hp: 2,
    flipText: 'Deal 1 to the enemy leader.',
    flipCost: { mana: { P: 1 } },
    flip: (c) => c.damage({ kind: 'leader', player: c.opp }, 1),
  }),
  k.summon(1, 'devil', 'Little Devil', ['Spirit'], {
    str: 1,
    hp: 2,
    text: 'Battlecry: Deal 1 to both leaders.',
    triggers: {
      onEnter: (c) => {
        c.damage({ kind: 'leader', player: c.opp }, 1);
        c.damage({ kind: 'leader', player: c.me }, 1);
      },
    },
    flipText: 'Deal 1 to both leaders.',
    flipCost: { mana: { P: 1 } },
    flip: (c) => {
      c.damage({ kind: 'leader', player: c.opp }, 1);
      c.damage({ kind: 'leader', player: c.me }, 1);
    },
  }),
  k.summon(1, 'firebat', 'Firebat', ['Beast'], {
    str: 1,
    hp: 2,
    text: 'Strike: Deal 1 to the defender first.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (d) c.damage(d, 1);
      },
    },
    flipText: 'Deal 1 to an enemy summon.',
    flip: (c) => {
      c.choose('deal-1', c.summonsOf(c.opp), 'Deal 1 to which enemy summon?');
    },
  }),
  k.summon(1, 'firesprite', 'Fire Sprite', ['Spirit'], {
    hp: 2,
    str: 1,
    powers: [
      {
        name: 'Spark',
        cost: { P: 1 },
        text: 'Deal 1 to an enemy summon.',
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 1),
      },
    ],
    flipText: 'Deal 1 to the enemy leader.',
    flipCost: { mana: { P: 1 } },
    flip: (c) => c.damage({ kind: 'leader', player: c.opp }, 1),
  }),
  k.summon(1, 'minimage', 'Minimage', ['Mortal', 'Scholar'], {
    hp: 2,
    str: 1,
    powers: [
      {
        name: 'Cantrip',
        cost: { P: 1 },
        text: 'Scry 3 for a spell.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 3, (d) => d.type === 'spell');
        },
      },
    ],
    flipText: 'Deal 1 to an enemy summon.',
    flip: (c) => {
      c.choose('deal-1', c.summonsOf(c.opp), 'Deal 1 to which enemy summon?');
    },
  }),
  k.summon(1, 'moonkrag', 'Moonkrag', ['Star'], {
    str: 2,
    hp: 4,
    flipText: 'Deal 1 to the enemy leader.',
    flipCost: { mana: { P: 1 } },
    flip: (c) => c.damage({ kind: 'leader', player: c.opp }, 1),
  }),
  k.summon(1, 'thinker', 'The Thinker', ['Mortal', 'Scholar'], {
    str: 1,
    hp: 3,
    text: 'At the start of your turn, draw a card.',
    triggers: { onAwake: (c) => c.draw(c.me, 1) },
  }),

  // --- level 2 --------------------------------------------------------------
  k.summon(2, 'ash demon', 'Ash Demon', ['Spirit'], {
    str: 2,
    hp: 2,
    text: 'Deathrattle: Deal 1 to every enemy summon.',
    triggers: {
      onDeath: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
      },
    },
    powers: [
      {
        name: 'Cinders',
        cost: { P: 1 },
        text: 'Deal 1 to an enemy character.',
        targets: [T.enemyOrLeader()],
        effect: (c) => c.damage(c.targets[0], 1),
      },
    ],
  }),
  k.summon(2, 'burnflayer', 'Burnflayer', ['Spirit'], {
    str: 2,
    hp: 4,
    powers: [
      {
        name: 'Flay',
        cost: { P: 1 },
        text: 'Deal 2 to an enemy summon, then 1 to this one.',
        targets: [T.enemy()],
        effect: (c) => {
          c.damage(c.targets[0], 2);
          const me = selfRef(c);
          if (me) c.damage(me, 1);
        },
      },
    ],
  }),
  k.summon(2, 'deathknight', 'Death Knight', ['Mortal', 'Spirit'], {
    hp: 3,
    str: 3,
    text:
      'Strike: Gains 1 HP off your deck. When an enemy summon dies, heal your leader 1.',
    triggers: {
      onAttack: (c) => {
        const me = selfRef(c);
        if (me) c.reinforce(me, 1);
      },
      onOtherDeath: (c) => {
        if (c.state.dyingOwner === c.me) return;
        c.unflip({ kind: 'leader', player: c.me }, 1);
      },
    },
  }),
  k.summon(2, 'dragon', 'Dragon', ['Beast'], {
    str: 3,
    hp: 2,
    text: 'Strike: Deal 1 to every enemy summon.',
    triggers: {
      onAttack: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
      },
    },
    flipText: 'Deal 2 to the enemy leader.',
    flipCost: { mana: { P: 1 } },
    flipUseful: (c) => !!c.summonAt({ kind: 'leader', player: c.opp }),
    flip: (c) => c.damage({ kind: 'leader', player: c.opp }, 2),
  }),
  k.summon(2, 'evil squire', 'Evil Squire', ['Mortal'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: An ally gains +3 attack until end of turn.',
    targets: [T.ally()],
    triggers: {
      onEnter: (c) => {
        if (c.targets[0]) c.buffStrength(c.targets[0], 3, 'turn');
      },
    },
  }),
  k.summon(2, 'lazylord', 'Lazy Lord', ['Mortal'], {
    str: 4,
    hp: 3,
    text: 'Arrives sapped.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (me) c.sap(me);
      },
    },
  }),
  k.summon(2, 'livingfort', 'Living Fort', ['Living'], {
    str: 1,
    hp: 6,
    redirect: true,
    stationary: true,
    text: 'Redirection. Stationary.',
  }),
  k.summon(2, 'pinelyte', 'Pinelyte', ['Living'], {
    str: 2,
    hp: 5,
    powers: [
      {
        name: 'Sap Burst',
        cost: {},
        sapSelf: true,
        hpCost: 2,
        text: 'Spend 2 HP off this: deal 3 to an enemy summon.',
        targets: [T.enemy()],
        effect: (c) => {
          const me = selfRef(c);
          if (!me) return;
          c.rawDamage(me, 2);
          c.damage(c.targets[0], 3);
        },
      },
    ],
    flipText: 'Deal 1 to an enemy summon.',
    flip: (c) => {
      c.choose('deal-1', c.summonsOf(c.opp), 'Deal 1 to which enemy summon?');
    },
  }),
  k.summon(2, 'warmateer', 'Warmateer', ['Mortal'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Rally',
        cost: { P: 1 },
        text: 'An ally character gains +4 attack until end of turn.',
        targets: [T.allyOrLeader()],
        effect: (c) => c.buffStrength(c.targets[0], 4, 'turn'),
      },
    ],
    flipText: 'Deal 1 to an enemy summon.',
    flip: (c) => {
      c.choose('deal-1', c.summonsOf(c.opp), 'Deal 1 to which enemy summon?');
    },
  }),
  k.summon(2, 'wizard', 'Red Wizard', ['Mortal', 'Scholar'], {
    hp: 3,
    str: 2,
    powers: [
      {
        name: 'Ember',
        cost: { P: 1 },
        text: 'Deal 1 to an enemy summon.',
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 1),
      },
      {
        name: 'Conflagrate',
        cost: { P: 2 },
        text: 'Deal 2 to every enemy summon.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp)) c.damage(ref, 2);
        },
      },
    ],
  }),

  // --- level 3 --------------------------------------------------------------
  k.summon(3, 'classe', 'Classe', ['Mortal', 'Scholar'], {
    str: 2,
    hp: 5,
    powers: [
      {
        name: 'Burning Heart',
        cost: { P: 1 },
        text: 'Draw a card and deal 1 to your leader.',
        effect: (c) => {
          c.draw(c.me, 1);
          c.damage({ kind: 'leader', player: c.me }, 1);
        },
      },
    ],
  }),
  k.summon(3, 'heavenknows', 'Heaven Knows', ['Star', 'Spirit'], {
    str: 3,
    hp: 5,
    text: 'At the end of your turn, deal 1 to every character.',
    triggers: {
      onEndTurn: (c) => {
        for (const ref of [...c.summonsOf(c.me, true), ...c.summonsOf(c.opp, true)]) {
          c.damage(ref, 1);
        }
      },
    },
  }),
  k.summon(3, 'helaks', 'Helaks', ['Spirit'], {
    str: 3,
    hp: 6,
    text: 'Cannot be healed.',
  }),
  k.summon(3, 'helemy', 'Helemy', ['Spirit', 'Scholar'], {
    str: 2,
    hp: 5,
    powers: [
      {
        name: 'Alchemize',
        cost: { P: 2 },
        text: 'Destroy one of your summons, then deal its attack to an enemy character.',
        targets: [T.ally('one of your summons'), T.enemyOrLeader()],
        effect: (c) => {
          const victim = c.summonAt(c.targets[0]);
          if (!victim) return;
          const paid = effectiveStrength(c.state, victim);
          c.destroy(c.targets[0]);
          c.damage(c.targets[1], paid);
        },
      },
    ],
  }),
  k.summon(3, 'Looker', 'The Looker', ['Spirit'], {
    str: 2,
    hp: 5,
    text: 'At the start of your turn, Scry 3 for any card.',
    triggers: {
      onAwake: (c) => {
        c.dig(c.me, 3, () => true);
      },
    },
  }),
  k.summon(3, 'Pod', 'The Pod', ['Living'], {
    str: 2,
    hp: 7,
    text: 'Deathrattle: Return 2 spells from your discard pile to your hand.',
    triggers: {
      onDeath: (c) => {
        c.choose('pod-revive', c.discardSpells(c.me), 'Return which spell to hand?');
      },
    },
  }),
  k.summon(3, 'Slicer', 'Slicer', ['Machine'], {
    str: 2,
    hp: 4,
    effectDamage: 1,
    text: 'Effect Damage +1. Battlecry: You take 2 debt.',
    triggers: { onEnter: (c) => c.addDebt(c.me, 2, 'The Slicer bills its owner up front.') },
  }),
  k.summon(3, 'stareater', 'Star Eater', ['Beast', 'Star'], {
    str: 4,
    hp: 4,
    powers: [
      {
        name: 'Devour',
        cost: {},
        sapSelf: true,
        text: 'Eat one of your other summons. It becomes HP on this one and costs no debt.',
        targets: [T.ally('one of your summons')],
        effect: (c) => {
          c.devour(c.targets[0]);
        },
      },
    ],
  }),
  k.summon(3, 'Tryybus', 'Tryybus', ['Star'], {
    str: 2,
    hp: 3,
    text: 'All allies have +1 attack. At the start of your turn, loses 1 HP.',
    triggers: {
      strengthBonus: ({ controller, summon }) =>
        summon.owner === controller && summon.cardId !== 'p3-Tryybus' ? 1 : 0,
      // Raw, so no Effect Damage bonus inflates the upkeep it pays.
      onAwake: (c) => {
        const me = selfRef(c);
        if (me) c.rawDamage(me, 1);
      },
    },
  }),

  // --- spells, traps and stages ---------------------------------------------
  k.spell('firebolt', 'Firebolt', { P: 1 }, {
    text: 'Deal 2 to an enemy summon.',
    targets: [T.enemy()],
    effect: (c) => c.damage(c.targets[0], 2),
  }),
  k.spell('planetblast', 'Planet Blast', { P: 1, C: 1 }, {
    text: 'Deal 1 to every character.',
    effect: (c) => {
      for (const ref of [...c.summonsOf(c.me, true), ...c.summonsOf(c.opp, true)]) {
        c.damage(ref, 1);
      }
    },
  }),
  k.spell('vaporize', 'Vaporize', { P: 3 }, {
    text: 'Deal 4 to an enemy summon.',
    targets: [T.enemy()],
    effect: (c) => c.damage(c.targets[0], 4),
    flipText: 'Deal 2 to the enemy leader.',
    flipCost: { mana: { P: 1 } },
    flipUseful: (c) => !!c.summonAt({ kind: 'leader', player: c.opp }),
    flip: (c) => c.damage({ kind: 'leader', player: c.opp }, 2),
  }),
  k.spell('poisondagger', 'Dagger Dance', { P: 1 }, {
    text: 'Deal 1 to an enemy summon, 2 times.',
    targets: [T.enemy()],
    effect: (c) => {
      for (let i = 0; i < 2; i++) c.damage(c.targets[0], 1);
    },
  }),
  k.spell('potion', 'Ember Tonic', { P: 1, C: 1 }, {
    text: 'Deal 1 to the enemy leader and draw a card.',
    effect: (c) => {
      c.damage({ kind: 'leader', player: c.opp }, 1);
      c.draw(c.me, 1);
    },
  }),
  k.spell('treasure', 'Treasure', { P: 1 }, {
    text: 'Draw 2 cards.',
    effect: (c) => c.draw(c.me, 2),
  }),
  k.spell('flower', 'Ember Flower', { P: 1 }, {
    text: 'Deal 1 to every enemy summon.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
    },
  }),
  k.trap('banner', 'Trap: Backdraft', { P: 1 }, {
    text: 'Deal 4 to the attacking summon.',
    effect: (c) => {
      const a = battleAttacker(c.state);
      if (a) c.damage(a, 4);
    },
  }),
  k.stage('castle', 'Field: The Castle', { P: 1, C: 1 }, {
    text: 'When you set it, and at the start of your turn, deal 1 to an enemy summon.',
    effect: (c) => {
      c.choose('deal-1', c.summonsOf(c.opp), 'Deal 1 to which enemy summon?');
    },
    stageHooks: {
      onAwake: (c) => {
        c.choose('deal-1', c.summonsOf(c.opp), 'Deal 1 to which enemy summon?');
      },
    },
    flipText: 'Deal 3 to every enemy summon.',
    flipCost: { mana: { P: 2 } },
    flipUseful: (c) => c.summonsOf(c.opp).length > 0,
    flip: (c) => {
      for (const t of c.summonsOf(c.opp)) c.damage(t, 3);
    },
  }),
  k.stage('towerofmystery', 'Field: Tower of Mystery', { P: 1, C: 1 }, {
    text: 'Your Scholars have +2 attack.',
    stageHooks: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Scholar') ? 2 : 0,
    },
  }),
];
