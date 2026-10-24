"""The judge reads the claim's sentence with "[cited]" where the checked citation stands (#672)."""

from pathlib import Path

from app.pipeline import sources, verify
from app.pipeline.verify import judged_text

MARKED = "Engines [cited] scale."
SENTENCE = "Optimized late interaction engines [b45][b31] enable to easily scale corpus sizes."


def test_marks_the_checked_citation_and_drops_the_others():
    claim = {"claim": "Optimized engines scale corpus sizes.", "sentence": SENTENCE}

    assert judged_text(claim, {"ref": "b31"}) == (
        "Optimized late interaction engines [cited] enable to easily scale corpus sizes."
    )


def test_keeps_punctuation_after_the_mark():
    claim = {
        "claim": "Existing language models are generally implemented with Transformers.",
        "sentence": "Existing language models are generally implemented with Transformers [b37], "
        "which require memory and compute that increases quadratically in sequence length.",
    }

    assert judged_text(claim, {"ref": "b37"}).startswith(
        "Existing language models are generally implemented with Transformers [cited], which"
    )


def test_falls_back_to_the_claim_without_a_marker_for_the_citation():
    claim = {"claim": "Engines scale.", "sentence": SENTENCE}

    assert judged_text(claim, {"ref": "b99"}) == "Engines scale."
    assert judged_text(claim, {"title": "PLAID"}) == "Engines scale."
    assert judged_text({"claim": "Engines scale.", "sentence": None}, {"ref": "b31"}) == "Engines scale."


def _check(monkeypatch, verdicts):
    """check_prepared with fake retrieval and a judge that answers from `verdicts` by text.
    Returns the result, the retrieval queries and the texts the judge read."""
    queries, judged = [], []

    def colbert_search(query, k, source=None):
        queries.append(query)
        passage = {"text": "Engines scale.", "page": 1, "start": 0, "end": 14, "score": 1.0}
        return [{**passage, "source": "cited.pdf"}]

    def judge(text, passages, figure=None):
        judged.append(text)
        return {"verdict": verdicts[text], "quote": "", "reasoning": ""}

    monkeypatch.setattr(verify.retrieval, "colbert_search", colbert_search)
    monkeypatch.setattr(verify, "_judge", judge)
    monkeypatch.setattr(verify, "_visual_indexing", {})
    monkeypatch.setattr(sources, "known_index", lambda identifier: {"index": "", "ids": {}})
    monkeypatch.setattr(sources, "version_of", lambda pdf: {})
    result = verify.check_prepared("Engines scale.", "2205.09707", Path("cited.pdf"), MARKED)
    return result, queries, judged


def test_a_refutes_is_rechecked_with_the_marked_sentence(monkeypatch):
    verdicts = {"Engines scale.": "refutes", MARKED: "insufficient"}

    result, queries, judged = _check(monkeypatch, verdicts)

    assert queries == ["Engines scale."]
    assert judged == ["Engines scale.", MARKED]
    assert (result["verdict"], result["verdict_from"]) == ("insufficient", "cited")
    assert result["claim"] == "Engines scale."


def test_a_refutes_both_judges_give_stays(monkeypatch):
    result, _, _ = _check(monkeypatch, {"Engines scale.": "refutes", MARKED: "refutes"})

    assert (result["verdict"], result["verdict_from"]) == ("refutes", "text")


def test_other_verdicts_are_not_rechecked(monkeypatch):
    result, _, judged = _check(monkeypatch, {"Engines scale.": "supports"})

    assert judged == ["Engines scale."]
    assert result["verdict"] == "supports"
