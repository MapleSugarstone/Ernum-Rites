import { beforeEach, describe, expect, it } from 'vitest';
import '../src/cards';
import { createGame, type DeckList } from '../src/engine/engine';
import {
  capturedClose,
  clearClose,
  clearJournal,
  closeReport,
  note,
  recordClose,
} from '../src/ui/diagnostics';

/**
 * The report a dropped player pastes into a bug thread.
 *
 * Everything it is written for is gone by the time the button is pressed:
 * dropping back to the lobby clears the seat, the room code and the phase so
 * the lobby can be drawn without them. So the volatile half is captured at the
 * moment of failure, and only the close code, which the browser announces after
 * the error that started the drop, is read later.
 */

const FILLER = 'x-r-dummy-1';
const LEADER = 'x-hero-dummy-warden';

function deck(): DeckList {
  return { name: 'Tester', leaderId: LEADER, cards: Array.from({ length: 60 }, () => FILLER) };
}

beforeEach(() => {
  clearClose();
  clearJournal();
});

describe('the match report', () => {
  it('keeps the facts the lobby is about to clear', () => {
    const state = createGame([deck(), deck()], 5, 0);
    recordClose({
      reason: 'the connection dropped',
      state,
      seat: 1,
      roomCode: 'BG842Q',
      online: true,
      health: { quietMs: 24_000, readyState: 1 },
    });
    // What failOnline does next: the seat, the room and the phase all go.
    const text = closeReport(capturedClose('code 1006')!);
    expect(text).toContain('mode:          online');
    expect(text).toContain('BG842Q');
    expect(text).toContain('you are seat 1');
    expect(text).toContain('the connection dropped');
  });

  it('names how the socket ended, which is only known afterwards', () => {
    recordClose({
      reason: 'the connection dropped',
      state: null,
      seat: 0,
      roomCode: 'AAA111',
      online: true,
      health: { quietMs: 1_000, readyState: 1 },
    });
    const text = closeReport(capturedClose('code 1006')!);
    expect(text, 'the code that separates a death from a clean close').toContain('code 1006');
    expect(text, 'and what the socket still called itself').toContain('open');
  });

  it('freezes how long the room had been quiet', () => {
    recordClose({
      reason: 'the room stopped answering',
      state: null,
      seat: 0,
      roomCode: 'AAA111',
      online: true,
      health: { quietMs: 25_000, readyState: 1 },
    });
    // Measured when the button is pressed this grows with the player's reading
    // time, and 25s is the number that means something.
    expect(closeReport(capturedClose('')!)).toContain('25.0s');
  });

  it('carries the journal that led up to it', () => {
    note('seated as seat 1 in room BG842Q');
    note('error: the connection dropped');
    recordClose({ reason: 'x', state: null, seat: 1, roomCode: 'BG842Q', online: true });
    const text = closeReport(capturedClose('')!);
    expect(text).toContain('seated as seat 1 in room BG842Q');
    expect(text).toContain('error: the connection dropped');
  });

  it('has nothing to offer once a new session claims it', () => {
    recordClose({ reason: 'x', state: null, seat: 1, roomCode: 'BG842Q', online: true });
    clearClose();
    expect(capturedClose('code 1006'), 'the next attempt owns the report').toBeNull();
  });

  it('still describes a match that is simply not there', () => {
    const text = closeReport({ reason: 'the match stopped', state: null, seat: null, online: false });
    expect(text).toContain('no match in progress');
    expect(text).toContain('mode:          local');
  });
});
