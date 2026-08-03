export const SPECTATOR_SLOTS = 4;

// Heartbeat cadence and the staleness window used to decide a slot is
// abandoned. Set well apart (3x) so a couple of missed/delayed beats from a
// slow network never gets a still-open tab reclaimed out from under it.
export const SPECTATOR_HEARTBEAT_MS = 30_000;
export const SPECTATOR_STALE_MS = 90_000;
