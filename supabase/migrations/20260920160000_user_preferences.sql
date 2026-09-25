-- Account settings: one JSON patch per user (backend/app/store.py's save_preferences/load_preferences).
-- owner is the Supabase user id, or "" for the shared space used while login is off (a plain
-- text key here instead of null, so the upsert's ON CONFLICT has something to match on).
-- Server-only like the other tables: RLS on and no policies, so only the gateway's service
-- role can read or write it.
create table if not exists public.preferences (
  owner text primary key,
  data  jsonb not null
);

alter table public.preferences enable row level security;
