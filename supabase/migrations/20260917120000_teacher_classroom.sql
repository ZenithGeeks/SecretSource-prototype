-- Teacher Google Classroom snapshots and server-side OAuth state.
--
-- These tables are deliberately server-only. The gateway uses the Supabase service role,
-- which bypasses RLS; browser clients receive no policy and therefore cannot read or write
-- Classroom data, OAuth state, or the encrypted refresh-token ciphertext.

create table if not exists public.teacher_google_connections (
  owner                     text primary key,
  google_subject            text not null,
  google_email              text,
  refresh_token_ciphertext  text not null,
  scopes                    text[] not null default '{}'::text[],
  access_token_expires_at   timestamptz,
  connected_at              timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  last_synced_at            timestamptz,
  last_sync_status          text,
  last_sync_error           text
);

create index if not exists teacher_google_connections_subject_idx
  on public.teacher_google_connections (google_subject);

create table if not exists public.teacher_google_oauth_states (
  id             uuid primary key default gen_random_uuid(),
  owner          text not null,
  state_hash     text not null unique,
  code_verifier  text not null,
  redirect_uri   text not null,
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists teacher_google_oauth_states_owner_idx
  on public.teacher_google_oauth_states (owner);
create index if not exists teacher_google_oauth_states_expires_idx
  on public.teacher_google_oauth_states (expires_at);
create index if not exists teacher_google_oauth_states_cleanup_idx
  on public.teacher_google_oauth_states (consumed_at, expires_at);

create table if not exists public.teacher_courses (
  id             uuid primary key default gen_random_uuid(),
  owner          text not null,
  course_id      text not null,
  name           text not null default '',
  section        text,
  description    text,
  room           text,
  course_state   text,
  raw            jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (owner, course_id)
);

create index if not exists teacher_courses_owner_idx
  on public.teacher_courses (owner);
create index if not exists teacher_courses_owner_course_idx
  on public.teacher_courses (owner, course_id);

create table if not exists public.teacher_coursework (
  id              uuid primary key default gen_random_uuid(),
  owner           text not null,
  course_id       text not null,
  coursework_id   text not null,
  resource_type   text not null,
  title           text,
  description     text,
  state           text,
  due_at          timestamptz,
  raw             jsonb not null default '{}'::jsonb,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner, course_id, coursework_id)
);

create index if not exists teacher_coursework_owner_idx
  on public.teacher_coursework (owner);
create index if not exists teacher_coursework_owner_course_idx
  on public.teacher_coursework (owner, course_id);
create index if not exists teacher_coursework_owner_resource_idx
  on public.teacher_coursework (owner, coursework_id);

create table if not exists public.teacher_submissions (
  id              uuid primary key default gen_random_uuid(),
  owner           text not null,
  course_id       text not null,
  coursework_id   text not null,
  submission_id   text not null,
  student_id      text not null,
  student_name    text,
  state           text,
  assigned_grade  numeric,
  attachments     jsonb not null default '[]'::jsonb,
  sync_state      text not null default 'synced',
  sync_error      text,
  analysis_id     text,
  raw             jsonb not null default '{}'::jsonb,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner, course_id, coursework_id, submission_id)
);

create index if not exists teacher_submissions_owner_idx
  on public.teacher_submissions (owner);
create index if not exists teacher_submissions_owner_course_idx
  on public.teacher_submissions (owner, course_id);
create index if not exists teacher_submissions_owner_coursework_student_idx
  on public.teacher_submissions (owner, coursework_id, student_id);

create table if not exists public.teacher_professor_reviews (
  id              uuid primary key default gen_random_uuid(),
  owner           text not null,
  course_id       text not null,
  coursework_id   text not null,
  submission_id   text not null,
  student_id      text not null,
  analysis_id     text,
  verdict         text not null,
  reasoning       text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner, submission_id)
);

create index if not exists teacher_professor_reviews_owner_idx
  on public.teacher_professor_reviews (owner);
create index if not exists teacher_professor_reviews_owner_coursework_idx
  on public.teacher_professor_reviews (owner, coursework_id);

create table if not exists public.teacher_feedback (
  id              uuid primary key default gen_random_uuid(),
  owner           text not null,
  course_id       text not null,
  coursework_id   text not null,
  submission_id   text not null,
  student_id      text not null,
  feedback_text   text not null default '',
  status          text not null default 'draft',
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner, submission_id)
);

create index if not exists teacher_feedback_owner_idx
  on public.teacher_feedback (owner);
create index if not exists teacher_feedback_owner_coursework_idx
  on public.teacher_feedback (owner, coursework_id);

alter table public.teacher_google_connections enable row level security;
alter table public.teacher_google_oauth_states enable row level security;
alter table public.teacher_courses enable row level security;
alter table public.teacher_coursework enable row level security;
alter table public.teacher_submissions enable row level security;
alter table public.teacher_professor_reviews enable row level security;
alter table public.teacher_feedback enable row level security;
