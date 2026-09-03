import { robotCopy } from '../engine/generated';
import { card } from '../engine/registry';
import { registerChoiceResolver } from '../engine/choices';
import { putSummonDirect, toHand } from '../engine/effects';
import { battleAttacker, battleDefender } from '../engine/state';
import type { CardDef, PlayerIdx } from '../engine/types';
import type { GameState, SummonInstance } from '../engine/state';
import { T, colorKit, holderRef, selfRef } from './build';

// Green is Robot: Machines, armour plating, and damage that skips the clash.
const k = colorKit('R', 'r', 'Green', 'Green/spells');

/**
 * Whether the body asking is the only summon its controller keeps in a slot.
 *
 * The leader seat is left out on purpose: a leader is always on the board, so
 * counting it would make "no other summons" a condition nobody could ever meet.
 * Asked from up there the question is only whether the slots are empty, which is
 * what counting exactly one slot body got backwards. A leading Player One is not
 * among the slot bodies, so the old count read an empty board as a failure and a
 * board with one other summon as a pass.
 */
function alone(state: GameState, player: PlayerIdx, self: SummonInstance | null): boolean {
  return state.players[player].slots.every((s) => !s || s.uid === self?.uid);
}

export const greenCards: CardDef[] = [
  k.starter('player1', 'Player One', ['Machine', 'Mortal'], {
    str: 1,
    hp: 4,
    text:
      'Battlecry: If you control no other summons, this gains a Power Shield ' +
      'and +4 attack.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (!me || !alone(c.state, c.me, c.source)) return;
        c.shield(me, 1);
        c.buffStrength(me, 4, 'permanent');
      },
    },
    powers: [
      {
        name: 'New Team',
        cost: { R: 2 },
        text: 'Return a supporter to your hand, then the top card of your deck becomes a supporter.',
        targets: [{ kind: 'supporter', side: 'ally', label: 'a supporter to take back' }],
        effect: (c) => {
          c.returnSupporter(c.targets[0]);
          c.supporterFromDeck(c.me, false);
        },
      },
    ],
  }),

  // --- level 1 --------------------------------------------------------------
  k.summon(1, 'automoton', 'Automoton', ['Machine'], {
    str: 1,
    hp: 4,
    flipText: 'The attached character gains a Power Shield.',
    flip: (c) => c.shield(holderRef(c), 1),
  }),
  k.summon(1, 'chipcrunch', 'Chipcrunch', ['Machine', 'Beast'], {
    text: 'Battlecry: Shuffle the top card of your discard pile into your deck.',
    triggers: { onEnter: (c) => { c.recycleTopDiscard(c.me); } },
    str: 1,
    hp: 2,
    flipText: 'Destroy any enemy active mana pips and sap one of their supporters.',
    // Nothing to empty and nothing left to sap means nothing to ask about, and
    // a costed flip that does nothing still stops the game to offer itself.
    flipUseful: (c) => {
      const them = c.state.players[c.opp];
      return (
        Object.values(them.mana).some((n) => n > 0) || them.supporters.some((s) => !s.sapped)
      );
    },
    flip: (c) => {
      // Pool first: sapping alone is dodged by tapping out early in the turn.
      // The mana always goes; the sap is only put to the player when there is
      // something left standing to spend it on.
      c.clearMana(c.opp);
      const standing = c
        .supportersOf(c.opp)
        .filter((r) => !c.state.players[c.opp].supporters[(r as { index: number }).index]?.sapped);
      if (standing.length > 0) c.choose('sap-supporter', standing, 'Sap which enemy supporter?');
    },
  }),
  k.summon(1, 'cogbeast', 'Cogbeast', ['Machine', 'Beast'], { str: 2, hp: 3,
    flipText: 'The attached character gains 1 HP off your deck.',
    flip: (c) => c.reinforce(holderRef(c), 1),
  }),
  k.summon(1, 'computerbug', 'Computer Bug', ['Machine', 'Hedron'], {
    hp: 1,
    str: 2,
    supporterLock: true,
    text: 'Supporter Lock. The enemy cannot play supporters. At the start of your turn, you take 1 debt.',
    triggers: {
      onAwake: (c) => c.addDebt(c.me, 1, 'The bug bills its keeper.'),
    },
  }),
  k.summon(1, 'defender', 'Defender', ['Machine'], {
    str: 1,
    hp: 5,
    redirect: true,
    text: 'Redirection. When attacked, gains 1 HP first.',
    triggers: {
      onDefend: (c) => {
        const me = selfRef(c);
        if (me) c.reinforce(me, 1);
      },
    },
    flipText: 'The attached character gains a Power Shield.',
    flip: (c) => c.shield(holderRef(c), 1),
  }),
  k.summon(1, 'lapgrob', 'Lapgrob', ['Machine'], {
    str: 1,
    hp: 2,
    text: 'Battlecry: Gains a Power Shield.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (me) c.shield(me, 1);
      },
    },
    flipText: 'The attached character gains a Power Shield.',
    flip: (c) => c.shield(holderRef(c), 1),
  }),
  k.summon(1, 'lightbolbe', 'Lightbolbe', ['Machine'], {
    str: 1,
    hp: 2,
    powers: [
      {
        name: 'Burn Out',
        cost: {},
        sapSelf: true,
        text: 'Destroy this summon and take 2 debt: add 1 colorless mana.',
        effect: (c) => {
          c.state.players[c.me].mana.C += 1;
          c.addDebt(c.me, 2, 'The bulb burns out.');
          const me = selfRef(c);
          if (me && me.kind !== 'leader') c.destroy(me);
        },
      },
    ],
    flipText: 'The attached character gains a Power Shield.',
    flip: (c) => c.shield(holderRef(c), 1),
  }),
  k.summon(1, 'mouse', 'Mouse', ['Machine', 'Beast'], {
    hp: 2,
    str: 2,
    powers: [
      {
        name: 'Click',
        cost: { R: 1 },
        text: 'Deal 1 to an enemy summon.',
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 1),
      },
    ],
    flipText: 'The attached character gains a Power Shield.',
    flip: (c) => c.shield(holderRef(c), 1),
  }),
  k.summon(1, 'pointer', 'Pointer', ['Machine', 'Hedron'], {
    str: 1,
    hp: 2,
    text: 'Battlecry: Prevent a sapped enemy summon from unsapping once.',
    targets: [
      {
        kind: 'summon',
        side: 'enemy',
        label: 'a sapped enemy summon',
        filter: (a) => !!a.summon?.sapped,
      },
    ],
    triggers: {
      onEnter: (c) => {
        if (!c.targets[0]) return;
        const s = c.summonAt(c.targets[0]);
        if (s) s.sapLock = true;
      },
    },
  }),
  k.summon(1, 'slicebot', 'Slicebot', ['Machine', 'Hedron'], { str: 4, hp: 1 }),

  // --- level 2 --------------------------------------------------------------
  k.summon(2, 'badglitch', 'Bad Glitch', ['Machine'], {
    hp: 3,
    str: 2,
    text: 'Battlecry: An enemy summon loses 2 attack.',
    targets: [T.enemy()],
    powers: [
      {
        name: 'Corrupt Data',
        cost: { R: 1 },
        text: 'An enemy summon loses 1 attack.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => c.buffStrength(c.targets[0], -1, 'permanent'),
      },
    ],
    triggers: {
      onEnter: (c) => {
        if (c.targets[0]) c.buffStrength(c.targets[0], -2, 'permanent');
      },
    },
    flipText: 'Each of your characters gains a Power Shield.',
    flipCost: { mana: { R: 2 } },
    flip: (c) => {
      for (const t of c.summonsOf(c.me, true)) c.shield(t, 1);
    },
  }),
  k.summon(2, 'bellobot', 'Bellobot', ['Machine'], {
    str: 1,
    hp: 2,
    text: 'Ally Machines have +1 attack.',
    triggers: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller &&
        def.factions?.includes('Machine') &&
        summon.cardId !== 'r2-bellobot'
          ? 1
          : 0,
    },
  }),
  k.summon(2, 'blackhat', 'Black Hat', ['Mortal', 'Scholar'], {
    str: 2,
    hp: 2,
    powers: [
      {
        name: 'Exploit',
        cost: { R: 1, C: 1 },
        text: 'Move an HP card from an enemy summon onto an ally summon.',
        targets: [T.enemy(), T.ally()],
        effect: (c) => c.moveHp(c.targets[0], c.targets[1], 1),
      },
    ],
  }),
  k.summon(2, 'digital nomad', 'Digital Nomad', ['Mortal', 'Machine'], {
    str: 2,
    hp: 3,
    text: 'Deathrattle: An ally gains a Power Shield.',
    triggers: {
      onDeath: (c) => {
        c.choose('shield-1', c.summonsOf(c.me, true), 'Give which ally a Power Shield?');
      },
    },
  }),
  k.summon(2, 'digitalrabbits', 'Digital Rabbits', ['Machine', 'Beast'], {
    str: 1,
    hp: 3,
    reborn: true,
    text: 'Reborn. Battlecry: Put a Digital Rabbits from your deck into an empty slot.',
    triggers: {
      onEnter: (c) => {
        if (c.emptySlot(c.me) === null) return;
        c.search(c.me, (d) => d.id === 'r2-digitalrabbits', {
          effect: 'rabbits',
          prompt: 'Put a Digital Rabbits into an empty slot',
        });
      },
    },
  }),
  k.summon(2, 'engineer', 'Engineer', ['Mortal', 'Scholar'], {
    hp: 3,
    str: 2,
    powers: [
      {
        name: 'Fabricate',
        cost: { R: 1, C: 1 },
        text: 'Scry 3 for a Machine and play it into an empty slot with 2 extra HP.',
        sapSelf: true,
        effect: (c) => {
          c.dig(c.me, 3, (d) => !!d.factions?.includes('Machine') && d.type === 'summon', {
            effect: 'fabricate',
            prompt: 'Fabricate a Machine with 2 extra HP',
          });
        },
      },
    ],
  }),
  k.summon(2, 'forklift', 'Forklift', ['Machine'], {
    str: 1,
    hp: 4,
    powers: [
      {
        name: 'Reposition',
        cost: {},
        text: 'Return an unsapped supporter to your hand. You may play another supporter this turn.',
        sapSelf: true,
        targets: [
          {
            kind: 'supporter',
            side: 'ally',
            label: 'an unsapped supporter',
            filter: (a2) => !a2.state.players[a2.me].supporters[
              a2.ref.kind === 'supporter' ? a2.ref.index : -1
            ]?.sapped,
          },
        ],
        effect: (c) => {
          if (c.returnSupporter(c.targets[0])) c.state.players[c.me].supportersLeft += 1;
        },
      },
    ],
  }),
  k.summon(2, 'hobbyist', 'Scoobert Engineer', ['Mortal'], {
    str: 2,
    hp: 3,
    powers: [
      {
        name: 'Machine Learning',
        cost: { R: 1 },
        text: "Draw a copy of the top card of the enemy's deck, rebuilt in Robot.",
        sapSelf: true,
        effect: (c) => {
          const deck = c.state.players[c.opp].deck;
          const id = deck.shift();
          if (!id) {
            c.log('Nothing left to salvage.');
            return;
          }
          c.toHand(c.me, robotCopy(id));
          c.state.players[c.opp].discard.push(id);
          c.log(`${card(id).name} is salvaged and rebuilt in Robot.`);
        },
      },
    ],
  }),
  k.summon(2, 'nommer', 'Nommer', ['Machine', 'Beast', 'Hedron'], {
    str: 3,
    hp: 2,
    muffleFlips: true,
    text: 'FLIP effects of its combat damage are muted on any character, and it heals 1 HP for each.',
    powers: [
      {
        name: 'Chew',
        cost: { R: 1 },
        text: 'Deal 2 to an enemy summon. This one heals 1.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => {
          c.damage(c.targets[0], 2);
          const me = selfRef(c);
          if (me) c.unflip(me, 1);
        },
      },
    ],
  }),
  k.summon(2, 'securitybot', 'Security Bot', ['Machine'], {
    str: 1,
    hp: 4,
    text: 'Battlecry: Gains a Power Shield. When attacked, deal 2 to the attacker.',
    triggers: {
      onEnter: (c) => {
        const me = selfRef(c);
        if (me) c.shield(me, 1);
      },
      onDefend: (c) => {
        const a = battleAttacker(c.state);
        if (a) c.damage(a, 2);
      },
    },
    flipText: 'The attached character gains a Power Shield.',
    flip: (c) => c.shield(holderRef(c), 1),
  }),

  // --- level 3 --------------------------------------------------------------
  k.summon(3, 'chemicalmen', 'Chemical Men', ['Machine', 'Mortal'], {
    str: 2,
    hp: 4,
    reborn: true,
    text: 'Reborn. Deathrattle: Your Machines gain a Power Shield.',
    triggers: {
      onDeath: (c) => {
        for (const ref of c.summonsOf(c.me, true)) {
          const s = c.summonAt(ref);
          if (s && card(s.cardId).factions?.includes('Machine')) c.shield(ref, 1);
        }
      },
    },
  }),
  k.summon(3, 'cybersiren', 'Cyber Siren', ['Machine'], {
    str: 2,
    hp: 5,
    powers: [
      {
        name: 'Enthrall',
        cost: { R: 3, C: 1 },
        text: 'Take control of an enemy summon, sap it, and rebuild it and its HP cards in Robot.',
        targets: [T.enemy()],
        sapSelf: true,
        effect: (c) => {
          // Held before the seize, because the ref points at a slot the summon
          // is about to leave; the body itself is the same object.
          const taken = c.summonAt(c.targets[0]);
          if (taken && c.takeControl(c.targets[0])) {
            taken.cardId = robotCopy(taken.cardId);
            // The HP cards ride along with the body, so they are rebuilt too
            // rather than staying in their old colours.
            for (const h of taken.hp) h.cardId = robotCopy(h.cardId);
          }
        },
      },
    ],
  }),
  k.summon(3, 'greenstar', 'Green Star', ['Star', 'Machine'], {
    str: 2,
    hp: 6,
    text: 'At the start of your turn, each of your characters gains 1 HP.',
    powers: [
      {
        name: 'Solar Flare',
        cost: { R: 2 },
        text: 'Deal 1 to every enemy summon.',
        sapSelf: true,
        effect: (c) => {
          for (const ref of c.summonsOf(c.opp)) c.damage(ref, 1);
        },
      },
    ],
    triggers: {
      onAwake: (c) => {
        for (const ref of c.summonsOf(c.me, true)) c.reinforce(ref, 1);
      },
    },
  }),
  k.summon(3, 'hatemachine', 'Hate Machine', ['Machine'], {
    str: 5,
    hp: 3,
    text: 'At the start of your turn, you take 2 debt.',
    triggers: {
      onAwake: (c) => c.addDebt(c.me, 2, 'The hate machine bills its keeper.'),
    },
    powers: [
      {
        name: 'Vent',
        cost: {},
        text: 'Deal 3 to an enemy summon.',
        sapSelf: true,
        targets: [T.enemy()],
        effect: (c) => c.damage(c.targets[0], 3),
      },
    ],
  }),
  k.summon(3, 'infinitemind', 'Infinite Mind', ['Machine', 'Scholar'], {
    str: 6,
    hp: 6,
    voidsDiscard: true,
    text:
      'At the start of your turn, draw a card. Your cards that go to the discard pile are annihilated.',
    triggers: { onAwake: (c) => c.draw(c.me, 1) },
  }),
  k.summon(3, 'maliciouscode', 'Malicious Code', ['Machine'], {
    str: 3,
    hp: 4,
    powers: [
      {
        name: 'Overwrite',
        cost: { R: 1 },
        text: 'An enemy summon loses 2 attack.',
        targets: [T.enemy()],
        sapSelf: true,
        effect: (c) => c.buffStrength(c.targets[0], -2, 'permanent'),
      },
    ],
  }),
  k.summon(3, 'scoobertsingularity', 'Scoobert Singularity', ['Machine', 'Star'], {
    str: 2,
    hp: 4,
    spellEcho: true,
    text: 'Your spells cast twice. When you play a Machine, draw a card and Mill 1.',
    triggers: {
      onSummonPlayed: (c) => {
        const played = c.summonAt(c.targets[0]);
        if (!played || played.owner !== c.me) return;
        if (!card(played.cardId).factions?.includes('Machine')) return;
        c.draw(c.me, 1);
        c.mill(c.me, 1);
      },
    },
  }),
  k.summon(3, 'shapethink', 'Shapethink', ['Hedron', 'Scholar'], {
    str: 2,
    hp: 5,
    text:
      'At the start of your turn, Scry 3 for any card. ' +
      'When an enemy uses a Power, deal 1 to them.',
    triggers: {
      onEnemyPower: (c) => {
        if (c.targets[0]) c.damage(c.targets[0], 1);
      },
      onAwake: (c) => {
        c.dig(c.me, 3, () => true);
      },
    },
  }),
  k.summon(3, 'strangestation', 'Strange Station', ['Machine', 'Star'], {
    str: 2,
    hp: 7,
    stationary: true,
    redirect: true,
    text: 'Redirection. Stationary. Your summons have +1 attack.',
    triggers: {
      strengthBonus: ({ controller, summon }) =>
        summon.owner === controller && !summon.isLeader ? 1 : 0,
    },
  }),

  // --- spells, traps and stages ---------------------------------------------
  k.spell('plugzap', 'Plug Zap', { R: 2, C: 1 }, {
    text: 'Deal 2 to a character.',
    targets: [T.anyOrLeader('a character')],
    effect: (c) => c.damage(c.targets[0], 2),
  }),
  k.spell('battery', 'Battery', {}, {
    text: 'An ally gains 2 HP off your deck, then draw a card.',
    targets: [T.allyOrLeader()],
    effect: (c) => {
      c.reinforce(c.targets[0], 2);
      c.draw(c.me, 1);
    },
  }),
  k.spell('download', 'Download', { R: 1 }, {
    text: "Search the enemy's debt for a card and rebuild it in Robot: it costs its total in Robot for you.",
    effect: (c) => {
      const refs = c.state.players[c.opp].debt.map((_, index) => ({
        kind: 'debt' as const,
        player: c.opp,
        index,
      }));
      if (refs.length === 0) {
        c.log('Nothing to download.');
        return;
      }
      c.choose('download', refs, 'Download which card?');
    },
  }),
  k.spell('grab', 'Grab', { R: 2 }, {
    text: 'Move 2 HP cards from an enemy summon onto an ally summon.',
    targets: [T.enemy(), T.ally()],
    effect: (c) => c.moveHp(c.targets[0], c.targets[1], 2),
    flipText: 'Each of your characters gains a Power Shield.',
    flipCost: { mana: { R: 2 } },
    flip: (c) => {
      for (const t of c.summonsOf(c.me, true)) c.shield(t, 1);
    },
  }),
  k.spell('npcgenerator', 'NPC Generator', { R: 1, C: 1 }, {
    text: 'Fill your empty slots with Automotons. Heal 1 debt.',
    effect: (c) => {
      // One pass over the slots: a 0-HP arrival dies on the spot when the deck
      // is out of cards, and its slot must not be offered a second body.
      const slots = c.state.players[c.me].slots;
      for (let slot = 0; slot < slots.length; slot++) {
        if (!slots[slot]) {
          c.putSummon(c.me, 'r1-automoton', slot, { strength: 1, color: 'R', hp: 4, level: 1 });
        }
      }
      c.clearDebt(c.me, 1);
    },
  }),
  k.trap('siphon', 'Trap: Wiretap', { R: 1 }, {
    spellTrap: true,
    text: 'Spell Trap. Counter the spell and add a copy of it to your hand, rebuilt in Robot.',
    effect: (c) => {
      const sp = c.state.pending?.spell;
      if (!sp) return;
      c.toHand(c.me, robotCopy(sp.cardId));
      c.log(`${card(sp.cardId).name} is copied and rebuilt in Robot.`);
    },
  }),
  k.spell('videogame', 'Video Game', { R: 1 }, {
    text: 'Draw 2 cards, then put a card from your hand under an ally as HP.',
    targets: [T.allyOrLeader()],
    effect: (c) => {
      c.draw(c.me, 2);
      const hand = c.state.players[c.me].hand;
      if (hand.length === 0) return;
      const refs = hand.map((_, i) => ({ kind: 'hand' as const, player: c.me, index: i }));
      c.choose('stack-hp-from-hand', refs, 'Put which card under it as HP?', {
        optional: true,
        at: c.targets[0],
      });
    },
  }),
  k.trap('stundevice', 'Trap: Stun Device', { R: 1 }, {
    text: 'The defending summon gains a Power Shield.',
    effect: (c) => {
      const d = battleDefender(c.state);
      if (d) c.shield(d, 1);
    },
  }),
  k.stage('connect', 'Field: Connect', { R: 1, C: 1 }, {
    text: 'Your Machines have +1 attack.',
    stageHooks: {
      strengthBonus: ({ controller, summon, def }) =>
        summon.owner === controller && def.factions?.includes('Machine') ? 1 : 0,
    },
    flipText: 'The attached character gains a Power Shield.',
    flip: (c) => c.shield(holderRef(c), 1),
  }),
  k.stage('thedodecahedron', 'Field: The Dodecahedron', { R: 1, C: 1 }, {
    text:
      'Your Machines gain a Power Shield when played. When you play a Hedron, ' +
      'shuffle a card from your discard pile into your deck.',
    stageHooks: {
      onSummonPlayed: (c) => {
        const ref = c.targets[0];
        if (ref.kind !== 'summon' || ref.player !== c.me) return;
        const s = c.summonAt(ref);
        if (!s) return;
        const def = card(s.cardId);
        if (def.factions?.includes('Machine')) c.shield(ref, 1);
        if (def.factions?.includes('Hedron')) c.recycleTopDiscard(c.me);
      },
    },
  }),
];

// The other halves of Digital Rabbits and Fabricate: what happens to the
// revealed pick. Unpicked cards always go to the bottom of the deck.
registerChoiceResolver('rabbits', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  const p = state.players[choice.player];
  if (pick.index !== undefined) {
    const [id] = cards.splice(pick.index, 1);
    const slot = p.slots.findIndex((x) => x === null);
    if (slot < 0) toHand(state, choice.player, id);
    else {
      putSummonDirect(state, choice.player, id, slot, {
        strength: 2,
        color: 'R',
        hp: 3,
        level: 2,
      });
    }
  }
  p.deck.push(...cards);
});

registerChoiceResolver('fabricate', (state, choice, pick) => {
  const cards = [...(choice.cards ?? [])];
  const p = state.players[choice.player];
  if (pick.index !== undefined) {
    const [id] = cards.splice(pick.index, 1);
    const slot = p.slots.findIndex((x) => x === null);
    if (slot < 0) toHand(state, choice.player, id);
    else {
      putSummonDirect(state, choice.player, id, slot, {
        strength: 0,
        color: 'R',
        hp: (card(id).hp ?? 1) + 2,
        asPrinted: true,
      });
    }
  }
  p.deck.push(...cards);
});
