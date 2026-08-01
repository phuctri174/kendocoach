import type {
  Bout,
  PersonRecord,
  Player,
  PlayerHistory,
  Side,
  TeamMatch,
} from "./types";

export function emptyHistory(): PlayerHistory {
  return {
    wins: 0,
    losses: 0,
    draws: 0,
    matchesPlayed: 0,
    ipponsScored: 0,
    ipponsConceded: 0,
    noIpponMatches: 0,
  };
}

function addBout(history: PlayerHistory, bout: Bout, side: Side): PlayerHistory {
  const scored = side === "A" ? bout.result.ipponsA : bout.result.ipponsB;
  const conceded = side === "A" ? bout.result.ipponsB : bout.result.ipponsA;
  const won = bout.result.winner === side;
  const drew = bout.result.winner === "draw";

  return {
    wins: history.wins + (won ? 1 : 0),
    losses: history.losses + (!won && !drew ? 1 : 0),
    draws: history.draws + (drew ? 1 : 0),
    matchesPlayed: history.matchesPlayed + 1,
    ipponsScored: history.ipponsScored + scored,
    ipponsConceded: history.ipponsConceded + conceded,
    noIpponMatches: history.noIpponMatches + (scored === 0 ? 1 : 0),
  };
}

/**
 * History deltas produced by one team match, keyed by personId — a record
 * belongs to the human, not to the stance they happened to fight in.
 */
export function historyDeltas(match: TeamMatch): Map<string, PlayerHistory> {
  const deltas = new Map<string, PlayerHistory>();
  const bouts = match.tiebreak ? [...match.bouts, match.tiebreak] : match.bouts;

  for (const bout of bouts) {
    for (const side of ["A", "B"] as const) {
      const player = side === "A" ? bout.playerA : bout.playerB;
      const key = player.id;
      deltas.set(key, addBout(deltas.get(key) ?? emptyHistory(), bout, side));
    }
  }
  return deltas;
}

function merge(a: PlayerHistory, b: PlayerHistory): PlayerHistory {
  return {
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    draws: a.draws + b.draws,
    matchesPlayed: a.matchesPlayed + b.matchesPlayed,
    ipponsScored: a.ipponsScored + b.ipponsScored,
    ipponsConceded: a.ipponsConceded + b.ipponsConceded,
    noIpponMatches: a.noIpponMatches + b.noIpponMatches,
  };
}

/** Pure: returns a new roster with histories advanced by this match. */
export function applyMatchToRoster(roster: Player[], match: TeamMatch): Player[] {
  const deltas = historyDeltas(match);
  return roster.map((player) => {
    const delta = deltas.get(player.id);
    return delta ? { ...player, history: merge(player.history, delta) } : player;
  });
}

/** Pure: same, against the club roster of people rather than draft entries. */
export function applyMatchToPeople(
  people: PersonRecord[],
  match: TeamMatch,
): PersonRecord[] {
  const deltas = historyDeltas(match);
  return people.map((person) => {
    const delta = deltas.get(person.id);
    return delta
      ? { ...person, history: merge(person.history ?? emptyHistory(), delta) }
      : person;
  });
}

/** Recompute a person's history from scratch over a run of matches. */
export function recomputeHistory(personId: string, matches: TeamMatch[]): PlayerHistory {
  return matches.reduce((acc, match) => {
    const delta = historyDeltas(match).get(personId);
    return delta ? merge(acc, delta) : acc;
  }, emptyHistory());
}
