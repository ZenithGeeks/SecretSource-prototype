-- #1027: load_memory asks for one owner's analyses that match a question, ranked by Postgres,
-- instead of reading that owner's whole history into the gateway.
-- `search` holds the paper title and every string inside the claims (claim text, cited work,
-- quote, reasoning, unchecked sources). backend/app/memory.py re-ranks the findings in the rows
-- this returns, so the column only has to find the right analyses.

alter table public.analyses
  add column if not exists search tsvector generated always as (
    to_tsvector('english', coalesce(data->>'title', ''))
    || jsonb_to_tsvector('english', coalesce(data->'claims', '[]'::jsonb), '["string"]')
  ) stored;

create index if not exists analyses_search_idx on public.analyses using gin (search);

-- owner_id null is the signed-out space: rows whose data has no owner, as store._supabase_owner.
-- websearch_to_tsquery never raises on user text, so the question can go in as typed.
create or replace function public.search_owned_analyses(owner_id text, query text, max_rows int)
returns table (started timestamptz, data jsonb)
language sql
stable
set search_path = public
as $$
  select a.started, a.data
  from public.analyses a
  where case when owner_id is null then a.data->>'owner' is null
             else a.data->>'owner' = owner_id end
    and a.search @@ websearch_to_tsquery('english', query)
  order by ts_rank(a.search, websearch_to_tsquery('english', query)) desc, a.started desc, a.id
  limit max_rows
$$;

-- Server-only, like the table: the anon and authenticated keys must not call it.
revoke execute on function public.search_owned_analyses(text, text, int) from public, anon, authenticated;
grant execute on function public.search_owned_analyses(text, text, int) to service_role;
