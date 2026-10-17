"""Time one analysis through the real queue, step by step (CONSTRAINTS.md, analysis time).

    docker exec -w /app secretsource-prototype-gateway-1 python bench_analysis.py data/papers/x.pdf

The paper goes on the queue the way the gateway's /api/analyses does, a worker runs it, and the
time of each step comes from the analysis's own stages. Run it where the gateway runs, with a
worker on the same queue. The analysis record is deleted at the end, so the benchmark leaves
nothing in anyone's history. A paper analysed before reuses cached GROBID and LLM answers, so
time a paper the store has not seen to compare runs.
"""

import argparse
import time
import uuid
from datetime import datetime, timezone

from app import store
from app.queue import enqueue_analysis

STEPS = ("extracting", "extracted", "planned", "verifying", "verified", "figures", "done")
POLL_SECONDS = 20


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paper", help="a PDF path the worker can read, or a DOI or arXiv id")
    args = parser.parse_args()

    analysis = _run(args.paper)
    try:
        _report(analysis)
    finally:
        store.delete(analysis["id"])


def _run(paper: str) -> dict:
    """Queue one analysis and wait until a worker has finished it."""
    analysis_id = "bench" + uuid.uuid4().hex[:7]
    started = datetime.now(timezone.utc).isoformat()
    queued = {"stage": "queued", "message": "waiting for a free worker", "at": round(time.time(), 1)}
    store.save({"id": analysis_id, "paper": paper, "owner": None, "status": "running",
                "stages": [queued], "claims": [], "started": started})
    enqueue_analysis(analysis_id, paper, True, None, [queued], started)
    print(f"analysis {analysis_id}", flush=True)
    while (analysis := store.load(analysis_id) or {}).get("status") not in ("done", "error"):
        time.sleep(POLL_SECONDS)
    return analysis


def _report(analysis: dict) -> None:
    """Print when each step first and last happened, counted from the queueing."""
    stages = analysis["stages"]
    start = stages[0]["at"]
    first, last = {}, {}
    for stage in stages:
        first.setdefault(stage["stage"], stage["at"])
        last[stage["stage"]] = stage["at"]
    checks = sum(len(c.get("verdicts", [])) + len(c.get("unchecked", [])) for c in analysis["claims"])
    print(f"status {analysis['status']} {analysis.get('message', '')}".strip())
    print(f"claims {len(analysis['claims'])}, checks {checks}")
    for step in STEPS:
        if step in first:
            print(f"{step:>10}  first {first[step] - start:7.1f}s  last {last[step] - start:7.1f}s")
    print(f"total {stages[-1]['at'] - start:.1f}s")


if __name__ == "__main__":
    main()
