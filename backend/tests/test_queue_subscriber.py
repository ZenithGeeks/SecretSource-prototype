"""_apply_snapshot turns a Redis analysis snapshot into analyses[]/streams[] state (see
tasks/plan.md, Task 3). _subscribe_forever is the loop around it; it is tested separately for
resilience against Redis being unavailable, without touching real Redis.
"""

import asyncio

import pytest
from app import main


@pytest.fixture(autouse=True)
def clean_state():
    main.analyses.clear()
    main.streams.clear()
    main._deleted.clear()
    yield
    main.analyses.clear()
    main.streams.clear()
    main._deleted.clear()


def _drain(queue: asyncio.Queue) -> list:
    items = []
    try:
        while True:
            items.append(queue.get_nowait())
    except asyncio.QueueEmpty:
        pass
    return items


def test_unseen_id_creates_analysis_and_pushes_every_stage_in_order():
    stages = [{"stage": "queued"}, {"stage": "extracting"}]
    snapshot = {"id": "a1", "status": "running", "stages": stages, "claims": []}

    main._apply_snapshot(snapshot)

    assert main.analyses["a1"] is snapshot
    assert _drain(main.streams["a1"]) == stages


def test_second_snapshot_pushes_only_the_new_stages():
    first = {"id": "a1", "status": "running", "stages": [{"stage": "queued"}], "claims": []}
    main._apply_snapshot(first)
    main.streams["a1"].get_nowait()

    second = {
        "id": "a1",
        "status": "running",
        "stages": [{"stage": "queued"}, {"stage": "extracting"}, {"stage": "checking"}],
        "claims": [],
    }
    main._apply_snapshot(second)

    assert main.analyses["a1"] is second
    assert _drain(main.streams["a1"]) == [{"stage": "extracting"}, {"stage": "checking"}]


def test_reapplying_the_same_snapshot_pushes_nothing():
    snapshot = {"id": "a1", "status": "running", "stages": [{"stage": "queued"}], "claims": []}
    main._apply_snapshot(snapshot)
    _drain(main.streams["a1"])

    main._apply_snapshot(snapshot)

    assert main.analyses["a1"] is snapshot
    assert _drain(main.streams["a1"]) == []


def test_additive_phase_guard_leaves_the_local_in_process_dict_untouched():
    local = {
        "id": "a1",
        "status": "running",
        "stages": [{"stage": "queued"}, {"stage": "extracting"}, {"stage": "checking"}],
        "claims": [{"claim": "x", "verdict": "supports"}],
    }
    main.analyses["a1"] = local
    main.streams["a1"] = asyncio.Queue()

    stale = {
        "id": "a1",
        "status": "running",
        "stages": [{"stage": "queued"}, {"stage": "extracting"}],
        "claims": [{"claim": "y", "verdict": "refutes"}],
    }
    main._apply_snapshot(stale)

    assert main.analyses["a1"] is local
    assert main.analyses["a1"]["claims"] == [{"claim": "x", "verdict": "supports"}]
    assert _drain(main.streams["a1"]) == []


def test_terminal_snapshot_pushes_the_stage_then_none_only_once():
    running = {"id": "a1", "status": "running", "stages": [{"stage": "queued"}], "claims": []}
    main._apply_snapshot(running)
    _drain(main.streams["a1"])

    done = {
        "id": "a1",
        "status": "done",
        "stages": [{"stage": "queued"}, {"stage": "done"}],
        "claims": [],
    }
    main._apply_snapshot(done)
    assert _drain(main.streams["a1"]) == [{"stage": "done"}, None]

    main._apply_snapshot(done)
    assert _drain(main.streams["a1"]) == []


def test_deleted_id_is_never_created():
    main._deleted.add("a1")
    snapshot = {"id": "a1", "status": "running", "stages": [{"stage": "queued"}], "claims": []}

    main._apply_snapshot(snapshot)

    assert "a1" not in main.analyses
    assert "a1" not in main.streams


def test_subscribe_forever_retries_on_connection_errors_and_cancels_cleanly(monkeypatch):
    monkeypatch.setattr(main, "_SUBSCRIBE_BACKOFF_START", 0.01)
    monkeypatch.setattr(main, "_SUBSCRIBE_BACKOFF_MAX", 0.01)

    attempts = []

    class FakePubSub:
        async def psubscribe(self, *args, **kwargs):
            attempts.append(1)
            raise ConnectionError("no redis")

    class FakeClient:
        def pubsub(self):
            return FakePubSub()

        async def close(self):
            pass

    monkeypatch.setattr(main, "pubsub_client", lambda: FakeClient())

    async def scenario():
        task = asyncio.create_task(main._subscribe_forever())
        while len(attempts) < 2:
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(asyncio.wait_for(scenario(), timeout=5))
    assert len(attempts) >= 2
