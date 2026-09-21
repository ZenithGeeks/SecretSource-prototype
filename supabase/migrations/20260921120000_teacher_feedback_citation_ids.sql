alter table public.teacher_feedback
  add column if not exists citation_ids text[] not null default '{}'::text[];
