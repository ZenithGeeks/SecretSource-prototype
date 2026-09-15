# SecretSource database (Supabase)

Optional Postgres persistence for the gateway. Project: `secretsource`
(`hecmskknxyssewgnflvy`).

## Model — document/blob, matching `backend/app/store.py`

The gateway reads and writes **whole analyses** (one JSON document per run) plus a small
source-resolution cache. Two tables:

| Table | Columns | Holds |
|-------|---------|-------|
| `analyses` | `id text pk`, `started timestamptz`, `data jsonb` | one analysis per row |
| `sources`  | `key text pk`, `data jsonb` | resolved cited-work lookups (cache) |

- **Server-only**: RLS enabled with **no policies**; the gateway connects with the **service
  role**, which bypasses RLS. Browsers get nothing.
- Mirrors `store.py` so switching SQLite → Supabase is a connection change, not a schema one.

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
schema. The REST API does not serve that schema, and `anon` / `authenticated` have no
access to it.

## Migrations

`supabase/migrations/` — apply via the Supabase SQL Editor, `supabase db push`, or the
Supabase MCP `apply_migration`. `20260909150239_blob_store.sql` creates the two tables
(idempotent: `create table if not exists`).
