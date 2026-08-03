-- Phase 6: single-player items, offered before position assignment in games
-- 2 and 4 (the even-game counterpart to augments in 1, 3, 5).
--
-- match_games.item_picks already existed as a stub from the Phase 1 schema —
-- PUBLIC, `{ "A": { itemId, targetPlayerId } | null, "B": ... | null }`. It
-- only ever holds the one item each side has equipped, same split as
-- augment_picks: the private 3-option offer lives in its own RLS-restricted
-- table, and item_picks is the only thing that's ever revealed once a side
-- locks in an equip.
create table public.item_offers (
  match_game_id uuid not null references public.match_games (id) on delete cascade,
  side text not null check (side in ('A', 'B')),
  player uuid not null references public.profiles (id),
  offered jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_game_id, side)
);

create index item_offers_player_idx on public.item_offers (player);

alter table public.item_offers enable row level security;

create policy "a player can only read their own item offer"
  on public.item_offers for select
  using (player = auth.uid());

-- No write policy: offers are rolled by a service-role Route Handler only.

-- Optimistic-concurrency guard for item_picks writes, same pattern as
-- augment_seq / draft_seq.
alter table public.match_games add column item_seq integer not null default 0;
