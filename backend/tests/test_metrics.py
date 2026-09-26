"""app.metrics counters and histograms update correctly across an analysis's lifecycle: a
successful run and a failed one, both driven through the real _start()/_run() path with the
pipeline's own functions stubbed out, the same way test_shared_limits.py drives it.
"""

import asyncio

import pytest
from app import main
from app.metrics import (
    ANALYSES_FINISHED,
    ANALYSES_STARTED,
    ANALYSIS_DURATION_SECONDS,
    AUDIT_FINDINGS,
    CLAIM_CHECKS_FAILED,
    CLAIM_VERDICTS,
)


def _value(metric, **labels):
    """A counter's (or a labelled counter's) current value, via the public collect() API."""
    target = metric.labels(**labels) if labels else metric
    return next(s.value for s in target.collect()[0].samples if s.name.endswith("_total"))


def _histogram_count(histogram):
    return next(s.value for s in histogram.collect()[0].samples if s.name.endswith("_count"))


@pytest.fixture
def stub_pipeline(monkeypatch):
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(main, "prepare_source", lambda s: {"status": "ok", "path": s})
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    findings = [{"kind": "claim-limit"}, {"kind": "ungrounded-quote"}]
    monkeypatch.setattr(main, "audit", lambda analysis: findings)
    main.analyses.clear()
    yield
    main.analyses.clear()


def _run_to_completion(paper: str):
    async def scenario():
        main._start(paper, True, None)
        while any(a["status"] == "running" for a in main.analyses.values()):
            await asyncio.sleep(0.01)

    asyncio.run(scenario())
    return next(iter(main.analyses.values()))


def test_a_successful_run_records_lifecycle_verdict_and_audit_metrics(stub_pipeline, monkeypatch):
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {
            "status": "ok", "file": f"{paper}.pdf",
            "claims": [{"claim": "c1", "citations": [{"key": "s1"}]}],
        },
    )
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path: {"status": "ok", "claim": claim, "source": source, "verdict": "supports"},
    )

    before_started = _value(ANALYSES_STARTED)
    before_finished = _value(ANALYSES_FINISHED, status="done")
    before_verdicts = _value(CLAIM_VERDICTS, verdict="supports")
    before_audit = _value(AUDIT_FINDINGS)
    before_duration_n = _histogram_count(ANALYSIS_DURATION_SECONDS)

    analysis = _run_to_completion("paper-ok")

    assert analysis["status"] == "done"
    assert _value(ANALYSES_STARTED) == before_started + 1
    assert _value(ANALYSES_FINISHED, status="done") == before_finished + 1
    assert _value(CLAIM_VERDICTS, verdict="supports") == before_verdicts + 1
    assert _value(AUDIT_FINDINGS) == before_audit + 2  # the two stubbed findings
    assert _histogram_count(ANALYSIS_DURATION_SECONDS) == before_duration_n + 1


def test_a_failed_check_is_counted_by_reason_not_as_a_verdict(stub_pipeline, monkeypatch):
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {
            "status": "ok", "file": f"{paper}.pdf",
            "claims": [{"claim": "c1", "citations": [{"key": "s1"}]}],
        },
    )
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path: {
            "status": "error", "message": "not found", "reason": "unresolvable",
            "claim": claim, "source": source,
        },
    )

    before_finished = _value(ANALYSES_FINISHED, status="done")
    before_failed = _value(CLAIM_CHECKS_FAILED, reason="unresolvable")
    before_supports = _value(CLAIM_VERDICTS, verdict="supports")

    analysis = _run_to_completion("paper-check-fails")

    assert analysis["status"] == "done"  # the analysis itself still finishes; one check failed
    assert _value(ANALYSES_FINISHED, status="done") == before_finished + 1
    assert _value(CLAIM_CHECKS_FAILED, reason="unresolvable") == before_failed + 1
    assert _value(CLAIM_VERDICTS, verdict="supports") == before_supports  # unchanged


def test_extraction_error_is_counted_as_finished_error_not_done(stub_pipeline, monkeypatch):
    def fail(paper):
        raise RuntimeError("grobid unreachable")

    monkeypatch.setattr(main, "extract_claims_with_citations", fail)

    before_error = _value(ANALYSES_FINISHED, status="error")
    before_done = _value(ANALYSES_FINISHED, status="done")
    before_duration_n = _histogram_count(ANALYSIS_DURATION_SECONDS)

    analysis = _run_to_completion("paper-bad")

    assert analysis["status"] == "error"
    assert _value(ANALYSES_FINISHED, status="error") == before_error + 1
    assert _value(ANALYSES_FINISHED, status="done") == before_done  # unchanged
    assert _histogram_count(ANALYSIS_DURATION_SECONDS) == before_duration_n + 1  # still recorded
