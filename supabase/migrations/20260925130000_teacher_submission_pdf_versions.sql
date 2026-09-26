alter table public.teacher_submissions
  add column if not exists student_email text,
  add column if not exists analysis_file_id text,
  add column if not exists analysis_file_version text;
