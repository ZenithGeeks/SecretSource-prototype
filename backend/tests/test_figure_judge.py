"""The judge sees the top figure only when the text alone leaves the claim insufficient (#501),
or refutes it (SCRUM-80); the verdict changes only when the figure supports the claim (#734).

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
    assert (result["verdict_from"], result["judged_figure"]) == ("figure", "figure-2.png")


def test_the_figure_is_judged_with_its_caption_and_not_the_passages(judge):
    verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.evidence == [
        ["A passage.", "Figure 2: Accuracy per model."],
        ["Figure 2: Accuracy per model."],
    ]


def test_a_supports_from_the_text_is_kept_without_the_figure(judge):
    judge.answers[False] = "supports"

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None]
    assert result["verdict"] == "supports"
    assert (result["verdict_from"], result["judged_figure"]) == ("text", "")


def test_a_refutes_the_figure_supports_becomes_supports(judge):
    judge.answers[False] = "refutes"

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None, CROP]
    assert result["verdict"] == "supports"
    assert (result["verdict_from"], result["judged_figure"]) == ("figure", "figure-2.png")


@pytest.mark.parametrize("figure_verdict", ["refutes", "insufficient"])
def test_a_refutes_stays_when_the_figure_does_not_support_the_claim(judge, figure_verdict):
    judge.answers.update({False: "refutes", True: figure_verdict})

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None, CROP]
    assert result["verdict"] == "refutes"
    assert (result["verdict_from"], result["judged_figure"]) == ("text", "")


@pytest.mark.parametrize("figure_verdict", ["refutes", "insufficient"])
def test_an_insufficient_stays_when_the_figure_does_not_support_the_claim(judge, figure_verdict):
    judge.answers[True] = figure_verdict

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None, CROP]
    assert result["verdict"] == "insufficient"
    assert (result["verdict_from"], result["judged_figure"]) == ("text", "")


def test_a_claim_with_the_cited_mark_never_gets_the_figure(judge):
    result = verify.check_prepared("We use AdamW [cited].", "2112.01488", PAPER)

    assert judge.figures == [None]
    assert result["verdict"] == "insufficient"


def test_without_a_figure_crop_the_text_verdict_stands(judge, monkeypatch):
    monkeypatch.setattr(verify, "_figure_crop", lambda hits, source: None)

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == [None]
    assert result["verdict"] == "insufficient"
    assert result["verdict_from"] == "text"


def test_without_passages_no_judge_call_gives_the_verdict(judge, monkeypatch):
    monkeypatch.setattr(verify, "evidence_from", lambda claim, name: [])
    monkeypatch.setattr(verify, "_visual", lambda claim, source: ([], "m"))

    result = verify.check_prepared("The model scores 71.0.", "2112.01488", PAPER)

    assert judge.figures == []
    assert (result["verdict"], result["verdict_from"]) == ("insufficient", "none")
