import { card } from '../engine/registry';
import { graftedCopy, oilRaise } from '../engine/generated';
import {
  battleAttacker,
  battleDefender,
  colorOf,
  findSummon,
  levelOf,
  livingOpponents,
  powersOf,
} from '../engine/state';
import type { CardDef, TargetRef } from '../engine/types';
import { T, colorKit, leaderOnly, selfRef } from './build';

// Purple is Oil: Spirits, wounds, and moving debt around rather than avoiding it.
const k = colorKit('O', 'o', 'Purple', 'Purple/Spell');

export const purpleCards: CardDef[] = [
  k.starter('spectralking', 'The Spectral King', ['Spirit', 'Mortal'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Siphon',
        cost: { O: 1 },
        text: 'Put a Wound on an enemy summon and draw a card.',
        targets: [T.enemy()],
        effect: (c) => {
          c.wound(c.targets[0], 1);
          c.draw(c.me, 1);
        },
      },
      {
        name: 'Collect',
        cost: { O: 2 },
        text: 'Heal 1 debt.',
        sapSelf: true,
        effect: (c) => c.clearDebt(c.me, 1),
      },
    ],
  }),

  // --- level 1 --------------------------------------------------------------
  k.summon(1, 'Kapigras', 'Kapigras', [], {
    str: 1,
    hp: 1,
    text: 'Leader: Become an Oil copy of an enemy leader of your choice.',
    triggers: {
      // Every enemy seat is offered, whether or not its leader has taken the
      // field: a deck names its leader from the start, so a seat still waiting
      // on its first turn can be copied too. With one enemy there is nothing to
      // ask and the pick is made on the spot.
      onEnter: leaderOnly((c) => {
        const refs = livingOpponents(c.state, c.me).map(
          (p): TargetRef => ({ kind: 'leader', player: p }),
        );
        c.choose('kapigras', refs, 'Become a copy of which leader?');
      }),
    },
    powers: [
      {
        name: 'Violence',
        cost: { O: 3 },
        text: 'Deal 4 to an enemy summon.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 4),
      },
    ],
  }),
  k.summon(1, 'butterfly', 'Grave Butterfly', ['Spirit'], {
    str: 1,
    hp: 4,
    flipText: 'Shuffle a Rot into the enemy\'s deck.',
    flip: (c) => c.curse(c.opp, 'o-curse-rot', 1),
  }),
  k.summon(1, 'ghost', 'Ghost', ['Spirit'], {
    str: 1,
    hp: 2,
    text: 'Deathrattle: Costs no debt.',
    triggers: { onDeath: (c) => c.clearDebt(c.me, 1) },
    flipText: 'Deal 1 debt.',
    flip: (c) => c.addDebt(c.opp, 1),
  }),
  k.summon(1, 'ghostbeast', 'Ghost Beast', ['Spirit', 'Beast'], { str: 2, hp: 2,
    flipText: 'Put a Wound on an enemy summon.',
    flip: (c) => {
      c.choose('wound-1', c.summonsOf(c.opp), 'Put a Wound on which enemy summon?');
    },
  }),
  k.summon(1, 'jacklebox', 'Jacklebox', ['Spirit'], {
    text: 'Deathrattle: Deal 1 to every enemy summon.',
    triggers: {
      onDeath: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
      },
    },
    str: 1,
    hp: 2,
    flipText: 'Shuffle a Rot into the enemy\'s deck.',
    flip: (c) => c.curse(c.opp, 'o-curse-rot', 1),
  }),
  k.summon(1, 'mothman', 'Mothman', ['Spirit', 'Beast'], {
    str: 1,
    hp: 2,
    text: 'Strike: Put a Wound on the defender.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (d) c.wound(d, 1);
      },
    },
    flipText: 'Put a Wound on an enemy summon.',
    flip: (c) => {
      c.choose('wound-1', c.summonsOf(c.opp), 'Put a Wound on which enemy summon?');
    },
  }),
  k.summon(1, 'owl', 'Night Owl', ['Beast'], {
    hp: 2,
    str: 1,
    powers: [
      {
        name: 'Watch',
        cost: { O: 1 },
        text: 'Scry 3 for a Spirit.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 3, (d) => !!d.factions?.includes('Spirit'));
        },
      },
    ],
  }),
  k.summon(1, 'pumpkineater', 'Pumpkin Eater', ['Beast'], {
    str: 2,
    hp: 5,
    text: 'Battlecry: Mill 2.',
    triggers: { onEnter: (c) => c.mill(c.me, 2) },
  }),
  k.summon(1, 'skeleton', 'Skeleton', ['Spirit'], {
    str: 1,
    hp: 3,
    text: 'Deathrattle: Adds its level plus 1 to your debt, then returns to your hand.',
    triggers: {
      // The engine bills a death for the body's level after this fires, so the
      // extra point is added here and the two land together.
      onDeath: (c) => {
        c.addDebt(c.me, 1, 'The bones are owed for twice over.');
        c.returnToHand();
      },
    },
    flipText: 'Shuffle a Rot into the enemy\'s deck.',
    flip: (c) => c.curse(c.opp, 'o-curse-rot', 1),
  }),
  k.summon(1, 'snakecoil', 'Snakecoil', ['Beast'], {
    str: 1,
    hp: 2,
    text: 'When attacked, put 2 Wounds on the attacker.',
    triggers: {
      onDefend: (c) => {
        const a = battleAttacker(c.state);
        if (a) c.wound(a, 2);
      },
    },
  }),
  k.summon(1, 'spider', 'Spider', ['Beast'], {
    str: 2,
    hp: 2,
    flipText: 'Put a Wound on an enemy summon.',
    flip: (c) => {
      c.choose('wound-1', c.summonsOf(c.opp), 'Put a Wound on which enemy summon?');
    },
  }),

  // --- level 2 --------------------------------------------------------------
  k.summon(2, 'boneknown', 'Bone Known', ['Spirit'], {
    str: 2,
    hp: 3,
    text: 'Has +1 attack for every 2 debt you carry.',
    triggers: {
      strengthBonus: ({ state, controller, summon, source }) =>
        source && summon.uid === source.uid
          ? Math.floor(state.players[controller].debtCount / 2)
          : 0,
    },
  }),
  k.summon(2, 'evilflower', 'Evil Flower', ['Living', 'Spirit'], {
    str: 1,
    hp: 4,
    text: 'At the start of your turn, put a Wound on every enemy summon.',
    triggers: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.wound(ref, 1);
      },
    },
  }),
  k.summon(2, 'mooncat', 'Mooncat', ['Beast', 'Star'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Prowl',
        cost: { O: 1 },
        text: 'Deal 1 to a character and Mill 1.',
        targets: [T.anyOrLeader('a character')],
        effect: (c) => {
          c.damage(c.targets[0], 1);
          c.mill(c.me, 1);
        },
      },
    ],
  }),
  k.summon(2, 'necromancer', 'Necromancer', ['Mortal', 'Scholar'], {
    str: 1,
    hp: 2,
    powers: [
      {
        name: 'Raise',
        cost: { O: 1 },
        text: "Put a summon from the enemy's debt zone into an empty slot with +2/+2, rebuilt in Oil as a Spirit.",
        targets: [T.enemyDebt()],
        effect: (c) => {
          const ref = c.targets[0];
          if (ref?.kind !== 'debt') return;
          const slot = c.emptySlot(c.me);
          if (slot === null) {
            c.log('No grave to fill.');
            return;
          }
          const id = c.removeFromDebt(ref.player, ref.index);
          if (!id) return;
          const raised = oilRaise(id);
          c.putSummon(c.me, raised, slot, {
            strength: 0,
            color: 'O',
            hp: card(raised).hp ?? 1,
            asPrinted: true,
          });
        },
      },
    ],
  }),
  k.summon(2, 'parkranger', 'Park Ranger', ['Mortal'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Tend',
        cost: {},
        sapSelf: true,
        text:
          'Clear all Wounds from every character. This summon gains +1 attack for each, ' +
          'then heals 1.',
        effect: (c) => {
          let cleared = 0;
          for (const player of [c.me, c.opp]) {
            for (const ref of c.summonsOf(player, true)) {
              const s = c.summonAt(ref);
              if (!s || s.wounds === 0) continue;
              cleared += s.wounds;
              s.wounds = 0;
            }
          }
          const me = selfRef(c);
          if (me && cleared > 0) c.buffStrength(me, cleared, 'permanent');
        },
      },
    ],
  }),
  k.summon(2, 'scientist', 'Scientist', ['Mortal', 'Scholar'], {
    hp: 4,
    str: 2,
    text: 'When an ally Scholar dies, draw a card.',
    triggers: {
      onOtherDeath: (c) => {
        if (c.state.dyingOwner !== c.me) return;
        const dead = c.state.dyingCardId;
        if (dead && card(dead).factions?.includes('Scholar')) c.draw(c.me, 1);
      },
    },
    powers: [
      {
        name: 'Experiment',
        cost: {},
        text: 'Mill 2 and take 1 debt, then draw a card.',
        // The debt is what stops this repeating forever: it charges nothing and
        // taps nothing, so the only ceiling is how much debt you can carry.
        effect: (c) => {
          c.mill(c.me, 2);
          c.addDebt(c.me, 1);
          c.draw(c.me, 1);
        },
      },
    ],
  }),
  k.summon(2, 'slime', 'Slime', ['Living'], {
    str: 3,
    hp: 4,
    text: 'Deathrattle: Put a Slime with 1 less HP into an empty slot.',
    triggers: {
      onDeath: (c) => {
        // hp.length is what it was built with, flipped cards included, so the
        // chain shrinks by one whatever damage it took.
        if (!c.source) return;
        const hp = c.source.hp.length - 1;
        // A body with no HP cannot exist, so that is where it ends.
        if (hp <= 0) return;
        const slot = c.emptySlot(c.me);
        if (slot === null) return;
        c.putSummon(c.me, 'o2-slime', slot, { strength: 3, color: 'O', hp, level: 2 });
      },
    },
  }),
  k.summon(2, 'stabber', 'Stabber', ['Mortal', 'Spirit'], {
    str: 3,
    hp: 1,
    text:
      'Strike: The defender loses 1 attack until end of turn. ' +
      'When an ally Spirit dies, gains 1 HP.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (d) c.buffStrength(d, -1, 'turn');
      },
      onOtherDeath: (c) => {
        if (c.state.dyingOwner !== c.me) return;
        const dead = c.state.dyingCardId;
        if (!dead || !card(dead).factions?.includes('Spirit')) return;
        const me = selfRef(c);
        if (me) c.reinforce(me, 1);
      },
    },
    powers: [
      {
        name: 'Bleed',
        cost: { O: 1 },
        text: 'Put a Wound on an enemy summon.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => c.wound(c.targets[0], 1),
      },
    ],
    flipText: 'The enemy cannot replace summons that die until the end of your turn.',
    flipCost: { mana: { O: 1 } },
    flip: (c) => c.lockReplace(c.opp, 1),
  }),
  k.summon(2, 'thecount', 'The Count', ['Spirit', 'Mortal'], {
    str: 1,
    hp: 3,
    text: 'Strike: Put 2 Wounds on the defender. Heals 2 whenever it kills an enemy summon.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (d) c.wound(d, 2);
      },
      // Only a death inside a battle this body started counts as its kill.
      onOtherDeath: (c) => {
        const atk = battleAttacker(c.state);
        if (!atk || !c.source || c.state.dyingOwner !== c.opp) return;
        if (findSummon(c.state, atk) !== c.source) return;
        const me = selfRef(c);
        if (me) c.unflip(me, 2);
      },
    },
    flipText: 'Shuffle 3 Dread into the enemy\'s deck.',
    flipCost: { mana: { O: 1 } },
    flip: (c) => c.curse(c.opp, 'o-curse-dread', 3),
  }),
  k.summon(2, 'witch', 'Witch', ['Mortal', 'Scholar'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Curse',
        cost: { O: 1 },
        text: "Shuffle 2 Rot into the enemy's deck.",
        sapSelf: true,
        effect: (c) => c.curse(c.opp, 'o-curse-rot', 2),
      },
      {
        name: 'Hex',
        cost: { O: 1 },
        text: 'Put 3 Wounds on an enemy summon.',
        targets: [T.enemy()],
        sapSelf: true,
        effect: (c) => c.wound(c.targets[0], 3),
      },
    ],
  }),

  // --- level 3 --------------------------------------------------------------
  k.summon(3, 'bighatsalze', 'Big Hat Salze', ['Mortal', 'Scholar'], {
    str: 3,
    hp: 4,
    powers: [
      {
        name: 'Study',
        cost: {},
        text: 'Mill 2 and add 1 Oil to your mana pool.',
        sapSelf: true,
        effect: (c) => {
          c.mill(c.me, 2);
          c.state.players[c.me].mana.O += 1;
          c.log('Salze burns pages for power.');
        },
      },
    ],
  }),
  k.summon(3, 'darksideofthemoon', 'Dark Side of the Moon', ['Star', 'Spirit'], {
    str: 2,
    hp: 6,
    text: 'Wounded enemies have -1 attack.',
    triggers: {
      strengthBonus: ({ controller, summon }) =>
        summon.owner !== controller && summon.wounds > 0 ? -1 : 0,
    },
  }),
  k.summon(3, 'devourer', 'The Devourer', ['Beast', 'Spirit'], {
    str: 2,
    hp: 4,
    text: 'Strike: Put 3 Wounds on the defender.',
    triggers: {
      onAttack: (c) => {
        const d = battleDefender(c.state);
        if (d) c.wound(d, 3);
      },
    },
  }),
  k.summon(3, 'eyesnight', 'Eyes of Night', ['Spirit'], {
    str: 2,
    hp: 4,
    woundAmplify: true,
    text:
      'Wounds on enemy summons become damage one for one. ' +
      'At the start of your turn, Mill 2.',
    triggers: { onAwake: (c) => c.mill(c.me, 2) },
  }),
  k.summon(3, 'fungal', 'Fungal Bloom', ['Living'], {
    str: 2,
    hp: 5,
    text:
      'Deathrattle: Every enemy summon takes 3 Wounds. The enemy cannot replace summons that die until the end of your turn.',
    triggers: {
      onDeath: (c) => {
        for (const ref of c.summonsOf(c.opp)) c.wound(ref, 3);
        c.lockReplace(c.opp, 1);
      },
    },
  }),
  k.summon(3, 'mothhorror', 'Moth Horror', ['Spirit', 'Beast'], {
    str: 4,
    hp: 3,
    text: 'Battlecry: Put 2 Wounds on every summon in play.',
    triggers: {
      onEnter: (c) => {
        for (const ref of [...c.summonsOf(c.me), ...c.summonsOf(c.opp)]) c.wound(ref, 2);
      },
    },
  }),
  k.summon(3, 'raingod', 'Rain God', ['Spirit', 'Star'], {
    str: 2,
    hp: 5,
    text: 'At the start of your turn, deal 1 to every Wounded enemy summon.',
    triggers: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.opp)) {
          const s = c.summonAt(ref);
          if (s && s.wounds > 0) c.damage(ref, 1);
        }
      },
    },
  }),
  k.summon(3, 'thelake', 'The Lake', ['Living', 'Spirit'], {
    str: 2,
    hp: 6,
    redirect: true,
    stationary: true,
    text: "Redirection. Stationary. When an enemy summon dies, Shuffle a Rot into the enemy's deck.",
    triggers: {
      onOtherDeath: (c) => {
        if (c.state.dyingOwner === c.opp) c.curse(c.opp, 'o-curse-rot', 1);
      },
    },
    flipText: 'Shuffle a Rot into the enemy\'s deck.',
    flip: (c) => c.curse(c.opp, 'o-curse-rot', 1),
  }),
  k.summon(3, 'wickerman', 'Wicker Man', ['Living', 'Spirit'], {
    str: 3,
    hp: 4,
    text: "Deathrattle: Shuffle 2 Rot into the enemy's deck.",
    triggers: {
      onDeath: (c) => c.curse(c.opp, 'o-curse-rot', 2),
    },
  }),

  // --- spells, traps and stages ---------------------------------------------
  k.spell('bomb', 'Bomb', { O: 2 }, {
    text: 'Destroy an enemy summon that has 3 or less HP left.',
    targets: [
      {
        kind: 'summon',
        side: 'enemy',
        label: 'a weakened enemy summon',
        filter: (a) => !!a.summon && a.summon.hp.filter((h) => !h.flipped).length <= 3,
      },
    ],
    effect: (c) => c.destroy(c.targets[0]),
    flipText: 'Put a Wound on an enemy summon.',
    flip: (c) => {
      c.choose('wound-1', c.summonsOf(c.opp), 'Put a Wound on which enemy summon?');
    },
  }),
  k.spell('blackcandle', 'Black Candle', { O: 1 }, {
    text: 'Put 2 Wounds on every enemy summon.',
    effect: (c) => {
      for (const ref of c.summonsOf(c.opp)) c.wound(ref, 2);
    },
  }),
  k.spell('bonedivination', 'Bone Divination', {}, {
    text: 'Scry 4 for a summon.',
    effect: (c) => {
      c.dig(c.me, 4, (d) => d.type === 'summon');
    },
  }),
  k.spell('corruptedritual', 'Corrupted Ritual', { O: 1, C: 1 }, {
    text: 'Destroy one of your summons, then your opponent takes 2 debt.',
    targets: [T.ally('one of your summons')],
    effect: (c) => {
      const victim = c.summonAt(c.targets[0]);
      if (!victim) return;
      c.destroy(c.targets[0]);
      c.addDebt(c.opp, 2, 'The ritual passes the bill along.');
    },
  }),
  k.spell('graft', 'Graft', { O: 1 }, {
    text: "An ally gains another summon's Powers, text and factions, with the gained Powers rebuilt in Oil. Draw a card.",
    targets: [
      {
        kind: 'summon',
        side: 'any',
        label: 'a summon to graft from',
        filter: (a) =>
          !!a.card &&
          (!!a.card.powers?.length || !!a.card.triggers || !!a.card.text?.trim()),
      },
      T.ally(),
    ],
    effect: (c) => {
      const source = c.summonAt(c.targets[0]);
      const dest = c.summonAt(c.targets[1]);
      if (!source || !dest) return;
      const was = card(dest.cardId);
      c.log(`${was.name} grafts on ${card(source.cardId).name}'s Powers.`);
      dest.cardId = graftedCopy(dest.cardId, source.cardId, {
        strength: dest.override ? dest.override.strength : (was.strength ?? 0),
        color: colorOf(dest, was),
        level: levelOf(dest, was),
        powers: powersOf(dest, was),
      });
      // The minted card carries the stats the override was supplying, so the
      // override has done its job and would otherwise blank the new Powers.
      dest.override = undefined;
      c.draw(c.me, 1);
    },
  }),
  k.spell('ghostshadow', 'Ghost Shadow', { O: 1 }, {
    text: 'An enemy summon loses 3 attack until end of turn.',
    targets: [T.enemy()],
    effect: (c) => c.buffStrength(c.targets[0], -3, 'turn'),
  }),
  k.spell('wishingclaw', 'Wishing Claw', {}, {
    text: 'Draw 3 cards and take 2 debt.',
    effect: (c) => {
      c.draw(c.me, 3);
      c.addDebt(c.me, 2, 'The claw always wants paying.');
    },
    flipText: 'Shuffle 3 Dread into the enemy\'s deck.',
    flipCost: { mana: { O: 2 } },
    flip: (c) => c.curse(c.opp, 'o-curse-dread', 3),
  }),
  k.trap('lazyeye', 'Trap: Lazy Eye', { O: 1 }, {
    text: 'Put 5 Wounds on the attacking summon.',
    effect: (c) => {
      const a = battleAttacker(c.state);
      if (a) c.wound(a, 5);
    },
  }),
  k.stage('campfire', 'Field: Campfire', { O: 1 }, {
    text: "At the start of your turn, draw a card and Shuffle a Rot into the enemy's deck.",
    stageHooks: {
      onAwake: (c) => {
        c.draw(c.me, 1);
        c.curse(c.opp, 'o-curse-rot', 1);
      },
    },
    flipText: 'Shuffle a Rot into the enemy\'s deck.',
    flip: (c) => c.curse(c.opp, 'o-curse-rot', 1),
  }),
  k.stage('mysterycabin', 'Field: Mystery Cabin', { O: 1 }, {
    text: 'Your Spirits have +1 attack.',
    stageHooks: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Spirit') ? 1 : 0,
    },
  }),
];
