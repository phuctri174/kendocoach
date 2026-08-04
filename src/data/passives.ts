import catalog from "../../passives_catalog.json";
import { loadPassiveCatalog, type SeedPassiveEntry } from "@/lib/versus/passiveCatalog";

/**
 * The passive catalog, loaded and validated from the hand-edited file at the
 * project root. Same pattern as AUGMENT_CATALOG/ITEM_CATALOG/CLUB_ROSTER.
 */
export const PASSIVE_CATALOG = loadPassiveCatalog(catalog.passives as SeedPassiveEntry[]);
