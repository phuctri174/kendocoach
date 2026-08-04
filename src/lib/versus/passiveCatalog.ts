import { STAT_PATHS, type StatPath } from "@/lib/kendo/types";

/** The shape of passives_catalog.json — hand-edited, same pattern as
 *  augments_catalog.json/items_catalog.json/players.seed.json. `id` is
 *  authored here (not derived from array order) since src/lib/versus/
 *  passives.ts references entries by id directly. */
export interface SeedPassiveEntry {
  id: string;
  character: string;
  appliesTo: string;
  context: string;
  condition: string;
  effects: Partial<Record<StatPath, number>>;
}

export type PassiveCatalogEntry = SeedPassiveEntry;

function fail(index: number, id: string, message: string): never {
  throw new Error(`passives_catalog.json entry ${index + 1}${id ? ` ("${id}")` : ""}: ${message}`);
}

/**
 * Turns the catalog file into validated entries, then indexes them by id —
 * same "throw with the offending entry named" philosophy as loadAugments/
 * loadRoster, since a malformed or missing entry here should fail loudly at
 * startup rather than silently making a passive inert.
 */
export function loadPassiveCatalog(seed: SeedPassiveEntry[]): Map<string, PassiveCatalogEntry> {
  if (!Array.isArray(seed)) {
    throw new Error("passives_catalog.json must contain a `passives` array");
  }

  const byId = new Map<string, PassiveCatalogEntry>();
  seed.forEach((entry, index) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) fail(index, "", "id is required");
    if (byId.has(id)) fail(index, id, `duplicate id "${id}"`);

    const character = typeof entry?.character === "string" ? entry.character.trim() : "";
    if (!character) fail(index, id, "character is required");

    const appliesTo = typeof entry?.appliesTo === "string" ? entry.appliesTo.trim() : "";
    if (!appliesTo) fail(index, id, "appliesTo is required");

    const context = typeof entry?.context === "string" ? entry.context.trim() : "";
    if (!context) fail(index, id, "context is required");

    const condition = typeof entry?.condition === "string" ? entry.condition.trim() : "";
    if (!condition) fail(index, id, "condition is required");

    const effects = entry?.effects;
    if (!effects || typeof effects !== "object" || Array.isArray(effects)) {
      fail(index, id, "effects must be an object");
    }
    const entries = Object.entries(effects);
    if (entries.length === 0) {
      fail(index, id, "effects must have at least one stat");
    }
    for (const [path, delta] of entries) {
      if (!STAT_PATHS.includes(path as StatPath)) {
        fail(index, id, `unknown stat "${path}" in effects`);
      }
      if (typeof delta !== "number" || Number.isNaN(delta)) {
        fail(index, id, `effects.${path} must be a number, got ${JSON.stringify(delta)}`);
      }
      // Sanity range, not a hard game-design rule — catches an obvious typo
      // (e.g. a stray extra digit) rather than validating balance.
      if (Math.abs(delta) > 100) {
        fail(index, id, `effects.${path} = ${delta} looks like a typo (magnitude over 100)`);
      }
    }

    byId.set(id, { id, character, appliesTo, context, condition, effects });
  });

  return byId;
}
