"""Application metrics for the analysis pipeline, in Prometheus's own types (counter, histogram,
gauge). Scraped from GET /metrics (main.py) by the `gateway` job in deploy/monitoring/prometheus.yml
(opt-in `monitoring` compose profile). Container CPU/memory already comes from cAdvisor; everything
here is what that can't see — success rate, queueing, LLM cost, and verdict/audit outcomes.

Kept in one module, imported wherever a pipeline step needs to record something, so every metric
name is defined exactly once.
"""

import threading
from contextvars import ContextVar

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


# The running analysis's own token counts, keyed "<phase>_<kind>" (for example "judge_prompt"),
# so its saved record says what its LLM calls cost (CONSTRAINTS.md). main._run_queued sets it to
# analysis["llm_tokens"]. asyncio.to_thread copies the context, and the copy points at the same
# dict, so calls made in worker threads add to it; the lock stops two threads losing an addition.
current_analysis_tokens: ContextVar[dict[str, int] | None] = ContextVar(
    "current_analysis_tokens", default=None
)
_tokens_lock = threading.Lock()


def record_llm_usage(phase: str, tracker) -> None:
    """Add one LLM call's tokens to the Prometheus counters and to the running analysis.

    Args:
        phase: which step made the call, "extract" or "judge".
        tracker: the dspy.track_usage() tracker that was open around the call. Every model
            entry in it is summed.
    """
    LLM_CALLS.labels(phase=phase).inc()
    analysis_tokens = current_analysis_tokens.get()
    for usage in tracker.get_total_tokens().values():
        for kind in ("prompt", "completion"):
            count = usage.get(f"{kind}_tokens")
            if not count:
                continue
            LLM_TOKENS.labels(phase=phase, kind=kind).inc(count)
            if analysis_tokens is not None:
                key = f"{phase}_{kind}"
                with _tokens_lock:
                    analysis_tokens[key] = analysis_tokens.get(key, 0) + count
