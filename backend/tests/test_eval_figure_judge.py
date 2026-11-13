"""eval_figure_judge.py: each verdict carries the crop it was judged on, and a failed reply its reason."""

from pathlib import Path

import dspy
import eval_figure_judge
from dspy.utils.exceptions import AdapterParseError
from eval_generated import Judged

CLAIM = {"text": "a claim", "figure": "p/table-1.png", "label": "Table 1", "caption": "Latency."}


def test_a_verdict_names_the_crop_it_was_judged_on():
    def judge(claim, caption, figure):
        assert caption == ["Table 1: Latency."] and figure == Path("crops/p/table-1.png")
        return {"verdict": "supports"}

    judged = eval_figure_judge.judge_one(judge, CLAIM, Path("crops"))

    assert judged == Judged("supports", "figure", "p/table-1.png")


def test_main_logs_each_claim_and_pass_scored_on_its_kind(monkeypatch, tmp_path):
    import json
    import sys

    from app.pipeline import verify

    claims = [
        {**CLAIM, "id": "t1", "paper": "p.pdf", "kind": "supports"},
        {**CLAIM, "id": "t2", "paper": "p.pdf", "kind": "refutes", "text": "another claim"},
    ]
    path = tmp_path / "table-claims.jsonl"
    path.write_text("".join(json.dumps(claim) + "\n" for claim in claims), encoding="utf-8")
    (tmp_path / "p").mkdir()
    (tmp_path / "p" / "table-1.png").write_bytes(b"")
    logged = {}

    def log_experiment(dataset, runs, **options):
        logged.update(dataset=dataset, runs=runs, options=options)
        return "exp1"

    # main() turns the judge cache off by replacing these; monkeypatch puts them back afterwards.
    monkeypatch.setattr(verify.store, "recall_cache", verify.store.recall_cache)
    monkeypatch.setattr(verify.store, "remember_cache", verify.store.remember_cache)

    def judge(claim, caption, figure):
        # A different verdict per claim, so a verdict filed under the wrong claim changes a label.
        return {"verdict": {"a claim": "supports", "another claim": "insufficient"}[claim]}

    monkeypatch.setattr(verify, "_build_judge", lambda: judge)
    monkeypatch.setattr(eval_figure_judge, "gateway_model", lambda: "qwen-test")
    monkeypatch.setattr(eval_figure_judge, "setup_tracing", lambda: False)
    monkeypatch.setattr(eval_figure_judge.dspy, "configure_cache", lambda **settings: None)  # global state
    monkeypatch.setattr(eval_figure_judge, "PHOENIX_COLLECTOR_ENDPOINT", "http://phoenix:6006")
    monkeypatch.setattr(eval_figure_judge, "log_experiment", log_experiment)
    argv = ["eval_figure_judge.py", str(path), "--figures", str(tmp_path), "--runs", "2"]
    monkeypatch.setattr(sys, "argv", argv)

    eval_figure_judge.main()

    labels = {(run.input["id"], run.repetition): run.scores[0].label for run in logged["runs"]}
    assert labels == {("t1", 1): "correct", ("t2", 1): "wrong", ("t1", 2): "correct", ("t2", 2): "wrong"}
    assert [run.input for run in logged["runs"][:2]] == logged["dataset"].inputs
    assert logged["options"]["metadata"]["gateway_model"] == "qwen-test"


def test_a_reply_that_is_not_json_becomes_an_error_with_its_reason():
    def judge(claim, caption, figure):
        signature = dspy.Signature("claim -> verdict")
        raise AdapterParseError(adapter_name="JSONAdapter", signature=signature, lm_response="[...]")

    judged = eval_figure_judge.judge_one(judge, CLAIM, Path("crops"))

    assert judged.verdict == "error" and judged.error == "reply was not JSON twice"
