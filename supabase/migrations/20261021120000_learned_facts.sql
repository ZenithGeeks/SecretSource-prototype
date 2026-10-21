-- What the assistant remembers about each signed-in user (SPEC.md, SCRUM-370).
-- The distill job writes rows. The gateway's /memories routes list and delete them
-- (backend/app/store.py: save_fact, load_facts, delete_fact, delete_facts).
-- subject_key is lower(trim(subject)), set by the gateway. The upsert's on_conflict needs a
-- plain unique constraint, and an expression index on lower(subject) is not one.
-- Server-only like the other tables: RLS on and no policies, so only the gateway's service
-- role can read or write it. The web app goes through /memories.
create table if not exists public.learned_facts (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('paper', 'concept', 'question')),
  subject     text not null,
  subject_key text not null,
  summary     text not null check (char_length(summary) <= 300),
  analysis_id text,
  session_id  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner, kind, subject_key)
);

alter table public.learned_facts enable row level security;
