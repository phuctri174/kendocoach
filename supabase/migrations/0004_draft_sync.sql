-- Phase 4: draft state machine support.
--
-- draft_seq is optimistic-concurrency guard for match_games.draft_state
-- writes — every applied pick (manual or auto-pick-on-timeout) does
-- `update ... where id = :id and draft_seq = :seq`, so a race between a
-- last-second manual pick and the timeout's auto-pick resolves to exactly
-- one winner: whichever UPDATE commits first advances the seq, and the
-- other's WHERE no longer matches. Same pattern as rooms' seat/ready claims.
alter table public.match_games add column draft_seq integer not null default 0;

alter publication supabase_realtime add table public.match_games;
