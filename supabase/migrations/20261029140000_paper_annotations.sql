-- Private reading annotations, keyed by the user's identity and exact PDF content hash.
-- The gateway uses the service role; browser clients receive no direct table access.
create table if not exists public.paper_annotations (
  owner      uuid not null references auth.users (id) on delete cascade,
  paper_hash text not null check (paper_hash ~ '^[0-9a-f]{64}$'),
  data       jsonb not null default '[]'::jsonb check (jsonb_typeof(data) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (owner, paper_hash)
);

alter table public.paper_annotations enable row level security;
