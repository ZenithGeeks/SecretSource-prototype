"""Integration test: a real AnalysisWorker (an RQ SimpleWorker, in-process, so monkeypatches apply)
running run_analysis_job() against a real Redis, not just calling the function directly.
Skipped when no Redis is reachable at REDIS_URL.
"""

import copy
import uuid

import pytest
import redis
import rq
from app import main
from app.config import REDIS_URL
from app.queue import (
    JOB_TIMEOUT,
    AnalysisWorker,
    redis_connection,
    run_analysis_job,  # noqa: F401  (referenced by name when enqueuing)
)
from rq.serializers import JSONSerializer

try:
    redis.Redis.from_url(REDIS_URL, socket_connect_timeout=1).ping()
except Exception:
    pytest.skip("needs a reachable Redis at REDIS_URL", allow_module_level=True)


@pytest.fixture
def stubbed_pipeline(monkeypatch):
    saves: list[dict] = []

    def extract(paper):
        claims = [{"claim": "c0", "citations": [{"key": "s0"}]}]
        return {"status": "ok", "file": f"{paper}.pdf", "title": "A Paper", "claims": claims}

    def save(analysis):
        saves.append(copy.deepcopy(analysis))

    monkeypatch.setattr(main.store, "save", save)
    monkeypatch.setattr(main, "extract_claims_with_citations", extract)
    monkeypatch.setattr(main, "lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(main, "prepare_source", lambda source: {"status": "ok", "path": source})
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path: {"status": "ok", "claim": claim, "source": source, "verdict": "supports"},
    )
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "audit", lambda analysis: [])
    monkeypatch.setattr(main, "index_paper", lambda title: f"indexed:{title}")
    main.analyses.clear()
    main.streams.clear()
    yield saves
    main.analyses.clear()
    main.streams.clear()


def test_run_analysis_job_via_rq_simple_worker(stubbed_pipeline):
    saves = stubbed_pipeline
    # A unique queue per test run: flushing only our own keys isn't practical against a
    # shared Redis, so we use a throwaway queue name and delete it afterwards instead.
    queue_name = f"test-analyses-{uuid.uuid4().hex}"
    queue = rq.Queue(queue_name, connection=redis_connection(), serializer=JSONSerializer)
    try:
        job = queue.enqueue(
            run_analysis_job, "job-rq", "paper.pdf", True, "owner-1",
            job_id="job-rq", job_timeout=JOB_TIMEOUT,
        )
        # SimpleWorker runs the job in this same process (no fork), so our monkeypatches
        # on `main` are visible to it. The default forking Worker would not see them.
        AnalysisWorker([queue], connection=redis_connection(), serializer=JSONSerializer).work(burst=True)

        job.refresh()
        assert job.get_status() == "finished"
        # rq's return-value API changed between versions; use whichever this install has.
        result = job.return_value() if hasattr(job, "return_value") else job.result
        assert result == {"id": "job-rq", "status": "done"}

        last = saves[-1]
        assert last["status"] == "done"
    finally:
        queue.delete(delete_jobs=True)


def test_a_job_that_escapes_run_analysis_job_is_saved_as_error_by_the_failure_callback(
    stubbed_pipeline, monkeypatch
):
    """run_analysis_job's own except turns a pipeline exception into status "error" already
    (see test_run_analysis_job.py); this covers what escapes that -- here, _run_queued itself
    raising, which propagates out of run_analysis_job and is caught by RQ's on_failure callback."""
    from app.queue import _on_analysis_job_failure
    from rq.job import Callback

    saves = stubbed_pipeline

    async def broken(*args, **kwargs):
        raise RuntimeError("pipeline wrapper crashed")

    monkeypatch.setattr(main, "_run_queued", broken)

    queue_name = f"test-analyses-{uuid.uuid4().hex}"
    queue = rq.Queue(queue_name, connection=redis_connection(), serializer=JSONSerializer)
    try:
        queue.enqueue(
            run_analysis_job, "job-rq-fail", "paper.pdf", True, "owner-1", [],
            job_id="job-rq-fail", job_timeout=JOB_TIMEOUT,
            on_failure=Callback(_on_analysis_job_failure),
        )
        AnalysisWorker([queue], connection=redis_connection(), serializer=JSONSerializer).work(burst=True)

        job = rq.job.Job.fetch("job-rq-fail", connection=redis_connection(), serializer=JSONSerializer)
        assert job.get_status() == "failed"

        last = saves[-1]
        assert last["id"] == "job-rq-fail"
        assert last["status"] == "error"
        assert last["stages"][-1]["stage"] == "error"
    finally:
        queue.delete(delete_jobs=True)


CALLED: list[str] = []


def not_an_analysis(marker: str) -> None:
    CALLED.append(marker)


def test_a_job_naming_another_function_is_refused_and_never_runs():
    CALLED.clear()
    queue_name = f"test-analyses-{uuid.uuid4().hex}"
    queue = rq.Queue(queue_name, connection=redis_connection(), serializer=JSONSerializer)
    try:
        queue.enqueue(not_an_analysis, "ran", job_id="job-rq-foreign")
        AnalysisWorker([queue], connection=redis_connection(), serializer=JSONSerializer).work(burst=True)

        job = rq.job.Job.fetch("job-rq-foreign", connection=redis_connection(), serializer=JSONSerializer)
        assert job.get_status() == "failed"
        assert CALLED == []
    finally:
        queue.delete(delete_jobs=True)
