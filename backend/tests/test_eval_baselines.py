"""The baselines' own rules: how a plain answer is read and how NLI labels become a verdict."""

import eval_baselines
from app.evaluation import Pair


def test_the_first_label_in_a_plain_answer_is_taken():
    assert eval_baselines.parsed_label("Supports.") == "supports"
    assert eval_baselines.parsed_label("insufficient - the passages are about pretraining") == "insufficient"
    assert eval_baselines.parsed_label("I cannot tell") == "error"


def test_an_entailing_passage_wins_over_a_contradicting_one():
    def classify(labels):
        return lambda premises, hypothesis: labels

    claim, passages = "Y improves recall.", ["p1", "p2"]
    assert (
        eval_baselines.nli_verdict(classify(["contradiction", "entailment"]), claim, passages) == "supports"
    )
    assert eval_baselines.nli_verdict(classify(["neutral", "contradiction"]), claim, passages) == "refutes"
    assert eval_baselines.nli_verdict(classify(["neutral", "neutral"]), claim, passages) == "insufficient"
    assert eval_baselines.nli_verdict(classify([]), claim, []) == "insufficient"


def test_the_always_baseline_says_supports_without_retrieval():
    pairs = [Pair("p", "p#0", "ref", "a claim", "test", {"labeler_1": 2})]

    assert eval_baselines.judge("always", pairs) == ["supports"]


def test_a_baseline_run_lands_on_the_dataset_eval_verdicts_uses(monkeypatch, tmp_path):
    import csv
    import sys

    import eval_verdicts
    from app.evaluation import pairs_from_labels

    rows = [
        {"paper_id": "p", "claim_id": f"p#{n}", "reference_id": "ref", "claim": f"claim {n}",
         "annotator": "labeler_1", "evidence": level, "split": split, "topic": "CV"}
        for n, level, split in [(1, "4", "test"), (2, "1", "test"), (3, "4", "train")]
    ]
    labels = tmp_path / "labels.csv"
    with labels.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    logged = {}

    def log_experiment(dataset, runs, **options):
        logged.update(dataset=dataset, runs=runs, options=options)
        return "exp1"

    monkeypatch.setattr(eval_baselines, "PHOENIX_COLLECTOR_ENDPOINT", "http://phoenix:6006")
    monkeypatch.setattr(eval_baselines, "log_experiment", log_experiment)
    monkeypatch.setattr(sys, "argv", ["eval_baselines.py", str(labels), "--baseline", "always"])

    eval_baselines.main()

    topics = {(row["claim_id"], row["reference_id"]): "CV" for row in rows}
    assert logged["dataset"].name == eval_verdicts.labels_dataset(pairs_from_labels(rows), topics).name
    assert [r.scores[0].label for r in logged["runs"]] == ["correct", "wrong"]  # only the test split
    assert logged["options"]["name"] == "baseline always" and logged["options"]["split"] == "test"
