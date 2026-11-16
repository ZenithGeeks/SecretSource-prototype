"""fold_check adds one check's result to its claim, the way _run_queued does after each check."""

from app.pipeline.verify import fold_check


def test_a_verdict_is_keyed_by_what_the_source_was_looked_up_by():
    claim = {"claim": "Late interaction beats single-vector retrieval.", "citations": []}
    fold_check(
        claim,
        "colbertv2.pdf",
        {"url": ""},
        {"status": "ok", "verdict": "supports", "quote": "…late interaction…"},
    )
    assert claim["verdicts"][0]["cited"] == "colbertv2.pdf"
    assert "unchecked" not in claim


def test_a_failed_check_is_kept_with_its_reason():
    claim = {"claim": "Residual compression loses no quality.", "citations": []}
    fold_check(
        claim,
        "plaid.pdf",
        {"url": ""},
        {"status": "error", "reason": "no-open-access", "message": "no free copy"},
    )
    assert claim["unchecked"] == [
        {"source": "plaid.pdf", "reason": "no-open-access", "message": "no free copy"}
    ]


def test_a_second_check_appends_rather_than_replacing():
    claim = {"claim": "A claim with two cited works.", "citations": []}
    fold_check(claim, "a.pdf", {"url": ""}, {"status": "ok", "verdict": "supports"})
    fold_check(claim, "b.pdf", {"url": ""}, {"status": "ok", "verdict": "refutes"})
    assert [v["cited"] for v in claim["verdicts"]] == ["a.pdf", "b.pdf"]


def test_a_link_we_could_not_resolve_is_a_web_source_for_legacy_results():
    claim = {"claim": "A spec says so.", "citations": []}
    fold_check(
        claim,
        "https://example.org/spec",
        {"url": "https://example.org/spec"},
        {"status": "error", "reason": "unresolvable", "message": "not a paper"},
    )
    assert claim["unchecked"][0]["reason"] == "web-source"
