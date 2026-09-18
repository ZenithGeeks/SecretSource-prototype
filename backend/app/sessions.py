"""Where the chat agents keep their sessions: in memory, or in Postgres so they survive a restart.

Set SESSION_DB_URL (or DIRECT_URL, the name Supabase's Connect dialog uses) to a Postgres
URL. For Supabase, use the session pooler URL (port 5432). With neither set, sessions live
in memory and are lost on restart, as before.

ADK creates its own tables (sessions, events, app_states, user_states). We put them in the
`adk` schema, not in `public`: Supabase serves `public` through its REST API, where the
browser's anon key could read every chat.
"""

import os

from sqlalchemy import event

SCHEMA = "adk"


def session_db_url() -> str:
    """The Postgres URL for sessions, with the async driver ADK needs. Empty when not set."""
    url = (os.getenv("SESSION_DB_URL") or os.getenv("DIRECT_URL") or "").strip().strip('"')
    for plain in ("postgresql://", "postgres://"):
        if url.startswith(plain):
            return "postgresql+asyncpg://" + url[len(plain):]
    return url


def session_service():
    """A DatabaseSessionService when a session database is set, an in-memory one otherwise."""
    from google.adk.sessions import DatabaseSessionService, InMemorySessionService

    url = session_db_url()
    if not url:
        return InMemorySessionService()
    service = DatabaseSessionService(
        db_url=url, connect_args={"server_settings": {"search_path": SCHEMA}}
    )
    event.listen(service.db_engine.sync_engine, "connect", _create_schema)
    return service


def _create_schema(connection, _record):
    """Make sure the schema exists before ADK creates its tables in it."""
    cursor = connection.cursor()
    cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    cursor.close()
    connection.commit()  # the driver opened a transaction; without this the schema is rolled back
