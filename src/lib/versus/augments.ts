import { STAT_PATHS, type StatPath } from "@/lib/kendo/types";

export type AugmentTier = "Rookie" | "Kyu" | "Dan";
export const AUGMENT_TIERS: readonly AugmentTier[] = ["Rookie", "Kyu", "Dan"];

/** Same auto-pick-on-timeout pattern as the draft's TURN_SECONDS. */
export const AUGMENT_PICK_SECONDS = 30;

/** The shape of augments_catalog.json — hand-edited, same pattern as
 *  players.seed.json. Unlike the roster, `id` is authored here rather than
 *  derived from array order: augment ids get persisted into in-progress
 *  match_games rows, so reordering the catalog must never reassign one. */
export interface SeedAugment {
  id: string;
  name: string;
  tier: AugmentTier;
  description: string;
  effects: Partial<Record<StatPath, number>>;
}

export type Augment = SeedAugment;

function fail(index: number, id: string, message: string): never {
  throw new Error(`augments_catalog.json entry ${index + 1}${id ? ` ("${id}")` : ""}: ${message}`);
}

/**
 * Turns the catalog file into validated augments. Throws with the offending
 * entry named when the file is malformed, same philosophy as loadRoster.
 */
export function loadAugments(seed: SeedAugment[]): Augment[] {
  if (!Array.isArray(seed)) {
    throw new Error("augments_catalog.json must contain an array of augments");
  }

  const seenIds = new Set<string>();
  const augments = seed.map((entry, index) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) fail(index, "", "id is required");
    if (seenIds.has(id)) fail(index, id, `duplicate id "${id}"`);
    seenIds.add(id);

    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name) fail(index, id, "name is required");

    if (!AUGMENT_TIERS.includes(entry?.tier)) {
      fail(index, id, `tier must be one of ${AUGMENT_TIERS.join(", ")}, got ${JSON.stringify(entry?.tier)}`);
    }

    const description = typeof entry?.description === "string" ? entry.description.trim() : "";
    if (!description) fail(index, id, "description is required");

    const effects = entry?.effects;
    if (!effects || typeof effects !== "object" || Array.isArray(effects)) {
      fail(index, id, "effects must be an object");
    }
    for (const [path, delta] of Object.entries(effects)) {
      // An "opp." prefix means "apply to the opposing team instead of the
      // picker's own" — not yet wired up to actually happen (see
      // NOT_YET_LIVE_AUGMENT_IDS), but valid catalog syntax so the file
      // doesn't have to be split while that lands.
      const bareStat = path.startsWith("opp.") ? path.slice(4) : path;
      if (!STAT_PATHS.includes(bareStat as StatPath)) {
        fail(index, id, `unknown stat "${path}" in effects`);
      }
      if (typeof delta !== "number" || Number.isNaN(delta)) {
        fail(index, id, `effects.${path} must be a number, got ${JSON.stringify(delta)}`);
      }
    }

    return { id, name, tier: entry.tier as AugmentTier, description, effects };
  });

  for (const tier of AUGMENT_TIERS) {
    const count = augments.filter((a) => a.tier === tier).length;
    if (count < 3) {
      throw new Error(`augments_catalog.json: tier "${tier}" has only ${count} augment(s), needs at least 3`);
    }
  }

  return augments;
}

/** Fisher-Yates, same approach as rollPool in draft.ts. */
export function rollTier(): AugmentTier {
  return AUGMENT_TIERS[Math.floor(Math.random() * AUGMENT_TIERS.length)];
}

export function rollAugmentOffer(catalog: readonly Augment[], tier: AugmentTier, count = 3): string[] {
  const eligible = catalog.filter((a) => a.tier === tier).map((a) => a.id);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, Math.min(count, eligible.length));
}
