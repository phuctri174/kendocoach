-- Switches account creation from email+password to username+password.
-- Supabase Auth is still email-based under the hood — the app derives a
-- synthetic, never-shown email from the username (see
-- src/lib/auth/username.ts) and stores the real handle here.
--
-- `username_lower` is a generated column so uniqueness/lookup queries are a
-- plain `.eq()` against it, with no LIKE-escaping foot-guns from `_` (a valid
-- username character that's also a SQL LIKE wildcard).

alter table public.profiles add column username text;
alter table public.profiles add column username_lower text generated always as (lower(username)) stored;

create unique index profiles_username_lower_idx
  on public.profiles (username_lower)
  where username_lower is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, username, is_guest)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'username',
      'Khách ' || substr(new.id::text, 1, 4)
    ),
    new.raw_user_meta_data ->> 'username',
    coalesce(new.is_anonymous, false)
  );
  return new;
end;
$$;
