-- Phase 8: bout simulation + series scoring.
--
-- simulateTeamMatch (the unmodified solo-mode engine) accepts a daihyosen
-- representative id per side up front — it can't pause mid-simulation to ask
-- a human which player to send out if the score ties, since the whole team
-- match resolves synchronously in one call. So "each real player picks their
-- own representative manually" has to mean picking it *before* the bout
-- runs, not reactively after seeing a tie. The natural place for that
-- pre-commitment is the same moment as locking in the lineup — one write,
-- same reveal-on-confirm timing already used for lineup_a/lineup_b.
alter table public.match_games add column representative_a text;
alter table public.match_games add column representative_b text;

-- match_games.result already existed as a jsonb stub from the Phase 1
-- schema. It now holds the full TeamMatch object (bouts, tiebreak, result,
-- log) the engine returns, not just the win/loss summary — the narration
-- log is what the result viewer replays. `result is null` is its own race
-- guard for "has this game's bout already been simulated", same pattern as
-- augment_tier.
