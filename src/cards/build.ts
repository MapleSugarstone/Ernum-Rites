import { refFor } from '../engine/effects';
import type { GameState, SummonInstance } from '../engine/state';
import type {
  CardColour,
  CardDef,
  Color,
  Cost,
  EffectFn,
  Faction,
  FlipCost,
  FlipEffect,
  Power,
  TargetSpec,
  Triggers,
} from '../engine/types';

/** The stat line every card of a level is measured against. */
export const LEVEL_BASE: Record<1 | 2 | 3, { strength: number; hp: number }> = {
  1: { strength: 1, hp: 1 },
  2: { strength: 2, hp: 3 },
  3: { strength: 3, hp: 5 },
};

export interface Extra {
  str?: number;
  hp?: number;
  text?: string;
  powers?: Power[];
  triggers?: Triggers;
  effectDamage?: number;
  woundAmplify?: boolean;
  supporterLock?: boolean;
  freeSpells?: boolean;
  spellTrap?: boolean;
  letSpellResolve?: boolean;
  spellEcho?: boolean;
  cursePotency?: boolean;
  muffleFlips?: boolean;
  voidsDiscard?: boolean;
  stationary?: boolean;
  redirect?: boolean;
  spellImmune?: boolean;
  reborn?: boolean;
  frenzy?: boolean;
  neutral?: boolean;
  flip?: FlipEffect;
  flipText?: string;
  flipCost?: FlipCost;
  flipUseful?: CardDef['flipUseful'];
  color2?: Color;
  color3?: Color;
  /** The art pack has no file for this card yet, so it renders frame-only. */
  noArt?: boolean;
  targets?: TargetSpec[];
  effect?: EffectFn;
  stageHooks?: CardDef['stageHooks'];
}

let counter = 0;
function nextNum(): string {
  counter += 1;
  return String(counter).padStart(3, '0');
}

/** Reset between test runs so collector numbers stay stable. */
export function resetNumbering(): void {
  counter = 0;
}

const ART_ROOT = 'Cardgame';

export function artPath(rel: string): string {
  return `${ART_ROOT}/${rel}.png`;
}

/** Common targeting shorthands, since most cards want one of these. */
export const T = {
  enemy: (label = 'an enemy summon'): TargetSpec => ({ kind: 'summon', side: 'enemy', label }),
  enemyOrLeader: (label = 'an enemy summon or leader'): TargetSpec => ({
    kind: 'summon',
    side: 'enemy',
    includeLeader: true,
    label,
  }),
  ally: (label = 'an ally summon'): TargetSpec => ({ kind: 'summon', side: 'ally', label }),
  allyOrLeader: (label = 'an ally summon or your leader'): TargetSpec => ({
    kind: 'summon',
    side: 'ally',
    includeLeader: true,
    label,
  }),
  any: (label = 'any summon'): TargetSpec => ({ kind: 'summon', side: 'any', label }),
  anyOrLeader: (label = 'any summon or leader'): TargetSpec => ({
    kind: 'summon',
    side: 'any',
    includeLeader: true,
    label,
  }),
  handCard: (label: string, match?: (t: string) => boolean): TargetSpec => ({
    kind: 'hand',
    side: 'ally',
    label,
    filter: match ? (a) => !!a.card && match(a.card.type) : undefined,
  }),
  // A discard flip cost sends the card to the debt zone, so a spell or a trap can
  // be sitting in there. Both of these read "a summon" and have to mean it.
  myDebt: (label = 'a summon in your debt'): TargetSpec => ({
    kind: 'debt',
    side: 'ally',
    label,
    filter: (a) => a.card?.type === 'summon',
  }),
  enemyDebt: (label = "a summon in the enemy's debt"): TargetSpec => ({
    kind: 'debt',
    side: 'enemy',
    label,
    filter: (a) => a.card?.type === 'summon',
  }),
  mySupporter: (label = 'one of your supporters'): TargetSpec => ({
    kind: 'supporter',
    side: 'ally',
    label,
  }),
  enemySupporter: (label = 'an enemy supporter'): TargetSpec => ({
    kind: 'supporter',
    side: 'enemy',
    label,
  }),
};

function base(
  id: string,
  name: string,
  color: CardColour,
  art: string,
  factions: Faction[],
  extra: Extra,
): CardDef {
  const def: CardDef = {
    id,
    name,
    color,
    type: 'summon',
    art: artPath(art),
    artist: 'klabss',
    num: nextNum(),
  };
  if (factions.length) def.factions = factions;
  if (extra.color2) def.color2 = extra.color2;
  if (extra.color3) def.color3 = extra.color3;
  if (extra.text) def.text = extra.text;
  if (extra.powers) def.powers = extra.powers;
  if (extra.triggers) def.triggers = extra.triggers;
  if (extra.effectDamage) def.effectDamage = extra.effectDamage;
  if (extra.woundAmplify) def.woundAmplify = extra.woundAmplify;
  if (extra.supporterLock) def.supporterLock = extra.supporterLock;
  if (extra.freeSpells) def.freeSpells = extra.freeSpells;
  if (extra.spellTrap) def.spellTrap = extra.spellTrap;
  if (extra.letSpellResolve) def.letSpellResolve = extra.letSpellResolve;
  if (extra.spellEcho) def.spellEcho = extra.spellEcho;
  if (extra.cursePotency) def.cursePotency = extra.cursePotency;
  if (extra.muffleFlips) def.muffleFlips = extra.muffleFlips;
  if (extra.voidsDiscard) def.voidsDiscard = extra.voidsDiscard;
  if (extra.stationary) def.stationary = extra.stationary;
  if (extra.redirect) def.redirect = extra.redirect;
  if (extra.spellImmune) def.spellImmune = extra.spellImmune;
  if (extra.reborn) def.reborn = extra.reborn;
  if (extra.frenzy) def.frenzy = extra.frenzy;
  if (extra.neutral) def.neutral = extra.neutral;
  if (extra.flip) def.flip = extra.flip;
  if (extra.flipText) def.flipText = extra.flipText;
  if (extra.flipCost) def.flipCost = extra.flipCost;
  if (extra.flipUseful) def.flipUseful = extra.flipUseful;
  if (extra.targets) def.targets = extra.targets;
  if (extra.effect) def.effect = extra.effect;
  if (extra.stageHooks) def.stageHooks = extra.stageHooks;
  return def;
}

export interface ColorKit {
  summon: (level: 1 | 2 | 3, file: string, name: string, factions: Faction[], extra?: Extra) => CardDef;
  starter: (file: string, name: string, factions: Faction[], extra?: Extra) => CardDef;
  spell: (file: string, name: string, cost: Cost, extra?: Extra) => CardDef;
  trap: (file: string, name: string, cost: Cost, extra?: Extra) => CardDef;
  stage: (file: string, name: string, cost: Cost, extra?: Extra) => CardDef;
}

/**
 * One set of builders per colour, because the art pack spells its spell folders
 * differently per colour (Spells, spells, Spell) and those paths are
 * case-sensitive once the site is served from Pages.
 */
export function colorKit(
  color: Color,
  prefix: string,
  folder: string,
  spellFolder: string,
): ColorKit {
  const mk = (level: 1 | 2 | 3, file: string, name: string, factions: Faction[], extra: Extra) => {
    const b = LEVEL_BASE[level];
    const def = base(`${prefix}${level}-${file}`, name, color, `${folder}/${level}/${file}`, factions, extra);
    def.level = level;
    def.strength = extra.str ?? b.strength;
    def.hp = extra.hp ?? b.hp;
    return def;
  };

  const nonSummon = (
    type: 'spell' | 'trap' | 'stage',
    file: string,
    name: string,
    cost: Cost,
    extra: Extra,
  ) => {
    const def = base(`${prefix}x-${file}`, name, color, `${spellFolder}/${file}`, [], extra);
    def.type = type;
    def.cost = cost;
    return def;
  };

  return {
    summon: (level, file, name, factions, extra = {}) => mk(level, file, name, factions, extra),
    // The `h-` in the id is historical and stays: changing it would orphan every
    // saved deck and every recorded replay that names one of these cards.
    starter: (file, name, factions, extra = {}) => {
      const def = base(`${prefix}h-${file}`, name, color, `${folder}/3/${file}`, factions, extra);
      def.starter = true;
      def.level = 3;
      def.strength = extra.str ?? 1;
      def.hp = extra.hp ?? 3;
      return def;
    },
    spell: (file, name, cost, extra = {}) => nonSummon('spell', file, name, cost, extra),
    trap: (file, name, cost, extra = {}) => nonSummon('trap', file, name, cost, extra),
    stage: (file, name, cost, extra = {}) => nonSummon('stage', file, name, cost, extra),
  };
}

/**
 * Neutral cards belong to no colour, so every leader's identity contains them.
 * They carry a colour only so the frame has something to draw with.
 */
export function neutralKit(): ColorKit {
  const mk = (level: 1 | 2 | 3, file: string, name: string, factions: Faction[], extra: Extra) => {
    const def = base(`n${level}-${file}`, name, 'N', `Neutral/${level}/${file}`, factions, extra);
    def.neutral = true;
    def.level = level;
    def.strength = extra.str ?? 1;
    def.hp = extra.hp ?? 1;
    return def;
  };

  const nonSummon = (
    type: 'spell' | 'trap' | 'stage',
    file: string,
    name: string,
    cost: Cost,
    extra: Extra,
  ) => {
    const def = base(`nx-${file}`, name, 'N', `Neutral/Spell/${file}`, [], extra);
    def.neutral = true;
    def.type = type;
    def.cost = cost;
    return def;
  };

  return {
    summon: (level, file, name, factions, extra = {}) => mk(level, file, name, factions, extra),
    starter: (file, name, factions, extra = {}) => mk(3, file, name, factions, extra),
    spell: (file, name, cost, extra = {}) => nonSummon('spell', file, name, cost, extra),
    trap: (file, name, cost, extra = {}) => nonSummon('trap', file, name, cost, extra),
    stage: (file, name, cost, extra = {}) => nonSummon('stage', file, name, cost, extra),
  };
}

/** Dual-colour cards live in their own folders and carry two colours. */
export function dualKit(pair: string, a: Color, b: Color) {
  const summon = (
    level: 1 | 2 | 3,
    file: string,
    name: string,
    factions: Faction[],
    extra: Extra = {},
  ): CardDef => {
    const bs = LEVEL_BASE[level];
    const def = base(`m-${pair.toLowerCase()}-${file}`, name, a, `Mixed/${pair}/${file}`, factions, {
      ...extra,
      color2: b,
    });
    def.level = level;
    def.strength = extra.str ?? bs.strength;
    def.hp = extra.hp ?? bs.hp;
    return def;
  };
  const other = (
    type: 'spell' | 'trap' | 'stage',
    file: string,
    name: string,
    cost: Cost,
    extra: Extra = {},
  ): CardDef => {
    const def = base(`m-${pair.toLowerCase()}-${file}`, name, a, `Mixed/${pair}/${file}`, [], {
      ...extra,
      color2: b,
    });
    def.type = type;
    def.cost = cost;
    return def;
  };
  return {
    summon,
    spell: (file: string, name: string, cost: Cost, extra: Extra = {}) =>
      other('spell', file, name, cost, extra),
    trap: (file: string, name: string, cost: Cost, extra: Extra = {}) =>
      other('trap', file, name, cost, extra),
    stage: (file: string, name: string, cost: Cost, extra: Extra = {}) =>
      other('stage', file, name, cost, extra),
  };
}

/**
 * Triple-colour cards. Only a leader carrying all three colours can run one, so
 * a deck is built around it rather than including it; every one of them is a
 * level 3 legend and there is exactly one per combination.
 */
export function tripleKit(trio: string, a: Color, b: Color, c: Color) {
  return {
    // `file` is the art basename as the pack spells it, which is the one place
    // in the set a filename carries a space; the id slug strips it out.
    // The ten legends are level 3; a three-colour card printed at any other
    // level is an ordinary card that happens to need all three of its colours.
    summon: (
      file: string,
      name: string,
      factions: Faction[],
      extra: Extra = {},
      level: 1 | 2 | 3 = 3,
    ): CardDef => {
      const bs = LEVEL_BASE[level];
      const slug = file.toLowerCase().replace(/[^a-z0-9]/g, '');
      const def = base(
        `m-${trio.toLowerCase()}-${slug}`,
        name,
        a,
        `Mixed/${trio}/${file}`,
        factions,
        { ...extra, color2: b, color3: c },
      );
      if (extra.noArt) {
        delete def.art;
        delete def.artist;
      }
      def.level = level;
      def.strength = extra.str ?? bs.strength;
      def.hp = extra.hp ?? bs.hp;
      return def;
    },
  };
}

/** The board position of the summon whose trigger or power is running. */
export function selfRef(ctx: { state: GameState; source: SummonInstance | null }) {
  return ctx.source ? refFor(ctx.state, ctx.source) : null;
}

/**
 * Leader. Wraps an effect so it runs only while the card holding it is its
 * owner's leader; in any other seat the effect is simply absent.
 */
export function leaderOnly(effect: EffectFn): EffectFn {
  return (c) => {
    if (selfRef(c)?.kind === 'leader') effect(c);
  };
}

/** The board position of the summon an HP card was protecting. */
export function holderRef(ctx: { state: GameState; holder: SummonInstance }) {
  return refFor(ctx.state, ctx.holder);
}
