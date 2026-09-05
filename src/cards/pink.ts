import type { CardDef, TargetSpec } from '../engine/types';
import { battleAttacker, colorOf, livingOpponents } from '../engine/state';
import { card } from '../engine/registry';
import { T, colorKit, selfRef } from './build';

// Candy is the trade colour: Stores sell effects to other players for their
// debt and the seller's Love, Love scales the payoffs, and debt is the price
// of everything. Saccharine is the tribe of the living sweets; the mortal
// shopkeepers who sell them carry no tribe of the colour. Bodies sit a point
// over the neutral line, because the Store half of a card is worth nothing
// against an opponent who never buys. Design notes: claude-notes/candy-faction.md.
const k = colorKit('K', 'k', 'Pink', 'Pink/Spells');

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

const anyDamaged = (state: import('../engine/state').GameState) =>
  state.players.some(
    (pl) =>
      !pl.eliminated &&
      [...pl.slots, pl.leader].some((s) => s && s.hp.some((h) => h.flipped)),
  );

export const pinkCards: CardDef[] = [
  // --- leader ----------------------------------------------------------------
  k.starter('PinkDeus', 'Pink Deus', ['Saccharine', 'Ernum'], {
    str: 3,
    hp: 4,
    powers: [
      {
        name: 'Charm',
        cost: {},
        text: 'Gain 1 Love.',
        sapSelf: true,
        effect: (c) => c.gainLove(c.me, 1),
      },
      {
        name: 'Bailout',
        cost: { K: 2 },
        text: 'Heal 2 debt.',
        sapSelf: true,
        effect: (c) => c.clearDebt(c.me, 2),
      },
    ],
  }),

  // --- level 1 ---------------------------------------------------------------
  k.summon(1, 'SugarBug', 'Sugar Bug', ['Saccharine', 'Beast'], {
    str: 4,
    hp: 2,
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.summon(1, 'apprentice', 'Apprentice', ['Saccharine', 'Mortal'], {
    str: 3,
    hp: 3,
    text: 'Store: Draw 2 cards.',
    store: {
      effect: (c) => c.draw(c.me, 2),
    },
  }),
  k.summon(1, 'candymouse', 'Candy Mouse', ['Saccharine', 'Beast'], {
    str: 2,
    hp: 3,
    text: 'Battlecry: Scry 3 for a Saccharine.',
    triggers: {
      onEnter: (c) => c.dig(c.me, 3, (d) => !!d.factions?.includes('Saccharine')),
    },
  }),
  k.summon(1, 'gingerbreadgirl', 'Gingerbread Girl', ['Saccharine', 'Living'], {
    str: 2,
    hp: 3,
    text: 'Store: Heal a character for 2.',
    store: {
      targets: [damagedCharacter('a character to heal')],
      useful: anyDamaged,
      effect: (c) => {
        if (c.targets[0]) c.unflip(c.targets[0], 2);
      },
    },
  }),
  k.summon(1, 'icecreambird', 'Ice Cream Bird', ['Saccharine', 'Beast'], {
    str: 3,
    hp: 2,
    text: 'Battlecry: Scry 2 for any card.',
    triggers: { onEnter: (c) => c.dig(c.me, 2, () => true) },
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.summon(1, 'livingbubbles', 'Living Bubbles', ['Saccharine', 'Living'], {
    str: 2,
    hp: 3,
    flipText: 'Return this card to your hand.',
    flip: (c) => {
      c.returnThis();
    },
  }),
  k.summon(1, 'livingcandy', 'Living Candy', ['Saccharine', 'Living'], {
    str: 2,
    hp: 2,
    text: 'Battlecry: Gain 1 Love.',
    triggers: { onEnter: (c) => c.gainLove(c.me, 1) },
    flipText: 'Return this card to your hand.',
    flip: (c) => {
      c.returnThis();
    },
  }),
  k.summon(1, 'lovecat', 'Love Cat', ['Saccharine', 'Beast'], {
    str: 2,
    hp: 2,
    text: 'Deathrattle: Gain 2 Love.',
    triggers: { onDeath: (c) => c.gainLove(c.me, 2) },
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.summon(1, 'patheticbonbon', 'Pathetic Bonbon', ['Saccharine'], {
    str: 1,
    hp: 4,
    redirect: true,
    text: 'Redirection.',
    flipText: 'Gain 3 Love.',
    flip: (c) => c.gainLove(c.me, 3),
  }),
  k.summon(1, 'sleepybeast', 'Sleepy Beast', ['Saccharine', 'Beast'], {
    str: 4,
    hp: 4,
    text: 'Arrives sapped.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (me) c.sap(me);
      },
    },
  }),

  // --- level 2 ---------------------------------------------------------------
  k.summon(2, 'Briber', 'Briber', ['Mortal'], {
    str: 3,
    hp: 4,
    text: 'Battlecry: Each enemy heals 1 debt. Gain 1 Love for each.',
    triggers: {
      onEnter: (c) => {
        const foes = livingOpponents(c.state, c.me);
        for (const foe of foes) c.clearDebt(foe, 1);
        c.gainLove(c.me, foes.length);
      },
    },
  }),
  k.summon(2, 'CandyGuardSeller', 'CandyGuard Seller', ['Saccharine', 'Mortal', 'Scholar'], {
    str: 3,
    hp: 3,
    text: 'Store: Put a CandyGuard into an empty slot.',
    store: {
      useful: (state, user) => state.players[user].slots.some((s) => s === null),
      effect: (c) => {
        const slot = c.emptySlot(c.me);
        if (slot === null) return;
        c.putSummon(c.me, 'k-candyguard', slot, {
          asPrinted: true,
          strength: 1,
          color: 'K',
          hp: 7,
        });
      },
    },
  }),
  k.summon(2, 'CandyWizard', 'Candy Wizard', ['Mortal', 'Scholar'], {
    str: 3,
    hp: 3,
    powers: [
      {
        name: 'Sprinkle',
        cost: { K: 1 },
        text: 'Gain 1 Love.',
        sapSelf: true,
        effect: (c) => c.gainLove(c.me, 1),
      },
      {
        name: 'Sugar Bolt',
        cost: { K: 2 },
        text: 'Deal 1 to an enemy summon. Love: Effect Damage +1.',
        targets: [T.enemy()],
        effect: (c) => {
          const n = c.spendLove(c.me);
          c.damage(c.targets[0], 1 + n);
        },
      },
    ],
  }),
  k.summon(2, 'GunForHire', 'Gun for Hire', ['Saccharine', 'Mortal', 'Beast'], {
    str: 4,
    hp: 3,
    text: 'Store: Annihilate a non-Candy summon. Store costs +2.',
    // Candy here is the colour, not the tribe: the gun refuses every pink card.
    store: {
      surcharge: 2,
      targets: [
        {
          kind: 'summon',
          side: 'any',
          label: 'a non-Candy summon to annihilate',
          filter: (a) => !!a.summon && !!a.card && colorOf(a.summon, a.card) !== 'K',
        },
      ],
      useful: (state) =>
        state.players.some((pl) =>
          pl.slots.some((s) => s && colorOf(s, card(s.cardId)) !== 'K'),
        ),
      effect: (c) => {
        if (c.targets[0]) c.annihilate(c.targets[0]);
      },
    },
  }),
  k.summon(2, 'HotcakeSeller', 'Hotcake Seller', ['Saccharine', 'Mortal'], {
    str: 3,
    hp: 3,
    text: 'Store: One of your summons gains +2 attack.',
    store: {
      targets: [T.ally('one of your summons')],
      useful: (state, user) => state.players[user].slots.some((s) => s !== null),
      effect: (c) => {
        if (c.targets[0]) c.buffStrength(c.targets[0], 2, 'permanent');
      },
    },
  }),
  k.summon(2, 'Nurse', 'Nurse', ['Mortal'], {
    str: 3,
    hp: 4,
    text: 'Store: Heal a character for 3.',
    store: {
      targets: [damagedCharacter('a character to heal')],
      useful: anyDamaged,
      effect: (c) => {
        if (c.targets[0]) c.unflip(c.targets[0], 3);
      },
    },
  }),
  k.summon(2, 'PrivateDetective', 'Private Detective', ['Mortal', 'Scholar'], {
    str: 3,
    hp: 3,
    text: 'Battlecry: Scry 4 for any card. Store: Scry 4 for any card.',
    triggers: { onEnter: (c) => c.dig(c.me, 4, () => true) },
    store: {
      useful: (state, user) => state.players[user].deck.length > 0,
      effect: (c) => c.dig(c.me, 4, () => true),
    },
  }),
  k.summon(2, 'Recycler', 'Recycler', ['Living'], {
    str: 3,
    hp: 4,
    text: 'Store: Shuffle 5 random cards from your discard pile into your deck.',
    store: {
      useful: (state, user) => state.players[user].discard.length > 0,
      effect: (c) => c.recycleDiscard(c.me, 5),
    },
  }),
  k.summon(2, 'SnoozingGiant', 'Snoozing Giant', ['Saccharine', 'Beast'], {
    str: 4,
    hp: 5,
    text: 'Arrives sapped.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (me) c.sap(me);
      },
    },
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.summon(2, 'spellsell', 'Spell Seller', ['Mortal', 'Scholar'], {
    str: 3,
    hp: 3,
    text: 'Store: Scry 6 for a spell.',
    store: {
      useful: (state, user) => state.players[user].deck.length > 0,
      effect: (c) => c.dig(c.me, 6, (d) => d.type === 'spell'),
    },
  }),

  // --- level 3 ---------------------------------------------------------------
  k.summon(3, 'AncientSugar', 'Ancient Sugar', ['Saccharine', 'Spirit'], {
    str: 4,
    hp: 5,
    text: 'At the start of your turn, gain 1 Love.',
    triggers: { onAwake: (c) => c.gainLove(c.me, 1) },
    powers: [
      {
        // No sap: the pump exists to swing with, and a sapped body cannot.
        name: 'Sugar Rush',
        cost: { K: 1 },
        text: 'Love: Gains +1 attack until end of turn.',
        needsLove: true,
        effect: (c) => {
          const me = selfRef(c);
          const n = c.spendLove(c.me);
          if (me && n > 0) c.buffStrength(me, n, 'turn');
        },
      },
    ],
  }),
  k.summon(3, 'DebtReliever', 'Debt Reliever', ['Saccharine', 'Grinkle'], {
    str: 4,
    hp: 5,
    text: 'Store: Heal 3 debt.',
    store: {
      useful: (state, user) => state.players[user].debtCount > 0,
      effect: (c) => c.clearDebt(c.me, 3),
    },
  }),
  k.summon(3, 'DerangedCandyfolk', 'Deranged Candyfolk', ['Saccharine', 'Mortal'], {
    str: 5,
    hp: 6,
    text: 'Battlecry: You take 2 debt.',
    triggers: { onEnter: (c) => c.addDebt(c.me, 2) },
    powers: [
      {
        name: 'Tantrum',
        cost: { K: 2 },
        text: 'Deal 2 to a summon. Love: Effect Damage +1.',
        sapSelf: true,
        targets: [T.any('a summon to hit')],
        effect: (c) => {
          const n = c.spendLove(c.me);
          c.damage(c.targets[0], 2 + n);
        },
      },
    ],
  }),
  k.summon(3, 'Eidola', 'Eidola', ['Saccharine', 'Spirit'], {
    str: 3,
    hp: 5,
    powers: [
      {
        name: 'Dream',
        cost: {},
        text: 'Love: Draw a card.',
        sapSelf: true,
        needsLove: true,
        effect: (c) => {
          const n = c.spendLove(c.me);
          c.draw(c.me, n);
        },
      },
    ],
  }),
  k.summon(3, 'Final Unicorn', 'Final Unicorn', ['Saccharine', 'Beast', 'Star'], {
    str: 4,
    hp: 6,
    powers: [
      {
        name: 'Final Blessing',
        cost: { K: 2 },
        text: 'Heal a character for 2. Love: Heal 1 more.',
        sapSelf: true,
        targets: [damagedCharacter('a character to heal')],
        effect: (c) => {
          const n = c.spendLove(c.me);
          if (c.targets[0]) c.unflip(c.targets[0], 2 + n);
        },
      },
    ],
    flipText: 'Return this card to your hand.',
    flipCost: { mana: { K: 1 } },
    flip: (c) => {
      c.returnThis();
    },
  }),
  k.summon(3, 'HyperCapitalist', 'Hyper Capitalist', ['Saccharine', 'Mortal'], {
    str: 4,
    hp: 5,
    text: 'When another player buys from one of your Stores, draw a card.',
    triggers: { onStoreSold: (c) => c.draw(c.me, 1) },
    powers: [
      {
        name: 'Golden Handshake',
        cost: { K: 2 },
        text: 'Draw a card and gain 1 Love.',
        sapSelf: true,
        effect: (c) => {
          c.draw(c.me, 1);
          c.gainLove(c.me, 1);
        },
      },
    ],
  }),
  k.summon(3, 'InfiniteLove', 'Infinite Love', ['Saccharine', 'Beast'], {
    str: 1,
    hp: 1,
    text: 'Arrives sapped. Battlecry, Love: Gains +1 attack and 1 HP off your deck.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (!me) return;
        c.sap(me);
        const n = c.spendLove(c.me);
        if (n <= 0) return;
        c.buffStrength(me, n, 'permanent');
        c.reinforce(me, n);
      },
    },
  }),
  k.summon(3, 'LastLollipop', 'Last Lollipop', ['Saccharine'], {
    str: 3,
    hp: 7,
    redirect: true,
    stationary: true,
    text: 'Redirection. Stationary. When attacked, gain 1 Love. At the end of your turn, your other Saccharine allies gain +1 attack.',
    triggers: {
      onDefend: (c) => c.gainLove(c.me, 1),
      // "Allies" here reaches the leader too, by the user's own ruling.
      onEndTurn: (c) => {
        for (const ref of c.summonsOf(c.me, true)) {
          const s = c.summonAt(ref);
          if (!s || s === c.source) continue;
          if (!card(s.cardId).factions?.includes('Saccharine')) continue;
          c.buffStrength(ref, 1, 'permanent');
        }
      },
    },
    powers: [
      {
        name: 'Lick',
        cost: {},
        text: 'Spend 1 HP off this: gain 1 Love.',
        sapSelf: true,
        hpCost: 1,
        effect: (c) => {
          const me = selfRef(c);
          if (!me) return;
          c.rawDamage(me, 1);
          c.gainLove(c.me, 1);
        },
      },
    ],
  }),
  k.summon(3, 'SweetHarmony', 'Sweet Harmony', ['Saccharine', 'Star'], {
    str: 4,
    hp: 5,
    powers: [
      {
        name: 'Harmonize',
        cost: {},
        text: 'Love: Heal 1 debt.',
        sapSelf: true,
        needsLove: true,
        effect: (c) => {
          const n = c.spendLove(c.me);
          c.clearDebt(c.me, n);
        },
      },
    ],
  }),

  // --- spells, field and traps ------------------------------------------------
  k.spell('Candycane', 'Candy Cane', { K: 1 }, {
    text: 'An ally character gains +2 attack until end of turn. Love: +1 attack.',
    targets: [T.allyOrLeader()],
    effect: (c) => {
      const n = c.spendLove(c.me);
      c.buffStrength(c.targets[0], 2 + n, 'turn');
    },
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.spell('DarkCandy', 'Dark Candy', { K: 4 }, {
    text: 'Deal 1 to every enemy summon. Love: Effect Damage +1.',
    effect: (c) => {
      const n = c.spendLove(c.me);
      for (const foe of livingOpponents(c.state, c.me)) {
        for (const ref of c.summonsOf(foe)) c.damage(ref, 1 + n);
      }
    },
    flipText: 'Return this card to your hand.',
    flipCost: { mana: { K: 1 } },
    flip: (c) => {
      c.returnThis();
    },
  }),
  k.stage('FieldClearanceSale', 'Field: Clearance Sale', { K: 3, C: 1 }, {
    text: 'Your Stores may be used twice per turn and cost 1 less. At the start of your turn, draw a card. When another player buys from one of your Stores, heal 1 debt.',
    storeBoost: true,
    stageHooks: {
      onAwake: (c) => c.draw(c.me, 1),
      onStoreSold: (c) => c.clearDebt(c.me, 1),
    },
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.spell('GiftOfGiving', 'Gift of Giving', {}, {
    text: 'The enemy draws a card. Gain 2 Love.',
    effect: (c) => {
      c.draw(c.opp, 1);
      c.gainLove(c.me, 2);
    },
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.spell('LineGoesUp', 'Line Goes Up', { K: 1 }, {
    text: 'Gain 1 Love for every 4 debt you carry.',
    effect: (c) => {
      const earned = Math.floor(c.state.players[c.me].debtCount / 4);
      if (earned > 0) c.gainLove(c.me, earned);
      else c.log('The line is flat.');
    },
  }),
  k.spell('Loan', 'Loan', {}, {
    text: 'A player draws 2 cards and takes 2 debt.',
    targets: [
      {
        kind: 'summon',
        side: 'any',
        includeLeader: true,
        label: 'a player, by their leader',
        filter: (a) => a.ref.kind === 'leader',
      },
    ],
    effect: (c) => {
      const t = c.targets[0];
      if (t?.kind !== 'leader') return;
      c.draw(t.player, 2);
      c.addDebt(t.player, 2, `${c.state.players[t.player].name} takes 2 debt on the loan.`);
    },
  }),
  k.spell('LoveForAPrice', 'Love for a Price', { K: 2 }, {
    text: 'Gain 2 Love and draw a card.',
    effect: (c) => {
      c.gainLove(c.me, 2);
      c.draw(c.me, 1);
    },
    flipText: 'Gain 1 Love.',
    flip: (c) => c.gainLove(c.me, 1),
  }),
  k.spell('cuffed', 'Cuffed', { K: 2 }, {
    text: 'An enemy summon becomes Stationary. Annihilate this card.',
    annihilateAfterCast: true,
    targets: [T.enemy()],
    effect: (c) => {
      const s = c.summonAt(c.targets[0]);
      if (!s) return;
      s.rooted = true;
      c.log(`${card(s.cardId).name} is cuffed in place.`);
    },
    flipText: 'Return this card to your hand.',
    flipCost: { mana: { K: 1 } },
    flip: (c) => {
      c.returnThis();
    },
  }),
  k.trap('trapExpensiveSecurity', 'Trap: Expensive Security', { K: 1 }, {
    text: 'Annihilate the attacking summon. Take 2 debt.',
    // A leader cannot be annihilated without ending the game, so an attack led
    // by one is not a window this can answer: the Scooba ruling.
    trapUseful: (c) => {
      const a = battleAttacker(c.state);
      const s = a ? c.summonAt(a) : null;
      return !!s && !s.isLeader;
    },
    effect: (c) => {
      const a = battleAttacker(c.state);
      if (a) c.annihilate(a);
      c.addDebt(c.me, 2, `${c.state.players[c.me].name} takes 2 debt for the security bill.`);
    },
  }),
  k.trap('trapSugarCrash', 'Trap: Sugar Crash', { K: 1 }, {
    spellTrap: true,
    text: 'Spell Trap. If the enemy has played more than 4 cards this turn, counter the spell, annihilate one of their summons and gain 2 Love.',
    trapUseful: (c) => {
      const sp = c.state.pending?.spell;
      return !!sp && c.state.players[sp.caster].playsThisTurn > 4;
    },
    targets: [
      {
        kind: 'summon',
        side: 'enemy',
        label: "a summon of the caster's to annihilate",
        optional: true,
        filter: (a) => {
          const sp = a.state.pending?.spell;
          return !sp || (a.ref.kind === 'summon' && a.ref.player === sp.caster);
        },
      },
    ],
    effect: (c) => {
      if (c.targets[0]) c.annihilate(c.targets[0]);
      c.gainLove(c.me, 2);
    },
  }),

  // The token CandyGuard Seller puts down. Never drafted: it arrives only
  // through the Store, into the buyer's own slot, off the buyer's own deck.
  {
    id: 'k-candyguard',
    name: 'CandyGuard',
    color: 'K',
    type: 'summon',
    level: 1,
    strength: 1,
    hp: 7,
    redirect: true,
    text: 'Redirection.',
    uncollectible: true,
    factions: ['Saccharine'],
    art: 'Cardgame/Pink/Extras/CandyGuard.png',
    artist: 'klabss',
    num: 'CGD',
  },
];
