-- Classroom submission IDs are scoped to a coursework item, not globally to a teacher.
alter table public.teacher_professor_reviews
  drop constraint if exists teacher_professor_reviews_owner_submission_id_key;

drop index if exists public.teacher_professor_reviews_owner_submission_review_idx;

create unique index if not exists teacher_professor_reviews_owner_coursework_review_idx
  on public.teacher_professor_reviews (owner, course_id, coursework_id, submission_id, review_id);

alter table public.teacher_feedback
  drop constraint if exists teacher_feedback_owner_submission_id_key;

create unique index if not exists teacher_feedback_owner_coursework_submission_idx
  on public.teacher_feedback (owner, course_id, coursework_id, submission_id);
