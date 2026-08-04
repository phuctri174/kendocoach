import { assignOpponentLineup, pickRepresentative } from "./ai";
import { buildOpponentTeam } from "./opponents";
import { createRng, type Rng } from "./rng";
import { lineupPlayers, simulateTeamMatch, suggestRepresentative } from "./teamMatch";
import type { RoundSpec } from "./tournament";
import type { PersonRecord, Player, Team, TeamMatch } from "./types";
// Solo mode reuses versus mode's passive-resolution engine wholesale rather
// than duplicating it — see passives.ts's own doc comment for why category A
// (static) vs B-F (live) split the way they do. Imported by direct path
// (not the `@/lib/kendo` barrel `passives.ts` itself pulls a couple of
// exports from) so the two directories' modules only ever reference each
// other through function calls inside these bodies, never at module-eval
// time — the one shape of import cycle that's actually safe.
import { buildPassiveHookForBout, hasLivePassiveCandidates, resolvePassiveStaticEffects } from "@/lib/versus/passives";
import { withFlatModifier } from "@/lib/versus/bout";

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

  // Character passives (category A, static — see versus/passives.ts) — same
  // "resolved the instant both lineups lock in" rule buildVersusTeamsForGame
  // follows for versus mode. Has to happen here rather than inside
  // buildCoachTeam/buildOpponentTeam: a same-position-opponent passive (e.g.
  // Trần Thụy Bảo Như's) needs BOTH sides' final lineups at once, and the
  // opponent's isn't final until assignOpponentLineup just above has run.
  const pickedA = coachTeam.roster.map((p) => p.id);
  const pickedB = opponentTeam.roster.map((p) => p.id);
  const passiveEffects = resolvePassiveStaticEffects({
    pickedA,
    pickedB,
    lineupA: coachTeam.lineup,
    lineupB: opponentTeam.lineup,
    rawPlayersA: coachTeam.roster,
    rawPlayersB: opponentTeam.roster,
  });
  coachTeam.roster = coachTeam.roster.map((p) => withFlatModifier(p, passiveEffects.get(p.id)));
  opponentTeam.roster = opponentTeam.roster.map((p) => withFlatModifier(p, passiveEffects.get(p.id)));

  const coachRepresentative = options.coachRepresentativeId
    ? (coachTeam.roster.find((p) => p.id === options.coachRepresentativeId) ??
      suggestRepresentative(coachTeam))
    : suggestRepresentative(coachTeam);

  // counterPick.order was built from the pre-passive opponentPlayers array —
  // re-point it at the now-buffed roster objects so the rep picker judges
  // candidates by the same stats they'll actually fight with, not their raw
  // seed numbers.
  const buffedOrder = counterPick.order.map(
    (p) => opponentTeam.roster.find((rp) => rp.id === p.id) ?? p,
  );
  const opponentRepresentative = pickRepresentative(buffedOrder, {
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
    // Live passives (categories B-F). No augment-history fetch to gate this
    // on (solo has none yet — see the plan's stage 3), so the only question
    // is whether either squad has a live-passive candidate at all.
    buildLiveModifier: hasLivePassiveCandidates(pickedA, pickedB)
      ? ({ teamAWinsSoFar, teamBWinsSoFar, playerA, playerB, boutsSoFar, isDaihyosen }) =>
          buildPassiveHookForBout({
            pickedA,
            pickedB,
            playerA,
            playerB,
            teamAWinsSoFar,
            teamBWinsSoFar,
            boutsSoFar,
            isDaihyosen,
          })
      : undefined,
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
