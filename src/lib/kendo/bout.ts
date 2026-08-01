import {
  COUNTER_TARGETS,
  DEFAULT_CONFIG,
  JODAN_COUNTER_EXPOSURE,
  JODAN_DOU_EXPOSURE,
  STYLE_ATTACK_BIAS,
  STYLE_DEFEND_MOD,
  STYLE_HIT_MOD,
  STYLE_INITIATIVE_MOD,
  STYLE_STAT_PERCENTS,
  SWITCHABLE_STYLES,
  type SimConfig,
} from "./config";
import { applyPercentModifier, applyStyleModifier } from "./draft";
import { createRng, type Rng } from "./rng";
import {
  TARGETS,
  type BaseStats,
  type Bout,
  type BoutResult,
  type CombatStyle,
  type Exchange,
  type Player,
  type Position,
  type Side,
  type StanceSwitch,
  type Target,
} from "./types";

/*
 * RULE — bout resolution is round-agnostic, permanently.
 *
 * Nothing in this file may depend on which round is being played. There is no
 * difficulty term, no per-round multiplier, and no "the opponent is better
 * because it is the Final" thumb on the scale. The same two stat blocks must
 * produce the same probabilities in the Round of 16 and in the Final, on
 * either side of the draw. This module deliberately does not import
 * ./tournament, and a test asserts that.
 *
 * Round progression is expressed in exactly two places, both outside this file:
 *   opponents.ts — which players get drawn onto the opposing squad
 *   ai.ts        — how well the AI assigns them to positions
 *
 * `timeLimitSeconds` is not a difficulty term: it is the pacing unit, it is
 * handed in per bout, and it applies identically to both fencers.
 */

export interface SimulateBoutOptions {
  id?: string;
  position: Position;
  daihyosen?: boolean;
  /** Round time limit in seconds. Ignored in sudden-death mode. */
  timeLimitSeconds?: number;
  /** Sudden death (encho/daihyosen): untimed, runs until one ippon is scored. */
  suddenDeath?: boolean;
  seed?: string | number;
  rng?: Rng;
  config?: Partial<SimConfig>;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/** How many exchanges a given time limit buys, with jitter. */
export function exchangeBudget(
  timeLimitSeconds: number,
  cfg: SimConfig,
  rng: Rng,
): number {
  const base = timeLimitSeconds / cfg.secondsPerExchange;
  const min = Math.max(1, Math.round(base * (1 - cfg.exchangeJitter)));
  const max = Math.max(min, Math.round(base * (1 + cfg.exchangeJitter)));
  return rng.int(min, max);
}

/**
 * Chance that a player tires on this exchange. Stamina lowers the odds of it
 * happening at all rather than softening the blow, so a fit player may sail
 * through a long bout untouched while an unfit one wilts early — the point of
 * making this probabilistic instead of a smooth curve.
 */
function fatigueTriggerChance(
  player: BaseStats,
  elapsed: number,
  timeLimitSeconds: number,
  cfg: SimConfig,
): number {
  const referenceExchanges = Math.max(1, cfg.referenceTimeLimit / cfg.secondsPerExchange);
  const resistance = 1 - clamp(player.stamina, 0, 100) / 100;
  const roundLength = timeLimitSeconds / cfg.referenceTimeLimit;
  const dragging = (elapsed + 1) / referenceExchanges;
  return clamp(
    cfg.fatigueTriggerScale * resistance * roundLength * dragging,
    0,
    cfg.fatigueTriggerCeiling,
  );
}

/** Stances a player can actually use, always including Chudan. */
export function availableStyles(player: Player): CombatStyle[] {
  const styles = player.styles?.length ? player.styles : ["Chudan" as CombatStyle];
  return styles.includes("Chudan") ? styles : ["Chudan", ...styles];
}

/**
 * Picks among `options` using the player's stance tendencies when they have
 * them, falling back to uniform choice when they don't — or when none of the
 * options carries any weight.
 */
function pickStance(player: Player, options: CombatStyle[], rng: Rng): CombatStyle {
  if (options.length === 1) return options[0];
  const weights = player.styleWeights;
  if (!weights) return rng.pick(options);

  const applied = options.map((style) => Math.max(0, weights[style] ?? 0));
  if (applied.reduce((sum, w) => sum + w, 0) <= 0) return rng.pick(options);
  return rng.weighted(options, applied);
}

/** Opening stance: weighted by tendency if set, otherwise uniform. */
function openingStance(player: Player, rng: Rng): CombatStyle {
  return pickStance(player, availableStyles(player), rng);
}

/**
 * After an ippon a player may re-decide their stance, but only between Chudan
 * and Jodan and only if they hold both. Nito is locked for the whole bout.
 */
function restanceOptions(player: Player, current: CombatStyle): CombatStyle[] {
  if (current === "Nito") return [];
  const usable = availableStyles(player).filter((s) => SWITCHABLE_STYLES.includes(s));
  return usable.length > 1 ? usable : [];
}

/**
 * The player's stat block for a stance: the stance's built-in percentage
 * trade-offs first, then their own flat styleModifiers on top.
 */
export function statsForStance(player: Player, stance: CombatStyle): BaseStats {
  return applyStyleModifier(
    applyPercentModifier(player, STYLE_STAT_PERCENTS[stance]),
    player.styleModifiers?.[stance],
  );
}

function pickTarget(attacker: BaseStats, stance: CombatStyle, rng: Rng): Target {
  const bias = STYLE_ATTACK_BIAS[stance];
  const weights = TARGETS.map((t) => Math.max(1, attacker.technique[t]) * bias[t]);
  return rng.weighted(TARGETS, weights);
}

function pickCounterTarget(
  defender: BaseStats,
  defenderStance: CombatStyle,
  attacked: Target,
  attackerIsJodan: boolean,
  rng: Rng,
): Target {
  const plausible = COUNTER_TARGETS[attacked];
  const bias = STYLE_ATTACK_BIAS[defenderStance];
  const options = TARGETS.filter((t) => plausible[t] !== undefined);
  const weights = options.map((t) => {
    const exposure = attackerIsJodan && t === "dou" ? JODAN_DOU_EXPOSURE : 1;
    return Math.max(1, defender.technique[t]) * plausible[t]! * bias[t] * exposure;
  });
  return rng.weighted(options, weights);
}

/**
 * Comparative resolution: the attacker's technique for this target against the
 * defender's dedicated defense for the *same* target.
 *
 *   p = attackerTechnique[target] / (attackerTechnique[target] + defenderDefense[target])
 *
 * Stance effects reach this roll only through the stat block (see
 * STYLE_STAT_PERCENTS) — no blanket multiplier is applied on top, so nothing
 * influences the roll twice. defend_rate is not involved at all; it governs
 * counter-ippon only.
 */
function hitChance(
  attacker: BaseStats,
  defender: BaseStats,
  target: Target,
  fatAtk: number,
  fatDef: number,
  cfg: SimConfig,
): number {
  const atk = Math.max(1, attacker.technique[target]) * (1 - fatAtk);
  const def = Math.max(1, defender.defense[target]) * (1 - fatDef);
  return clamp((cfg.hitScale * atk) / (atk + def), cfg.hitFloor, cfg.hitCeiling);
}

/** Counter-ippon is where defend_rate earns its keep. */
function counterChance(
  defender: BaseStats,
  attacker: BaseStats,
  defenderStance: CombatStyle,
  attackerStance: CombatStyle,
  counterTarget: Target,
  fatDef: number,
  fatAtk: number,
  cfg: SimConfig,
): number {
  const atk =
    Math.max(1, defender.technique[counterTarget]) * (1 - fatDef) * STYLE_HIT_MOD[defenderStance];
  const def =
    Math.max(1, attacker.defend_rate) * (1 - fatAtk) * STYLE_DEFEND_MOD[attackerStance];
  const exposure = attackerStance === "Jodan" ? JODAN_COUNTER_EXPOSURE : 1;
  return clamp((cfg.counterScale * atk * exposure) / (atk + def), 0, cfg.counterCeiling);
}

function hansokuChance(player: BaseStats, fatigue: number, cfg: SimConfig): number {
  const base = (clamp(player.hansoku_rate, 0, 100) / 100) * cfg.hansokuScale;
  const fatigueFactor =
    1 + (fatigue / Math.max(0.0001, cfg.fatigueCeiling)) * (cfg.hansokuFatigueGain - 1);
  return clamp(base * fatigueFactor, 0, 0.9);
}

export function simulateBout(
  playerA: Player,
  playerB: Player,
  options: SimulateBoutOptions,
): Bout {
  const cfg = { ...DEFAULT_CONFIG, ...options.config };
  const rng =
    options.rng ??
    createRng(options.seed ?? `${playerA.id}-${playerB.id}-${options.position}`);

  const suddenDeath = options.suddenDeath ?? false;
  const ipponsToWin = suddenDeath ? 1 : cfg.ipponsToWin;
  const total = suddenDeath
    ? cfg.suddenDeathMaxExchanges
    : exchangeBudget(options.timeLimitSeconds ?? cfg.referenceTimeLimit, cfg, rng);

  let stanceA = openingStance(playerA, rng);
  let stanceB = openingStance(playerB, rng);
  const opening = { a: stanceA, b: stanceB };
  // Recomputed whenever a stance changes, so modifiers follow the stance.
  let statsA = statsForStance(playerA, stanceA);
  let statsB = statsForStance(playerB, stanceB);

  const exchanges: Exchange[] = [];
  let ipponsA = 0;
  let ipponsB = 0;
  let hansokuA = 0;
  let hansokuB = 0;
  // Accumulated fatigue debuff, once triggered it stays for the rest of the bout.
  let fatA = 0;
  let fatB = 0;
  let decidedBy: BoutResult["decidedBy"] = "time";
  const fatigueTimeLimit = options.timeLimitSeconds ?? cfg.referenceTimeLimit;

  for (let i = 0; i < total; i++) {

    const initiator: Side = rng.weighted(
      ["A", "B"] as const,
      [
        Math.max(1, statsA.attack_rate) ** cfg.initiativeExponent *
          (1 - fatA) *
          STYLE_INITIATIVE_MOD[stanceA],
        Math.max(1, statsB.attack_rate) ** cfg.initiativeExponent *
          (1 - fatB) *
          STYLE_INITIATIVE_MOD[stanceB],
      ],
    );

    const attacker = initiator === "A" ? statsA : statsB;
    const defender = initiator === "A" ? statsB : statsA;
    const attackerStance = initiator === "A" ? stanceA : stanceB;
    const defenderStance = initiator === "A" ? stanceB : stanceA;
    const fatAtk = initiator === "A" ? fatA : fatB;
    const fatDef = initiator === "A" ? fatB : fatA;

    const target = pickTarget(attacker, attackerStance, rng);
    const pHit = hitChance(attacker, defender, target, fatAtk, fatDef, cfg);

    let outcome: Exchange["outcome"] = "blocked";
    let counterTarget: Target | undefined;
    let pCounter = 0;
    let scored = false;

    if (rng.chance(pHit)) {
      outcome = "ippon";
      scored = true;
      if (initiator === "A") ipponsA++;
      else ipponsB++;
    } else {
      counterTarget = pickCounterTarget(
        defender,
        defenderStance,
        target,
        attackerStance === "Jodan",
        rng,
      );
      pCounter = counterChance(
        defender,
        attacker,
        defenderStance,
        attackerStance,
        counterTarget,
        fatDef,
        fatAtk,
        cfg,
      );
      if (rng.chance(pCounter)) {
        outcome = "counter";
        scored = true;
        if (initiator === "A") ipponsB++;
        else ipponsA++;
      } else {
        counterTarget = undefined;
      }
    }

    // Fouls are called on the initiator independently of whether the strike
    // landed — but not once the strike has already ended the bout. Rolling one
    // anyway could push both fencers to the winning score in the same
    // exchange, and the tie-break below would then always favour side A, who
    // is always the coach. Stopping here keeps the bout symmetric.
    const alreadyWon = ipponsA >= ipponsToWin || ipponsB >= ipponsToWin;
    let hansoku: Side | undefined;
    let hansokuIppon: Side | undefined;
    if (!alreadyWon && rng.chance(hansokuChance(attacker, fatAtk, cfg))) {
      hansoku = initiator;
      const count = initiator === "A" ? ++hansokuA : ++hansokuB;
      if (count % cfg.hansokuPerIppon === 0) {
        hansokuIppon = initiator === "A" ? "B" : "A";
        scored = true;
        if (hansokuIppon === "A") ipponsA++;
        else ipponsB++;
      }
    }

    const exchange: Exchange = {
      index: i,
      initiator,
      target,
      outcome,
      counterTarget,
      hansoku,
      hansokuIppon,
      scoreAfter: { a: ipponsA, b: ipponsB },
      stance: { a: stanceA, b: stanceB },
      fatigue: { a: fatA, b: fatB },
      hitChance: pHit,
      counterChance: pCounter,
    };
    exchanges.push(exchange);

    // Roll for fatigue after the exchange resolves, so a debuff earned here
    // bites from the next one onward.
    const tired: Side[] = [];
    if (fatA < cfg.fatigueCeiling &&
        rng.chance(fatigueTriggerChance(statsA, i, fatigueTimeLimit, cfg))) {
      fatA = Math.min(cfg.fatigueCeiling, fatA + cfg.fatigueStep);
      tired.push("A");
    }
    if (fatB < cfg.fatigueCeiling &&
        rng.chance(fatigueTriggerChance(statsB, i, fatigueTimeLimit, cfg))) {
      fatB = Math.min(cfg.fatigueCeiling, fatB + cfg.fatigueStep);
      tired.push("B");
    }
    if (tired.length) exchange.fatigueTriggers = tired;

    const decided = ipponsA >= ipponsToWin || ipponsB >= ipponsToWin;

    // A point is the only moment a stance may be reconsidered.
    if (scored && !decided) {
      const switches: StanceSwitch[] = [];
      const reconsider = (side: Side) => {
        const player = side === "A" ? playerA : playerB;
        const current = side === "A" ? stanceA : stanceB;
        const options = restanceOptions(player, current);
        if (!options.length) return;
        // Tendencies apply to the mid-bout re-decision too, so a player who
        // favours Chudan drifts back to it rather than coin-flipping.
        const next = pickStance(player, options, rng);
        if (next === current) return;
        switches.push({ side, from: current, to: next });
        if (side === "A") {
          stanceA = next;
          statsA = statsForStance(playerA, next);
        } else {
          stanceB = next;
          statsB = statsForStance(playerB, next);
        }
      };
      reconsider("A");
      reconsider("B");
      if (switches.length) exchange.stanceSwitches = switches;
    }

    if (decided) {
      decidedBy = suddenDeath ? "sudden-death" : "two-ippon";
      break;
    }
  }

  let winner: BoutResult["winner"];
  if (ipponsA >= ipponsToWin) winner = "A";
  else if (ipponsB >= ipponsToWin) winner = "B";
  else if (ipponsA > ipponsB) winner = "A";
  else if (ipponsB > ipponsA) winner = "B";
  else winner = "draw";

  if (decidedBy !== "two-ippon" && decidedBy !== "sudden-death") {
    // Sudden death only ever exits via a score; reaching here means the safety
    // cap fired, which is a bug signal rather than a legitimate hikiwake.
    decidedBy = suddenDeath ? "safety-cap" : winner === "draw" ? "draw" : "time";
  }

  return {
    id: options.id ?? `bout-${options.position}-${playerA.id}-${playerB.id}`,
    position: options.position,
    daihyosen: options.daihyosen,
    playerA,
    playerB,
    openingStance: opening,
    exchanges,
    result: { winner, ipponsA, ipponsB, hansokuA, hansokuB, decidedBy },
  };
}

/**
 * Encho / daihyosen: untimed sudden death. Exchanges run until one ippon is
 * scored, so there is no time-based draw here. Fatigue keeps accruing (up to
 * `fatigueCeiling`), which is what stops a scoreless stalemate running forever.
 */
export function simulateEncho(
  playerA: Player,
  playerB: Player,
  options: Omit<SimulateBoutOptions, "position" | "daihyosen" | "suddenDeath"> & {
    position?: Position;
  } = {},
): Bout {
  return simulateBout(playerA, playerB, {
    ...options,
    position: options.position ?? "Taisho",
    daihyosen: true,
    suddenDeath: true,
    seed: options.seed ?? `encho-${playerA.id}-${playerB.id}`,
  });
}
