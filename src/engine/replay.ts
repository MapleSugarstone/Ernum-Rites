import type { Action, SourceRef } from './actions';
import { digestShort } from './digest';
import { applyAction, createGame, type DeckList } from './engine';
import type { GameState } from './state';
import type { PlayerIdx, TargetRef } from './types';

/** How a target is written on the wire, flat so both engines parse it the same. */
export interface WireRef {
  kind: string;
  player: number;
  index: number;
}

export interface WireAction {
  type: string;
  handIndex?: number;
  index?: number;
  slot?: number;
  source?: WireRef;
  powerIndex?: number;
  target?: WireRef;
  targets?: WireRef[];
  /** Party-only enemy pick. Written only when set, so 2-player replays never carry it. */
  enemy?: number;
}

export interface ReplayDeck {
  name: string;
  leaderId: string;
  cards: string[];
}

export interface ReplayStep {
  actor: number;
  action: WireAction;
  /** Digest of the state after this action, for pinpointing divergence. */
  digest: string;
}

export interface Replay {
  format: number;
  label: string;
  seed: number;
  startingPlayer: number;
  decks: ReplayDeck[];
  setupDigest: string;
  steps: ReplayStep[];
  finalDigest: string;
  winner: number;
  winReason: string | null;
}

// --- wire conversion --------------------------------------------------------

export function refToWire(ref: TargetRef): WireRef {
  switch (ref.kind) {
    case 'summon':
      return { kind: 'summon', player: ref.player, index: ref.slot };
    case 'leader':
      return { kind: 'leader', player: ref.player, index: 0 };
    case 'color':
      return { kind: 'color', player: 0, index: 0 };
    default:
      return { kind: ref.kind, player: ref.player, index: ref.index };
  }
}

export function refFromWire(w: WireRef): TargetRef {
  const player = w.player as PlayerIdx;
  switch (w.kind) {
    case 'summon':
      return { kind: 'summon', player, slot: w.index };
    case 'leader':
      return { kind: 'leader', player };
    case 'hand':
      return { kind: 'hand', player, index: w.index };
    case 'supporter':
      return { kind: 'supporter', player, index: w.index };
    case 'debt':
      return { kind: 'debt', player, index: w.index };
    case 'discard':
      return { kind: 'discard', player, index: w.index };
    default:
      return { kind: 'color', color: 'P' };
  }
}

export function actionToWire(a: Action): WireAction {
  const enemy = 'enemy' in a && a.enemy !== undefined ? { enemy: a.enemy } : {};
  switch (a.type) {
    case 'PLAY_STAGE':
      return { type: a.type, handIndex: a.handIndex, ...enemy };
    case 'PLAY_SUPPORTER':
      return { type: a.type, handIndex: a.handIndex };
    case 'REPLACE_SUMMON':
      return {
        type: a.type,
        handIndex: a.handIndex,
        targets: (a.targets ?? []).map(refToWire),
        ...enemy,
      };
    case 'PAY_FLIP':
      return a.handIndex === undefined
        ? { type: a.type, ...enemy }
        : { type: a.type, handIndex: a.handIndex, ...enemy };
    case 'SAP_SUPPORTER':
      return { type: a.type, index: a.index };
    case 'PLAY_SUMMON':
      return {
        type: a.type,
        handIndex: a.handIndex,
        slot: a.slot,
        targets: (a.targets ?? []).map(refToWire),
        ...enemy,
      };
    case 'CAST_SPELL':
      return { type: a.type, handIndex: a.handIndex, targets: a.targets.map(refToWire), ...enemy };
    case 'CAST_TRAP':
      return { type: a.type, handIndex: a.handIndex, targets: a.targets.map(refToWire) };
    case 'ACTIVATE_POWER':
      return {
        type: a.type,
        source: refToWire(a.source),
        powerIndex: a.powerIndex,
        targets: a.targets.map(refToWire),
        ...enemy,
      };
    case 'DECLARE_ATTACK':
      return { type: a.type, source: refToWire(a.source), target: refToWire(a.target) };
    case 'RESOLVE_CHOICE':
      return {
        type: a.type,
        ...(a.pick ? { target: refToWire(a.pick) } : {}),
        ...(a.index !== undefined ? { index: a.index } : {}),
      };
    default:
      return { type: a.type };
  }
}

export function actionFromWire(w: WireAction): Action {
  const targets = (w.targets ?? []).map(refFromWire);
  const enemy = w.enemy !== undefined ? { enemy: w.enemy as PlayerIdx } : {};
  switch (w.type) {
    case 'PLAY_SUPPORTER':
      return { type: 'PLAY_SUPPORTER', handIndex: w.handIndex ?? 0 };
    case 'SAP_SUPPORTER':
      return { type: 'SAP_SUPPORTER', index: w.index ?? 0 };
    case 'PLAY_SUMMON':
      return {
        type: 'PLAY_SUMMON',
        handIndex: w.handIndex ?? 0,
        slot: w.slot ?? 0,
        targets,
        ...enemy,
      };
    case 'CAST_SPELL':
      return { type: 'CAST_SPELL', handIndex: w.handIndex ?? 0, targets, ...enemy };
    case 'PLAY_STAGE':
      return { type: 'PLAY_STAGE', handIndex: w.handIndex ?? 0, ...enemy };
    case 'ACTIVATE_POWER':
      return {
        type: 'ACTIVATE_POWER',
        source: refFromWire(w.source!) as SourceRef,
        powerIndex: w.powerIndex ?? 0,
        targets,
        ...enemy,
      };
    case 'DECLARE_ATTACK':
      return {
        type: 'DECLARE_ATTACK',
        source: refFromWire(w.source!) as SourceRef,
        target: refFromWire(w.target!),
      };
    case 'CAST_TRAP':
      return { type: 'CAST_TRAP', handIndex: w.handIndex ?? 0, targets };
    case 'PASS_RESPONSE':
      return { type: 'PASS_RESPONSE' };
    case 'RESOLVE_CHOICE':
      return {
        type: 'RESOLVE_CHOICE',
        ...(w.target ? { pick: refFromWire(w.target) } : {}),
        ...(w.index !== undefined ? { index: w.index } : {}),
      };
    case 'REPLACE_SUMMON':
      return { type: 'REPLACE_SUMMON', handIndex: w.handIndex ?? 0, targets, ...enemy };
    case 'DECLINE_REPLACE':
      return { type: 'DECLINE_REPLACE' };
    case 'PAY_FLIP':
      return w.handIndex === undefined
        ? { type: 'PAY_FLIP', ...enemy }
        : { type: 'PAY_FLIP', handIndex: w.handIndex, ...enemy };
    case 'DECLINE_FLIP':
      return { type: 'DECLINE_FLIP' };
    case 'END_TURN':
      return { type: 'END_TURN' };
    case 'CONCEDE':
      return { type: 'CONCEDE' };
    default:
      throw new Error(`unknown action type ${w.type}`);
  }
}

// --- recording and verifying ------------------------------------------------

export interface Recorder {
  state: GameState;
  replay: Replay;
}

export function startRecording(
  decks: [DeckList, DeckList],
  seed: number,
  startingPlayer: PlayerIdx,
  label: string,
): Recorder {
  const state = createGame(decks, seed, startingPlayer);
  return {
    state,
    replay: {
      format: 1,
      label,
      seed,
      startingPlayer,
      decks: decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: [...d.cards] })),
      setupDigest: digestShort(state),
      steps: [],
      finalDigest: '',
      winner: -1,
      winReason: null,
    },
  };
}

/** Applies an action and appends it to the recording. Throws if it was illegal. */
export function recordAction(rec: Recorder, actor: PlayerIdx, action: Action): void {
  const res = applyAction(rec.state, actor, action);
  if (!res.ok) throw new Error(`recorded an illegal ${action.type}: ${res.error}`);
  rec.state = res.state;
  rec.replay.steps.push({
    actor,
    action: actionToWire(action),
    digest: digestShort(rec.state),
  });
}

export function finishRecording(rec: Recorder): Replay {
  rec.replay.finalDigest = digestShort(rec.state);
  rec.replay.winner = rec.state.winner === null ? -1 : rec.state.winner;
  rec.replay.winReason = rec.state.winReason;
  return rec.replay;
}

export interface ReplayResult {
  ok: boolean;
  stepIndex: number;
  detail: string | null;
}

/**
 * Re-runs a replay and reports the first step that does not match. This is what
 * makes the two engines checkable against each other and what makes a rules
 * change visible as an exact list of games whose outcome moved.
 */
export function verifyReplay(replay: Replay): ReplayResult {
  if (replay.decks.length !== 2) {
    return { ok: false, stepIndex: -1, detail: 'replay needs exactly two decks' };
  }
  const decks: [DeckList, DeckList] = [
    { name: replay.decks[0].name, leaderId: replay.decks[0].leaderId, cards: replay.decks[0].cards },
    { name: replay.decks[1].name, leaderId: replay.decks[1].leaderId, cards: replay.decks[1].cards },
  ];
  let state = createGame(decks, replay.seed, replay.startingPlayer as PlayerIdx);

  if (replay.setupDigest) {
    const got = digestShort(state);
    if (got !== replay.setupDigest) {
      return { ok: false, stepIndex: -1, detail: `setup digest ${got} != ${replay.setupDigest}` };
    }
  }

  for (let i = 0; i < replay.steps.length; i++) {
    const step = replay.steps[i];
    const action = actionFromWire(step.action);
    const res = applyAction(state, step.actor as PlayerIdx, action);
    if (!res.ok) {
      return { ok: false, stepIndex: i, detail: `${action.type} rejected: ${res.error}` };
    }
    state = res.state;
    if (step.digest) {
      const got = digestShort(state);
      if (got !== step.digest) {
        return {
          ok: false,
          stepIndex: i,
          detail: `after ${action.type}: digest ${got} != ${step.digest}`,
        };
      }
    }
  }

  if (replay.finalDigest) {
    const got = digestShort(state);
    if (got !== replay.finalDigest) {
      return {
        ok: false,
        stepIndex: replay.steps.length,
        detail: `final digest ${got} != ${replay.finalDigest}`,
      };
    }
  }
  const winner = state.winner === null ? -1 : state.winner;
  if (winner !== replay.winner) {
    return {
      ok: false,
      stepIndex: replay.steps.length,
      detail: `winner ${winner} != ${replay.winner}`,
    };
  }
  return { ok: true, stepIndex: -1, detail: null };
}
