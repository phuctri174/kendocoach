import catalog from "../../augments_catalog.json";
import { loadAugments, type SeedAugment } from "@/lib/versus/augments";

/**
 * The augment catalog, loaded and validated from the hand-edited file at the
 * project root. Same pattern as CLUB_ROSTER.
 */
export const AUGMENT_CATALOG = loadAugments(catalog as SeedAugment[]);
