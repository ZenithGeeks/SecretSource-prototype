-- The labeling page's rows (backend/app/labeling/): claims a person judged, passages they judged,
-- the 1-4 labels, and who labels which topic. Append-only: a later row for the same key
-- replaces an earlier one when the page reads them back (labeling/schema.py `current`), so
-- nobody overwrites anybody and the history stays. `data` holds the row as the page wrote it.
--
-- Server-only like the other tables: RLS enabled with NO policies; the gateway uses the
-- service role.

create table if not exists public.labeling_rows (
  id          bigint generated always as identity primary key,
  tab         text not null check (tab in ('claims', 'candidates', 'labels', 'assignments')),
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists labeling_rows_tab_idx on public.labeling_rows (tab, id);

alter table public.labeling_rows enable row level security;
