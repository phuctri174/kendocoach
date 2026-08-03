-- Persistent spectator seats: 4 slots per MATCH (not per room).
--
-- The spec asked for slots "per room", but rooms are freed and made
-- reclaimable by a brand new pair of players the instant a match is created
-- (see rooms/ready/route.ts's "free the room immediately" update) — a room's
-- id keeps no durable link to the match it spawned. Spectators watch an
-- ongoing SERIES, which can run long after the room that started it has
-- already been recycled for someone else's match, so the only entity stable
-- enough to hang a spectator seat off of is matches.id — the same id the
-- shareable link already points at (/tran/[matchId]/xem). Slots are keyed by
-- match_id here for that reason.
--
-- The 2 real players are never touched by any of this: they're seated via
-- matches.player_a/player_b at creation time and nothing here reads, writes,
-- or displaces those columns. A player who opens their own match's spectator
-- link is rejected a slot in the claim route (see spectate/claim/route.ts) —
-- they already have a seat, just not this kind.
create table public.match_spectators (
  match_id uuid not null references public.matches (id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Refreshed by a periodic client heartbeat while the tab is open. There is
  -- no reliable server-side "this websocket disconnected" signal in this
  -- serverless setup, so a slot is instead reclaimed lazily, at the next
  -- claim attempt, once its last_seen_at goes stale (see the claim route) —
  -- the same gap flagged earlier for room seats, addressed here via
  -- heartbeat + staleness instead of a live disconnect hook.
  last_seen_at timestamptz not null default now(),
  primary key (match_id, slot)
);

-- One slot per (match, user) — a claim attempt from someone who already
-- holds a slot on this match must find their own existing row, not take a
-- second one.
create unique index match_spectators_match_user_idx on public.match_spectators (match_id, user_id);
create index match_spectators_user_id_idx on public.match_spectators (user_id);

alter table public.match_spectators enable row level security;

-- Read-only from the client, same visibility as the match itself (anyone
-- with the link, per 0014_spectator_read.sql) — just enough to show a live
-- "x/4 đang xem" count. Claiming, heartbeating, and leaving all go through
-- the service-role admin client in Route Handlers, so there are no write
-- policies here at all.
create policy "anyone can read match spectators"
  on public.match_spectators for select
  using (true);

alter publication supabase_realtime add table public.match_spectators;
