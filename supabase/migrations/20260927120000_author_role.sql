-- The Author role's own records (backend/app/store.py's *_author_row functions): projects
-- (a .bib plus the drafts written against it), drafts (their .tex/.bib files and version)
-- and saved sources (what "Find a source" bookmarked, and uploaded source PDFs).
-- owner is the Supabase user id, or null for rows made while login was off.
-- Draft checks are not here: they are analyses rows with kind "draft-check", like the
-- single-claim checks of SCRUM-236, so they share the SSE stream and restart recovery.
-- Server-only like the other tables: RLS on and no policies, so only the gateway's service
-- role can read or write them.
create table if not exists public.author_projects (
  id    text primary key,
  owner text,
  data  jsonb not null
);
create index if not exists author_projects_owner_idx on public.author_projects (owner);
alter table public.author_projects enable row level security;

create table if not exists public.author_drafts (
  id    text primary key,
  owner text,
  data  jsonb not null
);
create index if not exists author_drafts_owner_idx on public.author_drafts (owner);
alter table public.author_drafts enable row level security;

create table if not exists public.author_sources (
  id    text primary key,
  owner text,
  data  jsonb not null
);
create index if not exists author_sources_owner_idx on public.author_sources (owner);
alter table public.author_sources enable row level security;
