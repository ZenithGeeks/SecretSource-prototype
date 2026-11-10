alter table public.teacher_feedback
  add column if not exists subject text not null default '';
