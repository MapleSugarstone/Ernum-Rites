/**
 * Cards another card in the same shell makes pointless. Two tiers, because only
 * one of them is provable: PROVEN pairs read the same word for word and differ
 * only on stats, cost or keywords, so no deck ever wants the loser. SUSPECT
 * pairs are a vanilla body against one with text and stats at least as good,
 * which is a straight downgrade unless the text is worth nothing. Cards that
 * both carry text are never compared: which effect is better is a balance
 * judgement, and this script does not make those.
 */
import '../src/cards';
import { allCards } from '../src/engine/registry';
import { RARITY_NAME, type CardDef, type ManaKind } from '../src/engine/types';

/** Keywords that are strictly good to have; a card missing one is not worse for it. */
const UPSIDE: (keyof CardDef)[] = [
  'redirect',
  'spellImmune',
  'woundAmplify',
  'freeSpells',
  'spellEcho',
  'cursePotency',
  'muffleFlips',
  'spellTrap',
];

/** Keywords that only cost you something. */
const DOWNSIDE: (keyof CardDef)[] = ['stationary', 'letSpellResolve'];

function rules(c: CardDef): string {
  const parts = [c.text ?? ''];
  for (const p of c.powers ?? []) parts.push(`${p.text}@${costKey(p.cost)}${p.sapSelf ? '/sap' : ''}`);
  if (c.flipText) parts.push(`FLIP ${c.flipText}`);
  return parts.join(' | ').replace(/\s+/g, ' ').trim();
}

function costKey(cost: Record<string, number> | undefined): string {
  if (!cost) return '-';
  return Object.keys(cost)
    .sort()
    .map((k) => `${k}${cost[k]}`)
    .join('');
}

function colours(c: CardDef): string {
  return [c.color, c.color2, c.color3].filter(Boolean).join('');
}

/** Whether cost `a` is payable anywhere cost `b` is: no more of any pip. */
function costNoWorse(a: CardDef['cost'], b: CardDef['cost']): boolean {
  const kinds = new Set<string>([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of kinds) {
    if ((a?.[k as ManaKind] ?? 0) > (b?.[k as ManaKind] ?? 0)) return false;
  }
  return true;
}

/**
 * Two bodies of the same tribe where the rival wins on the printed statline.
 * Restricted to summons sharing a faction because that is the comparison a
 * deckbuilder actually faces: cost alone says nothing once the text differs.
 */
function sameTribeBodyLoss(a: CardDef, b: CardDef): boolean {
  if (a.type !== 'summon' || b.type !== 'summon') return false;
  const fa = new Set(a.factions ?? []);
  if (![...(b.factions ?? [])].some((f) => fa.has(f))) return false;
  const statUp = (a.strength ?? 0) > (b.strength ?? 0) || (a.hp ?? 0) > (b.hp ?? 0);
  // A smaller body whose text is also the shorter one is the classic dud. Longer
  // text on the loser means it is buying its worse stats with something, which
  // is a tradeoff and not this script's call.
  if (rules(b).length > rules(a).length) return false;
  return statUp && dominates(a, b);
}

/** Whether `a` is at least as good as `b` everywhere stats can be compared. */
function statsNoWorse(a: CardDef, b: CardDef): boolean {
  return compare(a, b) !== null;
}

/** Does `a` dominate `b`? Requires at least one strict edge somewhere. */
function dominates(a: CardDef, b: CardDef): boolean {
  return compare(a, b) === true;
}

/** null if `a` falls behind anywhere, true if it is ahead somewhere, else false. */
function compare(a: CardDef, b: CardDef): boolean | null {
  let strict = false;
  const cmp = (av: number, bv: number) => {
    if (av < bv) return false;
    if (av > bv) strict = true;
    return true;
  };
  if (!cmp(a.strength ?? 0, b.strength ?? 0)) return null;
  if (!cmp(a.hp ?? 0, b.hp ?? 0)) return null;
  if (!cmp(a.effectDamage ?? 0, b.effectDamage ?? 0)) return null;
  for (const k of UPSIDE) {
    if (!cmp(a[k] ? 1 : 0, b[k] ? 1 : 0)) return null;
  }
  for (const k of DOWNSIDE) {
    if (!cmp(b[k] ? 1 : 0, a[k] ? 1 : 0)) return null;
  }
  if (!costNoWorse(a.cost, b.cost)) return null;
  if (costKey(a.cost) !== costKey(b.cost)) strict = true;
  return strict;
}

const pool = allCards().filter((c) => !c.uncollectible && !c.id.startsWith('x-') && c.id !== 'hidden');

/**
 * Same shell: swapping one for the other is a like-for-like deck slot. Rules
 * text is deliberately not part of this, so a vanilla body and a body with a
 * Battlecry still land in the same group and can be compared.
 */
function shell(c: CardDef): string {
  return [c.type, c.level ?? 0, colours(c), c.neutral ? 'N' : ''].join('/');
}

const groups = new Map<string, CardDef[]>();
for (const c of pool) {
  const k = shell(c);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(c);
}

type Tier = 'PROVEN' | 'SUSPECT' | 'UNJUDGED';
type Pair = { tier: Tier; win: CardDef; lose: CardDef; why: string };

const pairs: Pair[] = [];
for (const g of groups.values()) {
  if (g.length < 2) continue;
  for (const a of g) {
    for (const b of g) {
      if (a === b) continue;
      const sameText = rules(a) === rules(b);
      let tier: Tier | null = null;
      if (sameText) tier = dominates(a, b) ? 'PROVEN' : null;
      else if (rules(b) === '' && rules(a) !== '') tier = statsNoWorse(a, b) ? 'SUSPECT' : null;
      else if (rules(b) !== '' && rules(a) !== '') tier = sameTribeBodyLoss(a, b) ? 'UNJUDGED' : null;
      if (!tier) continue;
      const why: string[] = [];
      if ((a.strength ?? 0) !== (b.strength ?? 0)) why.push(`${b.strength ?? 0} -> ${a.strength ?? 0} attack`);
      if ((a.hp ?? 0) !== (b.hp ?? 0)) why.push(`${b.hp ?? 0} -> ${a.hp ?? 0} HP`);
      if (costKey(a.cost) !== costKey(b.cost)) why.push(`${costKey(b.cost)} -> ${costKey(a.cost)}`);
      for (const k of UPSIDE) if (a[k] && !b[k]) why.push(`gains ${String(k)}`);
      for (const k of DOWNSIDE) if (b[k] && !a[k]) why.push(`drops ${String(k)}`);
      if (tier === 'SUSPECT') why.push('and has text where this has none');
      pairs.push({ tier, win: a, lose: b, why: why.join(', ') });
    }
  }
}

function label(c: CardDef): string {
  const stat = c.type === 'summon' ? `${c.strength ?? 0}/${c.hp ?? 0}` : costKey(c.cost);
  const fac = (c.factions ?? []).join('/');
  return `${c.name} [${colours(c) || 'N'} ${stat}${fac ? ' ' + fac : ''} ${RARITY_NAME[c.rarity ?? 'C'][0]}]`;
}

// One card can lose to several; report each loser once against its best rival.
const worst = new Map<string, Pair>();
for (const p of pairs) {
  const cur = worst.get(p.lose.id);
  const better =
    !cur ||
    (cur.tier !== 'PROVEN' && p.tier === 'PROVEN') ||
    (cur.tier === 'UNJUDGED' && p.tier === 'SUSPECT') ||
    (cur.tier === p.tier &&
      (p.win.strength ?? 0) + (p.win.hp ?? 0) > (cur.win.strength ?? 0) + (cur.win.hp ?? 0));
  if (better) worst.set(p.lose.id, p);
}

const comparable = [...groups.values()].filter((g) => g.length > 1).reduce((n, g) => n + g.length, 0);
console.log(
  `${pool.length} collectible cards, ${comparable} of them in a shell with something to compare against.
`,
);

for (const tier of ['PROVEN', 'SUSPECT', 'UNJUDGED'] as Tier[]) {
  const rows = [...worst.values()].filter((p) => p.tier === tier);
  rows.sort((x, y) => x.lose.name.localeCompare(y.lose.name));
  const blurb =
    tier === 'PROVEN'
      ? 'Same text, worse card. No deck has a reason to run these.'
      : tier === 'SUSPECT'
        ? 'Vanilla against a body with text and stats no worse. Downgrades unless the text is worth nothing.'
        : 'Smaller body, no more text than its rival, same tribe. A downgrade unless its text is the better one, which is your call.';
  console.log(`${tier}  (${rows.length})  ${blurb}
`);
  for (const p of rows) {
    console.log(`  ${label(p.lose)}`);
    console.log(`    loses to ${label(p.win)}`);
    console.log(`    ${p.why}`);
    if (p.tier !== 'PROVEN') console.log(`    rival reads: ${rules(p.win)}`);
    if (p.tier === 'UNJUDGED') console.log(`    this reads:  ${rules(p.lose)}`);
    console.log('');
  }
}
