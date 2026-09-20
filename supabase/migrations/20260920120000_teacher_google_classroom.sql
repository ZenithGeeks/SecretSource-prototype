-- Server-only Teacher Google OAuth state and connection. RLS has no browser policies.
create table if not exists public.teacher_google_connections (
  owner text primary key, google_subject text not null, google_email text,
  refresh_token_ciphertext text not null, updated_at timestamptz not null default now()
);
create table if not exists public.teacher_google_oauth_states (
  id uuid primary key default gen_random_uuid(), owner text not null, state_hash text not null unique,
  verifier text not null, expires_at timestamptz not null, used_at timestamptz
);
create index if not exists teacher_google_oauth_states_expiry_idx on public.teacher_google_oauth_states(expires_at);
alter table public.teacher_google_connections enable row level security;
alter table public.teacher_google_oauth_states enable row level security;
