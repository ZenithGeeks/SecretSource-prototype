"""Score the judge against the labelers on the labeled claim/reference pairs (#423).

    python eval_verdicts.py labels.csv --split test --out verdicts.csv

`labels.csv` is the Labeler page's "Download labels CSV", with the `split` column filled by
split_dataset.py. Each pair is checked with the same verify_claim the pipeline runs, against the
reference PDF in PAPERS_DIR, so this scores retrieval and the judge together. It needs what an
analysis needs (ColBERT, the LLM), so run it where the worker runs. The judge's answers are
cached, so a second run with the same settings gives the same verdicts.

With PHOENIX_COLLECTOR_ENDPOINT set, the run is also an experiment in Phoenix: every labeled pair is a
dataset example (its split as a Phoenix split, its topic in the metadata), each verdict is a run,
and each run gets a `correct` evaluation. Runs on the same labels share one dataset, so their
experiments can be compared side by side. The report printed here also scores each topic.
"""

import argparse
import csv
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import requests
from app.config import PAPERS_DIR, PHOENIX_COLLECTOR_ENDPOINT, VLLM_MODEL
from app.evaluation import Pair, human_agreement, judge_scores, pairs_from_labels
from app.pipeline import verify


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("labels", type=Path, help="the labels CSV export")
    parser.add_argument("--split", default="test", help='which split to score ("" for all rows)')
    parser.add_argument("--out", type=Path, default=Path("verdicts.csv"), help="per-pair results")
    args = parser.parse_args()

    with args.labels.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    # The topic column comes from the labels export; an older export has none.
    topics = {(row["claim_id"], row["reference_id"]): row.get("topic", "") for row in rows}
    every_pair = pairs_from_labels(rows)
    pairs = [p for p in every_pair if not args.split or p.split == args.split]
    scored = [p for p in pairs if p.gold() is not None]
    print(
        f"{len(pairs)} pairs in split {args.split!r}; {len(pairs) - len(scored)} left out on a tie",
        file=sys.stderr,
    )

    results = []
    for number, pair in enumerate(scored, 1):
        source = PAPERS_DIR / f"{pair.reference_id}.pdf"
        started = datetime.now(UTC).isoformat()
        result = verify.verify_claim(pair.claim, source.as_posix())
        verdict = result.get("verdict") if result.get("status") == "ok" else "error"
        verdict_from = result.get("verdict_from", "none") if verdict != "error" else "none"
        results.append(
            {
                "claim_id": pair.claim_id,
                "reference_id": pair.reference_id,
                "gold": pair.gold(),
                "verdict": verdict,
                "verdict_from": verdict_from,
                "topic": topics[pair.claim_id, pair.reference_id],
                "started": started,
                "ended": datetime.now(UTC).isoformat(),
            }
        )
        print(f"{number}/{len(scored)} {pair.claim_id} {verdict}", file=sys.stderr)

    with args.out.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=["claim_id", "reference_id", "topic", "gold", "verdict", "verdict_from"],
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(results)

    judged = [r for r in results if r["verdict"] != "error"]
    report = {
        "settings": settings(),
        "errors": len(results) - len(judged),
        "judge": judge_scores([r["gold"] for r in judged], [r["verdict"] == "supports" for r in judged]),
        # The text judge and the figure judge are scored apart (SCRUM-80).
        "judge_by_source": {
            source: judge_scores(
                [r["gold"] for r in judged if r["verdict_from"] == source],
                [r["verdict"] == "supports" for r in judged if r["verdict_from"] == source],
            )
            for source in sorted({r["verdict_from"] for r in judged})
        },
        "judge_by_topic": {
            topic or "(none)": judge_scores(
                [r["gold"] for r in judged if r["topic"] == topic],
                [r["verdict"] == "supports" for r in judged if r["topic"] == topic],
            )
            for topic in sorted({r["topic"] for r in judged})
        },
        "humans": human_agreement(pairs),
    }
    print(json.dumps(report, indent=2))
    if PHOENIX_COLLECTOR_ENDPOINT:
        record_experiment(every_pair, topics, results, args.split, report)


def settings() -> dict:
    """What the verdicts depend on, so two runs can be compared: the model, how many passages
    the judge reads, and a hash of verify.py, which holds the judge's prompt."""
    source = Path(verify.__file__).read_bytes()
    return {
        "model": VLLM_MODEL,
        "evidence_count": verify.EVIDENCE_COUNT,
        "verify_py_sha256": hashlib.sha256(source).hexdigest()[:12],
    }


def record_experiment(
    pairs: list[Pair], topics: dict[tuple[str, str], str], results: list[dict], split: str, report: dict
) -> None:
    """Save this run in Phoenix as an experiment on the labeled pairs, with `correct` per pair."""
    phoenix = PHOENIX_COLLECTOR_ENDPOINT.rstrip("/")
    dataset_id = labels_dataset(phoenix, pairs, topics)
    examples = requests.get(f"{phoenix}/v1/datasets/{dataset_id}/examples", timeout=30)
    examples.raise_for_status()
    example_ids = {
        (e["input"]["claim_id"], e["input"]["reference_id"]): e["id"]
        for e in examples.json()["data"]["examples"]
    }
    settings = report["settings"]
    body = {
        "name": f"{settings['model']} verify {settings['verify_py_sha256']}",
        "description": f"eval_verdicts.py on split {split or 'all'}",
        "metadata": {**settings, "split": split, "judge": report["judge"]},
        "splits": [split] if split else None,
    }
    created = requests.post(f"{phoenix}/v1/datasets/{dataset_id}/experiments", json=body, timeout=30)
    created.raise_for_status()
    experiment_id = created.json()["data"]["id"]
    for result in results:
        error = result["verdict"] == "error"
        run = {
            "dataset_example_id": example_ids[result["claim_id"], result["reference_id"]],
            "output": {"verdict": result["verdict"], "verdict_from": result["verdict_from"]},
            "repetition_number": 1,
            "start_time": result["started"],
            "end_time": result["ended"],
            "error": "verify_claim did not return a verdict" if error else None,
        }
        posted = requests.post(f"{phoenix}/v1/experiments/{experiment_id}/runs", json=run, timeout=30)
        posted.raise_for_status()
        if error:
            continue
        correct = (result["verdict"] == "supports") == result["gold"]
        evaluation = {
            "experiment_run_id": posted.json()["data"]["id"],
            "name": "correct",
            "annotator_kind": "CODE",
            "start_time": result["ended"],
            "end_time": result["ended"],
            "result": {"label": "correct" if correct else "wrong", "score": float(correct)},
            "metadata": {"topic": result["topic"]},
        }
        requests.post(f"{phoenix}/v1/experiment_evaluations", json=evaluation, timeout=30).raise_for_status()
    print(f"Phoenix experiment {experiment_id} on dataset {dataset_id}", file=sys.stderr)


def labels_dataset(phoenix: str, pairs: list[Pair], topics: dict[tuple[str, str], str]) -> str:
    """The id of the Phoenix dataset holding these labeled pairs, uploaded on first use.

    The name carries a hash of the pairs and their levels, so new labels make a new dataset and
    runs on the same labels reuse one.
    """
    keys = sorted((p.claim_id, p.reference_id, sorted(p.levels.items())) for p in pairs)
    name = "labeler-pairs-" + hashlib.sha256(json.dumps(keys).encode()).hexdigest()[:10]
    found = requests.get(f"{phoenix}/v1/datasets", params={"name": name}, timeout=30)
    found.raise_for_status()
    if found.json()["data"]:
        return found.json()["data"][0]["id"]
    body = {
        "action": "create",
        "name": name,
        "description": "Labeled claim/reference pairs from the Labeler export; gold is the majority.",
        "inputs": [{"claim": p.claim, "claim_id": p.claim_id, "reference_id": p.reference_id} for p in pairs],
        "outputs": [{"supported": p.gold(), "levels": p.levels} for p in pairs],
        "metadata": [{"paper_id": p.paper_id, "topic": topics[p.claim_id, p.reference_id]} for p in pairs],
        "splits": [p.split or None for p in pairs],
    }
    uploaded = requests.post(f"{phoenix}/v1/datasets/upload", params={"sync": "true"}, json=body, timeout=60)
    uploaded.raise_for_status()
    return uploaded.json()["data"]["dataset_id"]


if __name__ == "__main__":
    main()
