import { simulateBout, simulateEncho } from "./bout";
import { overallStrength } from "./rating";
import { createRng, type Rng } from "./rng";
import { aiSkill, type RoundSpec } from "./tournament";
import { POSITIONS, type Lineup, type Player, type Position } from "./types";

/** Bouts sampled per matchup when estimating an edge. */
export const EDGE_SAMPLES = 24;
/** How sharply a maximally-skilled AI favours its best option. */
export const DECISION_SHARPNESS = 4;

/**
 * Estimated edge of `x` over `y`, in [-1, 1], by sampling the real engine
 * rather than a separate hand-tuned heuristic — the AI is judged by the same
 * rules the match will be played under.
 */
export function estimateEdge(
  x: Player,
  y: Player,
  timeLimitSeconds: number,
  rng: Rng,
  samples: number = EDGE_SAMPLES,
): number {
  let score = 0;
  for (let i = 0; i < samples; i++) {
    const bout = simulateBout(x, y, {
      position: "Chuken",
      timeLimitSeconds,
      rng,
    });
    if (bout.result.winner === "A") score += 1;
    else if (bout.result.winner === "B") score -= 1;
  }
  return score / samples;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

function softmaxPick<T>(items: T[], scores: number[], sharpness: number, rng: Rng): T {
  const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  const sd = Math.sqrt(
    scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (scores.length || 1),
  );
  // No spread means every option is equivalent — pick uniformly.
  if (sd < 1e-9) return items[Math.floor(rng.next() * items.length)];
  const weights = scores.map((s) => Math.exp(sharpness * ((s - mean) / sd)));
  return rng.weighted(items, weights);
}

export interface CounterPickOptions {
  round: RoundSpec;
  rng?: Rng;
  seed?: string | number;
  samples?: number;
}

export interface CounterPickResult {
  lineup: Lineup;
  /** The opponent assigned to each position, in Senpo-to-Taisho order. */
  order: Player[];
  /** Total estimated edge of the chosen assignment. */
  edge: number;
}

/**
 * Assigns the opponent's five to positions, trying to create bad matchups
 * against the coach's lineup. Decision quality scales with the round: at low
 * skill the softmax is nearly flat (effectively random), at high skill it
 * concentrates on the best permutation.
 */
export function assignOpponentLineup(
  coachLineup: Player[],
  opponents: Player[],
  options: CounterPickOptions,
): CounterPickResult {
  const rng =
    options.rng ?? createRng(options.seed ?? `counterpick-${options.round.name}`);
  const skill = aiSkill(options.round);
  const timeLimit = options.round.timeLimitSeconds;

  // edge[o][p] — how well opponent o does against the coach's player at position p.
  const edges = opponents.map((opponent) =>
    coachLineup.map((coachPlayer) =>
      estimateEdge(opponent, coachPlayer, timeLimit, rng, options.samples),
    ),
  );

  const indexPerms = permutations(opponents.map((_, i) => i));
  const totals = indexPerms.map((perm) =>
    perm.reduce((sum, opponentIndex, position) => sum + edges[opponentIndex][position], 0),
  );

  const chosen = softmaxPick(indexPerms, totals, DECISION_SHARPNESS * skill, rng);
  const order = chosen.map((i) => opponents[i]);
  const edge = chosen.reduce((sum, o, p) => sum + edges[o][p], 0);

  const lineup = POSITIONS.reduce((acc, position, i) => {
    acc[position.toLowerCase() as Lowercase<Position>] = order[i].id;
    return acc;
  }, {} as Lineup);

  return { lineup, order, edge };
}

export interface RepresentativeOptions extends CounterPickOptions {
  /** The coach's representative, when already chosen — enables counter-picking. */
  against?: Player;
}

/**
 * The opponent's encho representative. Randomised, but weighted toward the
 * stronger (or, when the coach's rep is known, the better-matched) choice as
 * the round number rises — same difficulty curve as the lineup AI.
 */
export function pickRepresentative(
  candidates: Player[],
  options: RepresentativeOptions,
): Player {
  const rng =
    options.rng ?? createRng(options.seed ?? `rep-${options.round.name}`);
  const skill = aiSkill(options.round);
  const timeLimit = options.round.timeLimitSeconds;

  const scores = candidates.map((candidate) =>
    options.against
      ? estimateEdge(candidate, options.against, timeLimit, rng, options.samples)
      : // Nobody to counter yet — fall back to raw strength.
        candidateStrength(candidate),
  );

  return softmaxPick(candidates, scores, DECISION_SHARPNESS * skill, rng);
}

/** Normalised to 0-1 for softmax scoring; same score used everywhere else. */
function candidateStrength(player: Player): number {
  return overallStrength(player) / 100;
}

/**
 * Suggested representative for the coach, offered as a default they can
 * override: whoever the engine rates best against the opponent's pick.
 */
export function suggestCoachRepresentative(
  candidates: Player[],
  against: Player | undefined,
  round: RoundSpec,
  rng: Rng = createRng(`coach-rep-${round.name}`),
  samples: number = EDGE_SAMPLES,
): Player {
  if (!against) {
    return candidates.reduce((best, p) =>
      candidateStrength(p) > candidateStrength(best) ? p : best,
    );
  }
  let best = candidates[0];
  let bestEdge = -Infinity;
  for (const candidate of candidates) {
    const edge = estimateEdge(candidate, against, round.timeLimitSeconds, rng, samples);
    if (edge > bestEdge) {
      bestEdge = edge;
      best = candidate;
    }
  }
  return best;
}

/** Runs the encho itself once both representatives are settled. */
export function runEncho(
  coachRep: Player,
  opponentRep: Player,
  rng: Rng,
  id?: string,
) {
  return simulateEncho(coachRep, opponentRep, { rng, id });
}
