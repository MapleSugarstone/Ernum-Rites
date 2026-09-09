// The bot's own thread. A Web Worker inside the player's browser, on their
// device, that holds the bot's caches and answers the page's requests for a
// decision, so a long think never freezes the page. Nothing leaves the
// device and nothing here needs a network.
import '../cards';
import { chooseAction, clearPlan, fullSearch, quickSearch, setSearchLimits, warm } from './bot';
import type { Action } from '../engine/actions';
import type { GameState } from '../engine/state';
import type { PlayerIdx } from '../engine/types';

/** How hard the bot plays: the full search, or the cheap one. */
export type BotLevel = 'easy' | 'hard';

export type BotRequest =
  | { id: number; kind: 'choose'; state: GameState; seat: PlayerIdx; level?: BotLevel }
  | { id: number; kind: 'warm'; state: GameState; seat: PlayerIdx; level?: BotLevel }
  | { id: number; kind: 'reset' };

export interface BotReply {
  id: number;
  action: Action;
}

const port = self as unknown as { postMessage(reply: BotReply): void; onmessage: ((e: MessageEvent<BotRequest>) => void) | null };

// Setting the limits clears every cache and the root seat, so it is only done
// when the level actually changes rather than on each request.
let level: BotLevel = 'hard';

function useLevel(next: BotLevel | undefined): void {
  const want = next ?? 'hard';
  if (want === level) return;
  level = want;
  setSearchLimits(want === 'easy' ? quickSearch : fullSearch);
}

port.onmessage = (e: MessageEvent<BotRequest>) => {
  const req = e.data;
  if (req.kind === 'reset') {
    clearPlan();
    return;
  }
  useLevel(req.level);
  if (req.kind === 'warm') {
    warm(req.state, req.seat);
    return;
  }
  port.postMessage({ id: req.id, action: chooseAction(req.state, req.seat) });
};
