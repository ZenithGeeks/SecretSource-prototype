"""Application metrics for the analysis pipeline, in Prometheus's own types (counter, histogram,
gauge). Scraped from GET /metrics (main.py) by the `gateway` job in deploy/monitoring/prometheus.yml
(opt-in `monitoring` compose profile). Container CPU/memory already comes from cAdvisor; everything
here is what that can't see — success rate, queueing, LLM cost, and verdict/audit outcomes.

Kept in one module, imported wherever a pipeline step needs to record something, so every metric
name is defined exactly once.
"""

from prometheus_client import Counter, Gauge, Histogram

# --- Analysis lifecycle: success rate, duration, queueing (backend/app/main.py) ---

ANALYSES_STARTED = Counter("analyses_started_total", "Analyses accepted by POST /analyses")
ANALYSES_FINISHED = Counter(
    "analyses_finished_total", "Analyses that reached a final state", ["status"]  # done | error
)
ANALYSIS_DURATION_SECONDS = Histogram(
    "analysis_duration_seconds",
    "Wall-clock time from acceptance to a final state, including any time queued",
    buckets=(5, 15, 30, 60, 120, 300, 600, 1200, 1800, float("inf")),
)
ANALYSIS_QUEUE_WAIT_SECONDS = Histogram(
    "analysis_queue_wait_seconds",
    "Time an analysis waited in the job queue before a worker started it",
    buckets=(0, 1, 5, 15, 30, 60, 120, 300, float("inf")),
)
ANALYSES_RUNNING = Gauge(
    "analyses_running", "Analyses past the queue and actively running (extracting, verifying, ...)"
)

# --- Per-claim outcomes: the closest thing to a correctness signal today (backend/app/main.py) ---

CLAIM_VERDICTS = Counter(
    "claim_verdicts_total", "Verdicts recorded for a claim against a cited source", ["verdict"]
)
CLAIM_CHECKS_FAILED = Counter(
    "claim_checks_failed_total", "Claim checks that could not be completed", ["reason"]
)
AUDIT_FINDINGS = Counter(
    "audit_findings_total", "Findings from app/pipeline/audit.py's self-check, summed across analyses"
)

# --- LLM usage, from dspy.track_usage() around each call (pipeline/claims.py, pipeline/verify.py) ---

LLM_CALLS = Counter("llm_calls_total", "LLM calls made", ["phase"])  # extract | judge
LLM_TOKENS = Counter("llm_tokens_total", "LLM tokens used", ["phase", "kind"])  # kind: prompt | completion


def record_llm_usage(phase: str, tracker) -> None:
    """Fold a dspy.track_usage() tracker's totals into the counters above. One call is one LM in
    this codebase (app/llm.py), but this sums every entry regardless, so a future multi-model
    change here does not also need a change at each call site."""
    LLM_CALLS.labels(phase=phase).inc()
    for usage in tracker.get_total_tokens().values():
        if usage.get("prompt_tokens"):
            LLM_TOKENS.labels(phase=phase, kind="prompt").inc(usage["prompt_tokens"])
        if usage.get("completion_tokens"):
            LLM_TOKENS.labels(phase=phase, kind="completion").inc(usage["completion_tokens"])
