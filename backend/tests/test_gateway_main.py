"""The corners of app/main.py the other test files leave open: start-up and restore helpers, the
Redis subscriber, run failures, stream and stop paths, the paper, page and figure routes, the
researcher projects, assistant helpers and a few small routes. Outside services are replaced at
the boundary (the store, Redis, the queue, the PDF pipeline); main's own code runs as it is."""

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import pymupdf
import pytest
from app import chats, main
from app.auth import current_user
from app.queue import run_analysis_job
from fastapi.testclient import TestClient
from google.adk.sessions import InMemorySessionService
from redis.exceptions import RedisError


@pytest.fixture(autouse=True)
def clean_state():
    def clear():
        main.analyses.clear()
        main.streams.clear()
        main._deleted.clear()
        main._missing.clear()
        main._unsaved.clear()
        main._savers.clear()
        main._derived.clear()
        main._consensus_cache.clear()
        main._loop = None

    clear()
    yield
    clear()


@pytest.fixture
def client_as():
    """A client whose requests come from this user (None is login off)."""

    def make(user: str | None) -> TestClient:
        main.app.dependency_overrides[current_user] = lambda: user
        return TestClient(main.app)

    yield make
    main.app.dependency_overrides.pop(current_user, None)


def _row(analysis_id: str, owner=None, status="done", **extra) -> dict:
    return {"id": analysis_id, "owner": owner, "status": status, "stages": [], "claims": [], **extra}


# --- start-up helpers ---


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("", 50), ("many", 50), ("7", 7), ("-3", 0)],
)
def test_startup_recent_reads_the_env_and_falls_back_when_it_is_empty_or_not_a_number(
    monkeypatch, raw, expected
):
    monkeypatch.setenv("ANALYSES_STARTUP_RECENT", raw)

    assert main.startup_recent() == expected


def test_restore_terminates_a_recheck_interrupted_by_restart(monkeypatch):
    row = _row(
        "a1",
        stages=[
            {"stage": "rechecking", "ref": "b13"},
            {"stage": "rechecking", "ref": "b14"},
            {"stage": "rechecked", "ref": "b14"},
        ],
    )
    monkeypatch.setattr(main.store, "load_startup", lambda _limit: {"a1": row})
    monkeypatch.setattr(main, "_save_soon", lambda _analysis_id: None)

    main.restore()

    event = main.analyses["a1"]["stages"][-1]
    assert event["ref"] == "b13"
    assert {key: value for key, value in event.items() if key != "at"} == {
        "stage": "rechecked",
        "ref": "b13",
        "interrupted": True,
    }
    assert isinstance(event["at"], float)


def test_pending_recheck_refs_use_the_latest_stage_per_reference():
    stages = [
        {"stage": "rechecking", "ref": "b13"},
        {"stage": "rechecking", "ref": "b14"},
        {"stage": "rechecked", "ref": "b14"},
        {"stage": "queued", "ref": "b16"},
        {"stage": "rechecking", "ref": "b15"},
        {"stage": "recheck-failed", "ref": "b15"},
    ]

    assert main._pending_recheck_refs(stages) == ["b13"]


def test_remembering_a_missing_id_drops_marks_that_have_expired():
    main._missing["old"] = time.monotonic() - main._MISSING_TTL_SECONDS - 1

    main._remember_missing("new")

    assert list(main._missing) == ["new"]


def test_a_deleted_row_is_not_held_in_memory():
    main._deleted.add("a1")

    assert main._hold(_row("a1", status="running")) is False
    assert "a1" not in main.analyses


@pytest.mark.parametrize("case", ["already open", "deleted", "not in memory", "finished"])
def test_open_stream_leaves_alone_an_analysis_that_needs_no_new_queue(case):
    existing = asyncio.Queue()
    if case != "not in memory":
        main.analyses["a1"] = _row("a1", status="done" if case == "finished" else "running")
    if case == "already open":
        main.streams["a1"] = existing
    if case == "deleted":
        main._deleted.add("a1")

    main._open_stream("a1")

    assert main.streams.get("a1") is (existing if case == "already open" else None)


def test_schedule_stream_opens_the_queue_at_once_when_called_on_the_event_loop():
    main.analyses["a1"] = _row("a1", status="running", stages=[{"stage": "queued"}])

    async def scenario():
        main._schedule_stream("a1")
        return main.streams["a1"].get_nowait()

    assert asyncio.run(scenario()) == {"stage": "queued"}


# --- Redis snapshots ---


def test_a_delete_snapshot_for_an_analysis_with_no_open_stream_still_marks_it_deleted():
    main._apply_snapshot({"id": "a1", "deleted": True})

    assert "a1" in main._deleted
    assert "a1" not in main.streams


def test_resync_leaves_a_running_analysis_alone_when_the_store_has_no_row(monkeypatch):
    row = _row("a1", status="running")
    main.analyses["a1"] = row
    monkeypatch.setattr(main.store, "load", lambda analysis_id: None)

    asyncio.run(main._resync_running())

    assert main.analyses["a1"] is row


class _Redis:
    """A Redis client that is also its own pubsub, listening to these messages once."""

    def __init__(self, messages):
        self.messages = messages
        self.closed = False

    def pubsub(self):
        return self

    async def psubscribe(self, *patterns):
        pass

    async def listen(self):
        for message in self.messages:
            yield message

    async def aclose(self):
        self.closed = True


def _run_subscriber(monkeypatch, *clients):
    """Run _subscribe_forever through these clients, in order; asking for one more cancels it."""
    pending = list(clients)

    def pubsub_client():
        if not pending:
            raise asyncio.CancelledError
        client = pending.pop(0)
        if isinstance(client, Exception):
            raise client
        return client

    monkeypatch.setattr(main, "pubsub_client", pubsub_client)
    monkeypatch.setattr(main, "_SUBSCRIBE_BACKOFF_START", 0.0)
    monkeypatch.setattr(main, "_SUBSCRIBE_BACKOFF_MAX", 0.0)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(asyncio.wait_for(main._subscribe_forever(), timeout=5))


def _published(snapshot: dict) -> dict:
    return {"type": "pmessage", "data": json.dumps(snapshot)}


def test_the_subscriber_applies_a_published_snapshot_and_closes_its_client(monkeypatch):
    snapshot = _row("a1", status="running", stages=[{"stage": "queued"}])
    redis = _Redis([_published(snapshot)])

    _run_subscriber(monkeypatch, redis)

    assert main.analyses["a1"]["stages"] == [{"stage": "queued"}]
    assert redis.closed


def test_the_subscriber_skips_messages_that_are_not_snapshots(monkeypatch):
    _run_subscriber(monkeypatch, _Redis([{"type": "psubscribe", "data": 1}]))

    assert not main.analyses


def test_the_subscriber_logs_a_snapshot_it_cannot_apply_and_keeps_listening(monkeypatch, caplog):
    good = _row("a1", status="running", stages=[{"stage": "queued"}])
    redis = _Redis([{"type": "pmessage", "data": "{not json"}, _published(good)])

    with caplog.at_level(logging.ERROR, logger=main.logger.name):
        _run_subscriber(monkeypatch, redis)

    assert "applying a Redis analysis snapshot failed" in caplog.text
    assert "a1" in main.analyses


def test_the_subscriber_keeps_listening_when_the_resync_fails(monkeypatch, caplog):
    async def broken():
        raise RuntimeError("store down")

    monkeypatch.setattr(main, "_resync_running", broken)
    good = _row("a1", status="running", stages=[{"stage": "queued"}])

    with caplog.at_level(logging.ERROR, logger=main.logger.name):
        _run_subscriber(monkeypatch, _Redis([_published(good)]))

    assert "reading running analyses back from the store failed" in caplog.text
    assert "a1" in main.analyses


def test_the_subscriber_retries_when_it_cannot_reach_redis(monkeypatch, caplog):
    good = _row("a1", status="running", stages=[{"stage": "queued"}])

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        _run_subscriber(monkeypatch, ConnectionError("no redis"), _Redis([_published(good)]))

    assert "lost Redis (no redis)" in caplog.text
    assert "a1" in main.analyses


def test_the_lifespan_starts_the_background_tasks_and_cancels_the_subscriber_on_exit(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "setup_tracing", lambda: calls.append("tracing"))
    monkeypatch.setattr(main, "restore", lambda: calls.append("restore"))
    monkeypatch.setattr(main, "_warm_agents", lambda: calls.append("warm"))
    monkeypatch.setattr(main.gc, "freeze", lambda: calls.append("freeze"))
    monkeypatch.setattr(main.dependencies, "log_report", lambda: calls.append("report"))

    @asynccontextmanager
    async def mcp_running():
        calls.append("mcp up")
        yield
        calls.append("mcp down")

    async def subscriber():
        await asyncio.Event().wait()

    monkeypatch.setattr(main.mcp_server, "running", mcp_running)
    monkeypatch.setattr(main, "_subscribe_forever", subscriber)

    async def scenario():
        async with main.lifespan(main.app):
            calls.append("serving")
            assert main._loop is asyncio.get_running_loop()
        await main.app.state.dependency_check
        return main.app.state.snapshot_subscriber.cancelled()

    assert asyncio.run(scenario()) is True
    assert calls[:4] == ["tracing", "restore", "warm", "freeze"]
    assert [call for call in calls if call.startswith("mcp") or call == "serving"] == [
        "mcp up",
        "serving",
        "mcp down",
    ]
    assert "report" in calls


def test_the_access_log_filter_leaves_a_record_that_is_not_an_access_line_alone():
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, "message", ("only",), None)

    assert main.PathWithoutQuery().filter(record) is True
    assert record.args == ("only",)


# --- saving ---


def test_a_save_for_an_analysis_deleted_meanwhile_writes_nothing(monkeypatch):
    saved = []
    monkeypatch.setattr(main.store, "save", saved.append)
    main._unsaved.add("gone")
    main._savers["gone"] = None

    asyncio.run(main._save_while_unsaved("gone"))

    assert saved == []
    assert "gone" not in main._savers


def test_a_failed_save_is_logged_and_does_not_stop_the_saver(monkeypatch, caplog):
    def broken(snapshot):
        raise RuntimeError("supabase down")

    monkeypatch.setattr(main.store, "save", broken)
    main.analyses["a1"] = _row("a1")
    main._unsaved.add("a1")

    with caplog.at_level(logging.ERROR, logger=main.logger.name):
        asyncio.run(main._save_while_unsaved("a1"))

    assert "saving analysis a1 failed" in caplog.text
    assert not main._unsaved


# --- a run that fails or skips steps ---


@pytest.fixture
def pipeline(monkeypatch):
    """The PDF pipeline replaced at its edges. Returns the saved copies of the analysis and the
    list of papers check_prepared was asked about."""
    saved, checked = [], []
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.append(json.loads(json.dumps(analysis))))
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {
            "status": "ok",
            "file": f"{paper}.pdf",
            "title": "T",
            "claims": [{"claim": "c1", "citations": [{"key": "s1"}]}],
        },
    )
    monkeypatch.setattr(main, "lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(
        main,
        "checked_citations",
        lambda claim: [(citation, citation["key"]) for citation in claim.get("citations", [])],
    )
    monkeypatch.setattr(
        main, "prepare_source", lambda source, expected=None: {"status": "ok", "path": source}
    )
    monkeypatch.setattr(
        main,
        "check_prepared",
        lambda claim, source, path, judged="", other_citations=False, source_outcome=None: (
            checked.append(source)
            or {"status": "ok", "claim": claim, "source": source, "verdict": "supports"}
        ),
    )
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "add_paper", lambda file: {"status": "ok"})
    monkeypatch.setattr(main, "audit", lambda analysis: [])
    monkeypatch.setattr(main, "index_paper", lambda title: "unknown")
    return saved, checked


def test_an_extraction_that_reports_an_error_ends_the_analysis_with_its_message(monkeypatch, pipeline):
    saved, _ = pipeline
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {"status": "error", "message": "grobid refused the file"},
    )

    result = run_analysis_job("g-extract", "paper", True, None)

    assert result["status"] == "error"
    assert saved[-1]["message"] == "grobid refused the file"


def test_a_run_without_verification_reads_the_paper_but_checks_no_citation(pipeline):
    saved, checked = pipeline

    result = run_analysis_job("g-noverify", "paper", False, None)

    assert result["status"] == "done"
    assert checked == []
    assert "planned" not in [stage["stage"] for stage in saved[-1]["stages"]]


def test_a_cited_paper_that_could_not_be_prepared_is_a_failed_check_not_a_verdict(monkeypatch, pipeline):
    saved, checked = pipeline
    monkeypatch.setattr(
        main,
        "prepare_source",
        lambda source, expected=None: {
            "status": "error", "message": "no pdf found", "reason": "unavailable"
        },
    )

    result = run_analysis_job("g-unready", "paper", True, None)

    failed = [stage for stage in saved[-1]["stages"] if stage["stage"] == "failed"]
    assert result["status"] == "done"
    assert [stage["message"] for stage in failed] == ["no pdf found"]
    assert checked == []


def test_a_readable_source_outcome_is_passed_to_each_check(monkeypatch, pipeline):
    saved, checked = pipeline
    outcome = {"source_kind": "paper", "outcome": "readable", "retryable": False, "attempts": []}
    monkeypatch.setattr(
        main, "prepare_source", lambda source, expected=None: {
            "status": "ok", "path": source, "source_outcome": outcome,
        },
    )
    received = []
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path, judged="", other_citations=False, source_outcome=None: (
            received.append(source_outcome)
            or {
                "status": "ok", "claim": claim, "source": source,
                "verdict": "supports", "source_outcome": source_outcome,
            }
        ),
    )

    result = run_analysis_job("g-outcome", "paper", True, None)

    assert result["status"] == "done"
    assert checked == []
    assert received == [outcome]
    assert saved[-1]["claims"][0]["verdicts"][0]["source_outcome"] == outcome


def test_a_readable_web_page_is_checked_with_the_web_judge(monkeypatch, pipeline):
    saved, _checked = pipeline
    page = object()
    monkeypatch.setattr(
        main, "prepare_source",
        lambda _source, expected=None: {"status": "web-page", "web_page": page},
    )
    checked = []
    monkeypatch.setattr(
        main, "check_web_page",
        lambda claim, source, web_page, judged, others, outcome=None: (
            checked.append((claim, source, web_page, judged, others))
            or {"status": "ok", "claim": claim, "source": source, "verdict": "supports"}
        ),
    )

    result = run_analysis_job("g-web", "paper", True, None)

    assert result["status"] == "done"
    assert checked == [("c1", "s1", page, "c1", False)]
    assert saved[-1]["claims"][0]["verdicts"][0]["verdict"] == "supports"


def test_a_recheck_passes_source_outcome_to_the_check(monkeypatch):
    outcome = {"source_kind": "paper", "outcome": "readable", "retryable": False, "attempts": []}
    main.analyses["g-recheck-outcome"] = {
        "claims": [{
            "claim": "c1", "sentence": "A claim [b1].",
            "citations": [{"ref": "b1", "key": "s1"}],
            "verdicts": [{"cited": "s1", "verdict": "refutes"}],
        }],
        "stages": [],
    }
    monkeypatch.setattr(
        main, "prepare_source", lambda source, expected=None: {
            "status": "ok", "path": source, "source_outcome": outcome,
        },
    )
    received = []
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path, judged="", other_citations=False, source_outcome=None: (
            received.append(source_outcome)
            or {
                "status": "ok", "claim": claim, "source": source,
                "verdict": "supports", "source_outcome": source_outcome,
            }
        ),
    )
    monkeypatch.setattr(main, "lookup_key", lambda citation: citation["key"])

    asyncio.run(main._recheck_reference("g-recheck-outcome", "b1", Path("paper.pdf")))

    assert received == [outcome]
    assert main.analyses["g-recheck-outcome"]["claims"][0]["verdicts"][0]["source_outcome"] == outcome


# --- starting a run ---


def test_a_run_is_still_queued_when_redis_cannot_take_the_queued_snapshot(client_as, monkeypatch, caplog):
    def no_redis():
        raise ConnectionError("redis down")

    monkeypatch.setattr(main, "enqueue_analysis", lambda *job: None)
    monkeypatch.setattr(main, "redis_connection", no_redis)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        response = client_as(None).post("/analyses", json={"paper": "p.pdf"})

    assert response.status_code == 200
    assert "publishing queued analysis" in caplog.text


# --- loading an owner's rows ---


def test_an_owner_whose_store_lists_a_row_twice_holds_it_once(monkeypatch):
    monkeypatch.setattr(main.store, "load_owned", lambda user: [_row("a1", "ada"), _row("a1", "ada")])

    assert [row["id"] for row in main.visible_to("ada")] == ["a1"]


def test_an_owner_does_not_get_back_a_row_this_process_deleted(monkeypatch):
    main._deleted.add("a1")
    monkeypatch.setattr(main.store, "load_owned", lambda user: [_row("a1", "ada"), _row("a2", "ada")])

    assert [row["id"] for row in main.visible_to("ada")] == ["a2"]


# --- lookup ---


def test_lookup_with_a_plain_dict_for_analyses_skips_a_deleted_id(monkeypatch):
    monkeypatch.setattr(main, "analyses", {})
    monkeypatch.setattr(main.store, "load", lambda analysis_id: pytest.fail("asked the store"))
    main._deleted.add("a1")

    assert main.lookup("a1") is None


def test_lookup_drops_a_row_the_store_returns_after_the_id_was_deleted(monkeypatch):
    def load(analysis_id):
        main._deleted.add(analysis_id)  # deleted while the store was being read
        return _row(analysis_id)

    monkeypatch.setattr(main.store, "load", load)

    assert main.lookup("a1") is None
    assert "a1" not in main.analyses


def test_lookup_returns_the_row_another_thread_put_in_memory_while_it_read_the_store(monkeypatch):
    newer = _row("a1", status="running")

    def load(analysis_id):
        main.analyses[analysis_id] = newer
        return _row(analysis_id)

    monkeypatch.setattr(main.store, "load", load)

    assert main.lookup("a1") is newer


def test_lookup_ignores_a_stored_row_whose_own_id_was_deleted_and_does_not_mark_the_id_missing(
    monkeypatch,
):
    main._deleted.add("renamed")
    monkeypatch.setattr(main.store, "load", lambda analysis_id: _row("renamed"))

    assert main.lookup("a1") is None
    assert "a1" not in main._missing


def test_a_row_loaded_for_an_owner_already_in_memory_takes_its_place_by_start_time(monkeypatch):
    main.analyses["late"] = _row("late", "ada", started="2026-01-02")
    main.analyses.mark_owner_loaded("ada")

    def load(analysis_id):
        return _row(analysis_id, "ada", started="2026-01-01")

    monkeypatch.setattr(main.store, "load", load)

    main.lookup("early")

    assert [row["id"] for row in main.analyses.owned_by("ada")] == ["early", "late"]


# --- deleting and stopping ---


def test_a_delete_that_redis_cannot_announce_still_deletes(monkeypatch, caplog):
    def no_redis():
        raise ConnectionError("redis down")

    deleted = []
    monkeypatch.setattr(main, "redis_connection", no_redis)
    monkeypatch.setattr(main.store, "delete", deleted.append)

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        asyncio.run(main._delete_one("a1"))

    assert deleted == ["a1"]
    assert "publishing the delete of analysis a1" in caplog.text


def test_the_event_stream_sends_each_new_stage_after_the_replay():
    main.analyses["a1"] = _row("a1", status="running", stages=[{"stage": "queued"}])

    async def scenario():
        queue = main.streams["a1"] = asyncio.Queue()
        for item in ({"stage": "queued"}, {"stage": "extracting"}, None):
            queue.put_nowait(item)
        return [chunk async for chunk in main._event_stream("a1")]

    chunks = asyncio.run(scenario())

    stages = [{"stage": "queued"}, {"stage": "extracting"}]
    assert chunks == [f"data: {json.dumps(stage)}\n\n" for stage in stages]


def test_a_queued_analysis_can_be_deleted_even_though_it_is_running(client_as, monkeypatch):
    main.analyses["a1"] = _row("a1", status="running")
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: True)
    monkeypatch.setattr(main.store, "delete", lambda analysis_id: True)

    response = client_as(None).delete("/analyses/a1")

    assert response.json() == {"deleted": "a1"}
    assert "a1" not in main.analyses


def test_a_finished_analysis_is_deleted_without_asking_the_queue(client_as, monkeypatch):
    main.analyses["a1"] = _row("a1")
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: pytest.fail("asked the queue"))
    monkeypatch.setattr(main.store, "delete", lambda analysis_id: True)

    response = client_as(None).delete("/analyses/a1")

    assert response.json() == {"deleted": "a1"}


def test_stopping_is_refused_when_the_queue_cannot_say_whether_the_job_lives(client_as, monkeypatch):
    main.analyses["a1"] = _row("a1", status="running")
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: False)
    monkeypatch.setattr(main, "job_is_alive", lambda analysis_id: None)

    response = client_as(None).post("/analyses/a1/stop")

    assert response.status_code == 503


def test_stopping_a_lost_job_whose_stored_row_already_finished_is_refused(client_as, monkeypatch):
    main.analyses["a1"] = _row("a1", status="running")
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: False)
    monkeypatch.setattr(main, "job_is_alive", lambda analysis_id: False)
    monkeypatch.setattr(main.store, "load", lambda analysis_id: _row(analysis_id, status="done"))

    response = client_as(None).post("/analyses/a1/stop")

    assert response.status_code == 409


def test_ending_a_stopped_analysis_closes_its_open_stream(monkeypatch):
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    analysis = _row("a1", status="running")

    async def scenario():
        queue = main.streams["a1"] = asyncio.Queue()
        await main._end_stopped(analysis)
        return queue.get_nowait()

    assert asyncio.run(scenario()) is None
    assert analysis["status"] == "error"


def test_ending_a_stopped_analysis_survives_redis_being_down(monkeypatch, caplog):
    def no_redis():
        raise ConnectionError("redis down")

    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", no_redis)
    analysis = _row("a1", status="running")

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        asyncio.run(main._end_stopped(analysis))

    assert "publishing the stop of analysis a1" in caplog.text
    assert analysis["status"] == "error"


# --- papers, pages and figures ---


@pytest.fixture
def paper_dir(monkeypatch, tmp_path):
    """A two-page PDF named paper.pdf that the caller may open."""
    document = pymupdf.open()
    document.new_page()
    document.new_page()
    document.save(tmp_path / "paper.pdf")
    document.close()
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(main, "PAGE_CACHE", tmp_path / "cache")
    monkeypatch.setattr(main, "papers_of", lambda user: frozenset({"paper.pdf"}))
    return tmp_path


def test_a_paper_name_that_starts_with_a_dot_is_refused(client_as):
    assert client_as(None).get("/papers/.hidden").status_code == 400


def test_a_page_is_rendered_to_a_png_and_kept(client_as, paper_dir):
    response = client_as(None).get("/papers/paper.pdf/pages/1.png")

    assert response.status_code == 200
    assert response.content.startswith(b"\x89PNG")
    assert (paper_dir / "cache" / f"paper-1-{main.DEFAULT_DPI}.png").is_file()


def test_a_page_already_rendered_is_served_without_opening_the_pdf(client_as, paper_dir, monkeypatch):
    client = client_as(None)
    client.get("/papers/paper.pdf/pages/1.png")
    monkeypatch.setattr(pymupdf, "open", lambda path: pytest.fail("opened the pdf again"))

    assert client.get("/papers/paper.pdf/pages/1.png").status_code == 200


def test_a_page_request_cannot_ask_for_more_than_the_largest_dpi(client_as, paper_dir):
    client_as(None).get("/papers/paper.pdf/pages/2.png?dpi=100000")

    assert (paper_dir / "cache" / f"paper-2-{main.MAX_DPI}.png").is_file()


@pytest.mark.parametrize("page_number", [0, 3])
def test_a_page_outside_the_paper_is_a_404_that_says_how_many_pages_it_has(client_as, paper_dir, page_number):
    response = client_as(None).get(f"/papers/paper.pdf/pages/{page_number}.png")

    assert response.status_code == 404
    assert response.json()["detail"] == "paper.pdf has 2 pages"


def test_a_figure_that_was_never_cropped_is_a_404(client_as, paper_dir):
    response = client_as(None).get("/papers/paper.pdf/figures/figure-9.png")

    assert response.status_code == 404
    assert response.json()["detail"] == "no such figure: figure-9"


def test_find_returns_where_the_text_sits(client_as, paper_dir, monkeypatch):
    found = {"page": 2, "boxes": [[1, 2, 3, 4]], "width": 612, "height": 792}
    asked = []
    monkeypatch.setattr(main, "locate", lambda path, q, page: asked.append((path, q, page)) or found)

    response = client_as(None).get("/papers/paper.pdf/find", params={"q": "late interaction", "page": 2})

    assert response.json() == found
    assert asked == [((paper_dir / "paper.pdf").as_posix(), "late interaction", 2)]


def test_find_returns_no_page_and_no_boxes_when_the_text_is_not_there(client_as, paper_dir, monkeypatch):
    monkeypatch.setattr(main, "locate", lambda path, q, page: None)

    response = client_as(None).get("/papers/paper.pdf/find", params={"q": "nothing"})

    assert response.json() == {"page": None, "boxes": []}


# --- researcher projects ---


@pytest.fixture
def projects(monkeypatch):
    """The caller's stored projects, and the ones saved."""
    stored, saved = [], []
    monkeypatch.setattr(main.store, "load_owned", lambda user: [])
    monkeypatch.setattr(main.store, "load_projects", lambda user: stored)
    monkeypatch.setattr(main.store, "save_project", saved.append)
    return stored, saved


def test_a_project_needs_a_name(client_as, projects):
    response = client_as(None).post("/researcher/projects", json={"name": "   "})

    assert response.status_code == 400
    assert projects[1] == []


def test_a_project_that_does_not_exist_has_no_library(client_as, projects):
    assert client_as(None).get("/researcher/projects/nope/library").status_code == 404


def test_a_project_library_lists_the_papers_filed_in_it(client_as, projects):
    stored, _ = projects
    main.analyses["a1"] = _row("a1", file="a1.pdf", paper="a1.pdf")
    main.analyses.mark_owner_loaded(None)
    stored.append(
        {"id": "p1", "owner": None, "name": "Survey", "description": "", "analyses": ["a1"],
         "created": "2026-01-01", "updated": "2026-01-01"}
    )  # fmt: skip

    response = client_as(None).get("/researcher/projects/p1/library")

    assert response.status_code == 200
    assert [paper["id"] for paper in response.json()["papers"]] == ["a1"]


def test_filing_a_paper_twice_in_a_project_lists_it_once(client_as, projects):
    stored, saved = projects
    main.analyses["a1"] = _row("a1")
    main.analyses.mark_owner_loaded(None)
    stored.append(
        {"id": "p1", "owner": None, "name": "Survey", "description": "", "analyses": ["a1"],
         "created": "2026-01-01", "updated": "2026-01-01"}
    )  # fmt: skip

    response = client_as(None).post("/researcher/projects/p1/papers", json={"analysis_id": "a1"})

    assert response.status_code == 200
    assert saved[0]["analyses"] == ["a1"]


# --- assistant ---


def test_keep_alive_sends_a_comment_line_while_the_events_are_slow(monkeypatch):
    monkeypatch.setattr(main, "HEARTBEAT_SECONDS", 0.02)

    async def slow():
        await asyncio.sleep(0.2)
        yield "data: late\n\n"

    async def scenario():
        return [chunk async for chunk in main._keep_alive(slow())]

    chunks = asyncio.run(scenario())

    assert chunks[0] == ": keep-alive\n\n"
    assert chunks[-1] == "data: late\n\n"


@pytest.fixture
def chat_client(client_as, monkeypatch, tmp_path):
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(chats, "_service", InMemorySessionService())
    return client_as


def test_a_question_about_a_paper_that_cannot_be_read_gets_an_error_event_and_no_reply(
    chat_client, monkeypatch
):
    main.analyses["a1"] = _row("a1", "user-ada", file="data/papers/a1.pdf")
    monkeypatch.setattr(main, "prepare_source", lambda paper, expected=None: {"status": "error"})
    client = chat_client("user-ada")
    chat = client.post("/assistant/chats").json()

    response = client.post(
        f"/assistant/chats/{chat['id']}/messages",
        json={"question": "What does it claim?", "context": {"analysis": "a1"}},
    )

    assert [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")] == [
        {"type": "error", "message": "this paper could not be read"}
    ]
    saved = client.get(f"/assistant/chats/{chat['id']}").json()
    assert [message["role"] for message in saved["messages"]] == ["user"]


def test_listing_chats_without_a_login_queues_no_distills(chat_client, monkeypatch):
    monkeypatch.setattr(main, "_queue_distills", lambda *args: pytest.fail("queued a distill"))

    assert chat_client(None).get("/assistant/chats").json() == []


def test_a_distill_that_redis_cannot_queue_is_logged_and_the_chat_stays_due(monkeypatch, caplog):
    marked = []

    async def find(user, chat_id):
        return object()

    async def mark_distilled(user, chat_id, now):
        marked.append(chat_id)

    def broken(user, chat_id, lines):
        raise RedisError("down")

    monkeypatch.setattr(chats, "due_for_distill", lambda sessions, now, leaving: ["c1"])
    monkeypatch.setattr(chats, "find", find)
    monkeypatch.setattr(chats, "messages", lambda chat: [])
    monkeypatch.setattr(chats, "distill_lines", lambda messages: ["user asked: hi"])
    monkeypatch.setattr(chats, "mark_distilled", mark_distilled)
    monkeypatch.setattr(main, "enqueue_distill", broken)

    with caplog.at_level(logging.WARNING, logger=main.logger.name):
        asyncio.run(main._queue_distills("user-ada", []))

    assert "queueing chat distills for user-ada failed" in caplog.text
    assert marked == []


# --- account and small routes ---


def test_clearing_researcher_data_without_a_login_has_no_facts_to_delete(client_as, monkeypatch):
    monkeypatch.setattr(main.store, "load_owned", lambda user: [])
    monkeypatch.setattr(main.store, "delete_projects", lambda user: None)
    monkeypatch.setattr(main.store, "delete_facts", lambda user: pytest.fail("deleted facts of nobody"))

    response = client_as(None).delete("/user/data", params={"scope": "researcher"})

    assert response.json() == {"deleted": 0, "skipped": 0}


def test_verify_checks_one_claim_against_one_source(client_as, monkeypatch):
    verdict = {"status": "ok", "verdict": "supports"}
    monkeypatch.setattr(main, "verify_claim", lambda claim, source: {**verdict, "claim": claim})

    response = client_as(None).post("/verify", json={"claim": "c", "source": "s"})

    assert response.json() == {**verdict, "claim": "c"}


def test_each_citation_of_a_sentence_citing_several_works_is_checked_as_one_of_several(monkeypatch, pipeline):
    """#943: the gateway tells check_prepared when the sentence cites other works too."""
    flags = {}
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {
            "status": "ok",
            "file": f"{paper}.pdf",
            "title": "T",
            "claims": [
                {"claim": "c1", "sentence": "A [b1] and B [b2].",
                 "citations": [{"key": "s1", "ref": "b1"}, {"key": "s2", "ref": "b2"}]},
                {"claim": "c2", "sentence": "Only C [b3].", "citations": [{"key": "s3", "ref": "b3"}]},
            ],
        },
    )
    monkeypatch.setattr(
        main,
        "check_prepared",
        lambda claim, source, path, judged="", other_citations=False, source_outcome=None: (
            flags.__setitem__(source, (judged, other_citations))
            or {"status": "ok", "claim": claim, "source": source, "verdict": "supports"}
        ),
    )

    run_analysis_job("g-several", "paper", True, None)

    assert flags == {
        "s1": ("A [cited] and B [other].", True),
        "s2": ("A [other] and B [cited].", True),
        "s3": ("Only C [cited].", False),
    }
