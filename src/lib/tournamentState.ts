import { opponentNameFor } from "@/data/opponents";
import {
  drawOpponents,
  playRoundAgainst,
  toPlayers,
  POSITIONS,
  TOURNAMENT_ROUNDS,
  type DrawnOpponents,
  type PersonRecord,
  type Position,
  type RoundOutcome,
  type Team,
} from "@/lib/kendo";

export const COACH_TEAM_ID = "dalat";
export const COACH_TEAM_NAME = "Đà Lạt Kendo Club";

/** Position assignment for the round, keyed by position, holding person ids. */
export type PositionAssignment = Record<Position, string>;

export interface TournamentState {
  squad: PersonRecord[];
  /** 0-3 while playing; 4 once the Final is done. */
  roundIndex: number;
  assignment: PositionAssignment;
  /** Completed rounds, oldest first. */
  results: RoundOutcome[];
  /**
   * This round's opposition, drawn before the coach sets positions so they can
   * see who they are facing. Cleared once the round has been played.
   */
  pendingOpponent?: DrawnOpponents;
  /**
   * Everyone who has already fought for an opposing team in this run. Nobody
   * appears twice across a single tournament; resets with a new tournament.
   */
  usedOpponentIds: string[];
  /** Set once the coach loses, or wins the Final. */
  eliminatedAt?: number;
  champion?: boolean;
}

/** Drafted order maps straight onto the five positions as the opening lineup. */
export function initialAssignment(squad: PersonRecord[]): PositionAssignment {
  return POSITIONS.reduce((acc, position, i) => {
    acc[position] = squad[i].id;
    return acc;
  }, {} as PositionAssignment);
}

export function createTournament(squad: PersonRecord[]): TournamentState {
  return {
    squad,
    roundIndex: 0,
    assignment: initialAssignment(squad),
    results: [],
    usedOpponentIds: [],
  };
}

/**
 * Draws the coming round's opposition so it can be shown to the coach before
 * they commit to positions. Idempotent: calling it twice for the same round
 * keeps the squad already drawn.
 */
export function beginRound(
  state: TournamentState,
  people: PersonRecord[],
  seed?: string,
): TournamentState {
  if (state.pendingOpponent || isTournamentOver(state)) return state;

  const round = currentRound(state);
  const opponents = drawOpponents({
    round,
    people,
    // The coach's own five, plus everyone already used as opposition this run.
    excludePersonIds: [...state.squad.map((p) => p.id), ...state.usedOpponentIds],
    opponentTeamName: opponentNameFor(round.index, state.squad.length),
    seed: seed ?? `opp-${round.name}-${Date.now()}-${Math.random()}`,
  });

  return {
    ...state,
    pendingOpponent: opponents,
    usedOpponentIds: [
      ...state.usedOpponentIds,
      ...opponents.players.map((p) => p.id),
    ],
  };
}

export function isTournamentOver(state: TournamentState): boolean {
  return state.champion === true || state.eliminatedAt !== undefined;
}

export function currentRound(state: TournamentState) {
  return TOURNAMENT_ROUNDS[Math.min(state.roundIndex, TOURNAMENT_ROUNDS.length - 1)];
}

/** Builds the coach's Team for the current position assignment. */
export function buildCoachTeam(state: TournamentState): Team {
  const roster = toPlayers(state.squad);
  const lineup = POSITIONS.reduce((acc, position) => {
    const personId = state.assignment[position];
    if (!roster.some((p) => p.id === personId)) {
      throw new Error(`Không tìm thấy thành viên ${personId} trong đội hình`);
    }
    acc[position.toLowerCase() as Lowercase<Position>] = personId;
    return acc;
  }, {} as Team["lineup"]);

  return { id: COACH_TEAM_ID, name: COACH_TEAM_NAME, roster, lineup };
}

/** Swaps whichever two positions the given people occupy. */
export function swapPositions(
  assignment: PositionAssignment,
  a: Position,
  b: Position,
): PositionAssignment {
  return { ...assignment, [a]: assignment[b], [b]: assignment[a] };
}

export interface PlayCurrentRoundOptions {
  coachRepresentativeId?: string;
  seed?: string;
}

/**
 * Plays the round against the already-drawn opposition. Only now does the
 * opponent AI see the coach's committed lineup and counter-pick against it.
 */
export function playCurrentRound(
  state: TournamentState,
  options: PlayCurrentRoundOptions = {},
): TournamentState {
  if (!state.pendingOpponent) {
    throw new Error("Chưa bốc thăm đối thủ cho vòng này");
  }

  const round = currentRound(state);
  const outcome = playRoundAgainst({
    round,
    coachTeam: buildCoachTeam(state),
    opponents: state.pendingOpponent,
    coachRepresentativeId: options.coachRepresentativeId,
    seed: options.seed ?? `${round.name}-${Date.now()}-${Math.random()}`,
  });

  const won = outcome.match.result.winner === "A";

  return {
    ...state,
    results: [...state.results, outcome],
    roundIndex: state.roundIndex + 1,
    pendingOpponent: undefined,
    eliminatedAt: won ? state.eliminatedAt : round.index,
    champion: won && round.index === TOURNAMENT_ROUNDS.length ? true : state.champion,
  };
}
