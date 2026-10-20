# SecretSource database (Supabase)

Optional Postgres persistence for the gateway. Project: `secretsource`
(`hecmskknxyssewgnflvy`).

## Model — document/blob, matching `backend/app/store.py`

The gateway reads and writes **whole analyses** (one JSON document per run) plus a small
source-resolution cache and the researcher's projects. Three tables:

| Table | Columns | Holds |
|-------|---------|-------|
| `analyses` | `id text pk`, `started timestamptz`, `data jsonb` | one analysis per row |
| `sources`  | `key text pk`, `data jsonb` | resolved cited-work lookups (cache) |
| `projects` | `id text pk`, `owner text`, `data jsonb` | a user's grouping of analysed papers |
| `labeling_rows` | `id bigint identity pk`, `tab text`, `data jsonb`, `created_at` | the Labeler role's append-only rows: claims, passages and 1-4 labels judged by hand, and who labels which topic |
| `author_projects`, `author_drafts`, `author_sources` | `id text pk`, `owner text`, `data jsonb` | the Author role's projects (a `.bib` plus drafts), drafts (their `.tex`/`.bib` files) and saved sources |

- **Server-only**: RLS enabled with **no policies**; the gateway connects with the **service
  role**, which bypasses RLS. Browsers get nothing.
- Mirrors `store.py` so switching SQLite → Supabase is a connection change, not a schema one.
- `analyses` keeps `owner` and `status` inside the `data` blob. Expression indexes on
  `(data->>'owner', started)` and `(data->>'status', started)` let the gateway read one owner's
  rows, or the running ones, without loading the table. `projects` has a real `owner` column
  (nullable when login is off) and is queried by it — hence `projects_owner_idx`.

## Enable it

Set both in `backend/.env` (unset → SQLite, the default):

```
SUPABASE_URL=https://hecmskknxyssewgnflvy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Dashboard → Settings → API → service_role>
```

then `pip install -r backend/requirements.txt` (adds `supabase`).

## Agent sessions (optional)

The chat agents (`backend/cli.py`, the A2A server) can keep their sessions in the same
database, so a conversation continues after a restart. This uses a Postgres connection, not
the REST API:

```
SESSION_DB_URL=postgresql://postgres.hecmskknxyssewgnflvy:<database password>@<session pooler host>:5432/postgres
```

Take the URL from Dashboard → Connect → **Session pooler**. The direct connection host is
IPv6 only and does not work from Docker Desktop. `DIRECT_URL` is read too.

ADK creates its own tables (`sessions`, `events`, `app_states`, `user_states`,
`adk_internal_metadata`) on first use. `backend/app/sessions.py` puts them in the `adk`
schema. The REST API does not serve that schema, and the `20260914120000_adk_sessions.sql`
migration also revokes it from `anon` / `authenticated`, so browsers have no access to it even
if a table-level grant slips in.

## Migrations

`supabase/migrations/` — apply via the Supabase SQL Editor, `supabase db push`, or the
Supabase MCP `apply_migration`. All are idempotent (`create ... if not exists`), so applying
them again is safe. In order:

- `20260909150239_blob_store.sql` — `analyses` + `sources`.
- `20260913160000_researcher_projects.sql` — `projects` (+ `projects_owner_idx`).
- `20260927120000_author_role.sql` — `author_projects`, `author_drafts`, `author_sources` (+ owner indexes).
- `20261012160000_labeling_rows.sql` — `labeling_rows`, the Labeler role's rows (+ a `(tab, id)` index).
- `20261020150000_labeling_rows_reviews_tab.sql` — lets `labeling_rows` keep the `reviews` tab, the labeler's AI reviews.
- `20261019120000_analyses_owner_status_idx.sql` — expression indexes so one owner's analyses,
  and the running ones, can be read without scanning `analyses`.
- `20260914120000_adk_sessions.sql` — the `adk` schema for chat sessions, locked away from the
  browser roles (ADK creates its own tables inside it at runtime).
