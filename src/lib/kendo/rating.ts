import {
  COUNTER_TARGETS,
  DEFAULT_CONFIG,
  STYLE_ATTACK_BIAS,
  type SimConfig,
} from "./config";
import { TARGETS, type BaseStats, type Target } from "./types";

/**
 * The neutral yardstick every player is measured against: a wholly average
 * club member. Tổng lực is that comparison expressed as a percentage, so ~50
 * means "an even match with the average", not an arbitrary index.
 */
export const REFERENCE_FENCER: BaseStats = {
  technique: { men: 50, kote: 50, dou: 50, tsuki: 50 },
  defense: { men: 50, kote: 50, dou: 50, tsuki: 50 },
  attack_rate: 50,
  defend_rate: 50,
  hansoku_rate: 10,
  stamina: 50,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Rough average fatigue debuff carried through a reference-length bout. Folded
 * in so stamina counts for something, since it quietly erodes every other stat.
 */
function averageFatigue(stamina: number, cfg: SimConfig): number {
  const referenceExchanges = Math.max(1, cfg.referenceTimeLimit / cfg.secondsPerExchange);
  const resistance = 1 - clamp(stamina, 0, 100) / 100;
  let carried = 0;
  let total = 0;
  for (let i = 0; i < referenceExchanges; i++) {
    const chance = clamp(
      cfg.fatigueTriggerScale * resistance * ((i + 1) / referenceExchanges),
      0,
      cfg.fatigueTriggerCeiling,
    );
    carried = Math.min(cfg.fatigueCeiling, carried + chance * cfg.fatigueStep);
    total += carried;
  }
  return total / referenceExchanges;
}

/** One side's per-exchange scoring and conceding rates when it attacks. */
function attackProfile(atk: BaseStats, def: BaseStats, cfg: SimConfig) {
  const bias = STYLE_ATTACK_BIAS.Chudan;
  const atkFade = 1 - averageFatigue(atk.stamina, cfg);
  const defFade = 1 - averageFatigue(def.stamina, cfg);

  // Targets are chosen in proportion to the attacker's own technique, so a
  // single weak technique costs little — it simply gets picked rarely.
  const weights = TARGETS.map((t) => Math.max(1, atk.technique[t]) * bias[t]);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const hit = (t: Target) => {
    const a = Math.max(1, atk.technique[t]) * atkFade;
    const d = Math.max(1, def.defense[t]) * defFade;
    return clamp((cfg.hitScale * a) / (a + d), cfg.hitFloor, cfg.hitCeiling);
  };

  const counterAfter = (attacked: Target) => {
    const plausible = COUNTER_TARGETS[attacked];
    const options = TARGETS.filter((t) => plausible[t] !== undefined);
    const w = options.map((t) => Math.max(1, def.technique[t]) * plausible[t]! * bias[t]);
    const tot = w.reduce((s, x) => s + x, 0);
    return options.reduce((acc, t, i) => {
      const a = Math.max(1, def.technique[t]) * defFade;
      const d = Math.max(1, atk.defend_rate) * atkFade;
      return acc + (w[i] / tot) * clamp((cfg.counterScale * a) / (a + d), 0, cfg.counterCeiling);
    }, 0);
  };

  let scores = 0;
  let concedes = 0;
  TARGETS.forEach((t, i) => {
    const share = weights[i] / totalWeight;
    const h = hit(t);
    scores += share * h;
    concedes += share * (1 - h) * counterAfter(t);
  });
  return { scores, concedes };
}

/**
 * Probability that `stats` beats `opponent` in one bout, draws counted as half.
 * Enumerates the exact state space the simulator walks — ippon tallies plus
 * each side's foul parity — over the reference exchange budget.
 */
export function expectedWinRate(
  stats: BaseStats,
  opponent: BaseStats = REFERENCE_FENCER,
  config: Partial<SimConfig> = {},
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Mirrors bout.ts: attack_rate decides initiative, compressed by the same
  // exponent so the rating cannot drift from what the simulator does.
  const wA = Math.max(1, stats.attack_rate) ** cfg.initiativeExponent;
  const wB = Math.max(1, opponent.attack_rate) ** cfg.initiativeExponent;
  const initiative = wA / (wA + wB);

  const mine = attackProfile(stats, opponent, cfg);
  const theirs = attackProfile(opponent, stats, cfg);
  const foulMe = clamp((clamp(stats.hansoku_rate, 0, 100) / 100) * cfg.hansokuScale, 0, 0.9);
  const foulThem = clamp((clamp(opponent.hansoku_rate, 0, 100) / 100) * cfg.hansokuScale, 0, 0.9);

  const base = cfg.referenceTimeLimit / cfg.secondsPerExchange;
  const min = Math.max(1, Math.round(base * (1 - cfg.exchangeJitter)));
  const max = Math.max(min, Math.round(base * (1 + cfg.exchangeJitter)));

  let win = 0;
  let draw = 0;

  for (let budget = min; budget <= max; budget++) {
    let states = new Map<string, number>([["0,0,0,0", 1]]);
    for (let step = 0; step < budget; step++) {
      const next = new Map<string, number>();
      const add = (key: string, p: number) => next.set(key, (next.get(key) ?? 0) + p);

      for (const [key, prob] of states) {
        const [ia, ib, fa, fb] = key.split(",").map(Number);
        if (ia >= cfg.ipponsToWin || ib >= cfg.ipponsToWin) {
          add(key, prob);
          continue;
        }
        for (const mineInitiates of [true, false]) {
          const pInit = mineInitiates ? initiative : 1 - initiative;
          if (pInit <= 0) continue;
          const profile = mineInitiates ? mine : theirs;
          const foul = mineInitiates ? foulMe : foulThem;

          const outcomes = [
            { da: mineInitiates ? 1 : 0, db: mineInitiates ? 0 : 1, p: profile.scores },
            { da: mineInitiates ? 0 : 1, db: mineInitiates ? 1 : 0, p: profile.concedes },
            { da: 0, db: 0, p: 1 - profile.scores - profile.concedes },
          ];
          for (const o of outcomes) {
            if (o.p <= 0) continue;
            // Mirrors bout.ts: a strike that ends the bout stops the foul roll.
            const decidedByStrike =
              ia + o.da >= cfg.ipponsToWin || ib + o.db >= cfg.ipponsToWin;
            for (const fouled of decidedByStrike ? [false] : [true, false]) {
              const pf = fouled ? foul : decidedByStrike ? 1 : 1 - foul;
              if (pf <= 0) continue;
              let nia = ia + o.da;
              let nib = ib + o.db;
              let nfa = fa;
              let nfb = fb;
              if (fouled) {
                if (mineInitiates) {
                  nfa = (fa + 1) % cfg.hansokuPerIppon;
                  if (nfa === 0) nib += 1;
                } else {
                  nfb = (fb + 1) % cfg.hansokuPerIppon;
                  if (nfb === 0) nia += 1;
                }
              }
              add(`${nia},${nib},${nfa},${nfb}`, prob * pInit * o.p * pf);
            }
          }
        }
      }
      states = next;
    }

    const share = 1 / (max - min + 1);
    for (const [key, prob] of states) {
      const [ia, ib] = key.split(",").map(Number);
      if (ia >= cfg.ipponsToWin || ia > ib) win += prob * share;
      else if (ib < cfg.ipponsToWin && ib === ia) draw += prob * share;
    }
  }

  return win + draw / 2;
}

/**
 * "Tổng lực" — a single 0-100 number for a fencer, and the only such number in
 * the codebase (opponent-selection weighting, the AI's representative pick and
 * the stats page all read it).
 *
 * It is not a weighted average of the stat sheet. It is the player's expected
 * win rate against a wholly average club member, worked out with the same
 * resolution maths the simulator uses. All eleven fighting stats are therefore
 * included with the weight the engine actually gives them: technique through
 * the targets the player favours, defense through what the opponent can land,
 * attack_rate through share of initiative, defend_rate through counter-ippon,
 * and stamina through fatigue.
 *
 * hansoku_rate is the one stat deliberately left out. Fouls do lose real bouts,
 * so this makes Tổng lực an estimate of fighting strength rather than a true
 * win rate — a discipline problem is reported on its own, not folded into the
 * strength number. Holding it at the reference value on both sides is what
 * excludes it: the rating becomes independent of the player's own foul rate
 * while an average fencer still sits at exactly 50.
 */
export function overallStrength(stats: BaseStats): number {
  return 100 * expectedWinRate({ ...stats, hansoku_rate: REFERENCE_FENCER.hansoku_rate });
}
