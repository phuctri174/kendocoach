import { simulateBout, simulateEncho, type LiveModifierHook } from "./bout";
import type { SimConfig } from "./config";
import { buildMatchLog } from "./narrate";
import { createRng, type Rng } from "./rng";
import {
  POSITIONS,
  TARGETS,
  type Bout,
  type Player,
  type Position,
  type Team,
  type TeamMatch,
  type TeamMatchResult,
} from "./types";

export interface SimulateTeamMatchOptions {
  id?: string;
  roundName: string;
  /** Bout time limit for this round. Defaults to the reference limit (2:00). */
  timeLimitSeconds?: number;
  seed?: string | number;
  rng?: Rng;
  config?: Partial<SimConfig>;
  /**
   * Representative for the encho, per side. Both are settled before the match
   * and simply go unused unless it ends level. Falls back to
   * `suggestRepresentative` when no pick was made.
   */
  representatives?: { a?: string; b?: string };
  /**
   * Builds the live per-exchange hook for one bout (including the daihyosen
   * tiebreak, if reached), given the team bout-win tally entering it — 0-0
   * for the first bout, and necessarily tied heading into the tiebreak since
   * that's only reached when the 5 regular bouts are level. Called once per
   * bout, fresh, so a caller wanting "sticky once triggered" state (e.g.
   * active for the rest of that bout after an ippon) can hold it in its own
   * closure without it leaking into the next bout. Absent by default, and no
   * existing caller sets it — solo mode's bout resolution is unaffected.
   */
  buildLiveModifier?: (context: {
    teamAWinsSoFar: number;
    teamBWinsSoFar: number;
    /** This bout's two combatants — lets a hook react to who's actually
     *  fighting (e.g. a passive that only fires in its own owner's bout, or
     *  one that compares the two sides' stats at bout start). */
    playerA: Player;
    playerB: Player;
    /** Every bout already resolved earlier in this same game, in play
     *  order — lets a hook carry an earlier bout's own result forward into
     *  a later, not-yet-simulated one (see the cross-bout passives in
     *  versus/passives.ts). Always the 5 regular bouts only: empty for the
     *  first of them, and never includes the daihyosen tiebreak itself. */
    boutsSoFar: readonly Bout[];
    /** True only for the daihyosen tiebreak call — the 5 regular bouts'
     *  cross-bout passives deliberately don't reach into it (their own
     *  design decision, not an engine constraint). */
    isDaihyosen: boolean;
  }) => LiveModifierHook | undefined;
}

export function lineupPlayers(team: Team): Player[] {
  const players = POSITIONS.map((position) => {
    const id = team.lineup[position.toLowerCase() as Lowercase<Position>];
    const player = team.roster.find((p) => p.id === id);
    if (!player) {
      throw new Error(
        `Team "${team.name}" has no rostered player for ${position} (id: ${id ?? "unset"})`,
      );
    }
    return player;
  });

  // One person cannot take the floor twice in the same round.
  const seen = new Map<string, Position>();
  players.forEach((player, i) => {
    const clash = seen.get(player.id);
    if (clash) {
      throw new Error(
        `Team "${team.name}" fields ${player.name} at both ${clash} and ${POSITIONS[i]} — the same person cannot fight twice in one round.`,
      );
    }
    seen.set(player.id, POSITIONS[i]);
  });

  return players;
}

export function techniqueAverage(player: Player): number {
  return TARGETS.reduce((sum, t) => sum + player.technique[t], 0) / TARGETS.length;
}

/** Default daihyosen pick: strongest all-round technique in the lineup. */
export function suggestRepresentative(team: Team): Player {
  const candidates = lineupPlayers(team);
  return candidates.reduce((best, p) =>
    techniqueAverage(p) > techniqueAverage(best) ? p : best,
  );
}

function resolveRepresentative(team: Team, id: string | undefined): Player {
  if (id) {
    const picked = team.roster.find((p) => p.id === id);
    if (picked) return picked;
  }
  return suggestRepresentative(team);
}

export function simulateTeamMatch(
  teamA: Team,
  teamB: Team,
  options: SimulateTeamMatchOptions,
): TeamMatch {
  const rng =
    options.rng ??
    createRng(options.seed ?? `${teamA.id}-vs-${teamB.id}-${options.roundName}`);

  const sideA = lineupPlayers(teamA);
  const sideB = lineupPlayers(teamB);

  // A plain loop rather than .map(), so each bout's live hook can be built
  // from the win tally the *previous* bouts in this same match actually
  // produced — buildLiveModifier needs that, not just its own bout's stats.
  const bouts: Bout[] = [];
  let runningWinsA = 0;
  let runningWinsB = 0;
  for (let i = 0; i < POSITIONS.length; i++) {
    const position = POSITIONS[i];
    const bout = simulateBout(sideA[i], sideB[i], {
      id: `${options.id ?? "match"}-${position.toLowerCase()}`,
      position,
      timeLimitSeconds: options.timeLimitSeconds,
      rng,
      config: options.config,
      dynamicModifier: options.buildLiveModifier?.({
        teamAWinsSoFar: runningWinsA,
        teamBWinsSoFar: runningWinsB,
        playerA: sideA[i],
        playerB: sideB[i],
        boutsSoFar: bouts,
        isDaihyosen: false,
      }),
    });
    bouts.push(bout);
    if (bout.result.winner === "A") runningWinsA++;
    else if (bout.result.winner === "B") runningWinsB++;
  }

  let teamAWins = 0;
  let teamBWins = 0;
  let draws = 0;
  let teamAIppons = 0;
  let teamBIppons = 0;

  for (const bout of bouts) {
    if (bout.result.winner === "A") teamAWins++;
    else if (bout.result.winner === "B") teamBWins++;
    else draws++;
    teamAIppons += bout.result.ipponsA;
    teamBIppons += bout.result.ipponsB;
  }

  let tiebreak: Bout | undefined;
  let winner: TeamMatchResult["winner"];
  let decidedBy: TeamMatchResult["decidedBy"];

  if (teamAWins !== teamBWins) {
    winner = teamAWins > teamBWins ? "A" : "B";
    decidedBy = "bouts";
  } else if (teamAIppons !== teamBIppons) {
    winner = teamAIppons > teamBIppons ? "A" : "B";
    decidedBy = "ippons";
  } else {
    const repA = resolveRepresentative(teamA, options.representatives?.a);
    const repB = resolveRepresentative(teamB, options.representatives?.b);
    tiebreak = simulateEncho(repA, repB, {
      id: `${options.id ?? "match"}-daihyosen`,
      rng,
      config: options.config,
      dynamicModifier: options.buildLiveModifier?.({
        teamAWinsSoFar: teamAWins,
        teamBWinsSoFar: teamBWins,
        playerA: repA,
        playerB: repB,
        boutsSoFar: bouts,
        isDaihyosen: true,
      }),
    });
    teamAIppons += tiebreak.result.ipponsA;
    teamBIppons += tiebreak.result.ipponsB;
    winner = tiebreak.result.winner;
    decidedBy = "daihyosen";
  }

  const result: TeamMatchResult = {
    winner,
    teamAWins,
    teamBWins,
    draws,
    teamAIppons,
    teamBIppons,
    decidedBy,
  };

  const match: TeamMatch = {
    id: options.id ?? `${teamA.id}-vs-${teamB.id}`,
    roundName: options.roundName,
    teamA,
    teamB,
    bouts,
    tiebreak,
    result,
    log: [],
  };

  match.log = buildMatchLog(match, rng);
  return match;
}
