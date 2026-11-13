"""How the figure judge does with only a crop and its caption, on figure and table claims.

    python eval_figure_judge.py ../docs/eval/generated/table-claims.jsonl --runs 2

Each claim goes through verify's own figure judge call with the claim's crop and caption,
which is what the pipeline sends after the text judge answers "insufficient". The judge cache
and dspy's cache are off, so every run asks the model again. Crops are read from --figures;
run `python -m app.pipeline.figures <pdf>` first for a paper whose crops are missing.
"""

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import dspy
from app.pipeline import verify
from app.tracing import setup_tracing
from dspy.utils.exceptions import AdapterParseError
from eval_decisive import gateway_model


def judge_one(judge, claim: dict, figures: Path) -> str:
    """The figure judge's verdict on one claim, or "error" when its reply was not JSON twice."""
    caption = [f"{claim['label']}: {claim['caption']}"] if claim.get("caption") else []
    try:
        return judge(claim["text"], caption, figures / claim["figure"])["verdict"]
    except AdapterParseError:
        return "error"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("claims", type=Path)
    parser.add_argument("--figures", type=Path, default=Path("data/papers/figures"))
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    setup_tracing()

    with args.claims.open(encoding="utf-8") as file:
        claims = [json.loads(line) for line in file]
    missing = [c["figure"] for c in claims if not (args.figures / c["figure"]).is_file()]
    if missing:
        raise SystemExit(f"{len(missing)} crops are not in {args.figures}, e.g. {missing[0]}")

    print("gateway model:", gateway_model())
    # Every run must ask the model again, so neither the judge's store cache nor dspy's answers.
    verify.store.recall_cache = lambda key: None
    verify.store.remember_cache = lambda key, value: None
    dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    judge = verify._build_judge()

    runs = []
    with ThreadPoolExecutor(max_workers=2) as pool:  # the judge gateway allows 3 requests at once
        for run in range(1, args.runs + 1):
            runs.append(list(pool.map(lambda c: judge_one(judge, c, args.figures), claims)))
            right = sum(v == c["kind"] for c, v in zip(claims, runs[-1], strict=True))
            print(f"run {run}: {right}/{len(claims)}", flush=True)

    for kind in ("supports", "refutes"):
        counts = Counter(r[i] for r in runs for i, c in enumerate(claims) if c["kind"] == kind)
        print(f"expected {kind:<8} -> " + ", ".join(f"{v} {n}" for v, n in sorted(counts.items())))
    if args.out:
        with args.out.open("w", encoding="utf-8") as file:
            for i, claim in enumerate(claims):
                file.write(json.dumps({**claim, "verdicts": [r[i] for r in runs]}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
