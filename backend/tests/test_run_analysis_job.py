"""run_analysis_job() (app/queue.py) is what a worker process actually runs for one
analysis: it rebuilds the skeleton the gateway's _start() would have built, runs the
pipeline via _run_queued directly (RQ already queued the job), waits for _index_self's
detached work, and cleans up analyses[]/streams[].
"""

import asyncio
import copy
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from app import main
from app.queue import run_analysis_job


class FakeRedis:
    def __init__(self):
        self.published: list[tuple[str, str]] = []

    def publish(self, channel: str, message: str) -> None:
        self.published.append((channel, message))


@pytest.fixture
def stubbed_pipeline(monkeypatch):
    saves: list[dict] = []

    def extract(paper):
        claims = [{"claim": "c0", "citations": [{"key": "s0"}]}]
        return {"status": "ok", "file": f"{paper}.pdf", "title": "A Paper", "claims": claims}

    def save(analysis):
        saves.append(copy.deepcopy(analysis))  # a later mutation must not change what we asserted

    monkeypatch.setattr(main.store, "save", save)
    monkeypatch.setattr(main, "extract_claims_with_citations", extract)
    monkeypatch.setattr("app.pipeline.sources.lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(main, "prepare_source", lambda source: {"status": "ok", "path": source})
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path, judged="", other_citations=False: {
            "status": "ok", "claim": claim, "source": source, "verdict": "supports"
        },
    )
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "add_paper", lambda file: {"status": "ok"})
    monkeypatch.setattr(main, "audit", lambda analysis: [])
    # A slight delay: without it, the detached _index_self task can happen to finish during
    # some other await inside _run_queued's own finally (e.g. _saved()'s polling loop) even
    # with no explicit drain, making the "drain lost work" mutation a false negative.
    monkeypatch.setattr(main, "index_paper", lambda title: (time.sleep(0.2), f"indexed:{title}")[1])
    monkeypatch.setattr(main, "redis_connection", FakeRedis)
    main.analyses.clear()
    main.streams.clear()
    yield saves
    main.analyses.clear()
    main.streams.clear()


def test_run_analysis_job_returns_a_small_result_and_cleans_up(stubbed_pipeline, monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(main, "redis_connection", lambda: fake)
    saves = stubbed_pipeline

    result = run_analysis_job("job1", "paper.pdf", True, "owner-1")

    assert result == {"id": "job1", "status": "done"}

    last = saves[-1]
    assert last["status"] == "done"
    assert last["owner"] == "owner-1"
    stage_names = [stage["stage"] for stage in last["stages"]]
    assert stage_names[0] == "extracting"  # no "queued": the job skips _run
    assert "queued" not in stage_names
    assert stage_names[-1] == "done"

    for channel, _ in fake.published:
        assert channel == "analysis:job1"
    assert fake.published  # at least one stage published

    assert "job1" not in main.analyses
    assert "job1" not in main.streams


def test_a_job_with_a_claim_limit_extracts_with_that_limit(stubbed_pipeline, monkeypatch):
    limits = []

    def extract_cited(paper, limit):
        limits.append(limit)
        return {"status": "ok", "file": f"{paper}.pdf", "title": "A Paper", "claims": []}

    monkeypatch.setattr(main, "extract_cited_claims", extract_cited)
    run_analysis_job("job1", "paper.pdf", True, "owner-1", None, None, 0)
    assert limits == [0]
    assert stubbed_pipeline[-1]["claim_limit"] == 0


def test_run_analysis_job_runs_twice_in_one_process(stubbed_pipeline, monkeypatch):
    """The event-loop trap: main.all_sources/all_checks are module-level asyncio.Semaphores
    that bind to the loop of whichever coroutine first has to actually wait on them (only the
    *waiting* path touches the loop -- see asyncio.Semaphore.acquire()). Each job makes its own
    asyncio.run loop, so without rebinding fresh semaphores inside the job, a second job reusing
    an object a previous job's loop already contended on raises "bound to a different event loop".

    We preset main.all_sources/all_checks to small, already-existing Semaphores here (as if a
    prior job had left them behind) so the trap bites regardless of the process-wide default
    capacity: correct code overwrites them with fresh ones every job and never notices; the
    buggy code (no rebinding) reuses these same objects across two different event loops.
    """
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())
    monkeypatch.setattr(main, "all_sources", asyncio.Semaphore(1))
    monkeypatch.setattr(main, "all_checks", asyncio.Semaphore(1))

    def extract(paper):
        claims = [
            {"claim": f"{paper}-{i}", "citations": [{"key": f"{paper}-{i}"}]} for i in range(3)
        ]
        return {"status": "ok", "file": f"{paper}.pdf", "title": "A Paper", "claims": claims}

    def prepare(source):
        time.sleep(0.02)
        return {"status": "ok", "path": source}

    def check(claim, source, path, judged="", other_citations=False):
        time.sleep(0.02)
        return {"status": "ok", "claim": claim, "source": source, "verdict": "supports"}

    monkeypatch.setattr(main, "extract_claims_with_citations", extract)
    monkeypatch.setattr(main, "prepare_source", prepare)
    monkeypatch.setattr(main, "check_prepared", check)
    # PARALLEL_SOURCES/PARALLEL_CHECKS (the *local*, per-run limit) stay at their default of 3,
    # so all 3 sources/checks can be in flight together -- that's what makes them actually
    # contend on the shared *global* all_sources/all_checks capacity of 1 we preset above,
    # instead of source_limit/check_limit already serializing them to one at a time.
    monkeypatch.setattr(main, "PARALLEL_SOURCES_TOTAL", 1)
    monkeypatch.setattr(main, "PARALLEL_CHECKS_TOTAL", 1)

    result1 = run_analysis_job("job-a", "paper-a.pdf", True, None)
    result2 = run_analysis_job("job-b", "paper-b.pdf", True, None)

    assert result1 == {"id": "job-a", "status": "done"}
    assert result2 == {"id": "job-b", "status": "done"}


def test_run_analysis_job_waits_for_detached_indexing(stubbed_pipeline):
    """_run_queued detaches _index_self (via _detach) after "done" and returns without
    waiting. asyncio.run() cancels pending tasks when its loop exits, so run_analysis_job
    must explicitly drain main._background or this result is lost."""
    saves = stubbed_pipeline

    run_analysis_job("job-index", "paper.pdf", True, None)

    last = saves[-1]
    assert last["indexed_in"] == "indexed:A Paper"


def test_a_stale_done_task_in_the_background_set_does_not_block_the_drain(stubbed_pipeline):
    """A task can sit in main._background already finished but not yet discarded (its
    done-callback runs via call_soon, not synchronously) -- or, as reproduced here, never
    discarded at all because it was never registered through _detach(). The drain loop
    (queue.py) must only wait on tasks that are still pending, or a leftover finished task
    like this spins it forever. Run in a thread with a timeout so a regression here fails
    this test instead of hanging the whole suite."""

    async def already_done():
        return None

    stale_loop = asyncio.new_event_loop()
    stale_task = stale_loop.create_task(already_done())
    stale_loop.run_until_complete(stale_task)
    stale_loop.close()
    main._background.add(stale_task)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(run_analysis_job, "job-stale-bg", "paper.pdf", True, None)
            result = future.result(timeout=15)
    finally:
        main._background.discard(stale_task)

    assert result == {"id": "job-stale-bg", "status": "done"}

def test_the_analysed_paper_is_indexed_for_search(stubbed_pipeline, monkeypatch):
    indexed = []
    monkeypatch.setattr(main, "add_paper", lambda file: indexed.append(file) or {"status": "ok"})

    run_analysis_job("job-own", "paper.pdf", True, "owner-1")

    assert indexed == ["paper.pdf.pdf"]  # the stub's extract names the file f"{paper}.pdf"


def test_a_paper_that_fails_to_index_still_finishes(stubbed_pipeline, monkeypatch):
    failed = {"status": "error", "message": "ColBERT is down", "reason": "indexing-failed"}
    monkeypatch.setattr(main, "add_paper", lambda file: failed)

    assert run_analysis_job("job-down", "paper.pdf", True, "owner-1") == {"id": "job-down", "status": "done"}
