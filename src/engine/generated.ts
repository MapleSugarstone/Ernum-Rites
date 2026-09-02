import { card, registerGenerated, setGeneratedRebuilder, tryCard } from './registry';
import type {
  CardColour,
  Cost,
  EffectFn,
  Faction,
  FlipCost,
  Power,
  Triggers,
} from './types';

/**
 * Cards minted during a match. Each builder derives a deterministic id from its
 * inputs and registers a full CardDef, so the product renders, inspects and
 * plays like any printed card, and both engines agree on it move for move.
 */

function coloredTotal(cost: Cost | undefined): number {
  if (!cost) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(cost)) {
    if (k !== 'C') n += v ?? 0;
  }
  return n;
}

/** A copy of any card rebuilt in Robot: same rules text, every colour pip now R. */
export function robotCopy(sourceId: string): string {
  const src = card(sourceId);
  return registerGenerated({
    ...src,
    id: `gen-hack-${sourceId}`,
    color: 'R',
    artTint: 'robot',
    color2: undefined,
    color3: undefined,
    identity: undefined,
    cost: robotizedCost(src.cost),
    // A body's Powers and flip price are costs too. Leaving them in their old
    // colours hands a mono-Robot deck a button it can never pay.
    powers: repriced(src.powers, robotizedCost),
    flipCost: repricedFlip(src.flipCost, robotizedCost),
    uncollectible: true,
    num: 'GEN',
  });
}

/**
 * A body pulled out of a debt pile and rebuilt in Oil: one bigger in both stats,
 * Spirit added to its faction line, and every colour pip on its Powers now O.
 */
export function oilRaise(sourceId: string): string {
  const src = card(sourceId);
  const factions: Faction[] = [...(src.factions ?? [])];
  if (!factions.includes('Spirit')) factions.push('Spirit');
  const powers: Power[] = (src.powers ?? []).map((p) => ({
    ...p,
    cost: oiledCost(p.cost),
  }));
  return registerGenerated({
    ...src,
    id: `gen-raise-${sourceId}`,
    color: 'O',
    artTint: 'oil',
    color2: undefined,
    color3: undefined,
    identity: undefined,
    factions,
    strength: (src.strength ?? 0) + 2,
    hp: (src.hp ?? 0) + 2,
    uncollectible: true,
    ...(powers.length ? { powers } : {}),
    num: 'GEN',
  });
}

/**
 * The Banana recoloured to match whoever is being handed it, so the gift pays the
 * colour that player actually spends rather than filling colourless.
 */
export function coloredBanana(bananaId: string, color: CardColour): string {
  const src = card(bananaId);
  return registerGenerated({
    ...src,
    id: `gen-banana-${color}`,
    color,
    neutral: false,
    uncollectible: true,
    num: 'GEN',
  });
}

/** A copy of a spell rebuilt in Oil, for a body that lends it out as a Power. */
export function oilCopy(sourceId: string): string {
  const src = card(sourceId);
  return registerGenerated({
    ...src,
    id: `gen-oil-${sourceId}`,
    color: 'O',
    artTint: 'oil',
    color2: undefined,
    color3: undefined,
    identity: undefined,
    cost: oiledCost(src.cost),
    // A body's Powers and flip price are costs too. Leaving them in their old
    // colours hands a mono-Oil deck a button it can never pay.
    powers: repriced(src.powers, oiledCost),
    flipCost: repricedFlip(src.flipCost, oiledCost),
    uncollectible: true,
    num: 'GEN',
  });
}

/** Rebuilds every Power's price with `reprice`, leaving the rest of the Power alone. */
function repriced(powers: Power[] | undefined, reprice: (c: Cost | undefined) => Cost) {
  return powers?.map((p) => ({ ...p, cost: reprice(p.cost) }));
}

function repricedFlip(flip: FlipCost | undefined, reprice: (c: Cost | undefined) => Cost) {
  return flip ? { ...flip, mana: reprice(flip.mana) } : undefined;
}

/**
 * A copy of a card rebuilt in Oil with its colour pips spread across Oil, Robot
 * and Pepper. Oil takes the odd pips, so a one-pip spell costs one Oil.
 */
export function malwareCopy(sourceId: string): string {
  const src = card(sourceId);
  return registerGenerated({
    ...src,
    id: `gen-malware-${sourceId}`,
    color: 'O',
    color2: 'R',
    color3: 'P',
    artTint: 'malware',
    identity: undefined,
    cost: splitThreeWays(src.cost),
    powers: repriced(src.powers, splitThreeWays),
    flipCost: repricedFlip(src.flipCost, splitThreeWays),
    uncollectible: true,
    num: 'GEN',
  });
}

function splitThreeWays(cost: Cost | undefined): Cost {
  const colored = coloredTotal(cost);
  const out: Cost = {};
  const base = Math.floor(colored / 3);
  const rem = colored % 3;
  const o = base + (rem > 0 ? 1 : 0);
  const r = base + (rem > 1 ? 1 : 0);
  if (o) out.O = o;
  if (r) out.R = r;
  if (base) out.P = base;
  if (cost?.C) out.C = cost.C;
  return out;
}

/** Every colour pip on a cost rewritten as Robot, colourless left alone. */
function robotizedCost(cost: Cost | undefined): Cost {
  const colored = coloredTotal(cost);
  const out: Cost = {};
  if (colored) out.R = colored;
  if (cost?.C) out.C = cost.C;
  return out;
}

/** Every colour pip on a cost rewritten as Oil, colourless left alone. */
function oiledCost(cost: Cost | undefined): Cost {
  const colored = coloredTotal(cost);
  const out: Cost = {};
  if (colored) out.O = colored;
  if (cost?.C) out.C = cost.C;
  return out;
}

/** Every colour pip split between Robot and Pepper, Robot taking the odd one. */
function recompiledCost(cost: Cost): Cost {
  const colored = coloredTotal(cost);
  const out: Cost = {};
  if (colored) {
    out.R = Math.ceil(colored / 2);
    if (colored > 1) out.P = Math.floor(colored / 2);
  }
  if (cost.C) out.C = cost.C;
  return out;
}

/**
 * A card rebuilt as a Pepper-Robot Machine: red frame, Robot second colour,
 * Machine as its whole faction line, Power costs split half Robot half Pepper.
 */
export function pepperRobotCopy(sourceId: string): string {
  const src = card(sourceId);
  const powers: Power[] = (src.powers ?? []).map((p) => ({
    ...p,
    cost: recompiledCost(p.cost),
  }));
  return registerGenerated({
    ...src,
    id: `gen-virus-${sourceId}`,
    color: 'P',
    color2: 'R',
    color3: undefined,
    artTint: 'virus',
    identity: undefined,
    // Rebuilding a neutral card in Pepper and Robot gives it colours, so it must
    // stop claiming neutrality or it keeps drawing the colourless frame.
    neutral: undefined,
    factions: ['Machine'],
    uncollectible: true,
    ...(powers.length ? { powers } : {}),
    num: 'GEN',
  });
}

/**
 * A body wearing another card's Powers. Minted rather than tracked on the
 * instance, so the printed face shows what the body actually does: a borrowed
 * Power that only exists in game state is a Power the player cannot read.
 *
 * A spell lends one sap-cost cast of itself; a summon lends its Power list. The
 * host's own stats are baked in because an instance that was already playing as
 * something else has no printed line of its own to fall back on.
 */
export function graftedCopy(
  hostId: string,
  sourceId: string,
  base: { strength: number; color: CardColour; level: number; powers: Power[] },
): string {
  const host = card(hostId);
  const src = card(sourceId);
  const lent: Power[] =
    src.type === 'spell' && src.effect
      ? [
          {
            name: src.name,
            cost: src.cost ?? {},
            text: src.text ?? '',
            targets: src.targets,
            sapSelf: true,
            effect: src.effect,
          },
        ]
      : (src.powers ?? []);
  const genId = `gen-graft-${hostId}+${sourceId}-${base.strength}L${base.level}${base.color}`;
  const factions = [...(host.factions ?? [])];
  for (const f of src.factions ?? []) {
    if (!factions.includes(f)) factions.push(f);
  }
  // A graft lends the whole text side, so the source's own triggers come
  // across on top of the host's rather than being dropped.
  const lentTriggers = src.type === 'spell' ? undefined : src.triggers;
  const lines = [host.text, lentTriggers ? src.text : undefined]
    .filter((t): t is string => !!t && !!t.trim());
  const merged = mergeTriggers(host.triggers, lentTriggers, genId);
  return registerGenerated({
    ...host,
    id: genId,
    color: base.color,
    strength: base.strength,
    level: base.level,
    factions,
    // A grafted Power arrives on a body the host paid for, so its pips
    // are rewritten as Oil rather than the colour it was printed in.
    powers: [...base.powers, ...(repriced(lent, oiledCost) ?? lent)],
    ...(lines.length ? { text: lines.join('\n') } : { text: undefined }),
    ...(host.redirect || src.redirect ? { redirect: true } : {}),
    ...(host.spellImmune || src.spellImmune ? { spellImmune: true } : {}),
    ...(Math.max(host.effectDamage ?? 0, src.effectDamage ?? 0)
      ? { effectDamage: Math.max(host.effectDamage ?? 0, src.effectDamage ?? 0) }
      : {}),
    ...(host.woundAmplify || src.woundAmplify ? { woundAmplify: true } : {}),
    ...(host.supporterLock || src.supporterLock ? { supporterLock: true } : {}),
    ...(host.spellEcho || src.spellEcho ? { spellEcho: true } : {}),
    ...(host.cursePotency || src.cursePotency ? { cursePotency: true } : {}),
    ...(host.muffleFlips || src.muffleFlips ? { muffleFlips: true } : {}),
    ...(host.stationary || src.stationary ? { stationary: true } : {}),
    ...(merged ? { triggers: merged } : { triggers: undefined }),
    // A body that has taken on a spell wears that spell's face. Living Curse
    // grafts from an Oil-tinted copy of the spell it swallowed, and without
    // this the host's own portrait spread over the top of it and the card gave
    // no sign of what it had become. A graft from a summon is the other case:
    // the host is still itself, wearing borrowed Powers, and keeps its face.
    ...(src.type === 'spell'
      ? { art: src.art, artTint: src.artTint, artist: src.artist }
      : {}),
    uncollectible: true,
    num: 'GEN',
  });
}

function chain(x?: EffectFn, y?: EffectFn): EffectFn | undefined {
  if (!x) return y;
  if (!y) return x;
  return (c) => { x(c); y(c); };
}

function sum<T>(x?: (a: T) => number, y?: (a: T) => number): ((a: T) => number) | undefined {
  if (!x) return y;
  if (!y) return x;
  return (a) => x(a) + y(a);
}

/**
 * Both parents' triggers on one body, each slot firing the first card's half
 * before the second's. Without this a fusion silently dropped every
 * Deathrattle, Battlecry and aura it was built from.
 */
function mergeTriggers(a: Triggers | undefined, b: Triggers | undefined, selfId: string): Triggers | undefined {
  if (!a && !b) return undefined;
  const bonus = sum(a?.strengthBonus, b?.strengthBonus);
  if (!a || !b) {
    const only = (a ?? b)!;
    if (!only.strengthBonus) return only;
  }
  a ??= {};
  b ??= {};
  return {
    onEnter: chain(a.onEnter, b.onEnter),
    onDeath: chain(a.onDeath, b.onDeath),
    onAttack: chain(a.onAttack, b.onAttack),
    onDefend: chain(a.onDefend, b.onDefend),
    onAwake: chain(a.onAwake, b.onAwake),
    onEndTurn: chain(a.onEndTurn, b.onEndTurn),
    onOtherDeath: chain(a.onOtherDeath, b.onOtherDeath),
    onSpellCast: chain(a.onSpellCast, b.onSpellCast),
    onEnemySpellCast: chain(a.onEnemySpellCast, b.onEnemySpellCast),
    onSummonPlayed: chain(a.onSummonPlayed, b.onSummonPlayed),
    // An aura names itself by id to stay off its own buff. The fusion carries
    // a different id, so it has to be excluded by hand.
    strengthBonus: bonus ? (args) => (args.summon.cardId === selfId ? 0 : bonus(args)) : undefined,
    effectDamageBonus: sum(a.effectDamageBonus, b.effectDamageBonus),
  };
}

/**
 * The fusion of two summons: the higher of each stat, both faction lines, both
 * Power sets, both trigger sets and both keyword lines. The first summon lends
 * its flip, since only one card can turn over.
 */
export function fusedRecomp(
  aId: string,
  bId: string,
  strength: number,
  hp: number,
  level: number,
): string {
  const a = card(aId);
  const b = card(bId);
  const factions: Faction[] = [];
  for (const f of [...(a.factions ?? []), ...(b.factions ?? [])]) {
    if (!factions.includes(f)) factions.push(f);
  }
  if (!factions.includes('Machine')) factions.push('Machine');
  const powers: Power[] = [...(a.powers ?? []), ...(b.powers ?? [])].map((p) => ({
    ...p,
    cost: recompiledCost(p.cost),
  }));
  const genId = `gen-fuse-${aId}+${bId}-${strength}x${hp}L${level}`;
  return registerGenerated({
    id: genId,
    name: 'Recomp',
    color: 'P',
    color2: 'R',
    type: 'summon',
    level,
    strength,
    hp,
    uncollectible: true,
    factions,
    note: `Recompiled from ${a.name} and ${b.name}.`,
    // Both parents' rules, one paragraph each: run together they read as a
    // single confused sentence rather than as two cards' worth of text.
    text: [a.text, b.text]
      .filter((t): t is string => !!t && !!t.trim())
      .join('\n'),
    ...(a.redirect || b.redirect ? { redirect: true } : {}),
    ...(a.spellImmune || b.spellImmune ? { spellImmune: true } : {}),
    ...(Math.max(a.effectDamage ?? 0, b.effectDamage ?? 0)
      ? { effectDamage: Math.max(a.effectDamage ?? 0, b.effectDamage ?? 0) }
      : {}),
    ...(a.woundAmplify || b.woundAmplify ? { woundAmplify: true } : {}),
    ...(a.supporterLock || b.supporterLock ? { supporterLock: true } : {}),
    ...(a.spellEcho || b.spellEcho ? { spellEcho: true } : {}),
    ...(a.cursePotency || b.cursePotency ? { cursePotency: true } : {}),
    ...(a.muffleFlips || b.muffleFlips ? { muffleFlips: true } : {}),
    ...(a.stationary || b.stationary ? { stationary: true } : {}),
    ...(powers.length ? { powers } : {}),
    ...(mergeTriggers(a.triggers, b.triggers, genId)
      ? { triggers: mergeTriggers(a.triggers, b.triggers, genId)! }
      : {}),
    ...(a.targets ? { targets: a.targets } : {}),
    ...(a.flip ? { flip: a.flip } : {}),
    ...(a.flipText ? { flipText: a.flipText } : {}),
    ...(a.flipCost ? { flipCost: a.flipCost } : {}),
    art: 'Cardgame/Extras/Recomp.png',
    artist: 'klabss',
    num: 'GEN',
    // A fusion is the rarest thing the board can produce: two bodies spent to
    // make one, and never twice the same. That is a Legendary whatever it says.
  }, 'L');
}

/**
 * A spell walking around as a summon. It wears the spell's name and art, and
 * carries one sap-cost Power that casts the spell's effect.
 */
export function livingSummon(
  spellId: string,
  opts: { strength: number; hp: number; level: number; free?: boolean },
): string {
  const src = card(spellId);
  const factions: Faction[] = ['Living'];
  for (const f of src.factions ?? []) {
    if (!factions.includes(f)) factions.push(f);
  }
  const powers: Power[] = src.effect
    ? [
        {
          name: 'Cast',
          cost: opts.free ? {} : (src.cost ?? {}),
          sapSelf: true,
          text: src.text ?? '',
          targets: src.targets,
          effect: src.effect,
        },
      ]
    : [];
  return registerGenerated({
    id: `gen-live-${spellId}-${opts.strength}x${opts.hp}L${opts.level}${opts.free ? 'f' : ''}`,
    name: src.name,
    color: src.color,
    color2: src.color2,
    color3: src.color3,
    type: 'summon',
    level: opts.level,
    strength: opts.strength,
    hp: opts.hp,
    uncollectible: true,
    factions,
    ...(powers.length ? { powers } : { text: 'A spell with legs and nothing to say.' }),
    art: src.art,
    artTint: src.artTint,
    artist: src.artist,
    num: 'GEN',
  });
}

/**
 * Mint a generated card from its id.
 *
 * Every id below is built by one of the functions above out of a source card and
 * a handful of numbers, so reading it back is a matter of taking those numbers
 * off the end and handing the rest to the same builder. Card ids contain
 * hyphens and the numeric tail does not, which is why the parsing runs from the
 * right.
 *
 * Silence on an unrecognised id is deliberate. This is a fallback for a client
 * holding a board it did not build, and a shape it cannot read should look the
 * same as a card it has never heard of rather than throw in the middle of a
 * render.
 */
function rebuild(id: string): void {
  const simple: Array<[string, (src: string) => string]> = [
    ['gen-hack-', robotCopy],
    ['gen-raise-', oilRaise],
    ['gen-oil-', oilCopy],
    ['gen-malware-', malwareCopy],
    ['gen-virus-', pepperRobotCopy],
  ];
  for (const [prefix, build] of simple) {
    if (!id.startsWith(prefix)) continue;
    const src = id.slice(prefix.length);
    if (tryCard(src)) build(src);
    return;
  }

  if (id.startsWith('gen-banana-')) {
    const rest = id.slice('gen-banana-'.length);
    // The colour is the last character and the banana is everything before it.
    const color = rest.slice(-1) as CardColour;
    const banana = rest.slice(0, -1).replace(/-$/, '');
    if (tryCard(banana)) coloredBanana(banana, color);
    return;
  }

  if (id.startsWith('gen-live-')) {
    // gen-live-<spellId>-<strength>x<hp>L<level>[f]
    const rest = id.slice('gen-live-'.length);
    const cut = rest.lastIndexOf('-');
    if (cut < 0) return;
    const spellId = rest.slice(0, cut);
    const m = /^(\d+)x(\d+)L(\d+)(f?)$/.exec(rest.slice(cut + 1));
    if (!m || !tryCard(spellId)) return;
    livingSummon(spellId, {
      strength: Number(m[1]),
      hp: Number(m[2]),
      level: Number(m[3]),
      ...(m[4] ? { free: true } : {}),
    });
    return;
  }

  if (id.startsWith('gen-fuse-')) {
    // gen-fuse-<aId>+<bId>-<strength>x<hp>L<level>
    const rest = id.slice('gen-fuse-'.length);
    const cut = rest.lastIndexOf('-');
    if (cut < 0) return;
    const pair = rest.slice(0, cut).split('+');
    const m = /^(\d+)x(\d+)L(\d+)$/.exec(rest.slice(cut + 1));
    if (!m || pair.length !== 2) return;
    if (!tryCard(pair[0]) || !tryCard(pair[1])) return;
    fusedRecomp(pair[0], pair[1], Number(m[1]), Number(m[2]), Number(m[3]));
    return;
  }

  if (id.startsWith('gen-graft-')) {
    // gen-graft-<hostId>+<sourceId>-<strength>L<level><colour>
    const rest = id.slice('gen-graft-'.length);
    const cut = rest.lastIndexOf('-');
    if (cut < 0) return;
    const pair = rest.slice(0, cut).split('+');
    const m = /^(\d+)L(\d+)([A-Z])$/.exec(rest.slice(cut + 1));
    if (!m || pair.length !== 2) return;
    const host = tryCard(pair[0]);
    if (!host || !tryCard(pair[1])) return;
    // A graft carries the host's own Powers alongside the borrowed ones, and
    // the host here is a card rather than a body, so its printed list is what
    // the mint was given.
    graftedCopy(pair[0], pair[1], {
      strength: Number(m[1]),
      level: Number(m[2]),
      color: m[3] as CardColour,
      powers: host.powers ?? [],
    });
    return;
  }
}

setGeneratedRebuilder(rebuild);
