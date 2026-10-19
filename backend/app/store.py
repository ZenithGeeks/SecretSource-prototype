"""Analyses and resolved sources that stay after a restart.

Two backends behind one API: SQLite for local runs and tests (the default), or Supabase
Postgres when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. Both keep one row per
analysis with the result as JSON. The gateway reads and writes whole analyses, never
parts of them. So switching backends changes the storage calls here and nothing above.
"""

import hashlib
import json
import logging
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger(__name__)


# Backend selection.
# Read at call time, not import: tests set the environment before the first use.
def _use_supabase() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


# Supabase. Blob tables: analyses(id, started, data), sources(key, data).
_client = None


def _supabase():
    """The Supabase client, created once. Uses the service role, which skips RLS:
    these tables are server-only and have no policies."""
    global _client
    if _client is None:
        from supabase import create_client

        _client = create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        )
    return _client


def _execute_with_retry(query):
    """Run a Supabase query, and once more if the server dropped the connection.

    The client keeps one HTTP/2 connection for every thread. When Supabase closes it, the
    next request fails with httpx.RemoteProtocolError("Server disconnected"), and asking
    again opens a new one. Every query here is a select, an upsert or a delete, so running
    it twice leaves the same rows. A delete whose first answer was lost answers "no rows" the
    second time, so delete() can say False for a row it did remove.
    """
    import httpx

    try:
        return query.execute()
    except httpx.RemoteProtocolError:
        return query.execute()


# SQLite.
SCHEMA = """
CREATE TABLE IF NOT EXISTS analyses (
    id      TEXT PRIMARY KEY,
    started TEXT DEFAULT CURRENT_TIMESTAMP,
    data    TEXT NOT NULL
)
"""

SOURCES_SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    key  TEXT PRIMARY KEY,
    data TEXT NOT NULL
)
"""

CACHE_SCHEMA = """
CREATE TABLE IF NOT EXISTS cache (
    key  TEXT PRIMARY KEY,
    data TEXT NOT NULL
)
"""

PROJECTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id    TEXT PRIMARY KEY,
    owner TEXT,
    data  TEXT NOT NULL
)
"""

# One row per user (owner "" when login is off, the same shared space analyses/projects use
# for their own NULL — a plain TEXT key here instead, see _pref_key below).
# The Author role's own records (backend/app/author/). One blob row per project, draft,
# saved source; every row carries its owner so a user only ever sees their own. Draft checks
# live in `analyses` with kind "draft-check" (the discriminator that
# once told them from single-claim checks), so they get the SSE stream, restart recovery and
# delete-all for free.
AUTHOR_TABLES = ("author_projects", "author_drafts", "author_sources")

AUTHOR_SCHEMA = """
CREATE TABLE IF NOT EXISTS {table} (
    id    TEXT PRIMARY KEY,
    owner TEXT,
    data  TEXT NOT NULL
)
"""

PREFERENCES_SCHEMA = """
CREATE TABLE IF NOT EXISTS preferences (
    owner TEXT PRIMARY KEY,
    data  TEXT NOT NULL
)
"""

_db: sqlite3.Connection | None = None
_db_path: str | None = None
# One connection for the whole process, used by one thread at a time. check_same_thread=False
# only turns off Python's check: parallel checks reading the source cache while a run saves used
# it at once and failed with "bad parameter or other API misuse", or crashed the process (#184).
_lock = threading.RLock()


def _connect() -> sqlite3.Connection:
    """The open connection. Reopens it if ANALYSES_DB changed since last time."""
    global _db, _db_path

    path = os.getenv("ANALYSES_DB", "data/analyses.db")
    if _db is None or path != _db_path:
        if _db is not None:
            _db.close()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(path, check_same_thread=False)
        _db.row_factory = sqlite3.Row
        _db.execute(SCHEMA)
        _db.execute(SOURCES_SCHEMA)
        _db.execute(CACHE_SCHEMA)
        _db.execute(PROJECTS_SCHEMA)
        _db.execute(PREFERENCES_SCHEMA)
        for table in AUTHOR_TABLES:
            _db.execute(AUTHOR_SCHEMA.format(table=table))
        # One owner's rows, and the running ones, without a scan of every JSON blob (#314).
        # The expressions match the WHERE clauses in load_owned and load_running.
        _db.execute(
            "CREATE INDEX IF NOT EXISTS analyses_owner_started_idx "
            "ON analyses (json_extract(data, '$.owner'), started)"
        )
        _db.execute(
            "CREATE INDEX IF NOT EXISTS analyses_status_started_idx "
            "ON analyses (json_extract(data, '$.status'), started)"
        )
        _db_path = path
    return _db


@contextmanager
def _sqlite():
    """The open connection, held by this thread until the block ends."""
    with _lock:
        yield _connect()


# Public API.
def _analysis_from_row(row) -> dict:
    """One stored analysis. `started` is filled from the column when the JSON has none, the same
    way load_all has always done, so a row read on its own matches one read with the others."""
    data = row["data"]
    analysis = data if isinstance(data, dict) else json.loads(data)
    if "started" in row.keys() and row["started"] is not None:
        analysis.setdefault("started", row["started"])
    return analysis


def _sqlite_analyses(
    where: str, params: tuple = (), *, order: str = "started", limit: int | None = None
) -> list[dict]:
    sql = f"SELECT started, data FROM analyses WHERE {where} ORDER BY {order}"
    if limit is not None:
        sql += " LIMIT ?"
        params = (*params, limit)
    with _sqlite() as database:
        rows = database.execute(sql, params).fetchall()
    return [_analysis_from_row(row) for row in rows]


# PostgREST returns at most this many rows per request. A longer result is read in pages.
_SUPABASE_PAGE = 1000


def _supabase_collect(apply) -> list:
    """Every row of one analyses query. `apply` adds the filters to a fresh builder, because a
    builder cannot be executed twice."""
    start = 0
    rows: list = []
    while True:
        query = apply(_supabase().table("analyses").select("started,data"))
        batch = _execute_with_retry(query.range(start, start + _SUPABASE_PAGE - 1)).data or []
        rows.extend(batch)
        if len(batch) < _SUPABASE_PAGE:
            return rows
        start += _SUPABASE_PAGE


def _supabase_owner(query, owner: str | None):
    """`owner` is inside the JSON. None is the signed-out space, a JSON null, not the empty string."""
    if owner is None:
        return query.is_("data->>owner", "null")
    return query.eq("data->>owner", owner)


def save(analysis: dict) -> None:
    if _use_supabase():
        _execute_with_retry(_supabase().table("analyses").upsert(
            {"id": analysis["id"], "data": analysis}
        ))
        return
    with _sqlite() as database:
        database.execute(
            "INSERT INTO analyses (id, data) VALUES (?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (analysis["id"], json.dumps(analysis)),
        )
        database.commit()


def load(analysis_id: str) -> dict | None:
    """One stored analysis, or None if there is no such row."""
    if _use_supabase():
        rows = _execute_with_retry(
            _supabase().table("analyses").select("started,data").eq("id", analysis_id)
        ).data
        return _analysis_from_row(rows[0]) if rows else None
    with _sqlite() as database:
        row = database.execute(
            "SELECT started, data FROM analyses WHERE id = ?", (analysis_id,)
        ).fetchone()
    return _analysis_from_row(row) if row else None


def load_owned(owner: str | None) -> list[dict]:
    """This owner's analyses, oldest first. None is the signed-out space. Other owners' rows
    are not read: the gateway asks per user instead of scanning the table (#314)."""
    if _use_supabase():
        def apply(query):
            return _supabase_owner(query, owner).order("started")

        return [_analysis_from_row(row) for row in _supabase_collect(apply)]
    if owner is None:
        return _sqlite_analyses("json_extract(data, '$.owner') IS NULL")
    return _sqlite_analyses("json_extract(data, '$.owner') = ?", (owner,))


def load_running() -> list[dict]:
    """Analyses still marked running, oldest first. A restart only needs these to recover jobs."""
    if _use_supabase():
        def apply(query):
            return query.eq("data->>status", "running").order("started")

        return [_analysis_from_row(row) for row in _supabase_collect(apply)]
    return _sqlite_analyses("json_extract(data, '$.status') = ?", ("running",))


def load_recent(limit: int) -> list[dict]:
    """The newest `limit` analyses, oldest first within that window. `limit` <= 0 reads none."""
    if limit <= 0:
        return []
    if _use_supabase():
        rows = _execute_with_retry(
            _supabase().table("analyses").select("started,data").order("started", desc=True).limit(limit)
        ).data or []
        return [_analysis_from_row(row) for row in reversed(rows)]
    with _sqlite() as database:
        rows = database.execute(
            "SELECT started, data FROM analyses ORDER BY started DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_analysis_from_row(row) for row in reversed(rows)]


def load_startup(recent: int) -> dict[str, dict]:
    """What the gateway holds after a restart: every running analysis, plus the newest `recent`
    rows. Oldest first. A live job older than that window is included too. Everything else
    stays in the store until its owner asks (load_owned)."""
    found = {row["id"]: row for row in load_recent(recent)}
    for row in load_running():
        found.setdefault(row["id"], row)
    return found


def load_readable(owner: str) -> list[dict]:
    """Analyses the chat memory may read: those with no owner, and `owner`'s when that is set.
    Oldest first. Anyone else's rows are not loaded."""
    rows = load_owned(None)
    if owner:
        rows.extend(load_owned(owner))
        rows.sort(key=lambda row: (row.get("started") or "", row.get("id") or ""))
    return rows


def load_all() -> dict[str, dict]:
    """Every stored analysis, oldest first, keyed by id.

    Startup does not use this (#314): it reads the whole table. Kept for one-off maintenance
    (app/backfill_titles.py) and for tests that still want every row."""
    if _use_supabase():
        def apply(query):
            return query.order("started")

        analyses = [_analysis_from_row(row) for row in _supabase_collect(apply)]
        return {analysis["id"]: analysis for analysis in analyses}
    analyses = _sqlite_analyses("1 = 1")
    return {analysis["id"]: analysis for analysis in analyses}


def delete(analysis_id: str) -> bool:
    if _use_supabase():
        deleted = _execute_with_retry(_supabase().table("analyses").delete().eq("id", analysis_id)).data
        return bool(deleted)
    with _sqlite() as database:
        deleted = database.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,)).rowcount
        database.commit()
    return bool(deleted)


def remember_source(key: str, resolution: dict) -> None:
    """Where a cited work's PDF lives, so a re-run does not ask a rate-limited API again."""
    if _use_supabase():
        _execute_with_retry(_supabase().table("sources").upsert({"key": key, "data": resolution}))
        return
    with _sqlite() as database:
        database.execute(
            "INSERT INTO sources (key, data) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET data = excluded.data",
            (key, json.dumps(resolution)),
        )
        database.commit()


def recall_source(key: str) -> dict | None:
    if _use_supabase():
        rows = _execute_with_retry(_supabase().table("sources").select("data").eq("key", key).limit(1)).data
        return rows[0]["data"] if rows else None
    with _sqlite() as database:
        row = database.execute("SELECT data FROM sources WHERE key = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None


def forget_source(key: str) -> None:
    """Drop a cited work's cached location, so the next run looks it up again."""
    if _use_supabase():
        _execute_with_retry(_supabase().table("sources").delete().eq("key", key))
        return
    with _sqlite() as database:
        database.execute("DELETE FROM sources WHERE key = ?", (key,))
        database.commit()


def cache_key(*parts: str) -> str:
    """One deterministic key from several strings (a namespace, the model id, the input), so a
    changed model or GROBID endpoint never reads another combination's cached answer."""
    return hashlib.sha256("\x00".join(parts).encode()).hexdigest()


def remember_cache(key: str, data: dict) -> None:
    """A GROBID parse or an LLM call's result, so the identical input never repeats the call.
    Same key/data-blob shape as `sources`, in its own table since these come from a different
    part of the pipeline (app/pipeline/claims.py, app/pipeline/verify.py) and never mix.

    A failed write is logged and skipped: the result is still returned to the caller, and the
    next run only repeats the call.
    """
    if _use_supabase():
        import httpx

        try:
            _execute_with_retry(_supabase().table("cache").upsert({"key": key, "data": data}))
        except httpx.TransportError as error:
            logger.warning("cache write for %s failed: %r", key[:12], error)
        return
    with _sqlite() as database:
        database.execute(
            "INSERT INTO cache (key, data) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET data = excluded.data",
            (key, json.dumps(data)),
        )
        database.commit()


def recall_cache(key: str) -> dict | None:
    """The cached result for `key`, or None. A failed read counts as a miss, so a dropped
    connection costs one repeated call instead of the whole analysis."""
    if _use_supabase():
        import httpx

        try:
            rows = _execute_with_retry(_supabase().table("cache").select("data").eq("key", key).limit(1)).data
        except httpx.TransportError as error:
            logger.warning("cache read for %s failed, treating it as a miss: %r", key[:12], error)
            return None
        return rows[0]["data"] if rows else None
    with _sqlite() as database:
        row = database.execute("SELECT data FROM cache WHERE key = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None


def save_project(project: dict) -> None:
    """A researcher's project: its name and the analyses in it. `owner` is the user id, or
    None when login is off."""
    if _use_supabase():
        _execute_with_retry(_supabase().table("projects").upsert(
            {"id": project["id"], "owner": project.get("owner"), "data": project}
        ))
        return
    with _sqlite() as database:
        database.execute(
            "INSERT INTO projects (id, owner, data) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, data = excluded.data",
            (project["id"], project.get("owner"), json.dumps(project)),
        )
        database.commit()


def load_projects(owner: str | None) -> list[dict]:
    """Every project of one owner. None means the projects made while login was off."""
    if _use_supabase():
        query = _supabase().table("projects").select("data")
        query = query.is_("owner", "null") if owner is None else query.eq("owner", owner)
        return [row["data"] for row in _execute_with_retry(query).data]
    with _sqlite() as database:
        rows = database.execute(
            "SELECT data FROM projects WHERE owner IS ?", (owner,)
        ).fetchall()
    return [json.loads(row["data"]) for row in rows]


def delete_project(project_id: str) -> None:
    """One project, by id. The caller checks ownership first (main.py's _project()), so this
    never takes an owner — same split as analyses' _delete_one() vs. delete_projects() below."""
    if _use_supabase():
        _execute_with_retry(_supabase().table("projects").delete().eq("id", project_id))
        return
    with _sqlite() as database:
        database.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        database.commit()


def delete_projects(owner: str | None) -> None:
    """Every project of one owner, for account-level "delete all" (#194's fix elsewhere reuses
    this for researcher; writer/teacher have no projects, so this is a no-op for them)."""
    if _use_supabase():
        query = _supabase().table("projects").delete()
        query = query.is_("owner", "null") if owner is None else query.eq("owner", owner)
        _execute_with_retry(query)
        return
    with _sqlite() as database:
        database.execute("DELETE FROM projects WHERE owner IS ?", (owner,))
        database.commit()


# Account preferences: one JSON blob per user (owner "" when login is off — a plain TEXT key
# side-steps SQL's "every NULL is distinct" rule, which would break the upsert below).
def _pref_key(owner: str | None) -> str:
    return owner or ""


def save_preferences(owner: str | None, data: dict) -> None:
    key = _pref_key(owner)
    if _use_supabase():
        _execute_with_retry(_supabase().table("preferences").upsert({"owner": key, "data": data}))
        return
    with _sqlite() as database:
        database.execute(
            "INSERT INTO preferences (owner, data) VALUES (?, ?) "
            "ON CONFLICT(owner) DO UPDATE SET data = excluded.data",
            (key, json.dumps(data)),
        )
        database.commit()


def load_preferences(owner: str | None) -> dict | None:
    key = _pref_key(owner)
    if _use_supabase():
        query = _supabase().table("preferences").select("data").eq("owner", key).limit(1)
        rows = _execute_with_retry(query).data
        return rows[0]["data"] if rows else None
    with _sqlite() as database:
        row = database.execute("SELECT data FROM preferences WHERE owner = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None


# --- the Author role's rows: projects, drafts and saved sources, one JSON blob each ---


def _author_table(table: str) -> str:
    if table not in AUTHOR_TABLES:
        raise ValueError(f"not an author table: {table}")
    return table


def save_author_row(table: str, row: dict) -> None:
    """Insert or replace one project, draft or source. `owner` is the user id, or None when
    login is off."""
    table = _author_table(table)
    if _use_supabase():
        _execute_with_retry(_supabase().table(table).upsert(
            {"id": row["id"], "owner": row.get("owner"), "data": row}
        ))
        return
    with _sqlite() as database:
        database.execute(
            f"INSERT INTO {table} (id, owner, data) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, data = excluded.data",
            (row["id"], row.get("owner"), json.dumps(row)),
        )
        database.commit()


def load_author_rows(table: str, owner: str | None) -> list[dict]:
    """Every row of one owner, in insertion order. None means the rows made while login was off."""
    table = _author_table(table)
    if _use_supabase():
        query = _supabase().table(table).select("data")
        query = query.is_("owner", "null") if owner is None else query.eq("owner", owner)
        return [row["data"] for row in _execute_with_retry(query).data]
    with _sqlite() as database:
        rows = database.execute(
            f"SELECT data FROM {table} WHERE owner IS ? ORDER BY rowid", (owner,)
        ).fetchall()
    return [json.loads(row["data"]) for row in rows]


def load_author_row(table: str, row_id: str) -> dict | None:
    """One row by id, whoever owns it: the caller checks the owner (a 404 either way)."""
    table = _author_table(table)
    if _use_supabase():
        rows = _execute_with_retry(_supabase().table(table).select("data").eq("id", row_id).limit(1)).data
        return rows[0]["data"] if rows else None
    with _sqlite() as database:
        row = database.execute(f"SELECT data FROM {table} WHERE id = ?", (row_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def delete_author_row(table: str, row_id: str) -> bool:
    table = _author_table(table)
    if _use_supabase():
        deleted = _execute_with_retry(_supabase().table(table).delete().eq("id", row_id)).data
        return bool(deleted)
    with _sqlite() as database:
        deleted = database.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,)).rowcount
        database.commit()
    return bool(deleted)


def delete_author_rows(owner: str | None) -> None:
    """Every author row of one owner, for Settings → Your data → Delete all."""
    for table in AUTHOR_TABLES:
        if _use_supabase():
            query = _supabase().table(table).delete()
            query = query.is_("owner", "null") if owner is None else query.eq("owner", owner)
            _execute_with_retry(query)
            continue
        with _sqlite() as database:
            database.execute(f"DELETE FROM {table} WHERE owner IS ?", (owner,))
            database.commit()
