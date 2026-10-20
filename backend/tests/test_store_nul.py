"""Supabase writes drop NUL characters, which Postgres refuses in text and jsonb (22P05).
Before this, one NUL in a PDF's extracted text made every save of that analysis fail, so it
never reached the shared database."""

import types

from app import store


class RecordingClient:
    """Keeps the last row each table was asked to upsert."""

    def __init__(self):
        self.rows = {}

    def table(self, name):
        client = self

        class Query:
            def upsert(self, row):
                client.rows[name] = row
                return self

            def execute(self):
                return types.SimpleNamespace(data=[])

        return Query()


def _use_supabase(monkeypatch):
    client = RecordingClient()
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    monkeypatch.setattr(store, "_supabase", lambda: client)
    return client


def test_an_analysis_with_nul_is_saved_without_it(monkeypatch):
    client = _use_supabase(monkeypatch)
    analysis = {
        "id": "a1",
        "title": "Paper\x00",
        "claims": [{"text": "a\x00b", "score": 0.5, "spans": [1, 2]}],
        "by\x00key": None,
    }

    store.save(analysis)

    assert client.rows["analyses"] == {
        "id": "a1",
        "data": {
            "id": "a1",
            "title": "Paper",
            "claims": [{"text": "ab", "score": 0.5, "spans": [1, 2]}],
            "bykey": None,
        },
    }
    assert analysis["title"] == "Paper\x00"  # the caller's dict is left as it was


def test_sources_cache_and_author_rows_drop_nul(monkeypatch):
    client = _use_supabase(monkeypatch)

    author_table = sorted(store.AUTHOR_TABLES)[0]

    store.remember_source("k1", {"url": "https://x\x00"})
    store.save_project({"id": "p1", "owner": None, "name": "P\x00"})
    store.save_author_row(author_table, {"id": "r1", "owner": None, "body": "t\x00"})

    assert client.rows["sources"]["data"] == {"url": "https://x"}
    assert client.rows["projects"]["data"]["name"] == "P"
    assert client.rows[author_table]["data"]["body"] == "t"


def test_values_without_nul_are_unchanged():
    value = {"a": ["x", 1, 2.5, True, None, {"b": "y"}]}
    assert store._without_nul(value) == value
