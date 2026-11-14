"""The judge reads the claim's sentence with "[cited]" where the checked citation stands (#672)."""

from pathlib import Path

from app.pipeline import sources, verify
from app.pipeline.verify import cites_others, judged_text

MARKED = "Engines [cited] scale."
SENTENCE = "Optimized late interaction engines [b45][b31] enable to easily scale corpus sizes."


def test_a_sentence_that_cites_another_work_too_cites_others():
    claim = {"claim": "Engines scale.", "sentence": SENTENCE}

    assert cites_others(claim, {"ref": "b31"})


def test_a_sentence_with_only_this_citation_or_none_does_not_cite_others():
    assert not cites_others({"claim": "x", "sentence": "Engines [b31] scale [b31]."}, {"ref": "b31"})
    # Without this citation's marker the judge reads the claim, so there is no part to pick out.
    assert not cites_others({"claim": "x", "sentence": SENTENCE}, {"ref": "b99"})
    assert not cites_others({"claim": "x", "sentence": SENTENCE}, {"title": "PLAID"})
    assert not cites_others({"claim": "x", "sentence": None}, {"ref": "b31"})


def test_marks_the_checked_citation_and_the_others():
    claim = {"claim": "Optimized engines scale corpus sizes.", "sentence": SENTENCE}

    assert judged_text(claim, {"ref": "b31"}) == (
        "Optimized late interaction engines [other] [cited] enable to easily scale corpus sizes."
    )


def test_a_run_of_other_citations_becomes_one_mark():
    claim = {"claim": "x", "sentence": "8.3B in Megatron-LM [b1][b2], and 17B in Turing-NLG [b3]."}

    assert judged_text(claim, {"ref": "b3"}) == "8.3B in Megatron-LM [other], and 17B in Turing-NLG [cited]."


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


def _check(monkeypatch, verdicts, others=False):
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
    result = verify.check_prepared(
        "Engines scale.", "2205.09707", Path("cited.pdf"), MARKED, other_citations=others
    )
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


def test_an_insufficient_for_a_sentence_citing_others_is_asked_again_about_its_part(monkeypatch):
    """#943: "8.3B in Megatron-LM and 17B in Turing-NLG [cited]" was insufficient against the
    Turing-NLG page, because the page does not mention Megatron-LM."""
    verdicts = {"Engines scale.": "insufficient", MARKED: "supports"}

    result, queries, judged = _check(monkeypatch, verdicts, others=True)

    assert queries == ["Engines scale."]
    assert judged == ["Engines scale.", MARKED]
    assert (result["verdict"], result["verdict_from"]) == ("supports", "cited")


def test_the_second_ask_never_turns_an_insufficient_into_a_refutes(monkeypatch):
    verdicts = {"Engines scale.": "insufficient", MARKED: "refutes"}

    result, _, judged = _check(monkeypatch, verdicts, others=True)

    assert judged == ["Engines scale.", MARKED]
    assert (result["verdict"], result["verdict_from"]) == ("insufficient", "text")


def test_an_insufficient_for_a_sentence_citing_only_this_work_is_not_asked_again(monkeypatch):
    result, _, judged = _check(monkeypatch, {"Engines scale.": "insufficient"})

    assert judged == ["Engines scale."]
    assert result["verdict"] == "insufficient"


def test_a_supports_for_a_sentence_citing_others_is_not_asked_again(monkeypatch):
    result, _, judged = _check(monkeypatch, {"Engines scale.": "supports"}, others=True)

    assert judged == ["Engines scale."]
    assert (result["verdict"], result["verdict_from"]) == ("supports", "text")


def test_a_refutes_for_a_sentence_citing_others_is_only_rechecked_once(monkeypatch):
    verdicts = {"Engines scale.": "refutes", MARKED: "insufficient"}

    result, _, judged = _check(monkeypatch, verdicts, others=True)

    assert judged == ["Engines scale.", MARKED]
    assert (result["verdict"], result["verdict_from"]) == ("insufficient", "cited")


def test_no_second_ask_when_the_marked_sentence_is_the_claim(monkeypatch):
    def judge(text, passages, figure=None):
        judged.append(text)
        return {"verdict": "insufficient", "quote": "", "reasoning": ""}

    judged = []
    monkeypatch.setattr(verify.retrieval, "colbert_search", lambda query, k, source=None: [
        {"text": "Engines scale.", "page": 1, "start": 0, "end": 14, "score": 1.0, "source": "cited.pdf"}
    ])
    monkeypatch.setattr(verify, "_judge", judge)
    monkeypatch.setattr(verify, "_visual_indexing", {})
    monkeypatch.setattr(sources, "known_index", lambda identifier: {"index": "", "ids": {}})
    monkeypatch.setattr(sources, "version_of", lambda pdf: {})

    verify.check_prepared(
        "Engines scale.", "2205.09707", Path("cited.pdf"), "Engines scale.", other_citations=True
    )

    assert judged == ["Engines scale."]
