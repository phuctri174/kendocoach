/** Bout time limit per game number, seconds — mirrors the solo tournament's
 * round-based pacing but keyed to game number instead of bracket round. */
export const GAME_TIME_LIMITS: Record<number, number> = {
  1: 120,
  2: 150,
  3: 180,
  4: 210,
  5: 240,
};
