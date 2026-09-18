"""Analyses running at once share one limit on sources and checks, and take turns under it
(#170). The pipeline steps are stubs that sleep, so the tests only see the scheduling.
"""

import asyncio
import threading
import time

import pytest
from app import main

CLAIMS = 6


@pytest.fixture
def two_runs(monkeypatch):
    lock = threading.Lock()
    in_flight = {"prepare": 0, "check": 0}
    most = {"prepare": 0, "check": 0}
    started = []  # the run of each check, in the order checks started

    def counted(kind, answer):
        with lock:
            in_flight[kind] += 1
            most[kind] = max(most[kind], in_flight[kind])
        time.sleep(0.05)
        with lock:
            in_flight[kind] -= 1
        return answer

    def extract(paper):
        claims = [
            {"claim": f"{paper} {i}", "citations": [{"key": f"{paper}-{i % 2}"}]} for i in range(CLAIMS)
        ]
        return {"status": "ok", "file": f"{paper}.pdf", "claims": claims}

    def check(claim, source, path):
        with lock:
            started.append(claim.split()[0])
        return counted("check", {"status": "ok", "claim": claim, "source": source, "verdict": "supports"})

    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "extract_claims_with_citations", extract)
    monkeypatch.setattr(main, "lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(main, "prepare_source", lambda s: counted("prepare", {"status": "ok", "path": s}))
    monkeypatch.setattr(main, "check_prepared", check)
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "audit", lambda analysis: [])
    monkeypatch.setattr(main, "PARALLEL_SOURCES", 2)
    monkeypatch.setattr(main, "PARALLEL_CHECKS", 2)
    main.analyses.clear()

    def run(sources_total: int, checks_total: int) -> list[str]:
        async def scenario():
            # Made inside the loop the runs use; the gateway's own are made once at import.
            monkeypatch.setattr(main, "all_sources", asyncio.Semaphore(sources_total))
            monkeypatch.setattr(main, "all_checks", asyncio.Semaphore(checks_total))
            main._start("a", True, None)
            main._start("b", True, None)
            while any(analysis["status"] == "running" for analysis in main.analyses.values()):
                await asyncio.sleep(0.01)
            return sorted(analysis["status"] for analysis in main.analyses.values())

        return asyncio.run(scenario())

    yield run, most, started
    main.analyses.clear()


def test_runs_stay_under_the_shared_limits(two_runs):
    run, most, started = two_runs
    assert run(sources_total=1, checks_total=2) == ["done", "done"]
    assert most == {"prepare": 1, "check": 2}  # each run alone may do 2 of each
    assert sorted(started) == ["a"] * CLAIMS + ["b"] * CLAIMS


def test_a_second_run_does_not_wait_for_all_of_the_first_runs_checks(two_runs):
    run, most, started = two_runs
    assert run(sources_total=4, checks_total=2) == ["done", "done"]  # both runs' papers ready together
    assert most["check"] == 2
    first = started[0]
    second = "b" if first == "a" else "a"
    last_of_first = len(started) - 1 - started[::-1].index(first)
    assert started.index(second) < last_of_first, started
