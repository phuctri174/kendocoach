import { STAT_PATHS, type StatPath } from "@/lib/kendo/types";

/** The shape of items_catalog.json — hand-edited, same pattern as
 *  augments_catalog.json. Unlike augments (team-wide, tiered), an item has
 *  no tier and its effects apply to exactly one equipped player. `id` is
 *  authored, not derived — item ids get persisted into in-progress
 *  match_games rows, so reordering the catalog must never reassign one. */
export interface SeedItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  effects: Partial<Record<StatPath, number>>;
}

export type Item = SeedItem;

function fail(index: number, id: string, message: string): never {
  throw new Error(`items_catalog.json entry ${index + 1}${id ? ` ("${id}")` : ""}: ${message}`);
}

/**
 * Turns the catalog file into validated items. Throws with the offending
 * entry named when the file is malformed, same philosophy as loadAugments.
 */
export function loadItems(seed: SeedItem[]): Item[] {
  if (!Array.isArray(seed)) {
    throw new Error("items_catalog.json must contain an array of items");
  }

  const seenIds = new Set<string>();
  const items = seed.map((entry, index) => {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) fail(index, "", "id is required");
    if (seenIds.has(id)) fail(index, id, `duplicate id "${id}"`);
    seenIds.add(id);

    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name) fail(index, id, "name is required");

    const icon = typeof entry?.icon === "string" ? entry.icon.trim() : "";
    if (!icon) fail(index, id, "icon is required (a filename under public/items/)");

    const description = typeof entry?.description === "string" ? entry.description.trim() : "";
    if (!description) fail(index, id, "description is required");

    const effects = entry?.effects;
    if (!effects || typeof effects !== "object" || Array.isArray(effects)) {
      fail(index, id, "effects must be an object");
    }
    for (const [path, delta] of Object.entries(effects)) {
      if (!STAT_PATHS.includes(path as StatPath)) {
        fail(index, id, `unknown stat "${path}" in effects`);
      }
      if (typeof delta !== "number" || Number.isNaN(delta)) {
        fail(index, id, `effects.${path} must be a number, got ${JSON.stringify(delta)}`);
      }
    }

    return { id, name, icon, description, effects };
  });

  if (items.length < 3) {
    throw new Error(`items_catalog.json has only ${items.length} item(s), needs at least 3`);
  }

  return items;
}

/** Fisher-Yates, same approach as rollAugmentOffer. */
export function rollItemOffer(catalog: readonly Item[], count = 3): string[] {
  const eligible = catalog.map((i) => i.id);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, Math.min(count, eligible.length));
}
