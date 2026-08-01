export type Target = "men" | "kote" | "dou" | "tsuki";
export const TARGETS: readonly Target[] = ["men", "kote", "dou", "tsuki"];

export type CombatStyle = "Chudan" | "Jodan" | "Nito";
export const COMBAT_STYLES: readonly CombatStyle[] = ["Chudan", "Jodan", "Nito"];

export type Position = "Senpo" | "Jiho" | "Chuken" | "Fukusho" | "Taisho";
export const POSITIONS: readonly Position[] = [
  "Senpo",
  "Jiho",
  "Chuken",
  "Fukusho",
  "Taisho",
];

/** Which corner of a bout / team match an actor belongs to. */
export type Side = "A" | "B";

/**
 * 0-100 grades, higher is always better. A technique number is both how well
 * the player lands that strike and how well they resist it, since a strike is
 * resolved by comparing the two players' grades for the same technique.
 */
export interface Technique {
  men: number;
  kote: number;
  dou: number;
  tsuki: number;
}

/** Derived from match history only — never hand-edited in the seed JSON. */
export interface PlayerHistory {
  wins: number;
  losses: number;
  draws: number;
  matchesPlayed: number;
  ipponsScored: number;
  ipponsConceded: number;
  noIpponMatches: number;
}

/** Per-target grades, same shape as Technique. Higher resists that strike better. */
export type Defense = Technique;

/** The stat block itself, without identity — a person's Chudan numbers. */
export interface BaseStats {
  technique: Technique;
  /** Resistance per target; the defender side of the hit comparison. */
  defense: Defense;
  attack_rate: number;
  defend_rate: number;
  /** Lower is better. */
  hansoku_rate: number;
  stamina: number;
}

/** Every stat a style modifier is allowed to touch. */
export type StatPath =
  | "attack_rate"
  | "defend_rate"
  | "hansoku_rate"
  | "stamina"
  | "technique.men"
  | "technique.kote"
  | "technique.dou"
  | "technique.tsuki"
  | "defense.men"
  | "defense.kote"
  | "defense.dou"
  | "defense.tsuki";

export const STAT_PATHS: readonly StatPath[] = [
  "attack_rate",
  "defend_rate",
  "hansoku_rate",
  "stamina",
  "technique.men",
  "technique.kote",
  "technique.dou",
  "technique.tsuki",
  "defense.men",
  "defense.kote",
  "defense.dou",
  "defense.tsuki",
];

/** Signed deltas applied on top of baseStats. Never a second full stat block. */
export type StyleModifier = Partial<Record<StatPath, number>>;

/**
 * Relative likelihood of taking each stance, e.g. { Chudan: 0.5, Jodan: 0.3 }.
 * Values are relative only and are normalised internally, so they need not sum
 * to 1. A stance the player can use but which is omitted here gets weight 0 —
 * listing weights is how you say "this is what they favour". Omit the whole
 * field for plain uniform choice.
 */
export type StyleWeights = Partial<Record<CombatStyle, number>>;

/**
 * One real club member. The single source of truth for their numbers: edit
 * baseStats here and every style variant of them re-derives automatically.
 */
export interface PersonRecord {
  /** Derived at load time from the seed file's order, e.g. "p14". */
  id: string;
  name: string;
  baseStats: BaseStats;
  /**
   * Styles this person can field. Chudan is always available whether or not
   * it is listed. Any style with an entry in styleModifiers is playable too.
   */
  styles?: CombatStyle[];
  styleModifiers?: Partial<Record<CombatStyle, StyleModifier>>;
  /** Optional stance tendencies; uniform choice when absent. */
  styleWeights?: StyleWeights;
  /** Career record, tracked per person and shared across their style variants. */
  history?: PlayerHistory;
}

/**
 * A person on the floor. Drafted once — stance is no longer part of identity;
 * it is resolved at the start of each bout from `styles`.
 */
export interface Player {
  id: string;
  name: string;
  technique: Technique;
  /** Resistance per target; the defender side of the hit comparison. */
  defense: Defense;
  attack_rate: number;
  /** Only affects resistance to counter-ippon; it never enters the hit roll. */
  defend_rate: number;
  /** Lower is better. */
  hansoku_rate: number;
  stamina: number;
  /** Stances this player can use. One is chosen per bout. */
  styles: CombatStyle[];
  /**
   * Per-stance stat deltas, applied by the simulator whenever this player
   * takes or changes stance during a bout.
   */
  styleModifiers?: Partial<Record<CombatStyle, StyleModifier>>;
  /** Optional stance tendencies; uniform choice when absent. */
  styleWeights?: StyleWeights;
  history: PlayerHistory;
}

export type Lineup = Record<Lowercase<Position>, string>;

export interface Team {
  id: string;
  name: string;
  /** Full recruited pool. */
  roster: Player[];
  lineup: Lineup;
}

export type ExchangeOutcome =
  /** Initiator's attack landed. */
  | "ippon"
  /** Attack failed and the defender scored on the counter. */
  | "counter"
  /** Nothing scored. */
  | "blocked";

export interface StanceSwitch {
  side: Side;
  from: CombatStyle;
  to: CombatStyle;
}

export interface Exchange {
  index: number;
  initiator: Side;
  target: Target;
  outcome: ExchangeOutcome;
  /** Set when outcome is "counter". */
  counterTarget?: Target;
  /** Rolled independently of the strike — the initiator fouled. */
  hansoku?: Side;
  /** Second foul by a player awards the opponent an ippon. */
  hansokuIppon?: Side;
  scoreAfter: { a: number; b: number };
  /** Stance each player held during this exchange. */
  stance: { a: CombatStyle; b: CombatStyle };
  /** Stance changes taken after this exchange, i.e. in reaction to an ippon. */
  stanceSwitches?: StanceSwitch[];
  /** Sides that picked up a fatigue debuff at the end of this exchange. */
  fatigueTriggers?: Side[];
  /** 0-1 performance debuff in effect during this exchange. */
  fatigue: { a: number; b: number };
  hitChance: number;
  counterChance: number;
}

export interface BoutResult {
  winner: Side | "draw";
  ipponsA: number;
  ipponsB: number;
  hansokuA: number;
  hansokuB: number;
  /**
   * How the bout ended. "safety-cap" means sudden death hit its technical
   * exchange limit without a score — a bug signal, not a real outcome.
   */
  decidedBy: "two-ippon" | "time" | "draw" | "sudden-death" | "safety-cap";
}

export interface Bout {
  id: string;
  position: Position;
  /** Present only on the tiebreak bout. */
  daihyosen?: boolean;
  playerA: Player;
  playerB: Player;
  /** Stance each player opened the bout in. */
  openingStance: { a: CombatStyle; b: CombatStyle };
  exchanges: Exchange[];
  result: BoutResult;
}

export type LogKind =
  | "match-header"
  | "bout-start"
  | "event"
  /**
   * A stance being taken — either announced at bout start or switched into
   * mid-bout. Colour comes from the `stance` field, not from the wording.
   */
  | "stance"
  | "bout-result"
  | "banner";

export interface MatchLogEvent {
  id: string;
  kind: LogKind;
  text: string;
  position?: Position;
  /** Which bout this beat belongs to, so the scoreboard can follow along. */
  boutId?: string;
  /** How far into that bout the beat is; drives live scoreboard reveal. */
  exchangeIndex?: number;
  /** Which team the beat favours, for colour-coding in the UI. */
  side?: Side | "neutral";
  /** Set on "stance" beats: the stance taken, which drives the colour. */
  stance?: CombatStyle;
  /** Running team bout score after this beat. */
  score?: { a: number; b: number };
}

export interface TeamMatchResult {
  winner: Side | "draw";
  teamAWins: number;
  teamBWins: number;
  draws: number;
  teamAIppons: number;
  teamBIppons: number;
  decidedBy: "bouts" | "ippons" | "daihyosen";
}

export interface TeamMatch {
  id: string;
  roundName: string;
  teamA: Team;
  teamB: Team;
  bouts: Bout[];
  /** Daihyosen — only present when the match went to a representative bout. */
  tiebreak?: Bout;
  result: TeamMatchResult;
  log: MatchLogEvent[];
}
