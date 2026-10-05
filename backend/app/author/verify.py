"""One claim against one source, cached, for every place the Author role checks something.

The single-claim route (POST /checks) and a draft check (one call per \\cite) both come
through here, so the same (claim, source) pair is judged once: the second time it is read
back from the `cache` table (app/store.py). Only a successful verdict is remembered — a
lookup that failed (rate limit, no open-access copy) should be tried again next time, not
repeated forever.

The key includes the judge model, like the pipeline's own judge cache, so a model change
never reads another model's verdict.
"""

from collections.abc import Callable

from app import store
from app.config import VLLM_MODEL
from app.metrics import CLAIM_CHECKS_FAILED, CLAIM_VERDICTS
from app.pipeline.verify import unchecked_reason


def verify_cached(
    claim: str, source: str, run: Callable[[str, str], dict], citation: dict | None = None
) -> dict:
    """`run(claim, source)` is app.pipeline.verify.verify_claim, passed in rather than
    imported so the gateway's own binding (which its tests monkeypatch) is what runs.
    `citation` is the cited work as the caller knows it (its `url`, if any), for the reason
    a failure is counted under."""
    key = store.cache_key("author-verify", VLLM_MODEL, claim.strip(), source.strip())
    cached = store.recall_cache(key)
    if cached is not None:
        result = {**cached, "cached": True}
    else:
        try:
            result = run(claim, source)
        except Exception:
            CLAIM_CHECKS_FAILED.labels(reason="failed").inc()
            raise
        if result.get("status") == "ok":
            store.remember_cache(key, result)
    _count(result, citation or {})
    return result


def _count(result: dict, citation: dict) -> None:
    """The claim-verdict counters, counted the way a paper analysis counts them (the check()
    closure in app/main.py), so the dashboards mean the same thing for both roles: once per
    claim checked against a source, a remembered answer included (an analysis counts above
    the judge's cache too), a verdict under its label and a failure under unchecked_reason's.
    """
    if result.get("status") == "ok":
        CLAIM_VERDICTS.labels(verdict=result["verdict"]).inc()
    else:
        CLAIM_CHECKS_FAILED.labels(reason=unchecked_reason(result, citation)).inc()


def citation_outcome(result: dict) -> dict:
    """The fields a draft-check citation takes from a verification result: the verdict and
    the passage it rests on, or why the source could not be read."""
    if result.get("status") != "ok":
        return {
            "verdict": "unavailable",
            "reason": result.get("reason", "failed"),
            "message": result.get("message", "") or "checking it failed",
        }
    evidence = result.get("evidence") or []
    first = evidence[0] if evidence else {}
    return {
        "verdict": result.get("verdict", "insufficient"),
        "explanation": result.get("reasoning", ""),
        "evidence": {
            "passage": result.get("quote") or first.get("text", ""),
            "pdf": result.get("source", ""),
            "page": first.get("page"),
        },
        "indexedIn": result.get("indexed_in") or {},
    }
