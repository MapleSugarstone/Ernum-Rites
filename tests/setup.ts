import { beforeAll } from 'vitest';
import { quickSearch, setSearchLimits } from '../src/ai/bot';

/**
 * The suite plays with the bot turned down.
 *
 * Most of these tests ask whether the game still runs: every deck against every
 * other, every three-colour leader, a corpus of replays. None of them care how
 * well the bot plays, and the searching bot costs about two cpu-seconds a game,
 * which turned a suite you run after every edit into a seven-minute wait.
 *
 * The tests that do care about the search say so themselves by calling
 * `setSearchLimits(fullSearch)`, which is the whole of combo.test.ts.
 */
beforeAll(() => {
  setSearchLimits(quickSearch);
});
