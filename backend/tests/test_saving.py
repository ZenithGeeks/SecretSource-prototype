"""Analyses are saved from a thread, so a slow store does not stop the gateway answering (#169).
The store is replaced by a dict whose save sleeps, the way a Supabase upsert takes 200-300 ms.
"""

import asyncio
import time

import pytest
from app import main


@pytest.fixture
def slow_store(monkeypatch):
    rows = {}
    saves = []

    def save(analysis):
        time.sleep(0.2)
        saves.append(analysis)
        rows[analysis["id"]] = analysis

    monkeypatch.setattr(main.store, "save", save)
    monkeypatch.setattr(main.store, "delete", lambda analysis_id: rows.pop(analysis_id, None) is not None)
    main.analyses.clear()
    main.streams.clear()
    yield rows, saves
    main.analyses.clear()
    main.streams.clear()


def running(analysis_id: str) -> None:
    main.analyses[analysis_id] = {
        "id": analysis_id,
        "status": "running",
        "owner": None,
        "stages": [],
        "claims": [],
    }
    main.streams[analysis_id] = asyncio.Queue()


def test_publishing_does_not_wait_for_the_store(slow_store):
    rows, saves = slow_store

    async def scenario():
        running("a")
        started = time.perf_counter()
        for claim in range(10):
            await main._publish("a", "verified", claim=claim)
        elapsed = time.perf_counter() - started
        await main._saved("a")
        return elapsed

    elapsed = asyncio.run(scenario())
    assert elapsed < 0.1  # ten saves on the loop take 2 s
    assert len(saves) < 10  # stages published during a save are written together
    assert len(rows["a"]["stages"]) == 10  # the stored state is the final one


def test_a_save_writes_a_copy_not_the_live_analysis(slow_store):
    rows, _ = slow_store

    async def scenario():
        running("a")
        await main._publish("a", "extracted")
        await asyncio.sleep(0.05)  # the save has taken its copy and is writing it
        main.analyses["a"]["claims"].append({"claim": "added during the save"})
        await main._saved("a")

    asyncio.run(scenario())
    assert rows["a"]["claims"] == []


def test_a_save_in_flight_does_not_bring_back_a_deleted_analysis(slow_store, monkeypatch):
    rows, _ = slow_store
    # Not what this test is about: a "running" row can only be deleted once its RQ job is
    # confirmed still queued (app/main.py's delete_analysis).
    monkeypatch.setattr(main, "cancel_if_queued", lambda analysis_id: True)

    async def scenario():
        running("a")
        await main._publish("a", "extracted")
        await asyncio.sleep(0.05)  # the save is running
        return await main.delete_analysis("a", user=None)

    assert asyncio.run(scenario()) == {"deleted": "a"}
    assert "a" not in rows
    assert "a" not in main.analyses
