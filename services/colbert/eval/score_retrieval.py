"""Score retrievers' rankings: recall@1/4/10, MRR and nDCG@10, with a bootstrap interval.

    python eval/score_retrieval.py claims.jsonl ranks/before.jsonl ranks/after.jsonl ...

Recall@4 is the headline: the pipeline hands the judge the top 4 passages (verify.EVIDENCE_COUNT).
The first ranks file is the baseline; every other retriever is compared to it claim by claim.
A claim's gold is one passage index or a list of them (SciFact has several relevant abstracts).
"""

import json
import math
import random
import sys
from pathlib import Path

KS = (1, 4, 10)
BOOTSTRAP = 2000


def load_gold(path: str) -> dict[str, tuple[set[int], str]]:
    gold = {}
    with open(path, encoding="utf-8") as file:
        rows = [json.loads(line) for line in file]
    for row in rows:
        indices = row["gold"] if isinstance(row["gold"], list) else [row["gold"]]
        gold[row["id"]] = (set(indices), row.get("kind", "all"))
    return gold


def metrics(top: list[int], relevant: set[int]) -> dict[str, float]:
    """Recall@k, MRR and nDCG@10 for one claim; every relevant passage counts the same (binary)."""
    first = next((rank for rank, index in enumerate(top, start=1) if index in relevant), None)
    dcg = sum(1 / math.log2(rank + 1) for rank, index in enumerate(top[:10], start=1) if index in relevant)
    ideal = sum(1 / math.log2(rank + 1) for rank in range(1, min(len(relevant), 10) + 1))
    row = {f"R@{k}": float(first is not None and first <= k) for k in KS}
    row["MRR"] = 1 / first if first else 0.0
    row["nDCG@10"] = dcg / ideal
    return row


def interval(values: list[float]) -> tuple[float, float]:
    """95% bootstrap interval of the mean, same resamples for every retriever (fixed seed)."""
    rng = random.Random(0)
    means = sorted(sum(rng.choices(values, k=len(values))) / len(values) for _ in range(BOOTSTRAP))
    return means[int(0.025 * BOOTSTRAP)], means[int(0.975 * BOOTSTRAP)]


def main() -> None:
    gold = load_gold(sys.argv[1])
    per_claim = {}  # retriever -> claim id -> metrics
    for path in sys.argv[2:]:
        with open(path, encoding="utf-8") as file:
            ranks = {row["id"]: row["top"] for row in map(json.loads, file)}
        per_claim[Path(path).stem] = {cid: metrics(ranks[cid], rel) for cid, (rel, _) in gold.items()}

    kinds = sorted({kind for _, kind in gold.values()})
    baseline = next(iter(per_claim))
    print(f"{len(gold)} claims ({', '.join(f'{k} {sum(v == k for _, v in gold.values())}' for k in kinds)})")
    print(
        f"{'retriever':<14}"
        + "".join(f"{m:>9}" for m in (*[f"R@{k}" for k in KS], "MRR", "nDCG@10"))
        + "   R@4 95% CI   "
        + "".join(f"R@4 {k:<9}" for k in kinds)
        + f"vs {baseline} R@4 (+/-)"
    )
    for name, rows in per_claim.items():
        mean = {m: sum(r[m] for r in rows.values()) / len(rows) for m in next(iter(rows.values()))}
        low, high = interval([r["R@4"] for r in rows.values()])
        by_kind = [
            sum(rows[c]["R@4"] for c, (_, k) in gold.items() if k == kind)
            / sum(k == kind for _, k in gold.values())
            for kind in kinds
        ]
        wins = sum(rows[c]["R@4"] > per_claim[baseline][c]["R@4"] for c in gold)
        losses = sum(rows[c]["R@4"] < per_claim[baseline][c]["R@4"] for c in gold)
        print(
            f"{name:<14}"
            + "".join(f"{mean[m]:>9.3f}" for m in mean)
            + f"   [{low:.3f}, {high:.3f}]  "
            + "".join(f"{v:<13.3f}" for v in by_kind)
            + f"+{wins} / -{losses}"
        )


if __name__ == "__main__":
    main()
