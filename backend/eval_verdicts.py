"""Score the judge against the labelers on the labeled claim/reference pairs (#423).

    python eval_verdicts.py labels.csv --split test --out verdicts.csv

`labels.csv` is the Labeler page's "Download labels CSV", with the `split` column filled by
split_dataset.py. Each pair is checked with the same verify_claim the pipeline runs, against the
reference PDF in PAPERS_DIR, so this scores retrieval and the judge together. It needs what an
analysis needs (ColBERT, the LLM), so run it where the worker runs. The judge's answers are
cached, so a second run with the same settings gives the same verdicts.
"""

import argparse
import csv
import hashlib
import json
import sys
from pathlib import Path

from app.config import PAPERS_DIR, VLLM_MODEL
from app.evaluation import human_agreement, judge_scores, pairs_from_labels
from app.pipeline import verify


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("labels", type=Path, help="the labels CSV export")
    parser.add_argument("--split", default="test", help='which split to score ("" for all rows)')
    parser.add_argument("--out", type=Path, default=Path("verdicts.csv"), help="per-pair results")
    args = parser.parse_args()

    with args.labels.open(newline="", encoding="utf-8") as file:
        pairs = [
            p
            for p in pairs_from_labels(list(csv.DictReader(file)))
            if not args.split or p.split == args.split
        ]
    scored = [p for p in pairs if p.gold() is not None]
    print(
        f"{len(pairs)} pairs in split {args.split!r}; {len(pairs) - len(scored)} left out on a tie",
        file=sys.stderr,
    )

    results = []
    for number, pair in enumerate(scored, 1):
        source = PAPERS_DIR / f"{pair.reference_id}.pdf"
        result = verify.verify_claim(pair.claim, source.as_posix())
        verdict = result.get("verdict") if result.get("status") == "ok" else "error"
        results.append(
            {
                "claim_id": pair.claim_id,
                "reference_id": pair.reference_id,
                "gold": pair.gold(),
                "verdict": verdict,
            }
        )
        print(f"{number}/{len(scored)} {pair.claim_id} {verdict}", file=sys.stderr)

    with args.out.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=["claim_id", "reference_id", "gold", "verdict"])
        writer.writeheader()
        writer.writerows(results)

    judged = [r for r in results if r["verdict"] != "error"]
    report = {
        "settings": settings(),
        "errors": len(results) - len(judged),
        "judge": judge_scores([r["gold"] for r in judged], [r["verdict"] == "supports" for r in judged]),
        "humans": human_agreement(pairs),
    }
    print(json.dumps(report, indent=2))


def settings() -> dict:
    """What the verdicts depend on, so two runs can be compared: the model, how many passages
    the judge reads, and a hash of verify.py, which holds the judge's prompt."""
    source = Path(verify.__file__).read_bytes()
    return {
        "model": VLLM_MODEL,
        "evidence_count": verify.EVIDENCE_COUNT,
        "verify_py_sha256": hashlib.sha256(source).hexdigest()[:12],
    }


if __name__ == "__main__":
    main()
