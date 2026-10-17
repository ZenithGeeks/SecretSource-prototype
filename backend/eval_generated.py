"""Score the pipeline's verdicts on generated claims whose answer is known by construction.

    python eval_generated.py ../docs/eval/generated/claims.jsonl \
        ../docs/eval/generated/caption-claims.jsonl --runs 3 --fresh

make_eval_claims.py wrote each claim from one passage of a paper in data/papers: "supports"
claims restate the passage, "refutes" claims change one fact in it. So the expected verdict is
the claim's kind.
Every claim goes through the pipeline's own prepare_source and check_prepared, like
eval_decisive.py, so this scores retrieval and the judge together on ~400 claims instead of 13.
The claims are LLM-written; eval_decisive.py's real rows stay the merge gate.

--fresh replaces app.store's answer cache with no-ops in this process, so every run asks the
judge again. --evidence-count sets verify.EVIDENCE_COUNT, the passages the judge gets.
"""

import argparse
import json
import statistics
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app import store
from app.pipeline import verify

PAPERS = Path("data/papers")
VERDICTS = ("supports", "refutes", "insufficient", "error")


def load_claims(paths: list[Path]) -> list[dict]:
    """Claims from every file, each tagged with the file it came from."""
    claims = []
    for path in paths:
        with path.open(encoding="utf-8") as file:
            claims += [{**json.loads(line), "claim_file": path.stem} for line in file]
    return claims


def judge(claim: dict, prepared: dict) -> str:
    """The pipeline's verdict for one claim, or "error"."""
    if prepared["status"] != "ok":
        return "error"
    result = verify.check_prepared(claim["text"], claim["paper"], Path(prepared["path"]))
    return result.get("verdict", "error") if result["status"] == "ok" else "error"


def report(claims: list[dict], runs: list[dict[str, str]]) -> None:
    """Accuracy per run and kind, the confusion counts, and the claims that changed verdict."""
    for kind in ("supports", "refutes", "all"):
        chosen = [c for c in claims if kind in ("all", c["kind"])]
        scores = [sum(run[c["id"]] == c["kind"] for c in chosen) / len(chosen) for run in runs]
        spread = f" (spread {max(scores) - min(scores):.3f})" if len(scores) > 1 else ""
        print(
            f"{kind:<9} n={len(chosen):<4} accuracy per run "
            + ", ".join(f"{s:.3f}" for s in scores)
            + f"; mean {statistics.mean(scores):.3f}{spread}"
        )
    for kind in ("supports", "refutes"):
        counts = Counter(run[c["id"]] for run in runs for c in claims if c["kind"] == kind)
        print(f"expected {kind:<8} -> " + ", ".join(f"{v} {counts[v]}" for v in VERDICTS if counts[v]))
    flipped = [c["id"] for c in claims if len({run[c["id"]] for run in runs}) > 1]
    print(f"{len(flipped)} claims changed verdict between runs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("claims", type=Path, nargs="+", help="JSON lines with id, paper, kind, text")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--fresh", action="store_true", help="no answer cache: the judge answers every run")
    parser.add_argument("--workers", type=int, default=4, help="claims judged at once")
    parser.add_argument("--out", type=Path, help="write every claim's verdicts here")
    parser.add_argument("--evidence-count", type=int, help="override verify.EVIDENCE_COUNT for this run")
    args = parser.parse_args()

    if args.evidence_count:
        verify.EVIDENCE_COUNT = args.evidence_count
    print(f"judge gets {verify.EVIDENCE_COUNT} passages per claim")
    if args.fresh:
        store.recall_cache = lambda key: None
        store.remember_cache = lambda key, data: None
    claims = load_claims(args.claims)
    papers = {c["paper"] for c in claims}
    prepared = {paper: verify.prepare_source((PAPERS / paper).as_posix()) for paper in sorted(papers)}
    failed = [p for p, result in prepared.items() if result["status"] != "ok"]
    print(f"{len(claims)} claims on {len(papers)} papers; {len(failed)} papers failed to index {failed}")

    runs = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for run in range(1, args.runs + 1):
            verdicts = list(pool.map(lambda c: judge(c, prepared[c["paper"]]), claims))
            runs.append({c["id"]: v for c, v in zip(claims, verdicts, strict=True)})
            print(
                f"run {run}: {sum(v == c['kind'] for c, v in zip(claims, verdicts)) / len(claims):.3f}",
                flush=True,
            )

    for name in sorted({c["claim_file"] for c in claims}):
        print(f"\n== {name}")
        report([c for c in claims if c["claim_file"] == name], runs)
    if args.out:
        with args.out.open("w", encoding="utf-8") as file:
            for claim in claims:
                file.write(json.dumps({**claim, "verdicts": [run[claim["id"]] for run in runs]}) + "\n")


if __name__ == "__main__":
    main()
