-- Fixes a lost-update race in the augment_seq/item_seq/lineup_seq
-- optimistic-concurrency counters: augments/pick, items/pick, and
-- lineup/confirm each independently compute `game.<x>_seq + 1` from a
-- pre-fetched row, while guarding the actual pick data on a per-side column
-- (e.g. lineup_a IS NULL / lineup_b IS NULL). That per-side guard correctly
-- lets A and B write concurrently without clobbering each other's pick data
-- — but when both requests read the row before either write commits, both
-- computed increments are based on the same stale seq value, so the counter
-- only advances once even though two real state changes happened.
--
-- The client (applyGameUpdate in src/app/tran/[matchId]/page.tsx) uses these
-- seq numbers to decide whether an incoming realtime row is newer than what
-- it's already showing, treating a tie as "not newer" and dropping the
-- update. If a client's own confirm response already advanced its local seq
-- to the same (too-low) value the DB landed on, the opponent's real confirm
-- arriving right after is silently discarded on both the broadcast and
-- postgres_changes channels — that side's `lineup_b`/`lineup_a` never
-- populates locally, so the match never starts even though the DB row is
-- fully valid and both sides show "confirmed".
--
-- Fix: move the increment into a BEFORE UPDATE trigger, which reads OLD
-- from the row Postgres has just locked for this UPDATE, not a pre-fetch —
-- concurrent writers targeting the same row are serialized by the row lock,
-- so each one's increment is computed from the true latest committed value.
create or replace function public.bump_match_game_seq()
returns trigger
language plpgsql
as $$
begin
  if new.augment_pick_a is distinct from old.augment_pick_a or new.augment_pick_b is distinct from old.augment_pick_b then
    new.augment_seq := old.augment_seq + 1;
  end if;
  if new.item_pick_a is distinct from old.item_pick_a or new.item_pick_b is distinct from old.item_pick_b then
    new.item_seq := old.item_seq + 1;
  end if;
  if new.lineup_a is distinct from old.lineup_a or new.lineup_b is distinct from old.lineup_b then
    new.lineup_seq := old.lineup_seq + 1;
  end if;
  return new;
end;
$$;

create trigger match_games_bump_seq
  before update on public.match_games
  for each row
  execute function public.bump_match_game_seq();
