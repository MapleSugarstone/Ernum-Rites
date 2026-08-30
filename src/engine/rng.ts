/** mulberry32. Deterministic so a Durable Object and a client agree on shuffles. */
export function nextRandom(seedState: number): { value: number; state: number } {
  let t = (seedState + 0x6d2b79f5) | 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, state: t };
}

export interface Rng {
  state: number;
}

export function randInt(rng: Rng, maxExclusive: number): number {
  const { value, state } = nextRandom(rng.state);
  rng.state = state;
  return Math.floor(value * maxExclusive);
}

/** Fisher-Yates, in place. */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
