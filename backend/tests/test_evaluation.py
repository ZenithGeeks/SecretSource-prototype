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
    assert scores["precision"] == pytest.approx(2 / 3)
    assert scores["recall"] == pytest.approx(2 / 3)
    assert scores["f1"] == pytest.approx(2 / 3)
    assert scores["kappa"] == pytest.approx(0.4666667)
    assert (scores["true_positive"], scores["false_positive"], scores["false_negative"]) == (2, 1, 1)


def test_a_judge_that_always_says_not_supported_scores_half_on_balanced_accuracy():
    gold = [False] * 9 + [True]
    scores = evaluation.judge_scores(gold, [False] * 10)

    assert scores["accuracy"] == pytest.approx(0.9)
    assert scores["balanced_accuracy"] == pytest.approx(0.5)


def test_balanced_accuracy_counts_only_the_classes_in_gold():
    # scikit-learn gives 1.0 here: no supported pair exists, so its recall is not averaged in
    assert evaluation.judge_scores([False, False], [False, False])["balanced_accuracy"] == 1.0


def test_no_pairs_gives_an_empty_report():
    assert evaluation.judge_scores([], []) == {"pairs": 0}


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
        return {
            "status": "ok",
            "verdict": "supports",
            "verdict_from": "figure" if claim == "claim c2" else "text",
        }

    monkeypatch.setattr(eval_verdicts.verify, "verify_claim", verify_claim)
    out = tmp_path / "verdicts.csv"
    monkeypatch.setattr(sys, "argv", ["eval_verdicts.py", str(labels), "--out", str(out)])

    eval_verdicts.main()

    assert asked == [("claim c1", "refB.pdf"), ("claim c2", "refB.pdf")]  # the train row is not run
    report = json.loads(capsys.readouterr().out)
    assert report["judge"]["pairs"] == 2 and report["judge"]["accuracy"] == pytest.approx(0.5)
    assert report["settings"]["evidence_count"] == eval_verdicts.verify.EVIDENCE_COUNT
    # c1 (gold supported) came from the text judge, c2 (gold not supported) from the figure judge.
    assert report["judge_by_source"]["text"]["true_positive"] == 1
    assert report["judge_by_source"]["figure"]["false_positive"] == 1
    with out.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    assert [r["verdict"] for r in rows] == ["supports", "supports"]
    assert [r["verdict_from"] for r in rows] == ["text", "figure"]


def test_pairs_keep_each_labeled_passage_once():
    rows = [
        {**label("c1", "ada", 4), "spans": json.dumps(["first passage", ""])},
        {**label("c1", "bo", 3), "spans": json.dumps(["first passage", "second passage"])},
    ]

    (pair,) = evaluation.pairs_from_labels(rows)

    assert pair.spans == ["first passage", "second passage"]


def test_level_confusion_counts_each_labelers_level_under_the_verdict():
    levels = [{"ada": 3}, {"ada": 3, "bo": 4}, {"ada": 1}]

    table = evaluation.level_confusion(levels, ["insufficient", "supports", "supports"])

    assert table == {"insufficient": {1: 0, 2: 0, 3: 1, 4: 0}, "supports": {1: 1, 2: 0, 3: 1, 4: 1}}


def write_labels(path, rows):
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_the_runner_reports_retrieval_recall_and_quote_grounding(monkeypatch, tmp_path, capsys):
    import eval_verdicts

    labels = tmp_path / "labels.csv"
    passage = "ColBERT stores one vector per token and compresses them to cut the index size"
    write_labels(
        labels,
        [
            {**label("c1", "ada", 4), "spans": json.dumps([passage])},
            {**label("c2", "ada", 3), "spans": json.dumps(["a passage retrieval never finds"])},
        ],
    )

    def verify_claim(claim, source):
        quote = "compresses them to cut the index size" if claim == "claim c1" else "words not in it"
        return {"status": "ok", "verdict": "supports", "quote": quote, "evidence": [{"text": passage}]}

    monkeypatch.setattr(eval_verdicts.verify, "verify_claim", verify_claim)
    out = tmp_path / "verdicts.csv"
    monkeypatch.setattr(sys, "argv", ["eval_verdicts.py", str(labels), "--out", str(out)])

    eval_verdicts.main()

    report = json.loads(capsys.readouterr().out)
    recall = report[f"retrieval_recall_at_{eval_verdicts.verify.EVIDENCE_COUNT}"]
    assert recall == {"pairs": 2, "share": 0.5}  # c2's labeled passage was not retrieved
    assert report["quote_grounding"] == {"pairs": 2, "share": 0.5}  # c2's quote is made up
    assert report["levels"]["supports"] == {"1": 0, "2": 0, "3": 1, "4": 1}


def test_the_runner_can_judge_the_labeled_passages_instead(monkeypatch, tmp_path, capsys):
    import eval_verdicts

    labels = tmp_path / "labels.csv"
    write_labels(
        labels,
        [
            {**label("c1", "ada", 4), "spans": json.dumps(["the labeled passage"])},
            {**label("c2", "ada", 1), "spans": "[]"},  # nothing to judge on
        ],
    )
    judged = []

    def judge_passages(claim, passages):
        judged.append((claim, passages))
        return {"verdict": "supports", "quote": "the labeled passage", "reasoning": ""}

    monkeypatch.setattr(eval_verdicts.verify, "judge_passages", judge_passages)
    out = tmp_path / "verdicts.csv"
    argv = ["eval_verdicts.py", str(labels), "--out", str(out), "--passages", "labeled"]
    monkeypatch.setattr(sys, "argv", argv)

    eval_verdicts.main()

    assert judged == [("claim c1", ["the labeled passage"])]
    report = json.loads(capsys.readouterr().out)
    assert report["errors"] == 1 and report["judge"]["true_positive"] == 1
    assert report["settings"]["passages"] == "labeled"
    assert report["quote_grounding"] == {"pairs": 1, "share": 1.0}
    assert report[f"retrieval_recall_at_{eval_verdicts.verify.EVIDENCE_COUNT}"]["pairs"] == 0
