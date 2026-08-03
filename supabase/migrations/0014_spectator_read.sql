-- Spectator mode: anyone with the match link can watch, no account or room
-- seat required.
--
-- This only ever widens SELECT on matches/match_games to "anyone" — the
-- exact same columns the two real players already read, under the exact
-- same reveal timing. Nothing in match_games is ever populated before its
-- normal reveal moment regardless of who's reading it: the private staging
-- always lives in augment_offers/item_offers, both locked to
-- `player = auth.uid()` (see 0005_augments.sql / 0006_items.sql) and
-- deliberately untouched here — a spectator's auth.uid() is null, so those
-- policies already correctly return nothing, same as any non-participant.
-- Multiple permissive SELECT policies on one table combine with OR, so the
-- existing "participants can read their match(es)" policies stay exactly as
-- they are; this just adds a second, broader one alongside them.
create policy "anyone can read any match"
  on public.matches for select
  using (true);

create policy "anyone can read any match's games"
  on public.match_games for select
  using (true);

-- match_games was never added to the realtime publication (only rooms and
-- matches were, in 0003_realtime.sql) — its postgres_changes subscription in
-- tran/[matchId]/page.tsx has always been a silent no-op, with the app
-- working purely off the broadcast channel each route sends after writing.
-- That's fine for the two real players, who also get their own action's
-- result directly in their fetch response as a second fallback — but a
-- spectator has neither of those, only the shared subscriptions, so the
-- postgres_changes path actually mattering now is new. Fixing it here.
alter publication supabase_realtime add table public.match_games;
