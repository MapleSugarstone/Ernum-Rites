import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../src/cards';
import { chooseAction, setNetwork } from '../src/ai/bot';
import { loadBundle, type NetBundleJson } from '../src/ai/net/bundle';
import { encode } from '../src/ai/net/encoder';
import { valueOf } from '../src/ai/net/model';
import { applyAction, createGame } from '../src/engine/engine';
import { actionFromWire, type Replay } from '../src/engine/replay';
import { currentActor } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';

/**
 * The trained network is exported by the C# trainer and read by the client,
 * and the observation it reads is built twice, once in each language. This
 * holds both encoders and both forward passes to the same floats on the same
 * positions: `dump-obs` walks a recorded game in C# and writes what it saw,
 * and this walks the same game here.
 */

interface Sample {
  step: number;
  seat: PlayerIdx;
  /** Observation length, with the non-zero entries as parallel index and value arrays. */
  size: number;
  idx: string;
  val: string;
  value: number;
}

interface Fixture {
  replay: string;
  net: string;
  every: number;
  samples: Sample[];
}

const FIXTURE = join(process.cwd(), 'conformance', 'net-parity.json');
const BUNDLE = join(process.cwd(), 'src', 'ai', 'net', 'default.json');

function bytesOf(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function dense(sample: Sample): Float32Array {
  const idx = new Int32Array(bytesOf(sample.idx).buffer);
  const val = new Float32Array(bytesOf(sample.val).buffer);
  const out = new Float32Array(sample.size);
  for (let i = 0; i < idx.length; i++) out[idx[i]] = val[i];
  return out;
}

function whereIs(i: number, cards: number, cardChannels: number, entityChannels: number, entities: number): string {
  const cardPlane = cardChannels * cards;
  const entPlane = entityChannels * entities;
  if (i < cardPlane) return `card channel ${Math.floor(i / cards)} column ${i % cards}`;
  if (i < cardPlane + entPlane) {
    const j = i - cardPlane;
    return `entity channel ${Math.floor(j / entities)} body ${j % entities}`;
  }
  return `scalar ${i - cardPlane - entPlane}`;
}

describe('network parity', () => {
  const present = existsSync(FIXTURE) && existsSync(BUNDLE);
  const run = present ? it : it.skip;

  run('encodes and values recorded positions the way the trainer does', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    const net = loadBundle(JSON.parse(readFileSync(BUNDLE, 'utf8')) as NetBundleJson);
    const replay = JSON.parse(
      readFileSync(join(process.cwd(), 'replays', fixture.replay), 'utf8'),
    ) as Replay;
    expect(net.cards.length).toBeGreaterThan(0);

    let state = createGame(
      replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
      replay.seed,
      replay.startingPlayer as PlayerIdx,
    );
    const byStep = new Map<number, Sample[]>();
    for (const s of fixture.samples) {
      const list = byStep.get(s.step) ?? [];
      list.push(s);
      byStep.set(s.step, list);
    }

    let checked = 0;
    for (let i = 0; i <= replay.steps.length; i++) {
      for (const sample of byStep.get(i) ?? []) {
        const theirs = dense(sample);
        const mine = encode(state, sample.seat, net);
        expect(mine.length, `step ${i} seat ${sample.seat} observation size`).toBe(theirs.length);
        for (let j = 0; j < mine.length; j++) {
          if (Math.abs(mine[j] - theirs[j]) > 1e-5) {
            throw new Error(
              `step ${i} seat ${sample.seat}: ${whereIs(j, net.cards.length, net.cardChannels, net.entityChannels, net.entities)} `
                + `is ${mine[j]} here and ${theirs[j]} in the trainer`,
            );
          }
        }
        const value = valueOf(net, mine);
        expect(Math.abs(value - sample.value), `step ${i} seat ${sample.seat} value ${value} vs ${sample.value}`)
          .toBeLessThan(2e-3);
        checked++;
      }
      if (i === replay.steps.length) break;
      const step = replay.steps[i];
      const res = applyAction(state, step.actor as PlayerIdx, actionFromWire(step.action));
      if (!res.ok) throw new Error(`step ${i} refused: ${res.error}`);
      state = res.state;
    }
    expect(checked).toBe(fixture.samples.length);
  });

  run('steers the bot without breaking a turn', () => {
    // The hook itself: with a network installed the search still returns a
    // legal action at a planned turn, and removing the network restores the
    // plain search. Play quality is the trainer's sweep to measure, not this.
    const net = loadBundle(JSON.parse(readFileSync(BUNDLE, 'utf8')) as NetBundleJson);
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    const replay = JSON.parse(
      readFileSync(join(process.cwd(), 'replays', fixture.replay), 'utf8'),
    ) as Replay;
    let state = createGame(
      replay.decks.map((d) => ({ name: d.name, leaderId: d.leaderId, cards: d.cards })),
      replay.seed,
      replay.startingPlayer as PlayerIdx,
    );
    for (let i = 0; i < Math.min(12, replay.steps.length); i++) {
      const step = replay.steps[i];
      const res = applyAction(state, step.actor as PlayerIdx, actionFromWire(step.action));
      if (!res.ok) throw new Error(`step ${i} refused: ${res.error}`);
      state = res.state;
    }
    try {
      setNetwork(net, 0.15);
      const action = chooseAction(state, currentActor(state));
      expect(applyAction(state, currentActor(state), action).ok).toBe(true);
    } finally {
      setNetwork(null);
    }
  });
});
