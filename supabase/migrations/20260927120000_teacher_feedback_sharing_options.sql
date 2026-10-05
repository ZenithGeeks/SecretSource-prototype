alter table public.teacher_feedback
  add column if not exists sharing_options jsonb not null default '{}'::jsonb;
