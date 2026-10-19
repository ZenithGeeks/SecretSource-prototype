-- #314: read one owner's analyses, or the running ones, without a scan of every row.
-- owner and status stay inside the data blob (the gateway still writes the whole document).
-- The expressions match the filters in backend/app/store.py.

create index if not exists analyses_owner_started_idx
  on public.analyses ((data->>'owner'), started);

create index if not exists analyses_status_started_idx
  on public.analyses ((data->>'status'), started);
