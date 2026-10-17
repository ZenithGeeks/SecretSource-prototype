"""Supabase queries run once more when the server drops the connection, and the cache treats a
failed read as a miss and a failed write as skipped. Before this, one dropped connection
stopped an analysis with "Server disconnected" and 0 claims (#473)."""

import types

import httpx
import pytest
from app import store


class FakeQuery:
    """The query builder: each builder method returns the query, and execute() raises the
    scripted errors in order before it returns the rows."""

    def __init__(self, errors, rows=()):
        self.errors, self.rows, self.runs = list(errors), list(rows), 0

    def select(self, *columns):
        return self

    def eq(self, column, value):
        return self

    def limit(self, count):
        return self

    def upsert(self, row):
        return self

    def execute(self):
        self.runs += 1
        if self.errors:
            raise self.errors.pop(0)
        return types.SimpleNamespace(data=self.rows)


class FakeClient:
    def __init__(self, query):
        self.query = query

    def table(self, name):
        return self.query


def _use_supabase(monkeypatch, query):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    monkeypatch.setattr(store, "_supabase", lambda: FakeClient(query))


def _dropped():
    return httpx.RemoteProtocolError("Server disconnected")


def test_a_dropped_connection_is_asked_again(monkeypatch):
    query = FakeQuery([_dropped()], [{"data": {"id": "a1"}}])
    _use_supabase(monkeypatch, query)

    assert store.load("a1") == {"id": "a1"}
    assert query.runs == 2


def test_a_second_drop_still_fails_outside_the_cache(monkeypatch):
    _use_supabase(monkeypatch, FakeQuery([_dropped(), _dropped()]))

    with pytest.raises(httpx.RemoteProtocolError):
        store.load("a1")


def test_a_failed_cache_read_is_a_miss(monkeypatch):
    _use_supabase(monkeypatch, FakeQuery([_dropped(), _dropped()]))

    assert store.recall_cache("key") is None


def test_a_failed_cache_write_is_skipped(monkeypatch):
    query = FakeQuery([httpx.ConnectError("refused")])
    _use_supabase(monkeypatch, query)

    store.remember_cache("key", {"tei": "<TEI/>"})  # does not raise
    assert query.runs == 1  # only a dropped connection is asked again
