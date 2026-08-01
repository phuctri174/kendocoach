import type { CombatStyle, StatPath, Target } from "./types";

/** Every balance knob lives here so tuning never means touching the sim logic. */
export interface SimConfig {
  /**
   * The single time-limit input drives both the exchange budget and the
   * stamina decay rate, so a longer round is longer *and* more tiring off one
   * number rather than two independently-tuned ones.
   */
  secondsPerExchange: number;
  /** Random spread around the derived budget, e.g. 0.2 = ±20%. */
  exchangeJitter: number;
  /** The time limit that `fatigueMax` is calibrated against. */
  referenceTimeLimit: number;
  /**
   * Multiplier on the technique-vs-technique hit probability. 1 is the plain
   * comparative formula `atk / (atk + def)`; lower values make ippon rarer
   * without changing which player is favoured.
   */
  hitScale: number;
  hitFloor: number;
  hitCeiling: number;
  /** Counter-ippon chance when a strike fails. */
  counterScale: number;
  counterCeiling: number;
  /**
   * Compresses how far apart two attack_rates can push the initiative roll.
   * Initiative is a weighted pick, so in log-odds terms the attack_rate term is
   * `initiativeExponent × ln(a / b)` — the exponent scales that term and
   * nothing else. 1 is the plain proportional split, 0 makes initiative a coin
   * flip. Stance and fatigue enter the same roll as separate multipliers, so
   * their pull is untouched by this.
   */
  initiativeExponent: number;
  /**
   * Fatigue is probabilistic, not a decay curve. Each exchange rolls a chance
   * that a player "thấm mệt" and picks up a lasting debuff for the rest of the
   * bout; stamina lowers that chance rather than shrinking the penalty.
   *
   * chance = fatigueTriggerScale
   *        × (1 - stamina/100)          — stamina is the resistance
   *        × (timeLimit / referenceTimeLimit)  — longer rounds tire faster
   *        × (elapsed / referenceExchanges)    — and it compounds as it drags on
   */
  fatigueTriggerScale: number;
  /** Cap on that per-exchange chance, however long a bout runs. */
  fatigueTriggerCeiling: number;
  /** Performance lost per trigger, as a fraction. */
  fatigueStep: number;
  /** Hard ceiling on accumulated fatigue, so encho cannot reduce anyone to zero. */
  fatigueCeiling: number;
  /** Per-exchange foul chance = (hansoku_rate / 100) * this. */
  hansokuScale: number;
  /** Fouls get likelier as fatigue builds: multiplier at full fatigue. */
  hansokuFatigueGain: number;
  /** Fouls needed to concede an ippon (kendo rule: two). */
  hansokuPerIppon: number;
  /** Ippons that end a bout outright. */
  ipponsToWin: number;
  /**
   * Safety valve only. Encho is sudden-death and untimed, so the loop needs a
   * technical stop to be provably terminating. Not a game mechanic — it should
   * essentially never be reached.
   */
  suddenDeathMaxExchanges: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  secondsPerExchange: 12,
  exchangeJitter: 0.2,
  referenceTimeLimit: 120,
  // 1.0 is the plain comparative formula, which left draws at ~1%. Halving it
  // keeps who-beats-whom identical while making ippon rare enough that hikiwake
  // and the round time limits both mean something again.
  hitScale: 0.5,
  hitFloor: 0.02,
  // Must stay above the plain formula's range or it would clip legitimate
  // results — a 100-vs-65 matchup is meant to read as ~61%.
  hitCeiling: 0.95,
  counterScale: 0.22,
  counterCeiling: 0.45,
  // Plain proportional initiative let attack_rate swing Tổng lực ~13.7 points
  // across its 30-70 range, against ~2.8-3.9 for any single technique or
  // defense stat — enough to outrank someone ahead on 8 of the other 10 stats.
  // See scripts/rating-check.ts, which holds the resulting spread in line.
  initiativeExponent: 0.3,
  fatigueTriggerScale: 0.3,
  fatigueTriggerCeiling: 0.5,
  fatigueStep: 0.08,
  fatigueCeiling: 0.45,
  hansokuScale: 0.25,
  hansokuFatigueGain: 1.5,
  hansokuPerIppon: 2,
  ipponsToWin: 2,
  suddenDeathMaxExchanges: 200,
};

/**
 * Stance trade-offs, as percentage deltas off the player's own base stat —
 * not flat points. Jodan hits men and kote harder but opens the dou; Nito
 * guards men and dou better at the cost of its own attacking range.
 *
 * These are the stance's effect on the stat block, applied by `statsForStance`
 * before any per-player styleModifiers. They are the only thing scaling the
 * hit roll, so nothing double-counts.
 */
export const STYLE_STAT_PERCENTS: Record<CombatStyle, Partial<Record<StatPath, number>>> = {
  Chudan: {},
  Jodan: {
    "technique.men": 7,
    "technique.kote": 7,
    "defense.dou": -7,
  },
  Nito: {
    "defense.men": 7,
    "defense.dou": 7,
    "technique.kote": -7,
    "technique.dou": -7,
    "technique.tsuki": -7,
  },
};

/**
 * Legacy blanket multipliers. No longer touch the hit roll — that is now the
 * plain technique-vs-defense comparison — but still shape counter-ippon, which
 * is deliberately left alone.
 */
export const STYLE_HIT_MOD: Record<CombatStyle, number> = {
  Chudan: 1,
  Jodan: 1.14,
  Nito: 0.95,
};

export const STYLE_DEFEND_MOD: Record<CombatStyle, number> = {
  Chudan: 1,
  Jodan: 0.92,
  Nito: 1.12,
};

export const STYLE_INITIATIVE_MOD: Record<CombatStyle, number> = {
  Chudan: 1,
  Jodan: 1.15,
  Nito: 0.98,
};

/** How a stance skews which target the attacker goes for. */
export const STYLE_ATTACK_BIAS: Record<CombatStyle, Record<Target, number>> = {
  Chudan: { men: 1, kote: 1, dou: 1, tsuki: 1 },
  Jodan: { men: 1.6, kote: 0.7, dou: 0.5, tsuki: 1.4 },
  Nito: { men: 0.7, kote: 1.6, dou: 1.5, tsuki: 0.4 },
};

/**
 * Jodan's raised arms leave the torso open: when a Jodan attack fails, the
 * defender counters more often, and far more often to dou.
 */
export const JODAN_COUNTER_EXPOSURE = 1.35;
export const JODAN_DOU_EXPOSURE = 2.2;

/** Plausible counter targets for a failed attack, with relative weights. */
export const COUNTER_TARGETS: Record<Target, Partial<Record<Target, number>>> = {
  men: { kote: 1.4, dou: 1.3, men: 0.6 },
  kote: { men: 1.5, dou: 0.9, kote: 0.5 },
  dou: { men: 1.4, tsuki: 0.8, kote: 0.7 },
  tsuki: { men: 1.3, dou: 1.0, kote: 0.7 },
};

/** Vietnamese spelling used in the log — note "Đô" rather than "Dou". */
export const TARGET_LABEL: Record<Target, string> = {
  men: "Men",
  kote: "Kote",
  dou: "Đô",
  tsuki: "Tsuki",
};

/** Single-letter glyph per target, for the scoreboard's ippon sequence. */
export const TARGET_LETTER: Record<Target, string> = {
  men: "M",
  kote: "K",
  dou: "D",
  tsuki: "T",
};

/** Glyph marking one hansoku on the scoreboard. */
export const HANSOKU_GLYPH = "▲";

/**
 * The only stances a player may move between mid-bout. Nito is excluded: once
 * a bout opens in Nito it is locked there.
 */
export const SWITCHABLE_STYLES: readonly CombatStyle[] = ["Chudan", "Jodan"];
