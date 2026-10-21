"""How well the judge's verdicts agree with the labelers, and labelers with each other (#423).

Read `pairs_from_labels` first: it turns the labeling export into one claim/reference pair per
row, with the labelers' 1-4 levels. `backend/eval_verdicts.py` runs the judge on the pairs and
prints `report`.

The labels grade only how well the source backs the claim (1 no support, 2 weak, 3 clear,
4 strong), so the comparison is binary: a level of 3 or 4 is "supported", and the judge's
"supports" is its "supported". "refutes" and "insufficient" both count as not supported.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field

SUPPORTED_FROM = 3  # the lowest 1-4 level that counts as "the source supports the claim"


@dataclass
class Pair:
    """One claim against one reference paper, with every labeler's 1-4 level."""

    paper_id: str
    claim_id: str
    reference_id: str
    claim: str
    split: str
    levels: dict[str, int] = field(default_factory=dict)  # labeler id -> 1-4

    def gold(self) -> bool | None:
        """Whether the labelers say the source supports the claim, by majority. None on a tie."""
        votes = Counter(level >= SUPPORTED_FROM for level in self.levels.values())
        if votes[True] == votes[False]:
            return None
        return votes[True] > votes[False]


def pairs_from_labels(rows: list[dict]) -> list[Pair]:
    """One Pair per (claim, reference) from the labels export, keeping each labeler's level.

    Rows without a 1-4 level are skipped. A labeler is told apart by `annotator_id` when the
    export has it, else by `annotator` (rows saved before ids, #391).
    """
    pairs: dict[tuple[str, str], Pair] = {}
    for row in rows:
        if row.get("evidence") not in {"1", "2", "3", "4"}:
            continue
        key = (row["claim_id"], row["reference_id"])
        pair = pairs.setdefault(
            key,
            Pair(row["paper_id"], row["claim_id"], row["reference_id"], row["claim"], row.get("split", "")),
        )
        pair.levels[row.get("annotator_id") or row["annotator"]] = int(row["evidence"])
    return list(pairs.values())


def judge_scores(gold: list[bool], predicted: list[bool]) -> dict[str, float]:
    """Accuracy, balanced accuracy, macro-F1 and Cohen's kappa of `predicted` against `gold`.

    `precision`, `recall` and `f1` are for the "supported" class alone.

    Balanced accuracy is reported because "not supported" is likely most of the labels, and a
    judge that always says so would look good on plain accuracy. As in scikit-learn, it averages
    the recall of the classes that appear in `gold` only.
    """
    if not gold:
        return {"pairs": 0}
    counts = Counter(zip(gold, predicted, strict=True))
    tp, tn = counts[(True, True)], counts[(False, False)]
    fp, fn = counts[(False, True)], counts[(True, False)]
    total = tp + tn + fp + fn
    recalls = [tp / (tp + fn)] if tp + fn else []
    recalls += [tn / (tn + fp)] if tn + fp else []
    f1_true = _ratio(2 * tp, 2 * tp + fp + fn)
    f1_false = _ratio(2 * tn, 2 * tn + fn + fp)
    return {
        "pairs": total,
        "accuracy": (tp + tn) / total,
        "balanced_accuracy": sum(recalls) / len(recalls),
        "precision": _ratio(tp, tp + fp),
        "recall": _ratio(tp, tp + fn),
        "f1": f1_true,
        "macro_f1": (f1_true + f1_false) / 2,
        "kappa": cohen_kappa([int(g) for g in gold], [int(p) for p in predicted], levels=2),
        "true_positive": tp,
        "true_negative": tn,
        "false_positive": fp,
        "false_negative": fn,
    }


def human_agreement(pairs: list[Pair]) -> dict[str, float]:
    """How much the first two labelers of each double-labeled pair agree.

    `kappa` is on the binary supported/not split, the same split the judge is scored on, so the
    two can be compared. `weighted_kappa` is on the 1-4 levels, with quadratic weights, as
    docs/labeling.md suggests.
    """
    first, second = [], []
    for pair in pairs:
        if len(pair.levels) < 2:
            continue
        a, b = (pair.levels[labeler] for labeler in sorted(pair.levels)[:2])
        first.append(a)
        second.append(b)
    if not first:
        return {"pairs": 0}
    supported_a = [int(level >= SUPPORTED_FROM) for level in first]
    supported_b = [int(level >= SUPPORTED_FROM) for level in second]
    return {
        "pairs": len(first),
        "agreement": sum(a == b for a, b in zip(supported_a, supported_b, strict=True)) / len(first),
        "kappa": cohen_kappa(supported_a, supported_b, levels=2),
        "weighted_kappa": cohen_kappa(
            [a - 1 for a in first], [b - 1 for b in second], levels=4, quadratic=True
        ),
    }


def cohen_kappa(a: list[int], b: list[int], levels: int, quadratic: bool = False) -> float:
    """Cohen's kappa of two raters over categories 0..levels-1; quadratic weights if asked.

    1 is perfect agreement and 0 is what chance alone gives. When both raters always give the
    same single category, chance agreement is total and kappa is undefined; this returns 1.0
    then, as perfect agreement.
    """
    n = len(a)
    observed = defaultdict(float)
    for x, y in zip(a, b, strict=True):
        observed[(x, y)] += 1 / n
    share_a = Counter(a)
    share_b = Counter(b)

    def weight(x: int, y: int) -> float:
        if quadratic:
            return (x - y) ** 2 / (levels - 1) ** 2
        return float(x != y)

    disagreement = sum(weight(x, y) * observed[(x, y)] for x in range(levels) for y in range(levels))
    expected = sum(
        weight(x, y) * (share_a[x] / n) * (share_b[y] / n) for x in range(levels) for y in range(levels)
    )
    if expected == 0:
        return 1.0
    return 1 - disagreement / expected


def _ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0
