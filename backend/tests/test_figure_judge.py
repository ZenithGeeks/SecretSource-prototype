"""The judge sees the top figure only when the text alone leaves the claim insufficient (#501).

No services: retrieval, the figure lookup and the judge are fakes. The fake judge answers
from a table keyed on whether it got a figure, and records the figure and evidence of each call.
"""

import types
from pathlib import Path

import pytest
from app.pipeline import sources, verify

PAPER = Path("data/papers/cited.pdf")
CROP = Path("figures/figure-2.png")
HIT = {"image": "figure-2.png", "label": "Figure 2", "caption": "Accuracy per model."}


@pytest.fixture
def judge(monkeypatch):
    """Fake retrieval with one passage and one figure hit. `answers` sets the verdicts."""
    judge = types.SimpleNamespace(
        figures=[], evidence=[], answers={False: "insufficient", True: "supports"}
    )

    def fake_judge(claim, passages, figure=None):
        judge.figures.append(figure)
        judge.evidence.append(passages)
        return {"verdict": judge.answers[figure is not None], "quote": "", "reasoning": ""}

    monkeypatch.setattr(verify, "evidence_from", lambda claim, name: [{"text": "A passage."}])
    monkeypatch.setattr(verify, "_figures_ready", lambda source: True)
    monkeypatch.setattr(verify, "_visual", lambda claim, source: ([HIT], "m"))
    monkeypatch.setattr(verify, "_figure_crop", lambda hits, source: CROP)
    monkeypatch.setattr(sources, "known_index", lambda pdf: {})
    monkeypatch.setattr(sources, "version_of", lambda source: {})
    monkeypatch.setattr(verify, "_judge", fake_judge)
    return judge


def test_an_insufficient_text_verdict_is_asked_again_with_the_figure(judge):
    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None, CROP]
    assert result["verdict"] == "supports"


def test_the_figure_is_judged_with_its_caption_and_not_the_passages(judge):
    verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.evidence == [
        ["A passage.", "Figure 2: Accuracy per model."],
        ["Figure 2: Accuracy per model."],
    ]


@pytest.mark.parametrize("text_verdict", ["supports", "refutes"])
def test_a_text_verdict_that_settles_the_claim_is_kept_without_the_figure(judge, text_verdict):
    judge.answers[False] = text_verdict

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None]
    assert result["verdict"] == text_verdict


def test_a_claim_with_the_cited_mark_never_gets_the_figure(judge):
    result = verify.check_prepared("We use AdamW [cited].", "2112.01488", PAPER)

    assert judge.figures == [None]
    assert result["verdict"] == "insufficient"


def test_without_a_figure_crop_the_text_verdict_stands(judge, monkeypatch):
    monkeypatch.setattr(verify, "_figure_crop", lambda hits, source: None)

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None]
    assert result["verdict"] == "insufficient"
