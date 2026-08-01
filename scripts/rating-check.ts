/**
 * Guards the contract of overallStrength(): every fighting stat must move the
 * number, and hansoku_rate must not. Tổng lực is derived from a simulated win
 * rate rather than a written-out formula, so a stat can fall out of it silently
 * — a change to the engine is enough. This fails loudly when that happens.
 *
 * Run with: npm run rating
 */
import { overallStrength, REFERENCE_FENCER } from "../src/lib/kendo/rating";
import type { BaseStats } from "../src/lib/kendo/types";

type Probe = {
  label: string;
  set: (stats: BaseStats, value: number) => BaseStats;
};

const probe = (
  label: string,
  set: (stats: BaseStats, value: number) => BaseStats,
): Probe => ({ label, set });

/** The eleven stats Tổng lực is built from. hansoku_rate is checked apart. */
const FIGHTING: Probe[] = [
  ...(["men", "kote", "dou", "tsuki"] as const).flatMap((t) => [
    probe(`technique.${t}`, (s, v) => ({ ...s, technique: { ...s.technique, [t]: v } })),
    probe(`defense.${t}`, (s, v) => ({ ...s, defense: { ...s.defense, [t]: v } })),
  ]),
  probe("attack_rate", (s, v) => ({ ...s, attack_rate: v })),
  probe("defend_rate", (s, v) => ({ ...s, defend_rate: v })),
  probe("stamina", (s, v) => ({ ...s, stamina: v })),
];

const HANSOKU = probe("hansoku_rate", (s, v) => ({ ...s, hansoku_rate: v }));

const base = REFERENCE_FENCER;
const baseline = overallStrength(base);
const failures: string[] = [];

// An average fencer is an even match with the average fencer, by definition.
if (Math.abs(baseline - 50) > 1e-6) {
  failures.push(`reference fencer should rate 50, got ${baseline.toFixed(6)}`);
}

if (FIGHTING.length !== 11) {
  failures.push(`expected 11 fighting stats, found ${FIGHTING.length}`);
}

console.log(`baseline (all-average reference) = ${baseline.toFixed(4)}\n`);
console.log("stat              @30       @70      spread   verdict");
console.log("-".repeat(58));

const spreads = new Map<string, number>();

for (const p of FIGHTING) {
  const lo = overallStrength(p.set(base, 30));
  const hi = overallStrength(p.set(base, 70));
  const spread = hi - lo;
  spreads.set(p.label, spread);
  // Meaningfully, not just to floating-point noise: a 40-point stat swing
  // should be worth at least a quarter of a rating point.
  const ok = spread > 0.25;
  if (!ok) failures.push(`${p.label} barely moves overallStrength (spread ${spread.toFixed(6)})`);
  console.log(
    `${p.label.padEnd(16)} ${lo.toFixed(3).padStart(7)} ${hi.toFixed(3).padStart(9)} ${spread
      .toFixed(3)
      .padStart(8)}   ${ok ? "moves" : "DEAD"}`,
  );
}

/**
 * No single stat may dominate the rating. attack_rate is the one that can:
 * it decides initiative on every exchange, where a technique or defense grade
 * only applies to its own target. Left proportional it swung TL ~13.7 points
 * against ~3.9 for the best single technique, enough to outrank a player ahead
 * on seven of the other ten stats. cfg.initiativeExponent is the lever; this
 * keeps it honest.
 */
const DOMINANCE_RATIO = 1.75;
const perTarget = [...spreads.entries()].filter(([k]) => k.includes("."));
const widestTarget = Math.max(...perTarget.map(([, v]) => v));
const attack = spreads.get("attack_rate")!;
const dominates = attack > widestTarget * DOMINANCE_RATIO;
if (dominates) {
  failures.push(
    `attack_rate dominates: ${attack.toFixed(3)} vs widest technique/defense ` +
      `${widestTarget.toFixed(3)} (limit ${(widestTarget * DOMINANCE_RATIO).toFixed(3)}). ` +
      `Lower cfg.initiativeExponent.`,
  );
}
const dominanceLine =
  `attack_rate ${attack.toFixed(3)} vs widest technique/defense ${widestTarget.toFixed(3)} ` +
  `— ratio ${(attack / widestTarget).toFixed(2)}x (limit ${DOMINANCE_RATIO}x) ${
    dominates ? "TOO DOMINANT" : "in line"
  }`;

const hansokuValues = [0, 10, 25, 50, 75, 100].map((v) =>
  overallStrength(HANSOKU.set(base, v)),
);
const hansokuSpread = Math.max(...hansokuValues) - Math.min(...hansokuValues);
const hansokuOk = hansokuSpread < 1e-9;
if (!hansokuOk) {
  failures.push(`hansoku_rate must not affect overallStrength (spread ${hansokuSpread})`);
}
console.log(
  `${"hansoku_rate".padEnd(16)} ${hansokuValues[0].toFixed(3).padStart(7)} ${hansokuValues
    .at(-1)!
    .toFixed(3)
    .padStart(9)} ${hansokuSpread.toFixed(3).padStart(8)}   ${
    hansokuOk ? "excluded (as intended)" : "LEAKING"
  }`,
);
console.log(`\n${dominanceLine}`);

if (failures.length > 0) {
  console.error(`\n[rating] FAILED\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\n[rating] OK — all 11 fighting stats move Tổng lực; hansoku_rate does not.");
