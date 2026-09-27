-- A generic result cache (backend/app/store.py's cache_key/remember_cache/recall_cache),
-- for a GROBID parse or an LLM call whose input has been seen before — separate from
-- `sources` (which caches where a cited work's PDF lives, not what was done with it).
-- Server-only like the other tables: RLS on and no policies, so only the gateway's service
-- role can read or write it.
create table if not exists public.cache (
  key   text primary key,
  data  jsonb not null
);

alter table public.cache enable row level security;
