"""Analyses and resolved sources that outlive a restart.

SQLite, one row per analysis, results kept as JSON — the gateway reads and writes whole
analyses, never parts of them. Swapping in Cloud SQL means changing the SQL strings and
the connection, nothing above this file.
"""

import json
import os
import sqlite3
from pathlib import Path

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
    """The open connection, reopened if ANALYSES_DB changed since last time."""
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


def save(analysis: dict) -> None:
    database = _connect()
    database.execute(
        "INSERT INTO analyses (id, data) VALUES (?, ?) "
        "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        (analysis["id"], json.dumps(analysis)),
    )
    database.commit()


def load_all() -> dict[str, dict]:
    """Every stored analysis, oldest first, keyed by id."""
    rows = _connect().execute("SELECT data FROM analyses ORDER BY started").fetchall()
    analyses = [json.loads(row["data"]) for row in rows]
    return {analysis["id"]: analysis for analysis in analyses}


def delete(analysis_id: str) -> bool:
    database = _connect()
    deleted = database.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,)).rowcount
    database.commit()
    return bool(deleted)


def remember_source(key: str, resolution: dict) -> None:
    """Where a cited work's PDF lives, so a re-run does not re-ask a rate-limited API."""
    database = _connect()
    database.execute(
        "INSERT INTO sources (key, data) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET data = excluded.data",
        (key, json.dumps(resolution)),
    )
    database.commit()


def recall_source(key: str) -> dict | None:
    row = _connect().execute("SELECT data FROM sources WHERE key = ?", (key,)).fetchone()
    return json.loads(row["data"]) if row else None
