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
