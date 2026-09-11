-- SecretSource persistence — document/blob model, matching backend/app/store.py.
--
-- The gateway reads and writes WHOLE analyses (one JSON document per run) plus a small
-- source-resolution cache. This mirrors store.py exactly, so swapping SQLite for Supabase
-- is a connection change, not a data-model change.
--
-- Access is server-only: the gateway connects with the service role (which bypasses RLS).
-- RLS is enabled with NO policies, so anon/authenticated browser clients get nothing.

create table if not exists public.analyses (
  id       text primary key,
  started  timestamptz not null default now(),
  data     jsonb not null
);

create table if not exists public.sources (
  key   text primary key,
  data  jsonb not null
);

create index if not exists analyses_started_idx on public.analyses (started);

alter table public.analyses enable row level security;
alter table public.sources  enable row level security;
