-- SecretSource persistence — document/blob model, matching backend/app/store.py.
--
-- The gateway reads and writes WHOLE analyses (one JSON document per run) plus a small
-- source-resolution cache. This mirrors store.py exactly, so swapping SQLite for Supabase
-- is a connection change, not a data-model change.
--
-- Supersedes the earlier normalized schema (analyses/claims/verdicts/…), which needed
-- Supabase Auth the backend doesn't have yet. Those empty dev tables are dropped below.
--
-- Access is server-only: the gateway connects with the service role (which bypasses RLS).
-- RLS is enabled with NO policies, so anon/authenticated browser clients get nothing.

-- ── Drop the normalized pipeline schema (empty dev tables) ──────────────────────
drop table if exists public.analysis_stages   cascade;
drop table if exists public.verdict_pages      cascade;
drop table if exists public.verdict_evidence   cascade;
drop table if exists public.verdicts           cascade;
drop table if exists public.unchecked_sources  cascade;
drop table if exists public.citations          cascade;
drop table if exists public.claims             cascade;
drop table if exists public.analyses           cascade;
drop function if exists public.set_updated_at() cascade;

-- ── Blob tables ────────────────────────────────────────────────────────────────
-- One row per analysis; the full result lives in `data`.
create table public.analyses (
  id       text primary key,
  started  timestamptz not null default now(),
  data     jsonb not null
);

-- Where a cited work's PDF was resolved, so a re-run doesn't re-hit a rate-limited API.
create table public.sources (
  key   text primary key,
  data  jsonb not null
);

create index analyses_started_idx on public.analyses (started);

-- ── Lock down to server-only (service role bypasses RLS) ─────────────────────────
alter table public.analyses enable row level security;
alter table public.sources  enable row level security;
