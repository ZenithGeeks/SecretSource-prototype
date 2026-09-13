-- Researcher projects: which analysed papers a user grouped together (backend/app/store.py).
-- owner is the Supabase user id, or null for projects made while login was off.
-- Server-only like the other tables: RLS on and no policies, so only the gateway's service
-- role can read or write it.
create table if not exists public.projects (
  id    text primary key,
  owner text,
  data  jsonb not null
);

create index if not exists projects_owner_idx on public.projects (owner);

alter table public.projects enable row level security;
