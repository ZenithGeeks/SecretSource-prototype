-- Lets the labeling page read the rows of one paper without scanning its whole tab
-- (backend/app/labeling/ledger.py `read(tab, paper_id)` filters on data->>'paper_id').
-- Only an index: no column or row changes. `assignments` rows have no paper_id and index as null.

create index if not exists labeling_rows_tab_paper_idx
  on public.labeling_rows (tab, (data->>'paper_id'), id);
