"""Check that the checks production found decisive stay decisive (CONSTRAINTS.md, verdict quality).

    python eval_decisive.py ../docs/eval/decisive-checks.csv --runs 3 --fresh --min-kept 12

Each row is a claim, the cited work it was checked against, and the expected verdict
("supports", "refutes" or "insufficient"). Most are the verdicts production gave;
CONSTRAINTS.md lists the rows corrected by hand. Every row is checked with the pipeline's own
prepare_source and check_prepared, so this scores retrieval and the judge together. It needs what an analysis
needs (ColBERT, the LLM), so run it where the worker runs. Exits 1 when a run keeps fewer than
--min-kept rows at their expected verdict.
"""

import argparse
import csv
import sys
from pathlib import Path

import dspy
from app import store
from app.pipeline import verify


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("cases", type=Path, help="CSV with paper, claim, source, expected")
    parser.add_argument("--runs", type=int, default=3, help="how many times to judge every row")
    parser.add_argument(
        "--fresh", action="store_true",
        help="skip the answer cache, so each run asks the judge again (needed to see run-to-run spread)",
    )
    parser.add_argument("--min-kept", type=int, default=0, help="fail when a run keeps fewer rows")
    args = parser.parse_args()

    with args.cases.open(newline="", encoding="utf-8") as file:
        cases = list(csv.DictReader(file))
    if args.fresh:
        # Neither read nor write: a fresh answer must not replace the one the pipeline uses.
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
        # dspy caches LM responses too, in memory and on disk; without this runs 2+ replay run 1.
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)

    paths = {case["source"]: verify.prepare_source(case["source"]) for case in cases}
    kept_per_run = []
    for run in range(1, args.runs + 1):
        kept = 0
        for number, case in enumerate(cases, 1):
            prepared = paths[case["source"]]
            if prepared["status"] == "error":
                verdict = "error: " + prepared.get("reason", "failed")
            else:
                result = verify.check_prepared(case["claim"], case["source"], Path(prepared["path"]))
                verdict = result.get("verdict", "error") if result["status"] == "ok" else "error"
            kept += verdict == case["expected"]
            print(f"run {run} {number}/{len(cases)} {case['expected']:>8} -> {verdict:<12} {case['source']}")
        kept_per_run.append(kept)
        print(f"run {run}: {kept}/{len(cases)} kept")

    print(f"kept per run: {kept_per_run}; minimum {min(kept_per_run)}, required {args.min_kept}")
    sys.exit(1 if min(kept_per_run) < args.min_kept else 0)


if __name__ == "__main__":
    main()
