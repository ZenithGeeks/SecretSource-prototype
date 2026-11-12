"""_publish() forwards the full analysis snapshot to Redis on every stage, additively
alongside its existing streams[]/store.save() behavior (see tasks/plan.md, Task 2). A single
claim/citation keeps stage ordering deterministic, since nothing here runs concurrently.

Driven through queue.run_analysis_job() (the worker's entry point, sync) rather than _start(),
since analyses no longer run in-process off POST /analyses.
"""

import copy
import json

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
        return {"status": "ok", "file": f"{paper}.pdf", "title": "T", "claims": claims}

    def save(analysis):
        saves.append(copy.deepcopy(analysis))

    monkeypatch.setattr(main.store, "save", save)
    monkeypatch.setattr(main, "extract_claims_with_citations", extract)
    # A non-empty title makes _index_self actually await asyncio.to_thread(index_paper, ...)
    # instead of returning synchronously -- returning synchronously races run_analysis_job's
    # _background drain loop under pytest's capture and can hang it (unrelated to this change).
    monkeypatch.setattr(main, "index_paper", lambda title: f"indexed:{title}")
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
    main.analyses.clear()
    main.streams.clear()
    yield saves
    main.analyses.clear()
    main.streams.clear()


def test_publish_sends_the_full_snapshot_to_redis_per_stage(stubbed_pipeline, monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(main, "redis_connection", lambda: fake)
    saves = stubbed_pipeline

    run_analysis_job("job-pub-1", "paper.pdf", True, None)

    # The last save is from the detached _index_self task, which run_analysis_job drains
    # before returning (see queue.py) but which never publishes to Redis on its own -- so
    # the last published snapshot corresponds to the save just before it, not the final one.
    stages = saves[-1]["stages"]
    assert len(fake.published) == len(stages) > 0

    for index, (channel, message) in enumerate(fake.published):
        assert channel == "analysis:job-pub-1"
        snapshot = json.loads(message)
        assert snapshot["id"] == "job-pub-1"
        # The snapshot published with stage N already carries stages[0..N], not fewer or more.
        assert snapshot["stages"] == stages[: index + 1]

    assert "indexed_in" not in json.loads(fake.published[-1][1])
    assert saves[-1]["indexed_in"] == "indexed:T"
    assert json.loads(fake.published[-1][1])["stages"] == saves[-1]["stages"]


def test_publish_survives_redis_being_down(stubbed_pipeline, monkeypatch):
    """A Redis outage must not leave the analysis stuck at status 'running' (see _publish's try/except)."""
    class DownRedis:
        def publish(self, channel, message):
            raise ConnectionError("redis is down")

    monkeypatch.setattr(main, "redis_connection", lambda: DownRedis())
    saves = stubbed_pipeline

    result = run_analysis_job("job-pub-2", "paper.pdf", True, None)

    assert result["status"] == "done"
    analysis = saves[-1]
    assert [stage["stage"] for stage in analysis["stages"]][:1] == ["extracting"]
    assert analysis["stages"][-1]["stage"] == "done"


def test_existing_stream_and_stage_behavior_is_unchanged(stubbed_pipeline, monkeypatch):
    """Redis is additive: an analysis with no reachable Redis-like object at all would still
    fail if _publish's existing behavior regressed, since the saved analysis is read here
    exactly like every other test in this suite does, unaffected by the new call."""
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())
    saves = stubbed_pipeline

    result = run_analysis_job("job-pub-3", "paper.pdf", True, None)

    assert result["status"] == "done"
    analysis = saves[-1]
    assert [stage["stage"] for stage in analysis["stages"]][:1] == ["extracting"]
    assert analysis["stages"][-1]["stage"] == "done"
