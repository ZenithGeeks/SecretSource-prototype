"""eval_generated.py's scoring: precision, recall and F1 split by the judge call (SCRUM-80)."""

import eval_generated
from eval_generated import Judged

CLAIMS = [
    {"id": "t1", "kind": "supports"},
    {"id": "t2", "kind": "refutes"},
    {"id": "f1", "kind": "supports"},
    {"id": "e1", "kind": "supports"},
]
RUN = {
    "t1": Judged("supports", "text", ""),
    "t2": Judged("supports", "text", ""),
    "f1": Judged("supports", "figure", "fig1.png"),
    "e1": Judged("error", "none", ""),
}


def test_each_judge_call_is_scored_on_its_own_verdicts():
    scores = eval_generated.scores_by_source(CLAIMS, RUN)

    assert set(scores) == {"all", "text", "figure"}
    assert scores["text"]["pairs"] == 2 and scores["text"]["precision"] == 0.5
    assert scores["figure"]["pairs"] == 1 and scores["figure"]["f1"] == 1.0


def test_errors_are_left_out_of_every_score():
    assert eval_generated.scores_by_source(CLAIMS, RUN)["all"]["pairs"] == 3
