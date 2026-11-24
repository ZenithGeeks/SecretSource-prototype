"""Gaps and edge cases of the labeling review, the ledger and the DSPy export."""

import json

import pytest
from app import auth
from app.labeling import dspy_export, ledger
from app.labeling.review import Saved, rule_findings
from app.labeling.schema import ALL_TABS

CLAIM = {"claim_id": "p#0", "candidates": [{"cand_id": "c1"}, {"cand_id": "c2"}]}


def passage_row(cand_id, status="relevant", reference_id="r1"):
    return {"cand_id": cand_id, "status": status, "reference_id": reference_id, "passage": "text"}


def test_an_edited_claim_with_empty_wording_is_flagged():
    saved = Saved({"status": "edited", "claim_edited": " "}, [passage_row("c1"), passage_row("c2")], [])
    texts = [f.text for f in rule_findings(CLAIM, saved) if f.target.kind == "claim"]
    assert texts == ["The claim is marked edited, but the new wording is empty."]


def test_passages_not_judged_yet_are_counted_in_one_finding():
    [finding] = rule_findings(CLAIM, Saved({"status": "accepted"}, [], []))
    assert finding.text == "2 passages are not judged yet."
    assert finding.target.id == "c1"


def test_one_open_passage_reads_in_the_singular():
    saved = Saved({}, [passage_row("c1", "irrelevant")], [])
    [finding] = rule_findings(CLAIM, saved)
    assert finding.text == "1 passage is not judged yet."


def test_passages_marked_relevant_with_no_level_are_flagged():
    saved = Saved({}, [passage_row("c1"), passage_row("c2")], [])
    [finding] = rule_findings(CLAIM, saved)
    assert finding.target.id == "r1" and "no level" in finding.text


def test_a_level_with_no_relevant_passage_is_flagged():
    rows = [passage_row("c1", "irrelevant"), passage_row("c2", "irrelevant")]
    saved = Saved({}, rows, [{"reference_id": "r1", "evidence": "3"}])
    [finding] = rule_findings(CLAIM, saved)
    assert "none of its passages is marked relevant" in finding.text


def test_a_ledger_is_made_once_and_reused(monkeypatch):
    monkeypatch.setattr(ledger, "_store", None)
    monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
    assert ledger.get_store() is ledger.get_store()


def test_without_supabase_there_is_nowhere_to_save(monkeypatch):
    monkeypatch.setattr(ledger, "_store", None)
    monkeypatch.setattr(auth, "_supabase_configured", lambda: False)
    with pytest.raises(ledger.NotConfigured):
        ledger.get_store()


def test_no_rows_means_no_insert(monkeypatch):
    monkeypatch.setattr(ledger.Ledger, "_table", lambda self: pytest.fail("the table was used"))
    ledger.Ledger().append("labels", [])


def test_a_label_with_unreadable_spans_is_left_out_of_the_verify_examples():
    label = dict.fromkeys(ALL_TABS["labels"], "")
    label |= {
        "claim_id": "p#0",
        "reference_id": "r1",
        "annotator_id": "a",
        "evidence": "3",
        "spans": "not json",
    }
    rows = {"claims": [], "labels": [label]}
    assert dspy_export.verdict_examples(rows) == []
    label["spans"] = json.dumps(["a span"])
    assert [e["source"] for e in dspy_export.verdict_examples(rows)] == ["a span"]
