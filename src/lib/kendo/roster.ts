import { emptyHistory } from "./history";
import {
  COMBAT_STYLES,
  STAT_PATHS,
  TARGETS,
  type BaseStats,
  type CombatStyle,
  type PersonRecord,
  type StatPath,
  type StyleModifier,
  type StyleWeights,
} from "./types";

/**
 * The shape of players.seed.json — name and stats only. Identity is derived at
 * load time, so the seed file never carries an id or any metadata.
 */
export interface SeedPlayer {
  name: string;
  styles?: CombatStyle[];
  baseStats: BaseStats;
  styleModifiers?: Partial<Record<CombatStyle, StyleModifier>>;
  /** Optional stance tendencies, relative weights. Omit for uniform choice. */
  styleWeights?: StyleWeights;
}

/**
 * Internal id for the Nth seeded player: "p01", "p02", ... Stable for a given
 * file order — reordering the seed file reassigns ids, which only matters once
 * histories are persisted across sessions.
 */
export function derivePersonId(index: number): string {
  return `p${String(index + 1).padStart(2, "0")}`;
}

function fail(index: number, name: string, message: string): never {
  throw new Error(`players.seed.json entry ${index + 1}${name ? ` ("${name}")` : ""}: ${message}`);
}

function validateStats(stats: BaseStats, index: number, name: string): BaseStats {
  if (!stats?.technique) fail(index, name, "baseStats.technique is required");
  if (!stats?.defense) fail(index, name, "baseStats.defense is required");

  const numeric: [string, number][] = [
    ...TARGETS.map(
      (t) => [`technique.${t}`, stats.technique?.[t]] as [string, number],
    ),
    ...TARGETS.map((t) => [`defense.${t}`, stats.defense?.[t]] as [string, number]),
    ["attack_rate", stats?.attack_rate],
    ["defend_rate", stats?.defend_rate],
    ["hansoku_rate", stats?.hansoku_rate],
    ["stamina", stats?.stamina],
  ];

  for (const [field, value] of numeric) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      fail(index, name, `${field} must be a number, got ${JSON.stringify(value)}`);
    }
    if (value < 0 || value > 100) {
      fail(index, name, `${field} must be between 0 and 100, got ${value}`);
    }
  }

  return {
    technique: { ...stats.technique },
    defense: { ...stats.defense },
    attack_rate: stats.attack_rate,
    defend_rate: stats.defend_rate,
    hansoku_rate: stats.hansoku_rate,
    stamina: stats.stamina,
  };
}

function validateModifiers(
  modifiers: Partial<Record<CombatStyle, StyleModifier>> | undefined,
  index: number,
  name: string,
): Partial<Record<CombatStyle, StyleModifier>> {
  if (!modifiers) return {};

  for (const [style, modifier] of Object.entries(modifiers)) {
    if (!COMBAT_STYLES.includes(style as CombatStyle)) {
      fail(index, name, `unknown style "${style}" in styleModifiers`);
    }
    for (const [path, delta] of Object.entries(modifier ?? {})) {
      if (!STAT_PATHS.includes(path as StatPath)) {
        fail(index, name, `unknown stat "${path}" in the ${style} modifier`);
      }
      if (typeof delta !== "number" || Number.isNaN(delta)) {
        fail(index, name, `${style}.${path} must be a number, got ${JSON.stringify(delta)}`);
      }
    }
  }
  return modifiers;
}

function validateWeights(
  weights: StyleWeights | undefined,
  index: number,
  name: string,
): StyleWeights | undefined {
  // Absent or empty both mean "no tendencies" — fall back to uniform choice.
  // The seed ships `{}` for everyone, so this must not be an error.
  if (!weights || Object.keys(weights).length === 0) return undefined;

  let total = 0;
  for (const [style, weight] of Object.entries(weights)) {
    if (!COMBAT_STYLES.includes(style as CombatStyle)) {
      fail(index, name, `unknown style "${style}" in styleWeights`);
    }
    if (typeof weight !== "number" || Number.isNaN(weight)) {
      fail(index, name, `styleWeights.${style} must be a number, got ${JSON.stringify(weight)}`);
    }
    if (weight < 0) {
      fail(index, name, `styleWeights.${style} cannot be negative (got ${weight})`);
    }
    total += weight;
  }
  if (total <= 0) {
    fail(index, name, "styleWeights must have at least one weight above zero");
  }
  return weights;
}

/**
 * Turns the seed file into club records, assigning each person a derived id.
 * Throws with the offending entry named when the file is malformed, so a
 * hand-edit mistake in VS Code surfaces immediately rather than as NaN stats.
 */
export function loadRoster(seed: SeedPlayer[]): PersonRecord[] {
  if (!Array.isArray(seed)) {
    throw new Error("players.seed.json must contain an array of players");
  }

  return seed.map((entry, index) => {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name) fail(index, "", "name is required");

    if (entry.styles && !Array.isArray(entry.styles)) {
      fail(index, name, "styles must be an array");
    }
    for (const style of entry.styles ?? []) {
      if (!COMBAT_STYLES.includes(style)) {
        fail(index, name, `unknown style "${style}"`);
      }
    }

    return {
      id: derivePersonId(index),
      name,
      baseStats: validateStats(entry.baseStats, index, name),
      styles: entry.styles ?? ["Chudan"],
      styleModifiers: validateModifiers(entry.styleModifiers, index, name),
      styleWeights: validateWeights(entry.styleWeights, index, name),
      history: emptyHistory(),
    };
  });
}

/** Names appearing more than once — ids stay unique, but the UI would confuse them. */
export function duplicateNames(people: PersonRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const person of people) {
    counts.set(person.name, (counts.get(person.name) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
}
