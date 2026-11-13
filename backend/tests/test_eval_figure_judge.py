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


def test_a_reply_that_is_not_json_becomes_an_error_with_its_reason():
    def judge(claim, caption, figure):
        signature = dspy.Signature("claim -> verdict")
        raise AdapterParseError(adapter_name="JSONAdapter", signature=signature, lm_response="[...]")

    judged = eval_figure_judge.judge_one(judge, CLAIM, Path("crops"))

    assert judged.verdict == "error" and judged.error == "reply was not JSON twice"
