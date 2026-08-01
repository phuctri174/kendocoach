-- Đà Lạt Kendo Club — versus mode, Phase 1 schema.
--
-- Server-authority principle: every random draw (candidate rolls, augment/item
-- rolls) and every pick validation happens in a service-role Route Handler,
-- never on the client. RLS below is the hard backstop for that promise — even
-- if a client bypassed the app entirely and hit Postgres with the anon key,
-- there is no INSERT/UPDATE/DELETE policy on rooms, matches, match_games, or
-- draft_events, so nothing but SELECT is possible outside the service role.

-- === profiles ===

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Every auth.users row — guest (anonymous) or full account — gets a matching
-- profile automatically, so the rest of the schema can FK to profiles(id)
-- uniformly without caring which kind of session it is.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', 'Khách ' || substr(new.id::text, 1, 4)),
    coalesce(new.is_anonymous, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- === rooms === (5 fixed seats, never created/deleted at runtime)

create table public.rooms (
  id smallint primary key check (id between 1 and 5),
  occupant_a uuid references public.profiles (id) on delete set null,
  occupant_b uuid references public.profiles (id) on delete set null,
  ready_a boolean not null default false,
  ready_b boolean not null default false,
  status text not null default 'open' check (status in ('open', 'full', 'in_match')),
  updated_at timestamptz not null default now()
);

insert into public.rooms (id) values (1), (2), (3), (4), (5);

alter table public.rooms enable row level security;

create policy "rooms are publicly readable"
  on public.rooms for select
  using (true);

-- No write policy: seat claims and ready-toggles go through a service-role
-- Route Handler so two clients can't win the same open seat in a race, and a
-- player can't flip the *other* seat's ready flag.

-- === matches ===

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id smallint not null references public.rooms (id),
  player_a uuid not null references public.profiles (id),
  player_b uuid not null references public.profiles (id),
  series_score_a smallint not null default 0,
  series_score_b smallint not null default 0,
  status text not null default 'drafting' check (status in ('drafting', 'in_progress', 'completed')),
  current_game_number smallint not null default 1 check (current_game_number between 1 and 5),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index matches_player_a_idx on public.matches (player_a);
create index matches_player_b_idx on public.matches (player_b);
create index matches_room_id_idx on public.matches (room_id);

alter table public.matches enable row level security;

create policy "participants can read their match"
  on public.matches for select
  using (auth.uid() = player_a or auth.uid() = player_b);

-- === match_games ===

create table public.match_games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  game_number smallint not null check (game_number between 1 and 5),
  time_limit_seconds smallint not null,
  draft_state jsonb not null default '{}'::jsonb,
  augment_tier text check (augment_tier in ('Rookie', 'Kyu', 'Dan')),
  augment_picks jsonb not null default '{}'::jsonb,
  item_picks jsonb not null default '{}'::jsonb,
  lineup_a jsonb,
  lineup_b jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, game_number)
);

create index match_games_match_id_idx on public.match_games (match_id);

alter table public.match_games enable row level security;

create policy "participants can read their match games"
  on public.match_games for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_games.match_id
        and (auth.uid() = m.player_a or auth.uid() = m.player_b)
    )
  );

-- === draft_events === (append-only log, for replay/debugging)

create table public.draft_events (
  id bigint generated always as identity primary key,
  match_game_id uuid not null references public.match_games (id) on delete cascade,
  phase smallint not null check (phase between 1 and 3),
  turn_index smallint not null,
  player uuid not null references public.profiles (id),
  candidate_id text not null,
  created_at timestamptz not null default now()
);

create index draft_events_match_game_id_idx on public.draft_events (match_game_id);

alter table public.draft_events enable row level security;

create policy "participants can read their draft events"
  on public.draft_events for select
  using (
    exists (
      select 1 from public.match_games mg
      join public.matches m on m.id = mg.match_id
      where mg.id = draft_events.match_game_id
        and (auth.uid() = m.player_a or auth.uid() = m.player_b)
    )
  );

-- === match_history === (completed series, public — feeds profile pages)

create table public.match_history (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) unique,
  player_a uuid not null references public.profiles (id),
  player_b uuid not null references public.profiles (id),
  winner uuid references public.profiles (id),
  series_score_a smallint not null,
  series_score_b smallint not null,
  completed_at timestamptz not null default now()
);

alter table public.match_history enable row level security;

create policy "match history is publicly readable"
  on public.match_history for select
  using (true);

-- === elo_ratings === (stub: starting rating only, tiers TBD)

create table public.elo_ratings (
  player_id uuid primary key references public.profiles (id),
  rating integer not null default 1000,
  rank_tier text,
  updated_at timestamptz not null default now()
);

alter table public.elo_ratings enable row level security;

create policy "elo ratings are publicly readable"
  on public.elo_ratings for select
  using (true);

-- === kendoka_stats === (derived; character_id is not a FK — the roster
-- lives in the hand-edited players.seed.json, not the database)

create table public.kendoka_stats (
  character_id text primary key,
  games_picked integer not null default 0,
  games_won integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.kendoka_stats enable row level security;

create policy "kendoka stats are publicly readable"
  on public.kendoka_stats for select
  using (true);
