-- Phase 8b: split bout resolution into two stages so the daihyosen
-- representative is picked only after both players know the match is
-- actually tied, not pre-guessed before the 5 regular bouts run.
--
-- simulateTeamMatch (unmodified) is fully deterministic given the same
-- teams + seed: calling it once WITHOUT representatives reveals whether the
-- 5 regular bouts (Senpo-Taisho) decide it outright; if `decidedBy` comes
-- back "daihyosen", the 5 bouts are still correct (reps don't affect them),
-- but the tiebreak in that response used the engine's own auto-suggested
-- rep, not a real pick — so it's discarded and only the 5 bouts + their
-- narration are kept. Once both players privately pick a representative
-- (same reveal-on-individual-confirm timing as every other pick in this
-- mode), simulateTeamMatch is called again with the SAME seed — reproducing
-- the identical 5 bouts — but now with real representatives, resolving the
-- daihyosen for real. Two calls to the same unmodified function, never a
-- fork of it.
alter table public.match_games add column bout_provisional jsonb;

-- Client staleness counter for the whole bout lifecycle (provisional bouts
-- appearing, either representative being picked, the final result
-- appearing) — bumped on every write in that lifecycle, same role as
-- draft_seq/augment_seq/item_seq/lineup_seq play for their own phases.
alter table public.match_games add column bout_seq integer not null default 0;
