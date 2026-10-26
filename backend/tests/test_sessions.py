"""The session database setting: which URL is used, and nothing changes when it is empty."""

from app import sessions
from google.adk.sessions import DatabaseSessionService, InMemorySessionService


def test_no_setting_keeps_sessions_in_memory_and_says_so(monkeypatch, caplog):
    monkeypatch.delenv("SESSION_DB_URL", raising=False)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    assert sessions.session_db_url() == ""
    assert isinstance(sessions.session_service(), InMemorySessionService)
    assert "SESSION_DB_URL is not set" in caplog.text


def test_a_plain_postgres_url_gets_the_async_driver(monkeypatch):
    monkeypatch.setenv("SESSION_DB_URL", "postgresql://user:secret@host:5432/postgres")
    assert sessions.session_db_url() == "postgresql+asyncpg://user:secret@host:5432/postgres"
    monkeypatch.setenv("SESSION_DB_URL", "postgres://user:secret@host:5432/postgres")
    assert sessions.session_db_url() == "postgresql+asyncpg://user:secret@host:5432/postgres"


def test_direct_url_is_read_when_session_db_url_is_not_set(monkeypatch):
    monkeypatch.delenv("SESSION_DB_URL", raising=False)
    monkeypatch.setenv("DIRECT_URL", '"postgresql://user:secret@host:5432/postgres"')
    assert sessions.session_db_url() == "postgresql+asyncpg://user:secret@host:5432/postgres"


def test_a_database_url_builds_a_database_service_without_connecting(monkeypatch):
    """Building the service must not open a connection: the tables are made on first use."""
    monkeypatch.setenv("SESSION_DB_URL", "postgresql://user:secret@127.0.0.1:1/postgres")
    assert isinstance(sessions.session_service(), DatabaseSessionService)
