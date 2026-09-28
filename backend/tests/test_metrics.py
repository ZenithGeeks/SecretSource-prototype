"""app.metrics counters and histograms update correctly across an analysis's lifecycle: a
successful run and a failed one, both driven through queue.run_analysis_job() (the worker's
entry point) with the pipeline's own functions stubbed out, the same way test_shared_limits.py
drives _run_queued.
"""

import time

import pytest
from app import main
from app.metrics import (
    ANALYSES_FINISHED,
    ANALYSES_STARTED,
    ANALYSIS_DURATION_SECONDS,
    ANALYSIS_QUEUE_WAIT_SECONDS,
    AUDIT_FINDINGS,
    CLAIM_CHECKS_FAILED,
    CLAIM_VERDICTS,
)
from app.queue import run_analysis_job


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
    monkeypatch.setattr(main, "redis_connection", lambda: _NullRedis())
    # A non-empty title makes _index_self actually await asyncio.to_thread(index_paper, ...)
    # instead of returning synchronously -- returning synchronously races run_analysis_job's
    # _background drain loop under pytest's capture and can hang it (unrelated to this change).
    monkeypatch.setattr(main, "index_paper", lambda title: f"indexed:{title}")
    main.analyses.clear()
    main.streams.clear()
    yield
    main.analyses.clear()
    main.streams.clear()


class _NullRedis:
    def publish(self, channel, message):
        pass


def _run_to_completion(analysis_id: str, paper: str, stages=None) -> dict:
    result = run_analysis_job(analysis_id, paper, True, None, stages)
    return result


def test_a_successful_run_records_lifecycle_verdict_and_audit_metrics(stub_pipeline, monkeypatch):
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {
            "status": "ok", "file": f"{paper}.pdf", "title": "T",
            "claims": [{"claim": "c1", "citations": [{"key": "s1"}]}],
        },
    )
    monkeypatch.setattr(
        main, "check_prepared",
        lambda claim, source, path: {"status": "ok", "claim": claim, "source": source, "verdict": "supports"},
    )

    before_finished = _value(ANALYSES_FINISHED, status="done")
    before_verdicts = _value(CLAIM_VERDICTS, verdict="supports")
    before_audit = _value(AUDIT_FINDINGS)
    before_duration_n = _histogram_count(ANALYSIS_DURATION_SECONDS)

    result = _run_to_completion("job-metrics-ok", "paper-ok")

    assert result["status"] == "done"
    assert _value(ANALYSES_FINISHED, status="done") == before_finished + 1
    assert _value(CLAIM_VERDICTS, verdict="supports") == before_verdicts + 1
    assert _value(AUDIT_FINDINGS) == before_audit + 2  # the two stubbed findings
    assert _histogram_count(ANALYSIS_DURATION_SECONDS) == before_duration_n + 1


def test_a_failed_check_is_counted_by_reason_not_as_a_verdict(stub_pipeline, monkeypatch):
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {
            "status": "ok", "file": f"{paper}.pdf", "title": "T",
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

    result = _run_to_completion("job-metrics-check-fails", "paper-check-fails")

    assert result["status"] == "done"  # the analysis itself still finishes; one check failed
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

    result = _run_to_completion("job-metrics-bad", "paper-bad")

    assert result["status"] == "error"
    assert _value(ANALYSES_FINISHED, status="error") == before_error + 1
    assert _value(ANALYSES_FINISHED, status="done") == before_done  # unchanged
    assert _histogram_count(ANALYSIS_DURATION_SECONDS) == before_duration_n + 1  # still recorded


def test_queue_wait_is_observed_from_the_queued_stages_timestamp(stub_pipeline, monkeypatch):
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {"status": "ok", "file": f"{paper}.pdf", "title": "T", "claims": []},
    )
    before = _histogram_count(ANALYSIS_QUEUE_WAIT_SECONDS)
    queued = {"stage": "queued", "message": "waiting for a free worker", "at": round(time.time(), 1)}

    _run_to_completion("job-metrics-wait", "paper-wait", stages=[queued])

    assert _histogram_count(ANALYSIS_QUEUE_WAIT_SECONDS) == before + 1


def test_analyses_started_is_not_touched_by_the_worker(stub_pipeline, monkeypatch):
    """ANALYSES_STARTED is incremented by _start() (POST /analyses), not by the job itself."""
    monkeypatch.setattr(
        main,
        "extract_claims_with_citations",
        lambda paper: {"status": "ok", "file": f"{paper}.pdf", "title": "T", "claims": []},
    )
    before = _value(ANALYSES_STARTED)

    _run_to_completion("job-metrics-started", "paper-started")

    assert _value(ANALYSES_STARTED) == before
