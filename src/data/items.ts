import catalog from "../../items_catalog.json";
import { loadItems, type SeedItem } from "@/lib/versus/items";

/**
 * The item catalog, loaded and validated from the hand-edited file at the
 * project root. Same pattern as AUGMENT_CATALOG / CLUB_ROSTER.
 */
export const ITEM_CATALOG = loadItems(catalog as SeedItem[]);
