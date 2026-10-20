"""Supabase writes turn NUL into U+FFFD, because Postgres refuses NUL in text and jsonb (22P05).
Before this, one NUL in a PDF's extracted text made every save of that analysis fail, so it
never reached the shared database (#570)."""

import types

from app import store
from app.labeling.ledger import Ledger
from app.teacher.repository import TeacherGoogleRepository


class RecordingClient:
    """Keeps the last rows each table was asked to upsert or insert."""

    def __init__(self):
        self.rows = {}

    def table(self, name):
        client = self

        class Query:
            def upsert(self, row, **options):
                client.rows[name] = row
                return self

            def insert(self, rows):
                client.rows[name] = rows
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


def test_an_analysis_with_nul_is_saved_with_a_replacement_character(monkeypatch):
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
            "title": "Paper\ufffd",
            "claims": [{"text": "a\ufffdb", "score": 0.5, "spans": [1, 2]}],
            "by\ufffdkey": None,
        },
    }
    assert analysis["title"] == "Paper\x00"  # the caller's dict is left as it was


def test_every_store_write_replaces_nul(monkeypatch):
    client = _use_supabase(monkeypatch)
    author_table = store.AUTHOR_TABLES[0]

    store.remember_source("k1", {"url": "https://x\x00"})
    store.remember_cache("k2", {"text": "c\x00"})
    store.save_project({"id": "p1", "owner": None, "name": "P\x00"})
    store.save_preferences(None, {"note": "n\x00"})
    store.save_author_row(author_table, {"id": "r1", "owner": None, "body": "t\x00"})

    assert client.rows["sources"]["data"] == {"url": "https://x\ufffd"}
    assert client.rows["cache"]["data"] == {"text": "c\ufffd"}
    assert client.rows["projects"]["data"]["name"] == "P\ufffd"
    assert client.rows["preferences"]["data"] == {"note": "n\ufffd"}
    assert client.rows[author_table]["data"]["body"] == "t\ufffd"


def test_labeling_rows_replace_nul(monkeypatch):
    client = _use_supabase(monkeypatch)

    Ledger().append("labels", [{"claim_id": "c\x00"}])

    [row] = client.rows["labeling_rows"]
    assert row["data"]["claim_id"] == "c\ufffd"


def test_teacher_rows_replace_nul():
    client = RecordingClient()

    TeacherGoogleRepository(client)._upsert("teacher_feedback", {"feedback_text": "f\x00"}, "owner")

    assert client.rows["teacher_feedback"] == {"feedback_text": "f\ufffd"}


def test_tuples_are_cleaned_and_lengths_kept():
    assert store.postgres_safe(("a\x00", "b")) == ["a\ufffd", "b"]
    assert len(store.postgres_safe("x\x00y")) == len("x\x00y")


def test_values_without_nul_are_unchanged():
    value = {"a": ["x", 1, 2.5, True, None, {"b": "y"}]}
    assert store.postgres_safe(value) == value
