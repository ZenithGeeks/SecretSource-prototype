"""Startup and per-request reads stay with one user (#314).

The gateway used to call store.load_all() at startup and again wherever one row was wanted.
These tests use a real SQLite file. A neighbour's row carries a marker, and json.loads fails
if a query meant for someone else parses it.
"""

import json

import pytest
from app import main, store
from app.author.router import _check, _checks_of
from fastapi import HTTPException
from fastapi.testclient import TestClient


def _put(analysis: dict, started: str) -> None:
    analysis["started"] = started
    store.save(analysis)
    with store._sqlite() as database:
        database.execute("UPDATE analyses SET started = ? WHERE id = ?", (started, analysis["id"]))
        database.commit()


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setattr(store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    main.analyses.clear()
    main._derived.clear()
    main._missing.clear()
    main._deleted.clear()
    yield
    main.analyses.clear()
    main._derived.clear()
    main._missing.clear()
    main._deleted.clear()


def _paper(analysis_id: str, owner, started: str, **extra) -> None:
    _put(
        {
            "id": analysis_id,
            "owner": owner,
            "status": "done",
            "kind": "paper",
            "stages": [],
            "claims": [],
            **extra,
        },
        started,
    )


def test_owned_reads_do_not_parse_another_users_rows(db, monkeypatch):
    _paper("ada-1", "ada", "2020-01-01T00:00:00+00:00")
    _paper("ada-2", "ada", "2020-01-02T00:00:00+00:00")
    _paper("shared", None, "2020-01-03T00:00:00+00:00")
    secret = json.dumps({"id": "secret", "owner": "bo", "status": "done", "note": "DO-NOT-PARSE"})
    with store._sqlite() as database:
        database.execute(
            "INSERT INTO analyses (id, started, data) VALUES (?, ?, ?)",
            ("secret", "2019-01-01T00:00:00+00:00", secret),
        )
        database.commit()
        indexes = {row["name"] for row in database.execute("PRAGMA index_list(analyses)")}

    real_loads = json.loads

    def guarded(text, *args, **kwargs):
        if isinstance(text, str) and "DO-NOT-PARSE" in text:
            raise AssertionError("parsed another user's row")
        return real_loads(text, *args, **kwargs)

    monkeypatch.setattr(store.json, "loads", guarded)
    assert "analyses_owner_started_idx" in indexes
    assert "analyses_status_started_idx" in indexes
    assert [row["id"] for row in store.load_owned("ada")] == ["ada-1", "ada-2"]
    assert [row["id"] for row in store.load_owned(None)] == ["shared"]
    assert store.load_running() == []
    assert [row["id"] for row in store.load_recent(2)] == ["ada-2", "shared"]


def test_startup_keeps_running_rows_outside_the_recent_window(db):
    _paper("old", "ada", "2020-01-01T00:00:00+00:00")
    _put(
        {
            "id": "live",
            "owner": "ada",
            "status": "running",
            "stages": [{"stage": "extracting"}],
            "claims": [],
        },
        "2020-01-02T00:00:00+00:00",
    )
    _paper("new", "bo", "2020-06-01T00:00:00+00:00")

    found = store.load_startup(1)

    assert set(found) == {"live", "new"}
    assert list(found) == ["new", "live"]  # newest window first, then a live job it did not cover


def test_readable_memory_skips_other_owners(db):
    _paper("shared", None, "2020-01-01T00:00:00+00:00")
    _paper("mine", "ada", "2020-02-01T00:00:00+00:00")
    _paper("theirs", "bo", "2020-03-01T00:00:00+00:00")

    assert [row["id"] for row in store.load_readable("")] == ["shared"]
    assert [row["id"] for row in store.load_readable("ada")] == ["shared", "mine"]


def test_a_restart_does_not_load_the_table_and_a_request_loads_one_owner(db, monkeypatch, tmp_path):
    for index in range(5):
        _paper(
            f"old-{index}",
            None,
            f"2020-01-{index + 1:02d}T00:00:00+00:00",
            file=f"papers/old-{index}.pdf",
        )
    _paper("draft", None, "2020-02-01T00:00:00+00:00", kind="draft-check")
    _put(
        {
            "id": "live",
            "owner": None,
            "status": "running",
            "kind": "paper",
            "stages": [{"stage": "queued"}],
            "claims": [],
        },
        "2020-03-01T00:00:00+00:00",
    )
    _paper("new-1", None, "2020-06-01T00:00:00+00:00")
    _paper("new-2", None, "2020-06-02T00:00:00+00:00")
    for index in range(20):
        _paper(f"ada-{index}", "ada", f"2019-01-{(index % 28) + 1:02d}T00:00:00+00:00")

    monkeypatch.setenv("ANALYSES_STARTUP_RECENT", "2")
    monkeypatch.setattr(main, "job_is_alive", lambda analysis_id: True)
    monkeypatch.setattr(main.dependencies, "log_report", lambda: None)

    def forbid_load_all():
        raise AssertionError("load_all was called")

    monkeypatch.setattr(store, "load_all", forbid_load_all)
    owned_calls = []
    real_owned = store.load_owned

    def counting(owner):
        owned_calls.append(owner)
        return real_owned(owner)

    monkeypatch.setattr(store, "load_owned", counting)

    main.restore()
    assert set(main.analyses) == {"new-1", "new-2", "live"}

    (tmp_path / "old-0.pdf").write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    client = TestClient(main.app)

    listed = client.get("/analyses").json()
    assert [row["id"] for row in listed] == [
        "new-2", "new-1", "live", "old-4", "old-3", "old-2", "old-1", "old-0",
    ]
    assert "draft" not in {row["id"] for row in listed}
    assert not any(row["id"].startswith("ada-") for row in listed)
    assert set(main.analyses) & {f"ada-{index}" for index in range(20)} == set()
    assert client.get("/analyses/old-0").status_code == 200
    assert client.get("/analyses/ada-0").status_code == 404
    assert client.get("/papers/old-0.pdf").status_code == 200
    # The list loaded this owner once; the paper and the single-id read reuse that copy.
    assert owned_calls == [None]
    client.get("/analyses")
    client.get("/papers/old-0.pdf")
    assert owned_calls == [None]


def test_a_stored_draft_check_is_found_without_loading_every_user(db, monkeypatch):
    _put(
        {
            "id": "mine",
            "kind": "draft-check",
            "owner": "ada",
            "status": "done",
            "draftId": "d1",
            "startedAt": "2020-01-02T00:00:00+00:00",
            "stages": [],
            "citations": [],
        },
        "2020-01-02T00:00:00+00:00",
    )
    _put(
        {
            "id": "earlier",
            "kind": "draft-check",
            "owner": "ada",
            "status": "done",
            "draftId": "d1",
            "startedAt": "2020-01-01T00:00:00+00:00",
            "stages": [],
            "citations": [],
        },
        "2020-01-01T00:00:00+00:00",
    )
    _put(
        {
            "id": "theirs",
            "kind": "draft-check",
            "owner": "bo",
            "status": "done",
            "draftId": "d1",
            "startedAt": "2020-01-03T00:00:00+00:00",
            "stages": [],
            "citations": [],
        },
        "2020-01-03T00:00:00+00:00",
    )
    main.analyses.clear()
    loads = []
    real_load = store.load

    def counting(analysis_id):
        loads.append(analysis_id)
        return real_load(analysis_id)

    monkeypatch.setattr(store, "load", counting)

    assert _check("mine", "ada")["id"] == "mine"
    assert loads == ["mine"]
    _check("mine", "ada")
    assert loads == ["mine"]
    with pytest.raises(HTTPException) as error:
        _check("theirs", "ada")
    assert error.value.status_code == 404
    assert [row["id"] for row in _checks_of("d1", "ada")] == ["earlier", "mine"]


def test_a_missing_id_is_not_asked_again(db, monkeypatch):
    loads = []
    real_load = store.load

    def counting(analysis_id):
        loads.append(analysis_id)
        return real_load(analysis_id)

    monkeypatch.setattr(store, "load", counting)
    assert main.lookup("nope") is None
    assert main.lookup("nope") is None
    assert loads == ["nope"]


class _Query:
    def __init__(self, pages, log):
        self.pages = pages
        self.log = log
        self.filters = []
        self.span = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def is_(self, column, value):
        self.filters.append(("is", column, value))
        return self

    def order(self, column, desc=False):
        self.filters.append(("order", column, desc))
        return self

    def limit(self, count):
        self.filters.append(("limit", count))
        return self

    def range(self, start, end):
        self.span = (start, end)
        return self

    def execute(self):
        self.log.append((tuple(self.filters), self.span))
        if self.span is None:
            batch = self.pages[0]
        else:
            index = self.span[0] // store._SUPABASE_PAGE
            batch = self.pages[index] if index < len(self.pages) else []
        return type("Result", (), {"data": batch})()


class _Client:
    def __init__(self, pages, log):
        self.pages = pages
        self.log = log

    def table(self, name):
        assert name == "analyses"
        return _Query(self.pages, self.log)


def test_supabase_owned_query_filters_by_owner_and_pages(monkeypatch):
    page = [
        {"started": f"{index:04d}", "data": {"id": f"a{index}", "owner": "ada"}}
        for index in range(store._SUPABASE_PAGE)
    ]
    last = [{"started": "9999", "data": {"id": "last", "owner": "ada"}}]
    log = []
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    monkeypatch.setattr(store, "_supabase", lambda: _Client([page, last], log))

    rows = store.load_owned("ada")

    assert [row["id"] for row in rows] == [f"a{index}" for index in range(store._SUPABASE_PAGE)] + ["last"]
    assert rows[0]["started"] == "0000"  # filled from the column when the JSON has none
    assert log[0][0] == (("eq", "data->>owner", "ada"), ("order", "started", False))
    assert log[0][1] == (0, store._SUPABASE_PAGE - 1)
    assert log[1][1] == (store._SUPABASE_PAGE, store._SUPABASE_PAGE * 2 - 1)

    log.clear()
    monkeypatch.setattr(store, "_supabase", lambda: _Client([[]], log))
    assert store.load_owned(None) == []
    assert log[0][0][0] == ("is", "data->>owner", "null")

    log.clear()
    monkeypatch.setattr(store, "_supabase", lambda: _Client([[]], log))
    assert store.load_running() == []
    assert ("eq", "data->>status", "running") in log[0][0]

    recent = [
        {"started": "2", "data": {"id": "newer", "started": "2020-02-01"}},
        {"started": "1", "data": {"id": "older", "started": "2020-01-01"}},
    ]
    log.clear()
    monkeypatch.setattr(store, "_supabase", lambda: _Client([recent], log))
    assert [row["id"] for row in store.load_recent(2)] == ["older", "newer"]
    assert ("order", "started", True) in log[0][0]
    assert ("limit", 2) in log[0][0]


def test_one_stored_row_is_loaded_by_id(db):
    _paper("only", "ada", "2020-01-01T00:00:00+00:00")
    loaded = store.load("only")
    assert loaded is not None
    assert loaded["owner"] == "ada"
    assert loaded["started"] == "2020-01-01T00:00:00+00:00"
    assert store.load("missing") is None
    # load_all still returns every valid row, for the maintenance script that needs them.
    assert set(store.load_all()) == {"only"}
    json.dumps(loaded)  # the row is a plain dict the rest of the gateway can save again
