"""Integration test: a real RQ SimpleWorker (in-process, so monkeypatches apply) actually
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
    redis_connection,
    run_analysis_job,  # noqa: F401  (referenced by name when enqueuing)
)

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
    queue = rq.Queue(queue_name, connection=redis_connection())
    try:
        job = queue.enqueue(
            run_analysis_job, "job-rq", "paper.pdf", True, "owner-1",
            job_id="job-rq", job_timeout=JOB_TIMEOUT,
        )
        # SimpleWorker runs the job in this same process (no fork), so our monkeypatches
        # on `main` are visible to it. The default forking Worker would not see them.
        rq.SimpleWorker([queue], connection=redis_connection()).work(burst=True)

        job.refresh()
        assert job.get_status() == "finished"
        # rq's return-value API changed between versions; use whichever this install has.
        result = job.return_value() if hasattr(job, "return_value") else job.result
        assert result == {"id": "job-rq", "status": "done"}

        last = saves[-1]
        assert last["status"] == "done"
    finally:
        queue.delete(delete_jobs=True)
