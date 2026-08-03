-- Bo3 as a second, room-locked match format alongside the existing Bo5 —
-- format is fixed per room (not chosen per-match), so it just needs to ride
-- along wherever a room's identity already flows into a match: rooms ->
-- matches (at creation, in rooms/ready) -> match_history (denormalized at
-- series completion, same as player_a/b/scores already are).
alter table public.rooms add column format text not null default 'bo5' check (format in ('bo3', 'bo5'));
alter table public.matches add column format text not null default 'bo5' check (format in ('bo3', 'bo5'));
alter table public.match_history add column format text not null default 'bo5' check (format in ('bo3', 'bo5'));

-- 5 generic rooms -> 3 explicit Bo5 + 3 explicit Bo3. Rooms 1-3 stay exactly
-- as they are today (format defaults to 'bo5', matching current behavior
-- unchanged); rooms 4-5 are repurposed to Bo3 rather than deleted and
-- recreated, and room 6 is new.
update public.rooms set format = 'bo3' where id in (4, 5);
insert into public.rooms (id, format) values (6, 'bo3');

-- "Tiếp tục" (continue to the next game) currently advances only the
-- clicking player's own client — goToNextGame is purely local state, with
-- nothing server-side gating it on the OTHER side having also clicked. Same
-- per-side-column shape as lineup_a/lineup_b or representative_a/b: each
-- side confirms independently and concurrently, so this needs its own pair
-- of columns and the same atomic-seq-bump fix applied to those, not a naive
-- read-then-write.
alter table public.match_games add column continue_a boolean not null default false;
alter table public.match_games add column continue_b boolean not null default false;

-- Same trigger as 0012/0013, extended to also cover continue_a/continue_b —
-- both sides can click "Tiếp tục" close together, and without this, the
-- exact same lost-increment race that hit lineup_a/lineup_b and
-- representative_a/b would hit this pair too: one side's client would never
-- locally see the other's continue flag, and the transition would never
-- fire on that browser even though the DB row is fully valid.
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
    or new.continue_a is distinct from old.continue_a
    or new.continue_b is distinct from old.continue_b
  then
    new.bout_seq := old.bout_seq + 1;
  end if;
  return new;
end;
$$;
