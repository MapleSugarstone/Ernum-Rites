import type { GameState, SummonInstance } from './state';
import { MANA_KINDS, type PlayerIdx, type TargetRef } from './types';

/**
 * A canonical, language-independent fingerprint of a game position.
 *
 * The exact string format is the cross-engine contract: csharp/Selatza.Engine/
 * Digest.cs builds the identical string, so a rules divergence shows up as a
 * mismatched digest on the step where it happened. Log text and uids are
 * excluded on purpose: wording is cosmetic, and uid allocation order is not
 * observable in play.
 */
export const DIGEST_FORMAT = 'v2';

const PHASE_NAME = { awake: 'awake', draw: 'draw', main: 'main', end: 'end' } as const;

function joinIds(ids: string[]): string {
  return ids.length === 0 ? '-' : ids.join(',');
}

function refString(ref: TargetRef): string {
  const index =
    ref.kind === 'summon'
      ? ref.slot
      : ref.kind === 'hand' ||
          ref.kind === 'supporter' ||
          ref.kind === 'debt' ||
          ref.kind === 'discard'
        ? ref.index
        : 0;
  const player = ref.kind === 'color' ? 0 : ref.player;
  return `${ref.kind}/${player}/${index}`;
}

function summonString(s: SummonInstance | null | undefined): string {
  if (!s) return '-';
  const hp =
    s.hp.length === 0 ? '-' : s.hp.map((h) => `${h.cardId}!${h.flipped ? 1 : 0}`).join(';');
  // A modifier's source card is deliberately absent: like log wording, it is
  // there for the client to draw with and is not observable in play.
  const mods =
    s.strengthMods.length === 0
      ? '-'
      : s.strengthMods
          .map((m) => `${m.amount}/${m.duration === 'turn' ? 'turn' : 'perm'}`)
          .join(',');
  const over = s.override
    ? `${s.override.strength}/${s.override.color}/${s.override.level}`
    : '-';
  return [
    s.cardId,
    hp,
    s.sapped ? 1 : 0,
    s.wounds,
    s.shields,
    mods,
    over,
    s.rooted ? 1 : 0,
    s.sapLock ? 1 : 0,
    s.bestowed ?? '-',
    s.enteredTurn,
    s.isLeader ? 1 : 0,
    s.owner,
    s.effectDamageMod,
  ].join('~');
}

function playerString(state: GameState, idx: PlayerIdx): string {
  const p = state.players[idx];
  const supporters =
    p.supporters.length === 0
      ? '-'
      : p.supporters.map((s) => `${s.cardId}/${s.sapped ? 1 : 0}`).join(',');
  const mana = MANA_KINDS.map((c) => p.mana[c]).join(',');
  const slots = p.slots.map((s, i) => `:s${i}=${summonString(s)}`).join('');
  return (
    `|p${idx}` +
    `:D${joinIds(p.deck)}` +
    `:H${joinIds(p.hand)}` +
    `:Z${joinIds(p.debt)}` +
    `:X${joinIds(p.discard)}` +
    `:C${p.debtCount}` +
    `:U${supporters}` +
    `:M${mana}` +
    `:F${p.supportersLeft}.${p.leaderPlayed ? 1 : 0}` +
    `:N${p.turnsTaken}` +
    `:O${p.deckOuts}` +
    `:L${p.replaceLocked}` +
    `:T${p.spellTax}` +
    `:G${p.stage ?? '-'}` +
    slots +
    `:h=${summonString(p.leader)}` +
    // Party-only marker. Never printed in a 2-player game, where nobody is
    // eliminated, so the v2 strings the C# engine builds are unaffected.
    (p.eliminated ? ':E1' : '')
  );
}

export function digestOf(state: GameState): string {
  let out =
    DIGEST_FORMAT +
    `|T${state.turn}` +
    `|A${state.active}` +
    `|S${state.startingPlayer}` +
    `|P${PHASE_NAME[state.phase]}` +
    `|W${state.winner === null ? -1 : state.winner}` +
    `|D${state.drawn ? 1 : 0}` +
    `|A${state.actions}` +
    `|R${state.rngState}`;

  for (let i = 0 as PlayerIdx; i < state.players.length; i++) {
    out += playerString(state, i);
  }

  out += '|PEND:';
  if (!state.pending) out += '-';
  else if (state.pending.battle) {
    out +=
      `${state.pending.player}:` +
      `${refString(state.pending.battle.attacker)}:` +
      `${refString(state.pending.battle.defender)}:` +
      `${state.pending.battle.trapUsed ? 1 : 0}`;
  } else if (state.pending.spell) {
    out +=
      `${state.pending.player}:S:${state.pending.spell.caster}:` +
      `${state.pending.spell.cardId}:` +
      state.pending.spell.targets.map(refString).join(';');
    // Party-only fields, printed only when set so 2-player strings never change.
    if (state.pending.spell.enemy !== undefined) out += `:e${state.pending.spell.enemy}`;
    if (state.pending.queue?.length) out += `:Q${state.pending.queue.join(',')}`;
  }

  out += '|RQ:';
  out +=
    state.replaceQueue.length === 0
      ? '-'
      : state.replaceQueue.map((r) => `${r.player}/${r.slot}`).join(',');

  out += '|FQ:';
  out +=
    state.flipQueue.length === 0
      ? '-'
      : state.flipQueue
          .map((f) => `${f.player}/${refString(f.holder)}/${f.cardId}`)
          .join(',');

  out += '|CQ:';
  out +=
    state.choiceQueue.length === 0
      ? '-'
      : state.choiceQueue
          .map(
            (c) =>
              `${c.player}/${c.source}/${c.effect}/` +
              `${(c.refs ?? []).map(refString).join(';')}/` +
              `${(c.cards ?? []).join(';')}/${(c.legal ?? []).join(';')}/` +
              `${c.optional ? 1 : 0}/${c.at ? refString(c.at) : '-'}` +
              // Party-only, printed only when set: see the eliminated marker.
              (c.victim !== undefined ? `/v${c.victim}` : ''),
          )
          .join(',');

  out += '|BT:';
  if (!state.battle) out += '-';
  else {
    out +=
      `${refString(state.battle.attacker)}:` +
      `${refString(state.battle.defender)}:` +
      `${state.battle.trapUsed ? 1 : 0}`;
  }

  return out;
}

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64, chosen because it reimplements identically in C# and in JS. */
export function digestHash(text: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

/** Short hex fingerprint, for compact replay files. */
export function digestShort(state: GameState): string {
  return digestHash(digestOf(state));
}
