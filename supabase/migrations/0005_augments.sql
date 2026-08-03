-- Phase 5: team-wide augments, offered before position assignment in games
-- 1, 3, and 5.
--
-- match_games.augment_tier / augment_picks already existed as stubs from the
-- Phase 1 schema — augment_tier is the server-rolled tier for the round
-- (null until rolled), augment_picks is `{ "A": id | null, "B": id | null }`
-- and is PUBLIC: it only ever holds the one augment each side has locked in.
--
-- The private 3-option offer each side is choosing from lives in its own
-- table with RLS restricted to the owning player, so — per the "hard
-- backstop" principle in 0001_init.sql — the opponent's unpicked options are
-- unreadable at the database level, not just hidden by the UI. The route
-- handler that rolls offers returns the caller's own row directly in its
-- response (same pattern as the caller's own draft pick), so the client
-- never needs to subscribe to this table over Realtime.
create table public.augment_offers (
  match_game_id uuid not null references public.match_games (id) on delete cascade,
  side text not null check (side in ('A', 'B')),
  player uuid not null references public.profiles (id),
  offered jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_game_id, side)
);

create index augment_offers_player_idx on public.augment_offers (player);

alter table public.augment_offers enable row level security;

create policy "a player can only read their own augment offer"
  on public.augment_offers for select
  using (player = auth.uid());

-- No write policy: offers are rolled by a service-role Route Handler only.

-- Optimistic-concurrency guard for augment_picks writes, same pattern as
-- draft_seq — the two sides lock in independently, so a naive
-- read-modify-write of the shared jsonb column could race and clobber one
-- side's pick with a stale copy of the object.
alter table public.match_games add column augment_seq integer not null default 0;
