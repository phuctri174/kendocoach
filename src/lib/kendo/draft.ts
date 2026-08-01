import { STYLE_STAT_PERCENTS } from "./config";
import { emptyHistory } from "./history";
import {
  COMBAT_STYLES,
  type BaseStats,
  type Target,
  type CombatStyle,
  type PersonRecord,
  type Player,
  type StatPath,
  type StyleModifier,
} from "./types";

const clamp100 = (v: number) => Math.min(100, Math.max(0, v));

/**
 * Which stances a person can use. Chudan is always available; any style named
 * in `styles` or given a modifier entry is available too, so hand-edits to
 * either field in the seed JSON take effect.
 */
export function stylesFor(person: PersonRecord): CombatStyle[] {
  const named = new Set<CombatStyle>(["Chudan"]);
  for (const style of person.styles ?? []) named.add(style);
  for (const style of Object.keys(person.styleModifiers ?? {}) as CombatStyle[]) {
    named.add(style);
  }
  // Keep a stable Chudan > Jodan > Nito ordering rather than key insertion order.
  return COMBAT_STYLES.filter((style) => named.has(style));
}

type ScalarStat = "attack_rate" | "defend_rate" | "hansoku_rate" | "stamina";

/** Reads one stat by path. */
export function readStat(stats: BaseStats, path: StatPath): number {
  if (path.startsWith("technique.")) {
    return stats.technique[path.slice("technique.".length) as Target];
  }
  if (path.startsWith("defense.")) {
    return stats.defense[path.slice("defense.".length) as Target];
  }
  return stats[path as ScalarStat];
}

function writeStat(stats: BaseStats, path: StatPath, value: number): void {
  if (path.startsWith("technique.")) {
    stats.technique[path.slice("technique.".length) as Target] = value;
  } else if (path.startsWith("defense.")) {
    stats.defense[path.slice("defense.".length) as Target] = value;
  } else {
    stats[path as ScalarStat] = value;
  }
}

function copyStats(base: BaseStats): BaseStats {
  return {
    technique: { ...base.technique },
    defense: { ...base.defense },
    attack_rate: base.attack_rate,
    defend_rate: base.defend_rate,
    hansoku_rate: base.hansoku_rate,
    stamina: base.stamina,
  };
}

/** Applies signed flat deltas to a copy of the base stats, clamped to 0-100. */
export function applyStyleModifier(
  base: BaseStats,
  modifier: StyleModifier | undefined,
): BaseStats {
  const out = copyStats(base);
  if (!modifier) return out;

  for (const [path, delta] of Object.entries(modifier) as [StatPath, number][]) {
    if (typeof delta !== "number" || Number.isNaN(delta)) continue;
    writeStat(out, path, clamp100(readStat(out, path) + delta));
  }
  return out;
}

/**
 * Applies percentage deltas measured against the *base* value, e.g. -7 on a
 * base of 80 subtracts 5.6. Percentages always read from `base`, so several
 * modifiers cannot compound off each other's results.
 */
export function applyPercentModifier(
  base: BaseStats,
  percents: Partial<Record<StatPath, number>> | undefined,
): BaseStats {
  const out = copyStats(base);
  if (!percents) return out;

  for (const [path, percent] of Object.entries(percents) as [StatPath, number][]) {
    if (typeof percent !== "number" || Number.isNaN(percent)) continue;
    const from = readStat(base, path);
    writeStat(out, path, clamp100(from + (from * percent) / 100));
  }
  return out;
}

/**
 * A person's stat block in a given stance: the stance's built-in percentage
 * trade-offs first, then any per-player flat styleModifiers on top.
 */
export function statsInStance(person: PersonRecord, style: CombatStyle): BaseStats {
  return applyStyleModifier(
    applyPercentModifier(person.baseStats, STYLE_STAT_PERCENTS[style]),
    person.styleModifiers?.[style],
  );
}

/**
 * One person becomes exactly one Player. Stance is no longer part of identity:
 * the styles they can use travel with them and are resolved per bout.
 */
export function toPlayer(person: PersonRecord): Player {
  return {
    id: person.id,
    name: person.name,
    ...person.baseStats,
    technique: { ...person.baseStats.technique },
    defense: { ...person.baseStats.defense },
    styles: stylesFor(person),
    styleModifiers: person.styleModifiers,
    styleWeights: person.styleWeights,
    history: person.history ?? emptyHistory(),
  };
}

export function toPlayers(people: PersonRecord[]): Player[] {
  return people.map(toPlayer);
}
