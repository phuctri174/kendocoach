-- Unfinished matches (status 'drafting' or 'in_progress') older than 1 day
-- are stale — abandoned rooms, disconnected players, closed tabs mid-draft —
-- and just sit there forever otherwise. Auto-purge them hourly.
--
-- match_games/draft_events/augment_offers/item_offers/match_spectators all
-- cascade from matches, so deleting the stale matches row is enough for
-- those. match_history has no cascading FK to matches (NO ACTION, same gap
-- that made the manual cleanup earlier this session order-sensitive), so it
-- is cleared first defensively — in practice a non-completed match should
-- never have a match_history row, since that table is only written at
-- series-completion time.
create extension if not exists pg_cron;

create or replace function public.cleanup_stale_matches()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.match_history
  where match_id in (
    select id from public.matches
    where status <> 'completed' and created_at < now() - interval '1 day'
  );

  delete from public.matches
  where status <> 'completed' and created_at < now() - interval '1 day';
end;
$$;

-- Re-running this migration (e.g. pasted twice into the SQL editor) must not
-- error on "job already exists" — drop any prior schedule of the same name
-- before recreating it.
select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-stale-matches';

select cron.schedule(
  'cleanup-stale-matches',
  '0 * * * *',
  $$select public.cleanup_stale_matches();$$
);
