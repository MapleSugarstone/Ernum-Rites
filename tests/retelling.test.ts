import { describe, expect, it } from 'vitest';
import '../src/cards';
import { applyAction, createGame, type DeckList } from '../src/engine/engine';
import type { GameState } from '../src/engine/state';
import type { PlayerIdx } from '../src/engine/types';
import { matchRetelling, retellingFilename } from '../src/ui/retelling';

/**
 * The match written out for somebody who was not there.
 *
 * It is built from the engine's own log, so what it can say is exactly what the
 * client was told. Online that log came from a redacted state, which is what
 * makes the file safe to hand over.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';
const WHEN = '2026-09-02T18:35:51.416Z';

function deck(name: string): DeckList {
  return { name, leaderId: LEADER, cards: Array.from({ length: 60 }, () => FILLER) };
}

function played(turns: number): GameState {
  let s = createGame([deck('Ada'), deck('Bo')], 4, 0);
  for (let i = 0; i < turns; i++) {
    const r = applyAction(s, s.active, { type: 'END_TURN' });
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

const tell = (state: GameState, over: Partial<Parameters<typeof matchRetelling>[0]> = {}) =>
  matchRetelling({ state, seat: 0, online: false, when: WHEN, ...over });

describe('the match retelling', () => {
  it('names the build, the mode and the seats', () => {
    const text = tell(played(4));
    expect(text).toContain('Ernum Rites, match replay');
    expect(text).toContain('mode:      local');
    expect(text).toContain('seat 0 (you): Ada');
    expect(text).toContain('seat 1: Bo');
  });

  it('names the room when the match was online', () => {
    const text = tell(played(2), { online: true, roomCode: 'V9KCQQ' });
    expect(text).toContain('mode:      online');
    expect(text).toContain('V9KCQQ');
  });

  it('groups what happened under the turn it happened in', () => {
    const s = played(4);
    const text = tell(s);
    expect(text).toContain('Turn 1');
    expect(text).toContain('Turn 2');
    // Every line the engine wrote is in there, none invented.
    for (const entry of s.log) expect(text).toContain(entry.text);
  });

  it('says how the board ended, which the log never restates', () => {
    const text = tell(played(4));
    expect(text).toContain('Final board');
    expect(text).toMatch(/seat 0 Ada: .*on \d+ HP, debt \d+/);
  });

  it('calls an unfinished match unfinished', () => {
    expect(tell(played(2))).toContain('result:    unfinished');
  });

  it('records a trap held back, which is a decision and not an absence', () => {
    const s = played(2);
    s.log.push({ turn: s.turn, player: 1 as PlayerIdx, text: 'Bo holds their trap.' });
    expect(tell(s), 'declining is part of the story').toContain('Bo holds their trap.');
  });

  it('stamps the file so a folder of them sorts by date', () => {
    const state = played(2);
    expect(retellingFilename({ state, seat: 0, online: false, when: WHEN })).toBe(
      'ernum-rites-2026-09-02-18-35-51.txt',
    );
    expect(
      retellingFilename({ state, seat: 0, online: true, roomCode: 'V9KCQQ', when: WHEN }),
    ).toContain('V9KCQQ');
  });
});
