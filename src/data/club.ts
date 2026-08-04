import seed from "../../players.seed.json";
// Imported from the specific submodule, not the `@/lib/kendo` barrel — this
// file's own CLUB_ROSTER export is what versus/passives.ts resolves its
// character ids against at module-load time (see its own idOf/ID
// comments), and passives.ts itself now gets imported from inside
// kendo/round.ts (solo mode reusing the same passive engine versus mode
// does). Going through the barrel here would mean: club.ts -> kendo barrel
// -> round.ts -> versus/passives.ts -> club.ts, a genuine circular import
// that throws "Cannot access 'CLUB_ROSTER' before initialization" at
// startup, not a theoretical concern (reproduced while wiring this up).
// Importing straight from roster.ts sidesteps the barrel entirely, since
// roster.ts's own dependencies never lead back to round.ts.
import { loadRoster, type SeedPlayer } from "@/lib/kendo/roster";

/**
 * The club roster, loaded and validated from the hand-edited seed file at the
 * project root. Ids are derived here, not stored in the file.
 */
export const CLUB_ROSTER = loadRoster(seed as SeedPlayer[]);
