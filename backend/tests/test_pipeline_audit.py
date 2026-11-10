"""audit.py: what an analysis says against itself. Pure functions, nothing to fake."""

import pytest
from app.pipeline import audit

PASSAGE = "ColBERT reduces the index size by a factor of ten on this benchmark."


def verdict(label="supports", quote="reduces the index size", **extra):
    return {"verdict": label, "quote": quote, "evidence": [{"text": PASSAGE}], **extra}


def checks(found):
    return [finding["check"] for finding in found]


@pytest.mark.parametrize(
    ("passage", "quote", "expected"),
    [
        (["a", "b", "c"], ["b", "c"], True),
        (["a", "b", "c"], ["c", "b"], False),
        (["a", "b"], [], False),
        (["a"], ["a", "b"], False),
        (["a", "b", "a", "c"], ["a", "c"], True),
    ],
)
def test_contains_needs_the_quote_as_a_run_of_words(passage, quote, expected):
    assert audit._contains(passage, quote) is expected


def test_overlap_of_an_empty_quote_is_zero():
    assert audit._overlap(["a"], []) == 0.0


def test_overlap_counts_each_word_of_the_passage_once():
    assert audit._overlap(["a", "b"], ["a", "a", "b", "c"]) == 0.5


def test_a_quote_copied_from_a_passage_has_no_findings():
    assert audit.check_verdict(verdict()) == []


def test_a_quote_cut_mid_sentence_still_counts_as_grounded():
    quote = "reduces the index size by a factor of ten and also halves the cost"
    assert audit.check_verdict(verdict(quote=quote)) == []


def test_a_quote_from_a_figure_caption_is_grounded():
    found = verdict(quote="Accuracy per model", evidence=[], pages=[{"caption": "Accuracy per model"}])
    assert audit.check_verdict(found) == []


def test_a_quote_made_up_is_flagged_with_its_text():
    [finding] = audit.check_verdict(verdict(quote="transformers always beat convolutions"))
    assert finding["check"] == "quote-not-in-evidence"
    assert "transformers always beat" in finding["detail"]


def test_a_quote_with_no_words_is_not_checked_against_the_evidence():
    assert audit.check_verdict(verdict(label="insufficient", quote="...")) == []


def test_an_unknown_label_is_flagged():
    [finding] = audit.check_verdict(verdict(label="maybe"))
    assert finding["check"] == "unknown-verdict"
    assert "'maybe'" in finding["detail"]


@pytest.mark.parametrize("label", ["supports", "refutes"])
def test_deciding_without_a_quote_is_flagged(label):
    assert checks(audit.check_verdict(verdict(label=label, quote="  "))) == ["decided-without-quote"]


def test_insufficient_without_a_quote_is_fine():
    assert audit.check_verdict(verdict(label="insufficient", quote="")) == []


def test_an_analysis_with_nothing_wrong_has_no_findings():
    analysis = {"claims": [{"verdicts": [verdict(cited="2112.01488")], "unchecked": []}]}
    assert audit.audit(analysis) == []


def test_an_analysis_without_claims_has_no_findings():
    assert audit.audit({}) == []


def test_more_claims_than_the_limit_is_flagged(monkeypatch):
    monkeypatch.setattr(audit, "CLAIM_LIMIT", 2)
    [finding] = audit.audit({"claims": [{}, {}, {}]})
    assert finding["check"] == "claim-limit"
    assert "3 claims kept" in finding["detail"]


def test_a_limit_of_zero_keeps_every_claim(monkeypatch):
    monkeypatch.setattr(audit, "CLAIM_LIMIT", 0)
    assert audit.audit({"claims": [{}] * 50}) == []


def test_an_unchecked_entry_without_a_reason_is_flagged_on_its_claim():
    analysis = {"claims": [{}, {"unchecked": [{"source": "paper-a", "reason": ""}]}]}
    [finding] = audit.audit(analysis)
    assert (finding["check"], finding["claim"], finding["source"]) == (
        "unchecked-without-reason",
        1,
        "paper-a",
    )


def test_a_source_with_a_verdict_and_an_unchecked_entry_is_flagged():
    claim = {"verdicts": [verdict(cited="paper-a")], "unchecked": [{"source": "paper-a", "reason": "failed"}]}
    [finding] = audit.audit({"claims": [claim]})
    assert (finding["check"], finding["source"]) == ("checked-and-unchecked", "paper-a")


def test_verdict_findings_carry_their_claim_and_source():
    claim = {"verdicts": [verdict(label="maybe", cited="paper-a")]}
    [finding] = audit.audit({"claims": [claim]})
    assert (finding["check"], finding["claim"], finding["source"]) == ("unknown-verdict", 0, "paper-a")
