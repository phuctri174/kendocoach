import seed from "../../players.seed.json";
import { loadRoster, type SeedPlayer } from "@/lib/kendo";

/**
 * The club roster, loaded and validated from the hand-edited seed file at the
 * project root. Ids are derived here, not stored in the file.
 */
export const CLUB_ROSTER = loadRoster(seed as SeedPlayer[]);
