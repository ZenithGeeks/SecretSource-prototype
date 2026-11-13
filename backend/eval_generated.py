"""Score the pipeline's verdicts on generated claims whose answer is known by construction.

    python eval_generated.py ../docs/eval/generated/claims.jsonl \
        ../docs/eval/generated/caption-claims.jsonl --runs 3 --fresh

make_eval_claims.py wrote each claim from one passage of a paper in data/papers: "supports"
claims restate the passage, "refutes" claims change one fact in it. So the expected verdict is
the claim's kind.
Every claim goes through the pipeline's own prepare_source and check_prepared, like
eval_decisive.py, so this scores retrieval and the judge together on ~400 claims instead of 13.
The claims are LLM-written; eval_decisive.py's real rows stay the merge gate.

--fresh replaces app.store's answer cache with no-ops and turns off dspy's LM cache in this
process, so every run asks the judge again. --evidence-count sets verify.EVIDENCE_COUNT, the
passages the judge gets.
"""

import argparse
import json
import statistics
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

import dspy
from app import store
from app.config import PHOENIX_COLLECTOR_ENDPOINT, VLLM_MODEL
from app.evaluation import judge_scores
from app.experiments import Dataset, Run, Score, dataset_name, log_experiment
from app.pipeline import verify
from app.tracing import setup_tracing
from eval_verdicts import settings

PAPERS = Path("data/papers")
VERDICTS = ("supports", "refutes", "insufficient", "error")


class Judged(NamedTuple):
    """One claim's verdict in one run, and which judge call gave it."""

    verdict: str
    verdict_from: str  # text | figure | none
    judged_figure: str  # the figure's file name when verdict_from is "figure"
    error: str | None = None  # why there is no verdict, when verdict is "error"


def load_claims(paths: list[Path]) -> list[dict]:
    """Claims from every file, each tagged with the file it came from."""
    claims = []
    for path in paths:
        with path.open(encoding="utf-8") as file:
            for line in file:
                claim = json.loads(line)
                # Ids repeat across files (claims.jsonl and caption-claims.jsonl share four), so
                # results are keyed by file and id together.
                claims.append({**claim, "claim_file": path.stem, "key": f"{path.stem}:{claim['id']}"})
    return claims


def judge(claim: dict, prepared: dict) -> Judged:
    """The pipeline's verdict for one claim, or "error"."""
    if prepared["status"] != "ok":
        return Judged("error", "none", "", failure(prepared))
    result = verify.check_prepared(claim["text"], claim["paper"], Path(prepared["path"]))
    if result["status"] != "ok":
        return Judged("error", "none", "", failure(result))
    return Judged(result["verdict"], result["verdict_from"], result["judged_figure"])


def failure(result: dict) -> str:
    """The reason and message of a failed step, as one line of text."""
    return " ".join(filter(None, [result.get("reason"), result.get("message")])) or "no message"


def report(claims: list[dict], runs: list[dict[str, Judged]]) -> None:
    """Accuracy per run and kind, the confusion counts, the claims that changed verdict, and
    precision, recall and F1 per run, split by the judge call that gave the verdict."""
    for kind in ("supports", "refutes", "all"):
        chosen = [c for c in claims if kind in ("all", c["kind"])]
        scores = [sum(run[c["key"]].verdict == c["kind"] for c in chosen) / len(chosen) for run in runs]
        spread = f" (spread {max(scores) - min(scores):.3f})" if len(scores) > 1 else ""
        print(
            f"{kind:<9} n={len(chosen):<4} accuracy per run "
            + ", ".join(f"{s:.3f}" for s in scores)
            + f"; mean {statistics.mean(scores):.3f}{spread}"
        )
    for kind in ("supports", "refutes"):
        counts = Counter(run[c["key"]].verdict for run in runs for c in claims if c["kind"] == kind)
        print(f"expected {kind:<8} -> " + ", ".join(f"{v} {counts[v]}" for v in VERDICTS if counts[v]))
    flipped = [c["key"] for c in claims if len({run[c["key"]].verdict for run in runs}) > 1]
    print(f"{len(flipped)} claims changed verdict between runs")
    for number, run in enumerate(runs, 1):
        for source, scores in scores_by_source(claims, run).items():
            print(
                f"run {number} {source:<6} n={scores['pairs']:<4} precision {scores['precision']:.3f}"
                f", recall {scores['recall']:.3f}, F1 {scores['f1']:.3f}, macro F1 {scores['macro_f1']:.3f}"
            )


def scores_by_source(claims: list[dict], run: dict[str, Judged]) -> dict[str, dict]:
    """One run's scores on "supports", for all verdicts and for each judge call (text, figure).

    Errors are left out, as in eval_verdicts.py. A claim's source can differ between runs, so the
    split is made per run.
    """
    pairs: dict[str, list[tuple[bool, bool]]] = {"all": []}
    for claim in claims:
        judged = run[claim["key"]]
        if judged.verdict == "error":
            continue
        pair = (claim["kind"] == "supports", judged.verdict == "supports")
        pairs["all"].append(pair)
        pairs.setdefault(judged.verdict_from, []).append(pair)
    return {
        source: judge_scores([gold for gold, _ in found], [said for _, said in found])
        for source, found in pairs.items()
        if found
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("claims", type=Path, nargs="+", help="JSON lines with id, paper, kind, text")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--fresh", action="store_true", help="no answer cache: the judge answers every run")
    # The judge gateway allows 3 requests at once, and other callers share the key (#511).
    parser.add_argument("--workers", type=int, default=2, help="claims judged at once")
    parser.add_argument("--out", type=Path, help="each claim's verdicts and which call gave them, here")
    parser.add_argument("--evidence-count", type=int, help="override verify.EVIDENCE_COUNT for this run")
    args = parser.parse_args()
    setup_tracing()

    if args.evidence_count:
        verify.EVIDENCE_COUNT = args.evidence_count
    print(f"judge gets {verify.EVIDENCE_COUNT} passages per claim")
    if args.fresh:
        # Turn off the pipeline's result cache (app/store.py), so every run asks the judge again.
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
        # dspy caches LM responses too, in memory and on disk; without this runs 2+ replay run 1.
        dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    claims = load_claims(args.claims)
    papers = {c["paper"] for c in claims}
    prepared = {paper: verify.prepare_source((PAPERS / paper).as_posix()) for paper in sorted(papers)}
    failed = [p for p, result in prepared.items() if result["status"] != "ok"]
    print(f"{len(claims)} claims on {len(papers)} papers; {len(failed)} papers failed to index {failed}")

    runs = []
    windows = []  # each pass's start and end, for its Phoenix runs
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for run in range(1, args.runs + 1):
            started = datetime.now(UTC).isoformat()
            judged = list(pool.map(lambda c: judge(c, prepared[c["paper"]]), claims))
            windows.append((started, datetime.now(UTC).isoformat()))
            runs.append({c["key"]: j for c, j in zip(claims, judged, strict=True)})
            accuracy = sum(runs[-1][c["key"]].verdict == c["kind"] for c in claims) / len(claims)
            print(f"run {run}: {accuracy:.3f}", flush=True)

    for name in sorted({c["claim_file"] for c in claims}):
        print(f"\n== {name}")
        report([c for c in claims if c["claim_file"] == name], runs)
    if args.out:
        with args.out.open("w", encoding="utf-8") as file:
            for claim in claims:
                judged = [run[claim["key"]] for run in runs]
                record = {
                    **claim,
                    "verdicts": [j.verdict for j in judged],
                    "verdict_from": [j.verdict_from for j in judged],
                    "judged_figure": [j.judged_figure for j in judged],
                }
                file.write(json.dumps(record) + "\n")
    if PHOENIX_COLLECTOR_ENDPOINT:
        experiment_id = log_experiment(
            claims_dataset(claims),
            experiment_runs(claims, runs, windows),
            name=f"{VLLM_MODEL} generated {settings('retrieved')['verify_py_sha256']}",
            description=f"eval_generated.py {' '.join(p.name for p in args.claims)}, {args.runs} runs",
            metadata={**settings("retrieved"), "fresh": args.fresh},
        )
        print(f"Phoenix experiment {experiment_id}")


def claim_input(claim: dict) -> dict:
    """A claim's dataset input."""
    return {"id": claim["id"], "paper": claim["paper"], "text": claim["text"]}


def claims_dataset(claims: list[dict]) -> Dataset:
    """The generated claims as a Phoenix dataset, with the verdict each was written to get."""
    inputs = [claim_input(c) for c in claims]
    outputs = [{"kind": c["kind"]} for c in claims]
    return Dataset(
        name=dataset_name("generated-claims", inputs + outputs),
        description="Claims written from one passage each; kind is the expected verdict.",
        inputs=inputs,
        outputs=outputs,
        metadata=[{"claim_file": c["claim_file"]} for c in claims],
        splits=[None] * len(claims),
    )


def experiment_runs(
    claims: list[dict], runs: list[dict[str, Judged]], windows: list[tuple[str, str]]
) -> list[Run]:
    """One Phoenix run per claim and pass, scored `correct` when the verdict is the claim's kind."""
    # shortcut: every claim of a pass gets the pass's start and end, since claims run in a pool
    found = []
    for repetition, (run, (started, ended)) in enumerate(zip(runs, windows, strict=True), 1):
        for claim in claims:
            judged = run[claim["key"]]
            output = {"verdict": judged.verdict, "verdict_from": judged.verdict_from}
            scores = []
            if judged.verdict != "error":
                is_correct = judged.verdict == claim["kind"]
                label = "correct" if is_correct else "wrong"
                scores = [Score(name="correct", score=float(is_correct), label=label)]
            found.append(Run(claim_input(claim), output, started, ended, judged.error, scores, repetition))
    return found


if __name__ == "__main__":
    main()
