import { card } from '../engine/registry';
import { registerChoiceResolver } from '../engine/choices';
import { log, toHand } from '../engine/effects';
import { coloredBanana, graftedCopy, malwareCopy, oilCopy, robotCopy } from '../engine/generated';
import {
  colorOf,
  findSummon,
  levelOf,
  otherPlayer,
  powersOf,
  remainingHp,
} from '../engine/state';
import { T, selfRef, tripleKit } from './build';
import type { CardDef } from '../engine/types';

/**
 * The ten three-colour legends, one per combination. Only a leader carrying all
 * three colours can run one, and leading a deck is a seat any body may take, so
 * each of these is the key to its own identity: you lead with it or you never
 * cast it. Every one is level 3 and prints Legendary off `color3` alone.
 */
// The trio names the art folder; the first colour is the frame, and is also
// what the card pays when it is faced as a supporter, so the two are not in
// the same order the way a dual pair's letters are.
const bgp = tripleKit('BGP', 'F', 'R', 'O');
const bgr = tripleKit('BGR', 'R', 'F', 'P');
const bgy = tripleKit('BGY', 'F', 'R', 'S');
const bpy = tripleKit('BPY', 'S', 'F', 'O');
const brp = tripleKit('BRP', 'O', 'F', 'P');
const bry = tripleKit('BRY', 'F', 'P', 'S');
const gpy = tripleKit('GPY', 'O', 'R', 'S');
const grp = tripleKit('GRP', 'R', 'P', 'O');
const gry = tripleKit('GRY', 'P', 'R', 'S');
const ryp = tripleKit('RYP', 'P', 'O', 'S');

/**
 * The supporter Banana Mage hands across the table. Neutral, so it pays
 * colourless, and uncollectible because Joke is the only thing that makes one.
 */
export const BANANA: CardDef = {
  id: 'n-banana',
  name: 'Banana',
  color: 'N',
  type: 'spell',
  neutral: true,
  uncollectible: true,
  level: 1,
  num: 'GEN',
  text: 'Supporter',
  art: 'Cardgame/Extras/Banana.png',
  artist: 'klabss',
};

export const tripleCards: CardDef[] = [
  BANANA,
  bgp.summon('Overknower', 'Overknower', ['Spirit', 'Scholar'], {
    str: 2,
    hp: 7,
    spellImmune: true,
    freeSpells: true,
    text: 'Spell Immunity. Your spells cost no mana while you control no summons.',
    powers: [
      {
        name: 'Madness',
        cost: { F: 1, R: 1, O: 1 },
        text: "Shuffle 4 Rot into the enemy's deck.",
        sapSelf: true,
        effect: (c) => c.curse(c.opp, 'o-curse-rot', 4),
      },
    ],
  }),

  bgr.summon('Screener', 'Screener', ['Machine'], {
    str: 3,
    hp: 5,
    text: 'Each ally Machine with 1 HP left gives Effect Damage +1.',
    triggers: {
      effectDamageBonus: ({ state, controller }) => {
        let n = 0;
        for (const s of state.players[controller].slots) {
          if (!s || s.cardId === 'm-bgr-screener') continue;
          if (!card(s.cardId).factions?.includes('Machine')) continue;
          if (remainingHp(s) === 1) n++;
        }
        return n;
      },
    },
    powers: [
      {
        name: 'Static',
        cost: { F: 1, R: 1, P: 1 },
        text: "Scry 5 of the enemy's deck for any card, rebuilt in Robot.",
        sapSelf: true,
        effect: (c) => c.raidDeck(c.opp, c.me, 5, 'static-raid'),
      },
    ],
  }),

  bgy.summon('Seer Altine', 'Seer Altine', ['Scholar', 'Star'], {
    str: 2,
    hp: 6,
    text:
      'At the start of your turn, the top card of your deck becomes a sapped supporter, ' +
      'then draw a card.',
    triggers: {
      onAwake: (c) => {
        c.supporterFromDeck(c.me);
        c.draw(c.me, 1);
      },
    },
    powers: [
      {
        name: 'Long Sight',
        cost: { F: 1, R: 1, S: 1 },
        text: 'Heal an ally 2, then Scry 5 for any card and put it under that ally as face-down HP.',
        sapSelf: true,
        targets: [T.allyOrLeader()],
        effect: (c) => {
          c.unflip(c.targets[0], 2);
          c.dig(c.me, 5, () => true, {
            effect: 'long-sight',
            prompt: 'Put a card under that ally',
            at: c.targets[0],
          });
        },
      },
      {
        name: 'Ultimate Progress',
        cost: { C: 1 },
        text: 'Annihilate an ally summon, then pay off 3 debt.',
        targets: [T.ally()],
        effect: (c) => {
          c.annihilate(c.targets[0]);
          c.clearDebt(c.me, 3);
        },
      },
    ],
  }),

  bpy.summon('BananaMage', 'Banana Mage', ['Living', 'Scholar'], {
    str: 0,
    hp: 1,
    text: 'Battlecry: Each of your characters heals 2.',
    triggers: {
      onEnter: (c) => {
        for (const ref of c.summonsOf(c.me, true)) c.unflip(ref, 2);
      },
    },
    powers: [
      {
        name: 'Joke',
        cost: { S: 1 },
        text: 'Your opponent gains 1 supporter in their own color and takes 3 debt.',
        sapSelf: true,
        effect: (c) => {
          const them = card(c.state.players[c.opp].leaderCardId);
          c.giveSupporter(
            c.opp,
            them.color === 'N' || them.neutral ? BANANA.id : coloredBanana(BANANA.id, them.color),
          );
          c.addDebt(c.opp, 3, 'Nobody laughed.');
        },
      },
      {
        name: 'Little Curse',
        cost: { O: 1, F: 1 },
        text: 'Deal 1 to a summon.',
        sapSelf: true,
        targets: [T.any()],
        effect: (c) => c.damage(c.targets[0], 1),
      },
    ],
  }),

  brp.summon('DecayingGrinkleGod', 'Decaying Grinkle God', ['Grinkle', 'Spirit'], {
    str: 2,
    hp: 3,
    text: 'At the start of your turn, your Grinkles gain +1 attack and this loses 1 HP.',
    triggers: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me, true)) {
          const s = c.summonAt(ref);
          if (s && card(s.cardId).factions?.includes('Grinkle')) c.buffStrength(ref, 1, 'permanent');
        }
        // Raw, so no Effect Damage bonus inflates the upkeep it pays.
        const me = selfRef(c);
        if (me) c.rawDamage(me, 1);
      },
    },
    powers: [
      {
        // Nine pips across three colours is the brake, so this one does not sap.
        name: 'Grinkle Rot',
        cost: { F: 2, P: 2, O: 2 },
        text: 'Destroy the enemy leader.',
        effect: (c) => c.destroy({ kind: 'leader', player: c.opp }),
      },
    ],
  }),

  bry.summon('DrownedWanderer', 'Drowned Wanderer', ['Mortal', 'Fish'], {
    str: 2,
    hp: 3,
    text: 'Has +1 attack for each summon in your debt zone.',
    triggers: {
      strengthBonus: ({ state, controller, summon }) => {
        if (summon.cardId !== 'm-bry-drownedwanderer' || summon.owner !== controller) return 0;
        return state.players[controller].debt.filter((id) => card(id).type === 'summon').length;
      },
    },
    powers: [
      {
        name: 'Wash Ashore',
        cost: { F: 1, P: 1, S: 1 },
        text: 'Draw 5 cards. Put any summons among them into empty slots with +1 attack and 1 extra HP, then discard the rest.',
        sapSelf: true,
        effect: (c) => {
          const p = c.state.players[c.me];
          const drawn = p.deck.splice(0, 5);
          for (const id of drawn) {
            const def = card(id);
            const slot = def.type === 'summon' ? c.emptySlot(c.me) : null;
            if (slot === null) {
              p.discard.push(id);
              continue;
            }
            const landed = c.putSummon(c.me, id, slot, {
              strength: def.strength ?? 0,
              color: def.color,
              hp: (def.hp ?? 1) + 1,
              asPrinted: true,
            });
            if (!landed) {
              p.discard.push(id);
              continue;
            }
            // The body plays as its own card, so the strength it arrives with is
            // the printed one and the +1 has to be laid on top. Passing it as an
            // override instead replaces the printed line and is dropped outright
            // by asPrinted, which is how this card spent its life granting the
            // extra HP and none of the attack.
            c.buffStrength({ kind: 'summon', player: c.me, slot }, 1, 'permanent');
          }
        },
      },
    ],
  }),

  gpy.summon('ObscureSlime', 'Obscure Slime', [], {
    str: 3,
    hp: 6,
    powers: [
      {
        name: 'Goop',
        cost: {},
        text: 'Deal 2 to a summon.',
        sapSelf: true,
        targets: [T.any()],
        effect: (c) => c.damage(c.targets[0], 2),
      },
      {
        name: 'Melt',
        cost: { O: 1, R: 1, S: 1 },
        text: 'Destroy an enemy supporter.',
        sapSelf: true,
        targets: [T.enemySupporter()],
        effect: (c) => {
          c.destroySupporter(c.targets[0]);
        },
      },
    ],
  }),

  grp.summon('HorribleMalware', 'Horrible Malware', ['Machine', 'Spirit'], {
    str: 2,
    hp: 3,
    text: 'Whenever your opponent casts a spell, you gain a copy rebuilt in Oil, its cost split evenly between Oil, Robot and Pepper.',
    triggers: {
      onEnemySpellCast: (c) => {
        const ref = c.targets[0];
        if (!ref || ref.kind !== 'discard') return;
        const id = c.state.players[ref.player].discard[ref.index];
        if (!id) return;
        c.toHand(c.me, malwareCopy(id));
      },
    },
    powers: [
      {
        name: 'Infect',
        cost: { P: 1, O: 1, R: 1 },
        text: 'Cast Virus.',
        sapSelf: true,
        // Virus asks for the same one enemy summon, so the ctx passes straight
        // through and the two cards can never drift apart.
        targets: [T.enemy()],
        effect: (c) => {
          card('m-rg-virus').effect?.(c);
        },
      },
    ],
  }),

  gry.summon('SpiritOfSolstice', 'Spirit of Solstice', ['Living', 'Spirit'], {
    str: 2,
    hp: 3,
    text: 'Your Living summons have +1 attack and gain 1 HP at the start of your turn.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && !summon.isLeader && def.factions?.includes('Living') ? 1 : 0,
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me)) {
          const s = c.summonAt(ref);
          if (s && card(s.cardId).factions?.includes('Living')) c.reinforce(ref, 1);
        }
      },
    },
    powers: [
      {
        name: 'Solstice',
        cost: { R: 1, P: 1, S: 1 },
        text: 'Each of your Living characters heals 1 and gains a Power Shield, then deal 1 to every enemy summon.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.me, true)) {
            const s = c.summonAt(ref);
            if (!s || !card(s.cardId).factions?.includes('Living')) continue;
            c.unflip(ref, 1);
            c.shield(ref, 1);
          }
          for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
        },
      },
    ],
  }),

  ryp.summon('LivingCurse', 'Living Curse', ['Spirit'], {
    str: 3,
    hp: 5,
    text: 'Battlecry: Scry 6 for a spell and gain its effect as a Power with its cost rebuilt in Oil.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (!me) return;
        c.dig(c.me, 6, (d) => d.type === 'spell', {
          effect: 'living-curse',
          prompt: 'Take a spell as a Power',
          at: me,
        });
      },
    },
    powers: [
      {
        name: 'Offering',
        cost: { P: 1, O: 1, S: 1 },
        text: 'Draw 3 cards, discard the spells among them, then deal 1 to an enemy summon for each spell discarded.',
        sapSelf: true,
        effect: (c) => {
          const p = c.state.players[c.me];
          const drawn = p.deck.splice(0, 3);
          let spells = 0;
          for (const id of drawn) {
            if (card(id).type === 'spell') {
              p.discard.push(id);
              spells++;
            } else {
              c.toHand(c.me, id);
            }
          }
          for (let i = 0; i < spells; i++) {
            c.choose('deal-1', c.summonsOf(c.opp), 'Which enemy summon takes 1?');
          }
        },
      },
    ],
  }),
];

/**
 * Screener's half of Static. The cards came off the enemy's deck, so the player
 * who is not choosing is the one they go back to.
 */
registerChoiceResolver('static-raid', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  const victim = choice.victim ?? otherPlayer(choice.player);
  if (pick.index !== undefined) {
    const [id] = cards.splice(pick.index, 1);
    toHand(state, choice.player, robotCopy(id));
  }
  state.players[victim].deck.push(...cards);
});

/** Seer Altine's Long Sight: one card off the reveal, face down under the ally. */
registerChoiceResolver('long-sight', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  const p = state.players[choice.player];
  if (pick.index !== undefined && choice.at) {
    const [id] = cards.splice(pick.index, 1);
    const self = findSummon(state, choice.at);
    if (!self) p.deck.unshift(id);
    else {
      self.hp.push({ cardId: id, flipped: false });
      log(state, choice.player, `${card(id).name} slides under ${card(self.cardId).name}.`);
    }
  }
  p.deck.push(...cards);
});

/**
 * Living Curse's Battlecry. The picked spell is discarded and comes back as a
 * Power on a card minted for this body, so the face reads what it can now do.
 */
registerChoiceResolver('living-curse', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  const p = state.players[choice.player];
  if (pick.index !== undefined && choice.at) {
    const [id] = cards.splice(pick.index, 1);
    const self = findSummon(state, choice.at);
    if (!self) toHand(state, choice.player, id);
    else {
      p.discard.push(id);
      const was = card(self.cardId);
      self.cardId = graftedCopy(self.cardId, oilCopy(id), {
        strength: self.override ? self.override.strength : (was.strength ?? 0),
        color: colorOf(self, was),
        level: levelOf(self, was),
        powers: powersOf(self, was),
      });
      self.override = undefined;
      log(state, choice.player, `${card(id).name} settles into the curse.`);
    }
  }
  p.deck.push(...cards);
});
