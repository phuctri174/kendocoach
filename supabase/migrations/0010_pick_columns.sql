-- Fixes a real lost-update race in augment_picks / item_picks: both pick
-- routes read the whole shared jsonb column, splice their own side's key in
-- with a JS spread, and write the entire column back. Each side's own
-- per-key `.is(augment_picks->>side, null)` guard passes correctly even
-- when the two requests interleave, but the write that lands second still
-- overwrites the column with its own stale copy of the object — silently
-- erasing whichever pick the other side had just written. augment_seq /
-- item_seq were added specifically to guard against this (see
-- 0005_augments.sql / 0006_items.sql) but were never actually wired into
-- the update's WHERE clause, so they never did.
--
-- Same fix already applied to lineup_a/lineup_b and
-- representative_a/representative_b: split into one column per side, so two
-- concurrent writes touch different columns and can't clobber each other —
-- no read-modify-write on shared JSON needed at all.
alter table public.match_games add column augment_pick_a text;
alter table public.match_games add column augment_pick_b text;
alter table public.match_games add column item_pick_a jsonb;
alter table public.match_games add column item_pick_b jsonb;

alter table public.match_games drop column augment_picks;
alter table public.match_games drop column item_picks;
