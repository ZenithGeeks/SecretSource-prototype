"""The verdict evaluation (#423): reading the labels export, the scores, and the runner.

The expected numbers were checked against scikit-learn (accuracy_score, balanced_accuracy_score,
f1_score(average="macro"), cohen_kappa_score) on the same inputs; scikit-learn is not a backend
dependency, so the values are pinned here. verify_claim is replaced, so nothing leaves the machine.
"""

import csv
import json
import sys

import pytest
from app import evaluation

GOLD = [True, True, False, False, False, False, True, False]
PREDICTED = [True, False, False, True, False, False, True, False]


def test_judge_scores_match_scikit_learn():
    scores = evaluation.judge_scores(GOLD, PREDICTED)

    assert scores["accuracy"] == pytest.approx(0.75)
    assert scores["balanced_accuracy"] == pytest.approx(0.7333333)
    assert scores["macro_f1"] == pytest.approx(0.7333333)
    assert scores["kappa"] == pytest.approx(0.4666667)
    assert (scores["true_positive"], scores["false_positive"], scores["false_negative"]) == (2, 1, 1)


def test_a_judge_that_always_says_not_supported_scores_half_on_balanced_accuracy():
    gold = [False] * 9 + [True]
    scores = evaluation.judge_scores(gold, [False] * 10)

    assert scores["accuracy"] == pytest.approx(0.9)
    assert scores["balanced_accuracy"] == pytest.approx(0.5)


def test_quadratic_weighted_kappa_matches_scikit_learn():
    a = [1, 2, 3, 3, 0, 2, 1]
    b = [1, 3, 3, 2, 0, 2, 2]
    assert evaluation.cohen_kappa(a, b, levels=4, quadratic=True) == pytest.approx(0.7920792)


def label(claim, annotator, level, split="test", reference="refB"):
    return {
        "paper_id": "paperA",
        "claim_id": claim,
        "reference_id": reference,
        "claim": f"claim {claim}",
        "annotator": annotator,
        "evidence": str(level),
        "split": split,
    }


def test_pairs_keep_every_labelers_level_and_take_the_majority():
    rows = [
        label("c1", "ada", 4),
        label("c1", "bo", 3),
        label("c2", "ada", 1),
        label("c3", "ada", 2),
        label("c3", "bo", 3),  # one says supported, one says not: a tie
        {**label("c4", "ada", 4), "evidence": ""},  # no level, skipped
    ]
    pairs = {p.claim_id: p for p in evaluation.pairs_from_labels(rows)}

    assert pairs["c1"].levels == {"ada": 4, "bo": 3} and pairs["c1"].gold() is True
    assert pairs["c2"].gold() is False
    assert pairs["c3"].gold() is None
    assert "c4" not in pairs


def test_human_agreement_uses_only_double_labeled_pairs():
    rows = [
        label("c1", "ada", 4),
        label("c1", "bo", 4),
        label("c2", "ada", 1),
        label("c2", "bo", 2),
        label("c3", "ada", 3),
    ]

    agreement = evaluation.human_agreement(evaluation.pairs_from_labels(rows))

    assert agreement["pairs"] == 2
    assert agreement["agreement"] == 1.0  # both pairs fall on the same side of the 3-or-more line


def test_the_runner_scores_the_split_and_writes_one_row_per_pair(monkeypatch, tmp_path, capsys):
    import eval_verdicts

    labels = tmp_path / "labels.csv"
    rows = [label("c1", "ada", 4), label("c2", "ada", 1), label("c3", "ada", 4, split="train")]
    with labels.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    asked = []

    def verify_claim(claim, source):
        asked.append((claim, source.rsplit("/", 1)[-1]))
        return {"status": "ok", "verdict": "supports"}

    monkeypatch.setattr(eval_verdicts.verify, "verify_claim", verify_claim)
    out = tmp_path / "verdicts.csv"
    monkeypatch.setattr(sys, "argv", ["eval_verdicts.py", str(labels), "--out", str(out)])

    eval_verdicts.main()

    assert asked == [("claim c1", "refB.pdf"), ("claim c2", "refB.pdf")]  # the train row is not run
    report = json.loads(capsys.readouterr().out)
    assert report["judge"]["pairs"] == 2 and report["judge"]["accuracy"] == pytest.approx(0.5)
    assert report["settings"]["evidence_count"] == eval_verdicts.verify.EVIDENCE_COUNT
    with out.open(newline="", encoding="utf-8") as file:
        assert [r["verdict"] for r in csv.DictReader(file)] == ["supports", "supports"]
