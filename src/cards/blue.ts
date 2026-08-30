import type { CardDef, TargetRef } from '../engine/types';
import { effectiveStrength } from '../engine/effects';
import { battleAttacker, battleDefender, livingOpponents } from '../engine/state';
import { card } from '../engine/registry';
import { T, colorKit, holderRef, selfRef } from './build';

// Blue is Fish: control, recursion out of debt, and moving HP cards around.
const k = colorKit('F', 'f', 'Blue', 'Blue/Spells');

export const blueCards: CardDef[] = [
  // --- leaders ---------------------------------------------------------------
  k.starter('thefish', 'The Fish', ['Fish', 'Star'], {
    str: 1,
    hp: 4,
    powers: [
      {
        name: 'Perfect System',
        cost: {},
        text: 'Scry 3 for a Fish.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 3, (d) => !!d.factions?.includes('Fish'));
        },
      },
      {
        name: 'Archon of Life',
        cost: { F: 2, C: 1 },
        text: 'Return a summon from your debt to your hand.',
        sapSelf: true,
        targets: [
          {
            kind: 'debt',
            side: 'ally',
            label: 'a summon in your debt',
            filter: (a) => a.card?.type === 'summon',
          },
        ],
        effect: (c) => {
          const r = c.targets[0];
          if (r?.kind !== 'debt') return;
          const id = c.removeFromDebt(c.me, r.index);
          if (id) c.toHand(c.me, id);
        },
      },
    ],
  }),

  // --- level 1 --------------------------------------------------------------
  k.summon(1, 'basicfish', 'Minnowling', ['Fish'], {
    text: 'Battlecry: Mill the enemy 1.',
    triggers: { onEnter: (c) => c.mill(c.opp, 1) },
    str: 1,
    hp: 2,
    flipText: 'Catch a spent HP card off the attached character.',
    flip: (c) => c.catch(holderRef(c), 1),
  }),
  k.summon(1, 'lilfish', 'Lilfish', ['Fish'], {
    str: 1,
    hp: 2,
    text: 'Battlecry: Draw a card.',
    triggers: {
      onEnter: (c) => c.draw(c.me, 1),
    },
    flipText: 'Catch a spent HP card off the attached character.',
    flip: (c) => c.catch(holderRef(c), 1),
  }),
  k.summon(1, 'longfish', 'Longfish', ['Fish'], {
    str: 3,
    hp: 2,
    flipText: 'Catch a spent HP card off the attached character.',
    flip: (c) => c.catch(holderRef(c), 1),
  }),
  k.summon(1, 'octopi', 'Octopi', ['Fish'], {
    str: 1,
    hp: 3,
    powers: [
      {
        name: 'Eight Hands',
        cost: { F: 1 },
        text: 'Unsap an ally summon.',
        targets: [T.ally()],
        effect: (c) => c.unsap(c.targets[0]),
      },
    ],
    flipText: 'Catch a spent HP card off the attached character.',
    flip: (c) => c.catch(holderRef(c), 1),
  }),
  k.summon(1, 'seabunny', 'Sea Bunny', ['Fish', 'Beast'], {
    str: 1,
    hp: 2,
    flipText: 'Bring a summon back from your debt to your hand.',
    flipCost: { mana: { F: 1 } },
    flipUseful: (c) => c.debtSummons(c.me).length > 0,
    flip: (c) => {
      c.choose('debt-summon-to-hand', c.debtSummons(c.me), 'Bring back which summon?');
    },
  }),
  k.summon(1, 'seahorse', 'Seahorse', ['Fish', 'Beast'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Move an HP card from your leader onto it.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (me) c.moveHp({ kind: 'leader', player: c.me }, me, 1);
      },
    },
    flipText: 'Catch a spent HP card off the attached character.',
    flip: (c) => c.catch(holderRef(c), 1),
  }),
  k.summon(1, 'seasnake', 'Sea Snake', ['Fish', 'Beast'], {
    str: 1,
    hp: 3,
    text: 'When attacked, draw a card.',
    triggers: {
      onDefend: (c) => c.draw(c.me, 1),
    },
  }),
  k.summon(1, 'swordfish', 'Swordfish', ['Fish'], {
    flipText: 'The attached character gains +2 attack.',
    flip: (c) => c.buffStrength(holderRef(c), 2, 'permanent'),
    str: 2,
    hp: 2,
  }),
  k.summon(1, 'urchin', 'Urchin', ['Fish'], {
    str: 1,
    hp: 4,
    text: 'When attacked, deal 2 to the attacker.',
    triggers: {
      onDefend: (c) => {
        const a = battleAttacker(c.state);
        if (a) c.damage(a, 2);
      },
    },
    flipText: 'Catch a spent HP card off the attached character.',
    flip: (c) => c.catch(holderRef(c), 1),
  }),
  k.summon(1, 'whaleshark', 'Whale Shark', ['Fish', 'Beast'], {
    str: 1,
    hp: 4,
    text: 'Battlecry: Shuffle 3 random cards from your discard pile into your deck.',
    triggers: {
      onEnter: (c) => c.recycleDiscard(c.me, 3),
    },
  }),

  // --- level 2 --------------------------------------------------------------
  k.summon(2, 'coralhead', 'Coralhead', ['Fish'], {
    str: 1,
    hp: 5,
    text: 'Ally Fish have +1 attack. At the start of your turn, Mill 2.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Fish') && def.id !== 'f2-coralhead'
          ? 1
          : 0,
      onAwake: (c) => c.mill(c.me, 2),
    },
  }),
  k.summon(2, 'fishamalgam', 'Fish Amalgam', ['Fish'], {
    str: 3,
    hp: 2,
    text: 'Battlecry: Pull HP cards off your other summons onto it.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (!me) return;
        for (const ref of c.summonsOf(c.me, true)) {
          if (JSON.stringify(ref) === JSON.stringify(me)) continue;
          c.moveHp(ref, me, 1);
        }
      },
    },
    powers: [
      {
        name: 'Engulf',
        cost: { F: 1 },
        text: 'Move an HP card from an ally onto this.',
        sapSelf: true,
        targets: [T.allyOrLeader('take an HP card from')],
        effect: (c) => {
          const me = selfRef(c);
          if (me) c.moveHp(c.targets[0], me, 1);
        },
      },
    ],
  }),
  k.summon(2, 'fishfolk', 'Fishfolk', ['Fish', 'Mortal'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Shoal',
        cost: { F: 1 },
        text: 'Draw a card if you control 3 or more Fish.',
        sapSelf: true,
        effect: (c) => {
          if (c.countFaction(c.me, 'Fish') >= 3) c.draw(c.me, 1);
          else c.log('The shoal is too thin.');
        },
      },
    ],
  }),
  k.summon(2, 'fishwizard', 'Fish Wizard', ['Fish', 'Scholar'], {
    hp: 3,
    str: 1,
    powers: [
      {
        name: 'Magic Fishiles',
        cost: { F: 1 },
        text: 'Draw and discard 3 cards. For each Fish drawn, deal 1 to an enemy summon.',
        sapSelf: true,
        targets: [
          {
            kind: 'summon',
            side: 'enemy',
            label: 'an enemy summon to shell',
            optional: true,
          },
        ],
        effect: (c) => {
          const hand = c.state.players[c.me].hand;
          const before = hand.length;
          c.draw(c.me, 3);
          let fish = 0;
          for (let i = hand.length - 1; i >= before; i--) {
            if (card(hand[i]).factions?.includes('Fish')) fish++;
            c.discard(c.me, i);
          }
          if (fish > 0 && c.targets[0]) c.damage(c.targets[0], fish);
        },
      },
      {
        name: 'Turn the Tide',
        cost: { F: 1 },
        text: 'Shuffle 3 random cards from your discard pile into your deck.',
        effect: (c) => c.recycleDiscard(c.me, 3),
      },
    ],
  }),
  k.summon(2, 'jellyking', 'Jelly King', ['Fish'], {
    str: 2,
    hp: 5,
    text: 'At the start of your turn, Catch 1 spent HP card off an ally.',
    triggers: {
      onAwake: (c) => {
        const refs = c.summonsOf(c.me, true).filter((ref) => {
          const s = c.summonAt(ref);
          return !!s && s.hp.some((h) => h.flipped);
        });
        c.choose('catch-1', refs, 'Catch a spent HP card off which ally?');
      },
    },
  }),
  k.summon(2, 'lighthousekeeper', 'Lighthouse Keeper', ['Mortal'], {
    str: 1,
    hp: 5,
    stationary: true,
    text: 'Stationary. When attacked, the enemy Mills 2.',
    triggers: {
      onDefend: (c) => c.mill(c.opp, 2),
    },
    powers: [
      {
        name: 'Beacon',
        cost: {},
        text: 'Scry 4 for a Fish.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 4, (d) => !!d.factions?.includes('Fish'));
        },
      },
    ],
  }),
  k.summon(2, 'riverfolk', 'Riverfolk', ['Fish', 'Mortal'], {
    str: 2,
    hp: 3,
    text: 'Deathrattle: Draw 2 cards.',
    triggers: { onDeath: (c) => c.draw(c.me, 2) },
    powers: [
      {
        name: 'Ferry',
        cost: { F: 1 },
        text: 'Catch a spent HP card off an ally.',
        sapSelf: true,
        targets: [T.allyOrLeader('catch a spent HP card off')],
        effect: (c) => {
          c.catch(c.targets[0], 1);
        },
      },
    ],
    flipText: 'Catch 2 spent HP cards off any ally.',
    flipCost: { mana: { F: 2 } },
    flip: (c) => c.catch(holderRef(c), 2),
  }),
  k.summon(2, 'scubadoba', 'Scubadoba', ['Mortal'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Surface',
        cost: { F: 1 },
        text: 'Return the top card of your discard pile to your hand.',
        sapSelf: true,
        effect: (c) => {
          const got = c.reviveFromDiscard(c.me);
          c.log(got ? `${got.name} surfaces.` : 'Nothing down there.');
        },
      },
    ],
  }),
  k.summon(2, 'submariner', 'Submariner', ['Mortal', 'Machine'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: The enemy Mills 2.',
    triggers: {
      onEnter: (c) => c.mill(c.opp, 2),
    },
    powers: [
      {
        name: 'Dive',
        cost: { F: 1 },
        text: 'The enemy Mills 2. Draw a card if their deck is under 8.',
        sapSelf: true,
        effect: (c) => {
          c.mill(c.opp, 2);
          if (c.state.players[c.opp].deck.length < 8) c.draw(c.me, 1);
        },
      },
    ],
    flipText: 'Bring a summon back from your debt to your hand.',
    flipCost: { mana: { F: 1 } },
    flipUseful: (c) => c.debtSummons(c.me).length > 0,
    flip: (c) => {
      c.choose('debt-summon-to-hand', c.debtSummons(c.me), 'Bring back which summon?');
    },
  }),
  k.summon(2, 'undersearesearcher', 'Undersea Researcher', ['Mortal', 'Scholar'], {
    hp: 3,
    str: 1,
    powers: [
      {
        name: 'Survey',
        cost: { F: 1 },
        text: 'Scry 3 for a spell.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 3, (d) => d.type === 'spell');
        },
      },
    ],
  }),

  // --- level 3 --------------------------------------------------------------
  k.summon(3, 'abyssalwalker', 'Abyssal Walker', ['Fish', 'Spirit'], {
    str: 3,
    hp: 4,
    text: 'Strike: Deal 1 to the defender first, and you take 1 debt.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (d) c.damage(d, 1);
        c.addDebt(c.me, 1, 'The walker drags the deep up with it.');
      },
    },
  }),
  k.summon(3, 'crabcity', 'Crab City', ['Fish'], {
    str: 1,
    hp: 9,
    redirect: true,
    stationary: true,
    text: 'Redirection. Stationary. At the start of your turn, the enemy Mills 2.',
    triggers: {
      onAwake: (c) => c.mill(c.opp, 2),
    },
  }),
  k.summon(3, 'darkness', 'The Darkness', ['Spirit'], {
    str: 2,
    hp: 6,
    text: 'Battlecry: The enemy shuffles their hand into their deck, then draws that many cards minus 1.',
    triggers: {
      onEnter: (c) => {
        const held = c.shuffleHandIntoDeck(c.opp);
        if (held > 1) c.draw(c.opp, held - 1);
      },
    },
  }),
  k.summon(3, 'deepseaheart', 'Deep Sea Heart', ['Fish'], {
    str: 2,
    hp: 6,
    powers: [
      {
        name: 'Dredge Up',
        cost: { F: 3 },
        text: 'Move a summon from your debt zone under an ally as face-down HP.',
        targets: [T.myDebt(), T.allyOrLeader()],
        effect: (c) => {
          const d = c.targets[0];
          if (d?.kind !== 'debt') return;
          c.debtToHp(c.targets[1], d.index);
        },
      },
    ],
  }),
  k.summon(3, 'eternalalbatross', 'Eternal Albatross', ['Beast', 'Star'], {
    str: 2,
    hp: 4,
    text: 'Deathrattle: Return a summon from your debt to your hand. You take 2 debt.',
    triggers: {
      onDeath: (c) => {
        c.choose('debt-summon-to-hand', c.debtSummons(c.me), 'Return which summon to hand?');
        c.addDebt(c.me, 2, 'The albatross is not free.');
      },
    },
  }),
  k.summon(3, 'infiniteship', 'The Infinite Ship', ['Machine', 'Star'], {
    str: 2,
    hp: 5,
    text: 'At the start of your turn, gains 1 HP and the enemy Mills 1.',
    triggers: {
      onAwake: (c) => {
        const me = selfRef(c);
        if (me) c.reinforce(me, 1);
        c.mill(c.opp, 1);
      },
    },
    powers: [
      {
        name: 'Set Sail',
        cost: { F: 2 },
        text: 'Shuffle 3 random cards from your discard pile into your deck, then draw 3.',
        sapSelf: true,
        effect: (c) => {
          c.recycleDiscard(c.me, 3);
          c.draw(c.me, 3);
        },
      },
    ],
  }),
  k.summon(3, 'riverdrinker', 'River Drinker', ['Fish', 'Spirit'], {
    str: 1,
    hp: 5,
    powers: [
      {
        name: 'Drink Deep',
        cost: { F: 3 },
        text: 'The enemy Mills 4.',
        sapSelf: true,
        effect: (c) => c.mill(c.opp, 4),
      },
    ],
  }),
  k.summon(3, 'serpant', 'The Serpent', ['Fish', 'Beast'], {
    str: 2,
    hp: 5,
    text: "Has +1 attack for every 6 cards in the enemy's discard pile.",
    triggers: {
      // An aura cannot ask questions, so in a party game it reads the fattest
      // enemy pile. Summing them would outgrow the printed card at four seats.
      strengthBonus: ({ state, controller, summon, source }) =>
        source && summon.uid === source.uid
          ? Math.floor(
              livingOpponents(state, controller).reduce(
                (n: number, foe) => Math.max(n, state.players[foe].discard.length),
                0,
              ) / 6,
            )
          : 0,
    },
    powers: [
      {
        name: 'Devour',
        cost: { F: 2 },
        text: "The enemy Mills cards equal to this character's attack.",
        sapSelf: true,
        effect: (c) => {
          const me = selfRef(c);
          const self = me ? c.summonAt(me) : null;
          if (self) c.mill(c.opp, effectiveStrength(c.state, self));
        },
      },
    ],
  }),
  k.summon(3, 'sharkmeat', 'Sharkmeat', ['Fish'], {
    str: 2,
    hp: 2,
    text: 'When an ally Fish dies, gains +1 attack.',
    triggers: {
      onOtherDeath: (c) => {
        if (c.state.dyingOwner !== c.me) return;
        const dead = c.state.dyingCardId;
        if (!dead || !card(dead).factions?.includes('Fish')) return;
        const me = selfRef(c);
        if (me) c.buffStrength(me, 1, 'permanent');
      },
    },
    powers: [
      {
        name: 'Feeding Frenzy',
        cost: { F: 2 },
        text: 'Destroy the enemy summon with the least attack.',
        sapSelf: true,
        effect: (c) => {
          let prey: TargetRef | null = null;
          let least = Number.POSITIVE_INFINITY;
          for (const ref of c.summonsOf(c.opp)) {
            const s = c.summonAt(ref);
            if (!s) continue;
            const str = effectiveStrength(c.state, s);
            if (str < least) {
              least = str;
              prey = ref;
            }
          }
          if (prey) c.destroy(prey);
          else c.log('Nothing in the water.');
        },
      },
    ],
  }),

  // --- spells, traps and stages ---------------------------------------------
  k.spell('riptide', 'Riptide', { F: 2 }, {
    text: 'Sap every enemy summon. They do not unsap the next time they would. Heal your leader for 2.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.opp)) {
        c.sap(ref);
        const s = c.summonAt(ref);
        if (s) s.sapLock = true;
      }
      c.unflip({ kind: 'leader', player: c.me }, 2);
    },
  }),
  k.spell('catch', 'Baited', { F: 1, C: 1 }, {
    text: 'Destroy a sapped summon.',
    targets: [
      {
        kind: 'summon',
        side: 'any',
        label: 'a sapped summon',
        filter: (a) => !!a.summon?.sapped,
      },
    ],
    effect: (c) => c.destroy(c.targets[0]),
  }),
  k.spell('chumbucket', 'Chum Bucket', { F: 1, C: 1 }, {
    text: 'The enemy Mills 2, then draw a card.',
    effect: (c) => {
      c.mill(c.opp, 2);
      c.draw(c.me, 1);
    },
    flipText: 'Catch a spent HP card off the attached character.',
    flip: (c) => c.catch(holderRef(c), 1),
  }),
  k.spell('error', 'Error', { F: 1, C: 1 }, {
    text: 'The enemy Mills 4.',
    effect: (c) => c.mill(c.opp, 4),
  }),
  k.spell('fishgoop', 'Fish Goop', {}, {
    text: 'Move 2 HP cards from an enemy summon onto the enemy leader.',
    targets: [T.enemy()],
    effect: (c) => c.moveHp(c.targets[0], { kind: 'leader', player: c.opp }, 2),
  }),
  k.spell('fishify', 'Fishify', { F: 1, C: 1 }, {
    text: 'Turn a summon into a Minnowling, keeping its HP cards.',
    targets: [T.any()],
    effect: (c) => c.transform(c.targets[0], 'f1-basicfish'),
    flipText: 'Bring a summon back from your debt to your hand.',
    flipCost: { mana: { F: 1 } },
    flipUseful: (c) => c.debtSummons(c.me).length > 0,
    flip: (c) => {
      c.choose('debt-summon-to-hand', c.debtSummons(c.me), 'Bring back which summon?');
    },
  }),
  k.spell('puddlewarp', 'Puddle Warp', { F: 1 }, {
    text: 'Shuffle an ally summon into your deck, then Scry 5 for a summon.',
    targets: [T.ally()],
    effect: (c) => {
      c.shuffleIntoDeck(c.targets[0]);
      c.dig(c.me, 5, (d) => d.type === 'summon', {
        effect: 'scry',
        prompt: 'Take which summon?',
      });
    },
  }),
  k.spell('snacklebox', 'Snacklebox', {}, {
    text: 'Put the top 2 cards of your discard pile under an ally as face-down HP.',
    targets: [T.allyOrLeader()],
    effect: (c) => {
      const s = c.summonAt(c.targets[0]);
      const pile = c.state.players[c.me].discard;
      if (!s) return;
      let fed = 0;
      for (let i = 0; i < 2 && pile.length > 0; i++) {
        const id = pile.pop();
        if (!id) break;
        s.hp.push({ cardId: id, flipped: false });
        fed++;
      }
      c.log(fed > 0 ? `${fed} snack(s) tucked in as HP.` : 'The box is empty.');
    },
  }),
  k.trap('scooba', 'Trap: Scooba', { F: 1 }, {
    text: "Shuffle the attacking summon into its owner's deck.",
    effect: (c) => {
      const a = battleAttacker(c.state);
      if (a) c.shuffleIntoDeck(a);
    },
  }),
  k.stage('fishideology', 'Field: Fish Ideology', { F: 2 }, {
    text: 'At the start of your turn, Catch 1 spent HP card off an ally.',
    stageHooks: {
      onAwake: (c) => {
        const refs = c.summonsOf(c.me, true).filter((ref) => {
          const s = c.summonAt(ref);
          return !!s && s.hp.some((h) => h.flipped);
        });
        c.choose('catch-1', refs, 'Catch a spent HP card off which ally?');
      },
    },
    flipText: 'Catch 2 spent HP cards off any ally.',
    flipCost: { mana: { F: 2 } },
    flip: (c) => c.catch(holderRef(c), 2),
  }),
  k.stage('rainstorm', 'Field: Rainstorm', { F: 1, C: 1 }, {
    text: 'Your Fish have +1 attack.',
    stageHooks: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Fish') ? 1 : 0,
    },
  }),
];
