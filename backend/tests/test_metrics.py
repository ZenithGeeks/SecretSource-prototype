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
    LLM_TOKENS,
    current_analysis_tokens,
    record_llm_usage,
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
    monkeypatch.setattr("app.pipeline.sources.lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(main, "prepare_source", lambda s: {"status": "ok", "path": s})
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "add_paper", lambda file: {"status": "ok"})
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
        lambda claim, source, path, judged="": {
            "status": "ok", "claim": claim, "source": source, "verdict": "supports"
        },
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


class _Tracker:
    """Stands in for dspy.track_usage(): one LM entry with these token counts."""

    def __init__(self, prompt: int, completion: int):
        self._usage = {"lm": {"prompt_tokens": prompt, "completion_tokens": completion}}

    def get_total_tokens(self):
        return self._usage


def test_an_analysis_records_the_tokens_of_its_own_llm_calls(stub_pipeline, monkeypatch):
    def extract(paper):
        record_llm_usage("extract", _Tracker(2000, 700))
        return {"status": "ok", "file": f"{paper}.pdf", "title": "T",
                "claims": [{"claim": "c1", "citations": [{"key": "s1"}, {"key": "s2"}]}]}

    def check(claim, source, path, judged=""):
        record_llm_usage("judge", _Tracker(1000, 100))
        return {"status": "ok", "claim": claim, "source": source, "verdict": "supports"}

    saved = {}
    monkeypatch.setattr(main, "extract_claims_with_citations", extract)
    monkeypatch.setattr(main, "check_prepared", check)
    monkeypatch.setattr(main.store, "save", lambda analysis: saved.update(analysis))

    _run_to_completion("job-metrics-tokens", "paper-tokens")

    # Extraction and both checks run in worker threads; all of them add to this run's tokens.
    assert saved["llm_tokens"] == {
        "extract_prompt": 2000, "extract_completion": 700,
        "judge_prompt": 2000, "judge_completion": 200,
    }


def test_an_llm_call_outside_an_analysis_counts_only_in_prometheus():
    before = _value(LLM_TOKENS, phase="judge", kind="prompt")

    record_llm_usage("judge", _Tracker(5, 5))

    assert _value(LLM_TOKENS, phase="judge", kind="prompt") == before + 5
    assert current_analysis_tokens.get() is None


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
        lambda claim, source, path, judged="": {
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


def test_author_verifications_count_like_an_analysis_does(monkeypatch, tmp_path):
    """app.author.verify.verify_cached is where every Author verification passes (a draft
    check's citations, a single-claim check), so the same counters move there: once per claim
    checked, a remembered answer included, a failure under the reason an analysis would use."""
    from app.author.verify import verify_cached

    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "metrics.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    calls = []

    def run(claim, source):
        calls.append(source)
        if source == "crash":
            raise RuntimeError("the pipeline fell over")
        if source == "blog":
            return {"status": "error", "reason": "unresolvable", "message": "not found"}
        if source == "paywalled":
            return {"status": "error", "reason": "no-open-access", "message": "no free copy"}
        return {"status": "ok", "verdict": "refutes", "quote": "q", "reasoning": "r"}

    refutes = _value(CLAIM_VERDICTS, verdict="refutes")
    verify_cached("a claim", "10.1/x", run)
    assert _value(CLAIM_VERDICTS, verdict="refutes") == refutes + 1
    again = verify_cached("a claim", "10.1/x", run)  # read back from the cache: still a verdict
    assert again["cached"] is True and calls == ["10.1/x"]
    assert _value(CLAIM_VERDICTS, verdict="refutes") == refutes + 2

    paywalled = _value(CLAIM_CHECKS_FAILED, reason="no-open-access")
    web = _value(CLAIM_CHECKS_FAILED, reason="web-source")
    unresolvable = _value(CLAIM_CHECKS_FAILED, reason="unresolvable")
    failed = _value(CLAIM_CHECKS_FAILED, reason="failed")
    verify_cached("a claim", "paywalled", run)
    # a cited work with a link that is not found is a web page, not a lookup that failed
    verify_cached("a claim", "blog", run, {"url": "https://example.org/post"})
    verify_cached("a claim", "blog", run, {"title": "No link"})
    with pytest.raises(RuntimeError):
        verify_cached("a claim", "crash", run)
    assert _value(CLAIM_CHECKS_FAILED, reason="no-open-access") == paywalled + 1
    assert _value(CLAIM_CHECKS_FAILED, reason="web-source") == web + 1
    assert _value(CLAIM_CHECKS_FAILED, reason="unresolvable") == unresolvable + 1
    assert _value(CLAIM_CHECKS_FAILED, reason="failed") == failed + 1
    assert _value(CLAIM_VERDICTS, verdict="refutes") == refutes + 2
