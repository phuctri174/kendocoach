-- Lobby and match-start rely on postgres_changes subscriptions (rooms filling
-- up, a match row appearing once both players ready). Tables aren't live over
-- Realtime until added to the publication explicitly.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.matches;
