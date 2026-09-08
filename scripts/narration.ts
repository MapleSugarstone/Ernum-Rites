// Turning a replay's actions into sentences with card names, shared by
// scripts/narrate.ts (a game as played) and scripts/playout.ts (a game as the
// bot would play it from a position).
import { card } from '../src/engine/registry';
import type { Action } from '../src/engine/actions';
import { remainingHp, type GameState } from '../src/engine/state';

export function seatName(seat: number, botSeat: number): string {
  if (botSeat < 0) return `seat ${seat}`;
  return seat === botSeat ? 'bot' : 'you';
}

type Ref = { kind: string; player: number; slot?: number; index?: number };

export function refName(st: GameState, r: Ref | undefined): string {
  if (!r) return '?';
  const p = st.players[r.player];
  if (r.kind === 'leader') return `${p.leader ? card(p.leader.cardId).name : 'the leader'} (leader)`;
  const s = p.slots[r.slot ?? r.index ?? 0];
  return s ? card(s.cardId).name : 'an empty slot';
}

/** One action as a sentence fragment, read against the state it is applied to. */
export function describeAction(st: GameState, actor: number, a: Action): string {
  const p = st.players[actor];
  const act = a as unknown as Record<string, unknown>;
  const targets = () =>
    Array.isArray(act.targets) && act.targets.length
      ? ' at ' + (act.targets as Ref[]).map((t) => refName(st, t)).join(', ')
      : '';
  switch (a.type) {
    case 'PLAY_SUMMON':
      return `plays ${card(p.hand[act.handIndex as number]).name}`;
    case 'PLAY_SUPPORTER':
      return `sets ${card(p.hand[act.handIndex as number]).name} as a supporter`;
    case 'PLAY_STAGE':
      return `plays ${card(p.hand[act.handIndex as number]).name}`;
    case 'CAST_SPELL':
      return `casts ${card(p.hand[act.handIndex as number]).name}${targets()}`;
    case 'CAST_TRAP':
      return `springs ${card(p.hand[act.handIndex as number]).name}`;
    case 'DECLARE_ATTACK':
      return `attacks ${refName(st, act.target as Ref)} with ${refName(st, act.source as Ref)}`;
    case 'ACTIVATE_POWER': {
      const src = act.source as Ref;
      const holder = src.kind === 'leader' ? p.leader : p.slots[src.slot ?? src.index ?? 0];
      const power = holder ? card(holder.cardId).powers?.[act.powerIndex as number]?.name : undefined;
      return `uses ${power ?? 'a Power'} on ${refName(st, src)}${targets()}`;
    }
    case 'END_TURN':
      return 'ends the turn';
    default:
      return a.type.toLowerCase().replace(/_/g, ' ');
  }
}

/** Actions that are answers rather than moves, left out of a narration. */
export const QUIET = new Set(['DECLINE_FLIP', 'PASS_RESPONSE', 'DECLINE_REPLACE']);

export function leaderLine(st: GameState, botSeat: number): string {
  return st.players.map((p, i) => `${seatName(i, botSeat)} ${p.leader ? remainingHp(p.leader) : 0}`).join(', ');
}
