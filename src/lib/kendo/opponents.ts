import { toPlayers } from "./draft";
import { overallStrength } from "./rating";
import { createRng, type Rng } from "./rng";
import { strengthBias, type RoundSpec } from "./tournament";
import {
  POSITIONS,
  type PersonRecord,
  type Player,
  type Team,
} from "./types";

/** How hard the round bias skews selection. Higher = stronger skew. */
export const SELECTION_BIAS_STRENGTH = 1.1;

/** Single 0-100 quality number for a stat block — the shared strength score. */
export const ratingOf = overallStrength;

export function personRating(person: PersonRecord): number {
  return ratingOf(person.baseStats);
}

export function playerRating(player: Player): number {
  return ratingOf(player);
}

function standardScores(values: number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length || 1);
  const sd = Math.sqrt(variance);
  // A flat pool has no spread to bias on — fall back to uniform weighting.
  return sd < 1e-9 ? values.map(() => 0) : values.map((v) => (v - mean) / sd);
}

/**
 * Selection weights for one round. Round 1 leans toward weaker players, later
 * rounds toward stronger, as a continuous exponential weighting — every player
 * keeps a non-zero chance in every round, so even the Final can draw a weak
 * squad by luck.
 */
export function selectionWeights(
  people: PersonRecord[],
  round: RoundSpec,
): number[] {
  const bias = strengthBias(round);
  return standardScores(people.map(personRating)).map((z) =>
    Math.exp(SELECTION_BIAS_STRENGTH * bias * z),
  );
}

function weightedSampleWithoutReplacement(
  people: PersonRecord[],
  weights: number[],
  count: number,
  rng: Rng,
): PersonRecord[] {
  const pool = people.map((person, i) => ({ person, weight: weights[i] }));
  const picked: PersonRecord[] = [];

  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng.next() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(pool.splice(index, 1)[0].person);
  }
  return picked;
}

export interface OpponentSquadOptions {
  round: RoundSpec;
  /** personIds the coach drafted — these can never appear as opponents. */
  excludePersonIds: Iterable<string>;
  rng?: Rng;
  seed?: string | number;
  size?: number;
}

/** Picks five opponents from everyone the coach did not draft. */
export function generateOpponentSquad(
  people: PersonRecord[],
  options: OpponentSquadOptions,
): PersonRecord[] {
  const rng = options.rng ?? createRng(options.seed ?? `opponents-${options.round.name}`);
  const excluded = new Set(options.excludePersonIds);
  const eligible = people.filter((person) => !excluded.has(person.id));
  const size = options.size ?? POSITIONS.length;

  if (eligible.length < size) {
    throw new Error(
      `Only ${eligible.length} players are eligible for the opponent squad; ${size} are needed.`,
    );
  }

  return weightedSampleWithoutReplacement(
    eligible,
    selectionWeights(eligible, options.round),
    size,
    rng,
  );
}

export interface BuildOpponentTeamOptions extends OpponentSquadOptions {
  name?: string;
  id?: string;
}

/**
 * Builds a full opponent team for a round. The lineup is left unassigned —
 * `assignOpponentLineup` fills it once the coach's lineup is known.
 */
export function buildOpponentTeam(
  people: PersonRecord[],
  options: BuildOpponentTeamOptions,
): { team: Team; players: Player[] } {
  const rng = options.rng ?? createRng(options.seed ?? `opponents-${options.round.name}`);
  const squad = generateOpponentSquad(people, { ...options, rng });
  const players = toPlayers(squad);

  const team: Team = {
    id: options.id ?? `opponent-r${options.round.index}`,
    name: options.name ?? `Đối thủ ${options.round.label}`,
    roster: players,
    lineup: {
      senpo: players[0].id,
      jiho: players[1].id,
      chuken: players[2].id,
      fukusho: players[3].id,
      taisho: players[4].id,
    },
  };

  return { team, players };
}
