"""Analyses and resolved sources that stay after a restart.

Two backends behind one API: SQLite for local runs and tests (the default), or Supabase
Postgres when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. Both keep one row per
analysis with the result as JSON. The gateway reads and writes whole analyses, never
parts of them. So switching backends changes the storage calls here and nothing above.
"""

import hashlib
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


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
        _db_path = path
    return _db


@contextmanager
def _sqlite():
    """The open connection, held by this thread until the block ends."""
    with _lock:
        yield _connect()


# Public API.
def save(analysis: dict) -> None:
    if _use_supabase():
        _supabase().table("analyses").upsert(
            {"id": analysis["id"], "data": analysis}
        ).execute()
        return
    with _sqlite() as database:
        database.execute(
            "INSERT INTO analyses (id, data) VALUES (?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (analysis["id"], json.dumps(analysis)),
        )
        database.commit()


def load_all() -> dict[str, dict]:
    """Every stored analysis, oldest first, keyed by id."""
    if _use_supabase():
        rows = _supabase().table("analyses").select("data").order("started").execute().data
        analyses = [row["data"] for row in rows]
        return {analysis["id"]: analysis for analysis in analyses}
    with _sqlite() as database:
        rows = database.execute("SELECT data FROM analyses ORDER BY started").fetchall()
    analyses = [json.loads(row["data"]) for row in rows]
    return {analysis["id"]: analysis for analysis in analyses}


def delete(analysis_id: str) -> bool:
    if _use_supabase():
        deleted = _supabase().table("analyses").delete().eq("id", analysis_id).execute().data
        return bool(deleted)
    with _sqlite() as database:
        deleted = database.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,)).rowcount
        database.commit()
    return bool(deleted)


def remember_source(key: str, resolution: dict) -> None:
    """Where a cited work's PDF lives, so a re-run does not ask a rate-limited API again."""
    if _use_supabase():
        _supabase().table("sources").upsert({"key": key, "data": resolution}).execute()
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
        rows = _supabase().table("sources").select("data").eq("key", key).limit(1).execute().data
        return rows[0]["data"] if rows else None
    with _sqlite() as database:
        row = database.execute("SELECT data FROM sources WHERE key = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None


def cache_key(*parts: str) -> str:
    """One deterministic key from several strings (a namespace, the model id, the input), so a
    changed model or GROBID endpoint never reads another combination's cached answer."""
    return hashlib.sha256("\x00".join(parts).encode()).hexdigest()


def remember_cache(key: str, data: dict) -> None:
    """A GROBID parse or an LLM call's result, so the identical input never repeats the call.
    Same key/data-blob shape as `sources`, in its own table since these come from a different
    part of the pipeline (app/pipeline/claims.py, app/pipeline/verify.py) and never mix."""
    if _use_supabase():
        _supabase().table("cache").upsert({"key": key, "data": data}).execute()
        return
    with _sqlite() as database:
        database.execute(
            "INSERT INTO cache (key, data) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET data = excluded.data",
            (key, json.dumps(data)),
        )
        database.commit()


def recall_cache(key: str) -> dict | None:
    if _use_supabase():
        rows = _supabase().table("cache").select("data").eq("key", key).limit(1).execute().data
        return rows[0]["data"] if rows else None
    with _sqlite() as database:
        row = database.execute("SELECT data FROM cache WHERE key = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None


def save_project(project: dict) -> None:
    """A researcher's project: its name and the analyses in it. `owner` is the user id, or
    None when login is off."""
    if _use_supabase():
        _supabase().table("projects").upsert(
            {"id": project["id"], "owner": project.get("owner"), "data": project}
        ).execute()
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
        return [row["data"] for row in query.execute().data]
    with _sqlite() as database:
        rows = database.execute(
            "SELECT data FROM projects WHERE owner IS ?", (owner,)
        ).fetchall()
    return [json.loads(row["data"]) for row in rows]


def delete_projects(owner: str | None) -> None:
    """Every project of one owner, for account-level "delete all" (#194's fix elsewhere reuses
    this for researcher; writer/teacher have no projects, so this is a no-op for them)."""
    if _use_supabase():
        query = _supabase().table("projects").delete()
        query = query.is_("owner", "null") if owner is None else query.eq("owner", owner)
        query.execute()
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
        _supabase().table("preferences").upsert({"owner": key, "data": data}).execute()
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
        rows = _supabase().table("preferences").select("data").eq("owner", key).limit(1).execute().data
        return rows[0]["data"] if rows else None
    with _sqlite() as database:
        row = database.execute("SELECT data FROM preferences WHERE owner = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None

