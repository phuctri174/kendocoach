-- Same lost-update race as 0012_atomic_seq_bump.sql, recurring in bout_seq —
-- missed there because at the time, `bout/run` and `bout/daihyosen` (both
-- guarded on the shared `result`/`bout_provisional` columns being null, so
-- only one caller can ever win) were the only bout_seq writers examined, and
-- that guard shape genuinely isn't racy: a second concurrent writer's UPDATE
-- just matches zero rows once the first commits, no lost increment possible.
--
-- `bout/representative` writes bout_seq too, but its guard shape is the
-- OTHER kind — one column per side (`representative_a` / `representative_b`
-- IS NULL), same as lineup_a/lineup_b, so A and B genuinely do write
-- concurrently without clobbering each other's pick. That's exactly the
-- shape 0012 fixed for lineup_seq/augment_seq/item_seq and missed here:
-- when both players privately pick their daihyosen representative close
-- together, both writes succeed, but bout_seq (computed as
-- `game.bout_seq + 1` from each request's own pre-fetch) only advances once
-- for two real changes. The client then silently drops whichever side's
-- "opponent also picked" update ties on that stale count, so neither client
-- ever locally sees both representatives set, and the bout/daihyosen call
-- that's supposed to fire once they are never happens on either browser —
-- the game just sits there, stuck, even though the DB row is fully valid.
--
-- Fix: extend the same BEFORE UPDATE trigger to also own bout_seq, covering
-- every column that bumps it (bout_provisional/result from the two
-- single-writer routes, representative_a/representative_b from the
-- concurrent-writer one) — same reasoning as 0012, just completing it.
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
  if new.bout_provisional is distinct from old.bout_provisional
    or new.result is distinct from old.result
    or new.representative_a is distinct from old.representative_a
    or new.representative_b is distinct from old.representative_b
  then
    new.bout_seq := old.bout_seq + 1;
  end if;
  return new;
end;
$$;
