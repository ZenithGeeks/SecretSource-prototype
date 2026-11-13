"""eval_generated.py's scoring: precision, recall and F1 split by the judge call (SCRUM-80)."""

import json

import eval_generated
from eval_generated import Judged


def test_claims_with_the_same_id_in_two_files_keep_their_own_key(tmp_path):
    for name, text in [("claims", "from the text"), ("caption-claims", "from a caption")]:
        claim = {"id": "paper.pdf#31:supports", "paper": "paper.pdf", "kind": "supports", "text": text}
        (tmp_path / f"{name}.jsonl").write_text(json.dumps(claim) + "\n", encoding="utf-8")

    claims = eval_generated.load_claims([tmp_path / "claims.jsonl", tmp_path / "caption-claims.jsonl"])

    keys = [c["key"] for c in claims]
    assert keys == ["claims:paper.pdf#31:supports", "caption-claims:paper.pdf#31:supports"]

CLAIMS = [
    {"id": "t1", "key": "t1", "kind": "supports"},
    {"id": "t2", "key": "t2", "kind": "refutes"},
    {"id": "f1", "key": "f1", "kind": "supports"},
    {"id": "e1", "key": "e1", "kind": "supports"},
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


def test_each_pass_becomes_a_repetition_scored_on_the_claims_kind():
    claims = [{**claim, "paper": "p.pdf", "text": f"claim {claim['id']}"} for claim in CLAIMS]
    second = {**RUN, "t2": Judged("refutes", "text", "")}

    runs = eval_generated.experiment_runs(claims, [RUN, second], [("a", "b"), ("c", "d")])

    by_pass = {(r.input["id"], r.repetition): r for r in runs}
    assert len(runs) == 8
    assert by_pass["t2", 1].scores[0].label == "wrong" and by_pass["t2", 2].scores[0].label == "correct"
    assert by_pass["e1", 1].scores == [] and by_pass["e1", 1].started == "a"


def test_a_failed_step_keeps_its_reason_and_message():
    failed = {"status": "error", "reason": "no_pdf", "message": "ref.pdf not found"}

    judged = eval_generated.judge({"text": "a claim", "paper": "ref.pdf"}, failed)

    assert judged.verdict == "error" and judged.error == "no_pdf ref.pdf not found"
