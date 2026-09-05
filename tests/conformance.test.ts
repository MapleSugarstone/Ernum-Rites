import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../src/cards';
import { allDecks, deckByKey } from '../src/cards';
import { chooseAction } from '../src/ai/bot';
import { digestHash, digestShort } from '../src/engine/digest';
import { createGame, type DeckList } from '../src/engine/engine';
import {
  finishRecording,
  recordAction,
  startRecording,
  verifyReplay,
  type Replay,
} from '../src/engine/replay';
import { allCards } from '../src/engine/registry';
import {
  currentActor,
  isOver,
} from '../src/engine/state';
import { costToString, type CardDef } from '../src/engine/types';

const CORPUS = join(process.cwd(), 'replays');

function asList(key: string, seatNo: number): DeckList {
  const d = deckByKey(key);
  return { name: `${d.name} (P${seatNo})`, leaderId: d.leaderId, cards: d.cards };
}

/** Play a bot game and record it, the same way the C# recorder does. */
function recordBotGame(aKey: string, bKey: string, seed: number): Replay {
  const rec = startRecording([asList(aKey, 1), asList(bKey, 2)], seed, 0, `${aKey}-vs-${bKey}`);
  let actions = 0;
  while (!isOver(rec.state) && actions < 6000 && rec.state.turn < 300) {
    const actor = currentActor(rec.state);
    recordAction(rec, actor, chooseAction(rec.state, actor));
    actions++;
  }
  return finishRecording(rec);
}

describe('digest', () => {
  it('hashes exactly the way the C# side does', () => {
    // Pinned vectors: if FNV drifts in either engine, this fails before anything
    // more expensive does.
    expect(digestHash('')).toBe('cbf29ce484222325');
    expect(digestHash('a')).toBe('af63dc4c8601ec8c');
    expect(digestHash('ernumrites')).toBe(digestHash('ernumrites'));
    expect(digestHash('ernumrites')).not.toBe(digestHash('ernumritez'));
  });

  it('is stable for a seed and moves when the position moves', () => {
    const decks: [DeckList, DeckList] = [asList('vanilla', 1), asList('vanilla', 2)];
    const a = createGame(decks, 777, 0);
    const b = createGame(decks, 777, 0);
    expect(digestShort(a)).toBe(digestShort(b));
    const c = createGame(decks, 778, 0);
    expect(digestShort(a)).not.toBe(digestShort(c));
  });
});

describe('replays', () => {
  it('re-runs a game it recorded itself', () => {
    const replay = recordBotGame('deepcurrent', 'emberchoir', 4242);
    expect(replay.steps.length).toBeGreaterThan(5);
    const res = verifyReplay(replay);
    expect(res.detail, `step ${res.stepIndex}`).toBeNull();
  });

  it('catches a tampered step at the exact index', () => {
    const replay = recordBotGame('vanilla', 'vanilla', 99);
    expect(replay.steps.length).toBeGreaterThan(3);
    replay.steps[2].digest = 'deadbeefdeadbeef';
    const res = verifyReplay(replay);
    expect(res.ok).toBe(false);
    expect(res.stepIndex).toBe(2);
  });

  // A representative slice only. The exhaustive sweep across every pairing is
  // the C# simulator's job, where it runs in a fraction of the time.
  it('records a spread of pairings without producing an illegal action', { timeout: 600_000 }, () => {
    for (let i = 0; i < allDecks.length; i++) {
      const a = allDecks[i];
      const b = allDecks[(i * 3 + 1) % allDecks.length];
      const replay = recordBotGame(a.key, b.key, 5000 + i * 977);
      const res = verifyReplay(replay);
      expect(res.detail, `${a.key} vs ${b.key} step ${res.stepIndex}`).toBeNull();
    }
  });
});

/**
 * The cross-engine check. The corpus is recorded by whichever engine ran
 * `record` last; both engines have to agree on every step of every game in it.
 */
describe('cross-engine conformance', () => {
  const files = existsSync(CORPUS)
    ? readdirSync(CORPUS)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];

  it('has a replay corpus to check against', () => {
    expect(
      files.length,
      'run `npm run sim:record` (or the C# sim) to write replays/',
    ).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`agrees with the other engine on ${file}`, () => {
      const replay = JSON.parse(readFileSync(join(CORPUS, file), 'utf8')) as Replay;
      const res = verifyReplay(replay);
      expect(res.detail, `step ${res.stepIndex} of ${replay.steps.length}`).toBeNull();
      expect(res.ok).toBe(true);
    });
  }
});

/**
 * Card data is the part of a two-engine port most likely to drift quietly: a
 * stat typed 3 instead of 4 on one side changes games without breaking either
 * build. The C# simulator writes conformance/cards.json; this compares it field
 * by field against what the TypeScript registry holds.
 */
describe('card manifest', () => {
  const manifestPath = join(process.cwd(), 'conformance', 'cards.json');

  interface Entry {
    id: string;
    name: string;
    type: string;
    starter: boolean;
    color: string;
    neutral: boolean;
    color2: string | null;
    color3: string | null;
    level: number;
    strength: number;
    hp: number;
    rarity: string;
    cost: string;
    factions: string[];
    identity: string[] | null;
    art: string;
    text: string;
    flipText: string;
    targets: number;
    powers: {
    name: string;
    text: string;
    cost: string;
    once: boolean;
    sap: boolean;
    hp: number;
    targets: number;
  }[];
    flip: boolean;
    /**
     * Presence only, the way `flip` is. A predicate cannot be compared across
     * the two engines, but whether a card carries one can be, and a card that
     * grew one on this side and not the other is exactly the drift this list
     * exists to catch: the rule that reads it lives in both engines.
     */
    flipUseful: boolean;
    /** Presence only, like `flipUseful`, and for the same reason. */
    trapUseful: boolean;
    flipCost: string;
    triggers: string;
    stage: string;
    /** Presence only, the way `flip` is. */
    store: boolean;
    storeSurcharge: number;
    storeTargets: number;
    storeUseful: boolean;
    storeBoost: boolean;
  }

  function triggerList(def: CardDef): string {
    const t = def.triggers;
    if (!t) return '';
    const names: string[] = [];
    if (t.onEnter) names.push('enter');
    if (t.onDeath) names.push('death');
    if (t.onAttack) names.push('attack');
    if (t.onDefend) names.push('defend');
    if (t.onAwake) names.push('awake');
    if (t.onOtherDeath) names.push('otherdeath');
    if (t.onSpellCast) names.push('spellcast');
    if (t.onStoreSold) names.push('storesold');
    if (t.onSummonPlayed) names.push('played');
    if (t.strengthBonus) names.push('strength');
    return names.join('+');
  }

  function stageList(def: CardDef): string {
    const h = def.stageHooks;
    if (!h) return '';
    const names: string[] = [];
    if (h.onAwake) names.push('awake');
    if (h.onStoreSold) names.push('storesold');
    if (h.strengthBonus) names.push('strength');
    return names.join('+');
  }

  function entryOf(def: CardDef): Entry {
    return {
      id: def.id,
      name: def.name,
      type: def.type,
      starter: !!def.starter,
      color: def.color,
      neutral: !!def.neutral,
      color2: def.color2 ?? null,
      color3: def.color3 ?? null,
      level: def.level ?? 1,
      strength: def.strength ?? 0,
      hp: def.hp ?? 0,
      rarity: def.rarity ?? 'C',
      cost: costToString(def.cost),
      factions: [...(def.factions ?? [])],
      identity: def.identity ? [...def.identity] : null,
      art: def.art ?? '',
      text: def.text ?? '',
      flipText: def.flipText ?? '',
      targets: def.targets?.length ?? 0,
      powers: (def.powers ?? []).map((p) => ({
        name: p.name,
        text: p.text,
        cost: costToString(p.cost),
        once: p.oncePerTurn ?? false,
        sap: p.sapSelf ?? false,
        hp: p.hpCost ?? 0,
        targets: p.targets?.length ?? 0,
      })),
      flip: !!def.flip,
      flipUseful: !!def.flipUseful,
      trapUseful: !!def.trapUseful,
      flipCost: def.flipCost
        ? `${costToString(def.flipCost.mana)}|${def.flipCost.mill ?? 0}|${def.flipCost.discard ?? 0}`
        : '',
      triggers: triggerList(def),
      stage: stageList(def),
      store: !!def.store,
      storeSurcharge: def.store?.surcharge ?? 0,
      storeTargets: def.store?.targets?.length ?? 0,
      storeUseful: !!def.store?.useful,
      storeBoost: !!def.storeBoost,
    };
  }

  it('has a manifest to check against', () => {
    expect(
      existsSync(manifestPath),
      'run `npm run cs:sim -- cards` to write conformance/cards.json',
    ).toBe(true);
  });

  it('matches the C# card definitions field for field', () => {
    if (!existsSync(manifestPath)) return;
    const theirs = JSON.parse(readFileSync(manifestPath, 'utf8')) as Entry[];
    // Cards minted during earlier tests' games (gen-*) are not printed cards.
    const mine = allCards()
      .filter((c) => c.art && !c.id.startsWith('gen-'))
      .map(entryOf)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    expect(mine.length, 'card count').toBe(theirs.length);

    const byId = new Map(theirs.map((e) => [e.id, e]));
    const diffs: string[] = [];
    for (const m of mine) {
      const t = byId.get(m.id);
      if (!t) {
        diffs.push(`${m.id}: missing on the C# side`);
        continue;
      }
      const a = JSON.stringify(m);
      const b = JSON.stringify(t);
      if (a !== b) diffs.push(`${m.id}\n  ts: ${a}\n  cs: ${b}`);
    }
    for (const t of theirs) {
      if (!mine.some((m) => m.id === t.id)) diffs.push(`${t.id}: missing on the TypeScript side`);
    }
    expect(diffs.slice(0, 6)).toEqual([]);
  });
});
