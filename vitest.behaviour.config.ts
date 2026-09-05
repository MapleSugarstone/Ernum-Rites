import { defineConfig, type UserConfig } from 'vitest/config';
import base from './vite.config';

// The decision-level bot tests: what the bot chooses on hand-built boards. Not
// part of the deploy gate, because a card change or a search change can move a
// choice without anything being wrong. Run with `npm run test:behaviour`.
// Spread rather than merged: a merge concatenates include patterns and would
// run the gate as well.
const shared = base as UserConfig;
export default defineConfig({
  ...shared,
  test: { ...shared.test, include: ['tests/behaviour/**/*.test.ts'] },
});
