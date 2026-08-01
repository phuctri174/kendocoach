import { assignOpponentLineup, pickRepresentative } from "./ai";
import { buildOpponentTeam } from "./opponents";
import { createRng, type Rng } from "./rng";
import { lineupPlayers, simulateTeamMatch, suggestRepresentative } from "./teamMatch";
import type { RoundSpec } from "./tournament";
import type { PersonRecord, Player, Team, TeamMatch } from "./types";

export interface DrawOpponentsOptions {
  round: RoundSpec;
  /** The full club pool. */
  people: PersonRecord[];
  /**
   * Everyone ineligible this round: the coach's own squad, plus anyone who has
   * already appeared for an opposing team earlier in this tournament run.
   */
  excludePersonIds: Iterable<string>;
  opponentTeamName?: string;
  rng?: Rng;
  seed?: string | number;
}

export interface DrawnOpponents {
  team: Team;
  players: Player[];
}

/**
 * Step one of a round: pick who the coach is facing. Deliberately separate
 * from simulation so the squad can be revealed while the coach is still
 * deciding their own positions — the AI's own positioning is not decided here.
 */
export function drawOpponents(options: DrawOpponentsOptions): DrawnOpponents {
  const rng =
    options.rng ?? createRng(options.seed ?? `opponents-${options.round.index}`);
  return buildOpponentTeam(options.people, {
    round: options.round,
    excludePersonIds: options.excludePersonIds,
    rng,
    name: options.opponentTeamName,
  });
}

export interface PlayRoundAgainstOptions {
  round: RoundSpec;
  /** The coach's team, with the lineup they have committed to. */
  coachTeam: Team;
  /** The squad drawn earlier by `drawOpponents`. */
  opponents: DrawnOpponents;
  coachRepresentativeId?: string;
  rng?: Rng;
  seed?: string | number;
  /** Lower this to speed up AI evaluation in bulk simulations. */
  aiSamples?: number;
}

export interface RoundOutcome {
  round: RoundSpec;
  match: TeamMatch;
  opponentTeam: Team;
  coachRepresentative: Player;
  opponentRepresentative: Player;
  /** The AI's estimated edge from its chosen position assignment. */
  counterPickEdge: number;
}

/**
 * Step two: the opponent AI now sees the coach's committed lineup, counter-picks
 * its own positions against it, and the five bouts are simulated.
 */
export function playRoundAgainst(options: PlayRoundAgainstOptions): RoundOutcome {
  const rng = options.rng ?? createRng(options.seed ?? `round-${options.round.index}`);
  const { round, coachTeam } = options;
  const { team: opponentTeam, players: opponentPlayers } = options.opponents;

  const coachLineup = lineupPlayers(coachTeam);

  const counterPick = assignOpponentLineup(coachLineup, opponentPlayers, {
    round,
    rng,
    samples: options.aiSamples,
  });
  opponentTeam.lineup = counterPick.lineup;

  const coachRepresentative = options.coachRepresentativeId
    ? (coachTeam.roster.find((p) => p.id === options.coachRepresentativeId) ??
      suggestRepresentative(coachTeam))
    : suggestRepresentative(coachTeam);

  const opponentRepresentative = pickRepresentative(counterPick.order, {
    round,
    rng,
    against: coachRepresentative,
    samples: options.aiSamples,
  });

  const match = simulateTeamMatch(coachTeam, opponentTeam, {
    id: `r${round.index}-${coachTeam.id}-vs-${opponentTeam.id}`,
    roundName: round.label,
    timeLimitSeconds: round.timeLimitSeconds,
    rng,
    representatives: {
      a: coachRepresentative.id,
      b: opponentRepresentative.id,
    },
  });

  return {
    round,
    match,
    opponentTeam,
    coachRepresentative,
    opponentRepresentative,
    counterPickEdge: counterPick.edge,
  };
}

export interface PlayRoundOptions
  extends Omit<PlayRoundAgainstOptions, "opponents">,
    Pick<DrawOpponentsOptions, "people" | "opponentTeamName"> {
  /** Defaults to just the coach's own squad when omitted. */
  excludePersonIds?: Iterable<string>;
}

/**
 * Both steps at once. Convenient for bulk simulation; the UI uses the two
 * halves separately so the opponent squad can be shown before the coach
 * commits to their positions.
 */
export function playRound(options: PlayRoundOptions): RoundOutcome {
  const rng = options.rng ?? createRng(options.seed ?? `round-${options.round.index}`);
  const exclude =
    options.excludePersonIds ?? options.coachTeam.roster.map((p) => p.id);

  const opponents = drawOpponents({
    round: options.round,
    people: options.people,
    excludePersonIds: exclude,
    opponentTeamName: options.opponentTeamName,
    rng,
  });

  return playRoundAgainst({ ...options, opponents, rng });
}
