/**
 * Seeded RNG so a bout replays identically from the same seed — the UI can
 * re-render a match without re-rolling it, and the test script can diff runs.
 */
export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick; weights <= 0 are treated as 0. Falls back to uniform if all are 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  if (state === 0) state = 0x9e3779b9;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items, weights) => {
      const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
      if (total <= 0) return items[Math.floor(next() * items.length)];
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= Math.max(0, weights[i]);
        if (roll <= 0) return items[i];
      }
      return items[items.length - 1];
    },
  };
}
