export type RoundName = "Round of 16" | "Quarterfinal" | "Semifinal" | "Final";

export interface RoundSpec {
  /** Stable identifier, used in match ids and seeds. Never shown to the user. */
  name: RoundName;
  /** Vietnamese display label — this is what the UI renders. */
  label: string;
  /** 1-4. */
  index: number;
  /** Bout time limit in seconds — drives exchange budget and stamina decay. */
  timeLimitSeconds: number;
  /** 0 at Round of 16, 1 at the Final. Everything round-scaled derives from this. */
  difficulty: number;
}

/**
 * Top 16, single elimination: the coach plays exactly four team matches.
 *
 * `timeLimitSeconds` is a pacing unit, not a clock — nothing counts down. It
 * sets the exchange budget for a bout and scales how fast fatigue accumulates
 * over it. A "4:00" round is simply a longer, more tiring one.
 */
export const TOURNAMENT_ROUNDS: readonly RoundSpec[] = [
  { name: "Round of 16", label: "Vòng 1/8", index: 1, timeLimitSeconds: 120, difficulty: 0 },
  { name: "Quarterfinal", label: "Tứ kết", index: 2, timeLimitSeconds: 180, difficulty: 1 / 3 },
  { name: "Semifinal", label: "Bán kết", index: 3, timeLimitSeconds: 240, difficulty: 2 / 3 },
  { name: "Final", label: "Chung kết", index: 4, timeLimitSeconds: 240, difficulty: 1 },
];

export function roundByIndex(index: number): RoundSpec {
  const round = TOURNAMENT_ROUNDS.find((r) => r.index === index);
  if (!round) throw new Error(`No tournament round with index ${index}`);
  return round;
}

/**
 * Signed strength bias for opponent selection: -1 skews toward the weakest
 * players, +1 toward the strongest. Applied as continuous weighting, never a
 * cutoff — any player can be drawn in any round.
 */
export function strengthBias(round: RoundSpec): number {
  return round.difficulty * 2 - 1;
}

/**
 * How well the opponent AI plays: near-random in the Round of 16, close to
 * optimal by the Final. Shared by lineup counter-picking and rep selection.
 */
export function aiSkill(round: RoundSpec): number {
  return 0.15 + 0.85 * round.difficulty;
}

/** Formats 120 as "2:00" for the UI. */
export function formatTimeLimit(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  return `${mins}:${String(seconds % 60).padStart(2, "0")}`;
}
