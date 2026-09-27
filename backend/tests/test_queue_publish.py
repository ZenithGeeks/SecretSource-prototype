"""_publish() forwards the full analysis snapshot to Redis on every stage, additively
alongside its existing streams[]/store.save() behavior (see tasks/plan.md, Task 2). A single
claim/citation keeps stage ordering deterministic, since nothing here runs concurrently.
"""

import asyncio
import json

import pytest
from app import main


class FakeRedis:
    def __init__(self):
        self.published: list[tuple[str, str]] = []

    def publish(self, channel: str, message: str) -> None:
        self.published.append((channel, message))


@pytest.fixture
def stubbed_pipeline(monkeypatch):
    def extract(paper):
        claims = [{"claim": "c0", "citations": [{"key": "s0"}]}]
        return {"status": "ok", "file": f"{paper}.pdf", "claims": claims}

    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "extract_claims_with_citations", extract)
    monkeypatch.setattr(main, "lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(main, "prepare_source", lambda source: {"status": "ok", "path": source})
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path: {"status": "ok", "claim": claim, "source": source, "verdict": "supports"},
    )
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "audit", lambda analysis: [])
    main.analyses.clear()
    yield
    main.analyses.clear()


def _run_to_completion(paper: str) -> str:
    async def scenario():
        analysis_id = main._start(paper, True, None)["id"]
        async def wait():
            while main.analyses[analysis_id]["status"] == "running":
                await asyncio.sleep(0.01)
        await asyncio.wait_for(wait(), timeout=10)
        return analysis_id

    return asyncio.run(scenario())


def test_publish_sends_the_full_snapshot_to_redis_per_stage(stubbed_pipeline, monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(main, "redis_connection", lambda: fake)

    analysis_id = _run_to_completion("paper.pdf")

    stages = main.analyses[analysis_id]["stages"]
    assert len(fake.published) == len(stages) > 0

    for index, (channel, message) in enumerate(fake.published):
        assert channel == f"analysis:{analysis_id}"
        snapshot = json.loads(message)
        assert snapshot["id"] == analysis_id
        # The snapshot published with stage N already carries stages[0..N], not fewer or more.
        assert snapshot["stages"] == stages[: index + 1]

    assert json.loads(fake.published[-1][1]) == main.analyses[analysis_id]


def test_publish_survives_redis_being_down(stubbed_pipeline, monkeypatch):
    """A Redis outage must not leave the analysis stuck at status 'running' (see _publish's try/except)."""
    class DownRedis:
        def publish(self, channel, message):
            raise ConnectionError("redis is down")

    monkeypatch.setattr(main, "redis_connection", lambda: DownRedis())

    analysis_id = _run_to_completion("paper.pdf")

    analysis = main.analyses[analysis_id]
    assert analysis["status"] == "done"
    assert [stage["stage"] for stage in analysis["stages"]][:2] == ["queued", "extracting"]
    assert analysis["stages"][-1]["stage"] == "done"


def test_existing_stream_and_stage_behavior_is_unchanged(stubbed_pipeline, monkeypatch):
    """Redis is additive: an analysis with no reachable Redis-like object at all would still
    fail if _publish's existing behavior regressed, since streams[]/analyses[] are read here
    exactly like every other test in this suite does, unaffected by the new call."""
    monkeypatch.setattr(main, "redis_connection", lambda: FakeRedis())

    analysis_id = _run_to_completion("paper.pdf")

    analysis = main.analyses[analysis_id]
    assert analysis["status"] == "done"
    assert [stage["stage"] for stage in analysis["stages"]][:2] == ["queued", "extracting"]
    assert analysis["stages"][-1]["stage"] == "done"
