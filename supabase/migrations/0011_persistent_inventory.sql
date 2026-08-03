-- Augments and items now persist and stack across the whole series instead
-- of applying to just the game they were picked in.
--
-- Augments need no new storage: "all augments active entering game N" is
-- derivable by scanning this match's own match_games rows (game_number <=
-- N, odd, augment_pick_a/b) — see activeAugmentIdsFor in src/lib/versus/bout.ts.
-- Each one still independently re-checks its own condition against game N's
-- actual roster, so a stacked augment from an earlier game never gets
-- grandfathered in if this game's draft doesn't satisfy it.
--
-- Items are trickier: the draft fully resets every game, so an item can't
-- stay "equipped to a person" the way an augment can passively keep
-- applying. Instead it becomes a permanent, non-consumable, series-wide
-- inventory entry (this table), and each game's lineup phase is where the
-- coach re-chooses which inventory items (if any) go on which of that
-- game's own 5 drafted players.
alter table public.matches add column inventory_a jsonb not null default '[]'::jsonb;
alter table public.matches add column inventory_b jsonb not null default '[]'::jsonb;

-- item_pick_a/b keeps its existing role — the per-game "have I made this
-- round's new-item pick yet" gate for the item-offer phase (even games
-- only) — but now holds just the itemId. The pick itself lands in
-- inventory_a/b above; it's no longer equipped to anyone by picking it.
alter table public.match_games alter column item_pick_a type text using (item_pick_a ->> 'itemId');
alter table public.match_games alter column item_pick_b type text using (item_pick_b ->> 'itemId');

-- This game's actual equip assignments — chosen from the accumulated
-- inventory at lineup time, one array entry per equipped player (max one
-- item per player, enforced at equip time same as before). An array now,
-- not a single slot, since by game 4-5 there can be more inventory items
-- than the previous one-equip-per-game model ever allowed.
alter table public.match_games add column item_equips_a jsonb not null default '[]'::jsonb;
alter table public.match_games add column item_equips_b jsonb not null default '[]'::jsonb;
