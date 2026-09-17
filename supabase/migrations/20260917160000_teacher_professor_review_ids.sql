-- Teacher review controls are per EssayCheck citation card, not one value for a whole essay.
alter table public.teacher_professor_reviews
  add column if not exists review_id text not null default '';

alter table public.teacher_professor_reviews
  drop constraint if exists teacher_professor_reviews_owner_submission_id_key;

create unique index if not exists teacher_professor_reviews_owner_submission_review_idx
  on public.teacher_professor_reviews (owner, submission_id, review_id);
