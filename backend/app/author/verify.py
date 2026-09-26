"""One claim against one source, cached, for every place the Author role checks something.

The single-claim route (POST /checks), a draft check (one call per \\cite) and the lazy
verification of a search result all come through here, so the same (claim, source) pair is
judged once: the second time it is read back from the `cache` table (app/store.py). Only a
successful verdict is remembered — a lookup that failed (rate limit, no open-access copy)
should be tried again next time, not repeated forever.

The key includes the judge model, like the pipeline's own judge cache, so a model change
never reads another model's verdict.
"""

from collections.abc import Callable

from app import store
from app.config import VLLM_MODEL


def verify_cached(claim: str, source: str, run: Callable[[str, str], dict]) -> dict:
    """`run(claim, source)` is app.pipeline.verify.verify_claim, passed in rather than
    imported so the gateway's own binding (which its tests monkeypatch) is what runs."""
    key = store.cache_key("author-verify", VLLM_MODEL, claim.strip(), source.strip())
    cached = store.recall_cache(key)
    if cached is not None:
        return {**cached, "cached": True}
    result = run(claim, source)
    if result.get("status") == "ok":
        store.remember_cache(key, result)
    return result


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
