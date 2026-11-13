"""How the figure judge does with only a crop and its caption, on figure and table claims.

    python eval_figure_judge.py ../docs/eval/generated/table-claims.jsonl --runs 2

Each claim goes through verify's own figure judge call with the claim's crop and caption,
which is what the pipeline sends after the text judge answers "insufficient". The judge cache
and dspy's cache are off, so every run asks the model again. Crops are read from --figures;
run `python -m app.pipeline.figures <pdf>` first for a paper whose crops are missing.
With PHOENIX_COLLECTOR_ENDPOINT set, the runs are saved as one Phoenix experiment on the same
dataset eval_generated.py uses for that claims file.
"""

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import dspy
from app.config import PHOENIX_COLLECTOR_ENDPOINT
from app.experiments import log_experiment, source_sha
from app.pipeline import verify
from app.tracing import setup_tracing
from dspy.utils.exceptions import AdapterParseError
from eval_decisive import gateway_model
from eval_generated import Judged, claims_dataset, experiment_runs, load_claims


def judge_one(judge, claim: dict, figures: Path) -> Judged:
    """The figure judge's verdict on one claim, or "error" when its reply was not JSON twice."""
    caption = [f"{claim['label']}: {claim['caption']}"] if claim.get("caption") else []
    try:
        verdict = judge(claim["text"], caption, figures / claim["figure"])["verdict"]
    except AdapterParseError:
        return Judged("error", "figure", claim["figure"], "reply was not JSON twice")
    return Judged(verdict, "figure", claim["figure"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("claims", type=Path)
    parser.add_argument("--figures", type=Path, default=Path("data/papers/figures"))
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    setup_tracing()

    claims = load_claims([args.claims])
    missing = [c["figure"] for c in claims if not (args.figures / c["figure"]).is_file()]
    if missing:
        raise SystemExit(f"{len(missing)} crops are not in {args.figures}, e.g. {missing[0]}")

    model = gateway_model()
    print("gateway model:", model)
    # Every run must ask the model again, so neither the judge's store cache nor dspy's answers.
    verify.store.recall_cache = lambda key: None
    verify.store.remember_cache = lambda key, value: None
    dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    judge = verify._build_judge()

    runs = []
    windows = []  # each pass's start and end, for its Phoenix runs
    with ThreadPoolExecutor(max_workers=2) as pool:  # the judge gateway allows 3 requests at once
        for run in range(1, args.runs + 1):
            started = datetime.now(UTC).isoformat()
            judged = pool.map(lambda c: judge_one(judge, c, args.figures), claims)
            runs.append({c["key"]: j for c, j in zip(claims, judged, strict=True)})
            windows.append((started, datetime.now(UTC).isoformat()))
            right = sum(runs[-1][c["key"]].verdict == c["kind"] for c in claims)
            print(f"run {run}: {right}/{len(claims)}", flush=True)

    for kind in ("supports", "refutes"):
        counts = Counter(r[c["key"]].verdict for r in runs for c in claims if c["kind"] == kind)
        print(f"expected {kind:<8} -> " + ", ".join(f"{v} {n}" for v, n in sorted(counts.items())))
    if args.out:
        with args.out.open("w", encoding="utf-8") as file:
            for claim in claims:
                verdicts = [r[claim["key"]].verdict for r in runs]
                file.write(json.dumps({**claim, "verdicts": verdicts}, ensure_ascii=False) + "\n")
    if PHOENIX_COLLECTOR_ENDPOINT:
        sha = source_sha(verify)
        experiment_id = log_experiment(
            claims_dataset(claims),
            experiment_runs(claims, runs, windows),
            name=f"{model} figure judge {sha}",
            description=f"eval_figure_judge.py {args.claims.name}, {args.runs} runs",
            metadata={"gateway_model": model, "verify_py_sha256": sha},
        )
        print(f"Phoenix experiment {experiment_id}")


if __name__ == "__main__":
    main()
