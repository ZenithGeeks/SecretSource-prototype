"""run_draft_check_job() (app/queue.py) is what a worker runs for one Author draft check:
it rebuilds the row the gateway queued, reads earlier checks of that draft from the store
(so an override still carries over), runs _run_draft_check, and drops the rows it loaded.
"""

import asyncio
import copy

import pytest
from app import main
from app.author import router as author
from app.author import verify as author_verify
from app.author.router import new_draft_check
from app.queue import _on_draft_check_job_failure, run_draft_check_job
from rq.job import JobStatus

TEX = r"Late interaction scores with MaxSim~\cite{khattab2020}."
BIB = """@inproceedings{khattab2020,
  title = {ColBERT},
  author = {Khattab, Omar and Zaharia, Matei},
  year = {2020},
  doi = {10.1145/3397271.3401075},
}
"""


class FakeRedis:
    def __init__(self):
        self.published: list[tuple[str, str]] = []

    def publish(self, channel: str, message: str) -> None:
        self.published.append((channel, message))


class _FakeJob:
    def __init__(self, args, kwargs=None):
        self.args = args
        self.kwargs = kwargs or {}


@pytest.fixture
def draft(monkeypatch, tmp_path):
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path / "papers")
    monkeypatch.setattr(author, "reference_checks", lambda entries: {})
    monkeypatch.setattr(author_verify, "find_cited_work", lambda title, fields: title)

    def verify(claim, source):
        return {
            "status": "ok",
            "claim": claim,
            "source": f"{source}.pdf",
            "verdict": "refutes",
            "quote": "the paper says refutes",
            "reasoning": "because",
            "evidence": [{"text": "t", "page": 4, "score": 0.9}],
        }

    monkeypatch.setattr(main, "verify_claim", verify)
    main.analyses.clear()
    main.streams.clear()
    row = {
        "id": "draft1",
        "owner": "user-ada",
        "projectId": None,
        "title": "Related work",
        "version": 1,
        "files": [
            {"name": "related-work.tex", "kind": "tex", "content": TEX},
            {"name": "main.bib", "kind": "bib", "content": BIB},
        ],
        "pdfs": {},
        "savedHash": "x",
    }
    main.store.save_author_row(author.DRAFTS, row)
    yield row
    main.analyses.clear()
    main.streams.clear()


def _queued(at: float = 1.0) -> dict:
    return {"stage": "queued", "message": "waiting for a free worker", "at": at}


def test_run_draft_check_job_publishes_stages_and_cleans_up(draft, monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(main, "redis_connection", lambda: fake)
    queued = _queued()

    result = run_draft_check_job(
        "chk1",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        [queued],
        "2026-10-19T00:00:00+00:00",
    )

    assert result == {"id": "chk1", "status": "done"}
    saved = main.store.load("chk1")
    assert saved["status"] == "done"
    assert saved["owner"] == "user-ada"
    assert saved["contentHash"] == "hash"
    stages = [stage["stage"] for stage in saved["stages"]]
    assert stages[0] == "queued" and "planned" in stages and stages[-1] == "done"
    assert saved["citations"][0]["verdict"] == "refutes"
    assert [channel for channel, _ in fake.published] == ["analysis:chk1"] * len(fake.published)
    assert fake.published
    assert "chk1" not in main.analyses
    assert "chk1" not in main.streams


def test_an_override_is_carried_from_the_store_not_from_this_process_memory(draft, monkeypatch):
    """The worker does not share the gateway's analyses dict. The previous check is whatever
    the store has, including a resolution the author saved after that check finished."""
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())
    first = new_draft_check(
        "chk-old",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        "2026-10-18T00:00:00+00:00",
    )
    main.analyses["chk-old"] = first
    main.streams["chk-old"] = asyncio.Queue()
    asyncio.run(author._run_draft_check("chk-old", "user-ada"))
    previous = main.store.load("chk-old")
    previous["citations"][0]["resolution"] = {"kind": "overridden", "note": "fine here"}
    main.store.save(previous)
    main.analyses.clear()
    main.streams.clear()

    result = run_draft_check_job(
        "chk-new",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        [_queued()],
        "2026-10-19T00:00:00+00:00",
    )

    assert result["status"] == "done"
    carried = main.store.load("chk-new")["citations"][0]
    assert carried["resolution"]["kind"] == "overridden"
    assert carried["verdict"] == "refutes"
    # the worker must not keep the sibling rows it loaded for the carry-over
    assert "chk-old" not in main.analyses
    assert "chk-new" not in main.analyses


def test_two_draft_checks_in_one_process_ignore_the_gateway_semaphore(draft, monkeypatch):
    """PARALLEL_CHECKS is the per-worker limit, created inside the check on that job's loop.
    The gateway-wide all_checks semaphore must not be reused: it is bound to whatever loop
    waited on it first, and every job has its own loop."""
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())
    sem = asyncio.Semaphore(1)

    async def bind():
        await sem.acquire()

    loop = asyncio.new_event_loop()
    loop.run_until_complete(bind())
    loop.close()
    monkeypatch.setattr(main, "all_checks", sem)

    first = run_draft_check_job(
        "chk-a",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        [_queued()],
        "2026-10-19T00:00:00+00:00",
    )
    second = run_draft_check_job(
        "chk-b",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        [_queued(2.0)],
        "2026-10-19T00:00:01+00:00",
    )

    assert first == {"id": "chk-a", "status": "done"}
    assert second == {"id": "chk-b", "status": "done"}


def test_restore_keeps_a_live_draft_check_and_interrupts_a_gone_one(monkeypatch):
    live = new_draft_check("live", "ada", "d1", "T", 1, "h", "2026-10-19T00:00:00+00:00", [_queued()])
    dead = new_draft_check("dead", "ada", "d1", "T", 1, "h", "2026-10-19T00:00:00+00:00", [_queued()])
    monkeypatch.setattr(
        main.store, "load_startup", lambda recent: {"live": copy.deepcopy(live), "dead": copy.deepcopy(dead)}
    )
    saved = []
    monkeypatch.setattr(main.store, "save", lambda row: saved.append(row["id"]))
    monkeypatch.setattr(main, "job_is_alive", lambda check_id: check_id == "live")

    main.restore()

    assert main.analyses["live"]["status"] == "running"
    assert main.analyses["dead"]["status"] == "error"
    assert main.analyses["dead"]["message"] == "interrupted by a restart"
    assert saved == ["dead"]
    main.analyses.clear()
    main.streams.clear()


def test_failure_callback_marks_a_stored_running_check_as_error(monkeypatch):
    stored = new_draft_check(
        "chk-f",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        "2026-10-19T00:00:00+00:00",
        [_queued()],
    )
    monkeypatch.setattr(main.store, "load", lambda check_id: stored if check_id == "chk-f" else None)
    saved = []
    monkeypatch.setattr(main.store, "save", lambda row: saved.append(copy.deepcopy(row)))
    published = []
    monkeypatch.setattr(
        "app.queue.redis_connection",
        lambda: type("R", (), {"publish": staticmethod(lambda ch, msg: published.append((ch, msg)))})(),
    )
    job = _FakeJob(
        ["chk-f", "user-ada", "draft1", "Related work", 1, "hash", [_queued()], stored["startedAt"]]
    )

    _on_draft_check_job_failure(job, None, RuntimeError, RuntimeError("boom"), None)

    assert saved[0]["status"] == "error"
    assert saved[0]["message"] == "boom"
    assert saved[0]["finishedAt"].endswith("+00:00")
    assert saved[0]["stages"][-1]["stage"] == "error"
    assert published and published[0][0] == "analysis:chk-f"


def test_failure_callback_builds_a_row_when_nothing_was_stored(monkeypatch):
    monkeypatch.setattr(main.store, "load", lambda check_id: None)
    saved = []
    monkeypatch.setattr(main.store, "save", lambda row: saved.append(row))
    monkeypatch.setattr("app.queue.redis_connection", lambda: FakeRedis())
    queued = _queued()
    job = _FakeJob(
        ["chk-f2", "user-ada", "draft1", "Related work", 2, "hash", [queued], "2026-10-19T00:00:00+00:00"]
    )

    _on_draft_check_job_failure(job, None, RuntimeError, RuntimeError("worker died"), None)

    check = saved[0]
    assert check["id"] == "chk-f2"
    assert check["kind"] == "draft-check"
    assert check["owner"] == "user-ada"
    assert check["draftId"] == "draft1"
    assert check["version"] == 2
    assert check["stages"][0] == queued
    assert check["stages"][-1]["stage"] == "error"
    assert check["status"] == "error"
    assert check["finishedAt"].endswith("+00:00")


def test_failure_callback_names_the_cause_when_the_worker_died(monkeypatch):
    from rq.exceptions import AbandonedJobError

    monkeypatch.setattr(main.store, "load", lambda check_id: None)
    saved = []
    monkeypatch.setattr(main.store, "save", lambda row: saved.append(row))
    monkeypatch.setattr("app.queue.redis_connection", lambda: FakeRedis())
    job = _FakeJob(
        ["chk-f3", "user-ada", "draft1", "Related work", 1, "hash", [_queued()], "2026-10-19T00:00:00+00:00"]
    )

    # RQ's cleanup passes an AbandonedJobError with no text when the job's worker is gone.
    _on_draft_check_job_failure(job, None, AbandonedJobError, AbandonedJobError(), None)

    assert saved[0]["message"] == "the worker stopped before this check finished"


class _Job:
    def __init__(self, status):
        self.status = status
        self.id = "chk-race"

    def get_status(self, refresh=True):
        return self.status


def test_a_cancelled_job_exits_before_it_saves(draft, monkeypatch):
    """Cancel won before the worker started. The job must not write the row back."""
    calls = []
    monkeypatch.setattr(main, "verify_claim", lambda *args, **kwargs: calls.append(args))
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())
    monkeypatch.setattr("app.queue.Job.fetch", lambda *args, **kwargs: _Job(JobStatus.CANCELED))

    result = run_draft_check_job(
        "chk-race",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        [_queued()],
        "2026-10-19T00:00:00+00:00",
    )

    assert result == {"id": "chk-race", "status": "cancelled"}
    assert calls == []
    assert main.store.load("chk-race") is None


def _stop_after_first_save(monkeypatch, job, *, cancel: bool):
    """Publish one stage, wait until it is stored, then drop the row. The next publish is
    the worker's next save, and it must not put the check back."""

    async def scripted(check_id, user):
        await main._publish(check_id, "planned", checks=1)
        await main._saved(check_id)
        if cancel:
            job.status = JobStatus.CANCELED
        main.store.delete(check_id)
        await main._publish(check_id, "done")

    monkeypatch.setattr(author, "_run_draft_check", scripted)


def test_a_cancel_during_the_check_does_not_save_the_deleted_row(draft, monkeypatch):
    """The worker was already running when cancel ran. It had stored a stage; the delete
    removed it. The next save must not put the check back."""
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())
    job = _Job(JobStatus.STARTED)
    monkeypatch.setattr("app.queue.Job.fetch", lambda *args, **kwargs: job)
    _stop_after_first_save(monkeypatch, job, cancel=True)

    result = run_draft_check_job(
        "chk-race",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        [_queued()],
        "2026-10-19T00:00:00+00:00",
    )

    assert result == {"id": "chk-race", "status": "cancelled"}
    assert main.store.load("chk-race") is None


def test_a_deleted_row_is_not_saved_again_when_cancel_did_not_stick(draft, monkeypatch):
    """Status still says started, but the gateway already deleted the row this job had stored."""
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())
    job = _Job(JobStatus.STARTED)
    monkeypatch.setattr("app.queue.Job.fetch", lambda *args, **kwargs: job)
    _stop_after_first_save(monkeypatch, job, cancel=False)

    result = run_draft_check_job(
        "chk-race",
        "user-ada",
        "draft1",
        "Related work",
        1,
        "hash",
        [_queued()],
        "2026-10-19T00:00:00+00:00",
    )

    assert result == {"id": "chk-race", "status": "cancelled"}
    assert main.store.load("chk-race") is None


def test_load_draft_checks_is_scoped_to_the_draft_and_owner(draft):
    started = "2026-10-01T00:00:00+00:00"
    main.store.save(new_draft_check("mine", "user-ada", "draft1", "T", 1, "h", "2026-10-02T00:00:00+00:00"))
    main.store.save(new_draft_check("other-owner", "user-bo", "draft1", "T", 1, "h", started))
    main.store.save(new_draft_check("other-draft", "user-ada", "draft2", "T", 1, "h", started))
    main.store.save({"id": "paper", "owner": "user-ada", "status": "done"})

    ids = {row["id"] for row in main.store.load_draft_checks("draft1", "user-ada")}

    assert ids == {"mine"}
