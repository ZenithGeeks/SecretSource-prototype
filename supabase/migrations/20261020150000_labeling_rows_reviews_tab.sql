-- The labeler's AI reviews (backend/app/labeling/review.py) are kept in labeling_rows under the
-- tab 'reviews' (labeling/schema.py REVIEWS). The first migration's check allowed only the four
-- label tabs, so every review failed when it saved (#636). Idempotent: drop and re-add the check.

alter table public.labeling_rows drop constraint if exists labeling_rows_tab_check;

alter table public.labeling_rows
  add constraint labeling_rows_tab_check
  check (tab in ('claims', 'candidates', 'labels', 'assignments', 'reviews'));
