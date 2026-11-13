"""eval_figures.py's Phoenix runs: each mode's verdicts in the shape eval_generated logs."""

import eval_figures
from eval_generated import Judged

CLAIMS = [
    {"id": "c1", "key": "figure-claims:c1", "figure": "p/figure-1.png"},
    {"id": "c2", "key": "figure-claims:c2", "figure": "p/figure-2.png"},
]
RUN = [{"text": "insufficient", "figure": "supports"}, {"text": "refutes", "figure": "error"}]


def test_only_the_figure_mode_names_the_crop():
    text = eval_figures.judged_by("text", CLAIMS, RUN)
    figure = eval_figures.judged_by("figure", CLAIMS, RUN)

    assert text["figure-claims:c1"] == Judged("insufficient", "text", "")
    assert figure["figure-claims:c1"] == Judged("supports", "figure", "p/figure-1.png")


def test_an_unparsed_reply_keeps_its_reason():
    judged = eval_figures.judged_by("figure", CLAIMS, RUN)["figure-claims:c2"]

    assert judged.verdict == "error" and judged.error == "reply was not JSON twice"
