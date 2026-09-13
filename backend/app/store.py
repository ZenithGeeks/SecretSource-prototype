"""Analyses and resolved sources that outlive a restart.

Two backends behind one API: SQLite for local runs and tests (the default), or Supabase
Postgres when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. Both keep one row per
analysis with the result as JSON — the gateway reads and writes whole analyses, never
parts of them, so switching backends changes the storage calls here and nothing above.
"""

import json
import os
import sqlite3
from pathlib import Path


# Backend selection.
# Read at call time, not import: tests set the environment before the first use.
def _use_supabase() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


# Supabase. Blob tables: analyses(id, started, data), sources(key, data).
_client = None


def _supabase():
    """The Supabase client, created once. Uses the service role, which bypasses RLS:
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

_db: sqlite3.Connection | None = None
_db_path: str | None = None


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
        _db_path = path
    return _db


# Public API.
def save(analysis: dict) -> None:
    if _use_supabase():
        _supabase().table("analyses").upsert(
            {"id": analysis["id"], "data": analysis}
        ).execute()
        return
    database = _connect()
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
    rows = _connect().execute("SELECT data FROM analyses ORDER BY started").fetchall()
    analyses = [json.loads(row["data"]) for row in rows]
    return {analysis["id"]: analysis for analysis in analyses}


def delete(analysis_id: str) -> bool:
    if _use_supabase():
        deleted = _supabase().table("analyses").delete().eq("id", analysis_id).execute().data
        return bool(deleted)
    database = _connect()
    deleted = database.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,)).rowcount
    database.commit()
    return bool(deleted)


def remember_source(key: str, resolution: dict) -> None:
    """Where a cited work's PDF lives, so a re-run does not re-ask a rate-limited API."""
    if _use_supabase():
        _supabase().table("sources").upsert({"key": key, "data": resolution}).execute()
        return
    database = _connect()
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
    row = _connect().execute("SELECT data FROM sources WHERE key = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None
