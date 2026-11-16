"""A tool's error says whether asking again can help (#417).

Only a lookup service that would not answer, or a network timeout or dropped connection, is
worth retrying. The failing calls are replaced, so these tests make no network calls.
"""

import pytest
import requests
from app.pipeline import claims, rag, sources, verify


@pytest.fixture(autouse=True)
def local_store(monkeypatch, tmp_path):
    """A failed fetch drops its cached rows. Keep that in a temp SQLite file, not the shared store."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))


@pytest.mark.parametrize(
    ("error", "reason", "retryable"),
    [
        (sources.Unresolvable("a bare title"), "unresolvable", False),
        (sources.NoOpenAccessCopy("no free PDF"), "no-open-access", False),
        (sources.NotDownloadable("not a PDF"), "not-downloadable", False),
        (sources.LookupUnavailable("rate limited"), "lookup-unavailable", True),
        (sources.WebSource("a blog post"), "web-source", False),
        (RuntimeError("our own bug"), "failed", False),
        (requests.ReadTimeout("read timed out"), "failed", True),
        (requests.ConnectionError("connection refused"), "failed", True),
        (TimeoutError("timed out"), "failed", True),
        (requests.HTTPError("500 Server Error"), "failed", False),
    ],
)
def test_each_reason_says_whether_a_retry_can_help(error, reason, retryable):
    result = sources.tool_error(error)
    assert {key: result[key] for key in ("status", "message", "reason", "retryable")} == {
        "status": "error",
        "message": str(error),
        "reason": reason,
        "retryable": retryable,
    }
    assert result["source_outcome"]["outcome"]


def test_a_download_that_timed_out_is_reported_as_retryable(monkeypatch):
    found = sources.Resolution("https://example.org/paper.pdf")
    monkeypatch.setattr(sources, "_resolve", lambda identifier, expected=None: found)

    def download(url, name):
        raise requests.ConnectTimeout("connect timed out")

    monkeypatch.setattr(sources, "_download", download)

    result = sources.fetch_source("10.1000/example")

    assert result["reason"] == "not-downloadable"
    assert result["retryable"] is True


def lookup_unavailable(identifier, expected=None):
    raise sources.LookupUnavailable("Semantic Scholar is rate limiting us")


def test_fetch_source_carries_retryable(monkeypatch):
    monkeypatch.setattr(sources, "_resolve", lookup_unavailable)

    assert sources.fetch_source("10.1000/example")["retryable"] is True


@pytest.mark.parametrize(
    "tool",
    [claims.extract_claims, claims.extract_citations, claims.extract_claims_with_citations],
)
def test_the_extract_tools_carry_reason_and_retryable(monkeypatch, tool):
    monkeypatch.setattr(claims, "local_pdf", lookup_unavailable)

    result = tool("10.1000/example")

    assert result["status"] == "error"
    assert result["reason"] == "lookup-unavailable"
    assert result["retryable"] is True


def test_verify_claim_carries_retryable(monkeypatch):
    monkeypatch.setattr(sources, "local_pdf", lookup_unavailable)

    result = verify.verify_claim("ColBERT reduces index size by 10x", "10.1000/example")

    assert result["reason"] == "lookup-unavailable"
    assert result["retryable"] is True


def test_a_failed_check_carries_retryable(monkeypatch, tmp_path):
    def evidence_from(claim, name):
        raise requests.ReadTimeout("ColBERT timed out")

    monkeypatch.setattr(verify, "evidence_from", evidence_from)
    monkeypatch.setattr(verify, "_figures_ready", lambda source: False)

    result = verify.check_prepared(
        "a claim", "2112.01488", tmp_path / "paper.pdf",
        source_outcome={"source_kind": "paper", "outcome": "readable", "retryable": False, "attempts": []},
    )

    assert result["status"] == "error"
    assert result["retryable"] is True
    assert result["source_outcome"]["outcome"] == "retrieval-failed"


def test_a_failed_check_without_prior_source_outcome_keeps_the_original_failure(monkeypatch, tmp_path):
    def evidence_from(claim, name):
        raise requests.ReadTimeout("ColBERT timed out")

    monkeypatch.setattr(verify, "evidence_from", evidence_from)
    monkeypatch.setattr(verify, "_figures_ready", lambda source: False)

    result = verify.check_prepared("a claim", "2112.01488", tmp_path / "paper.pdf")

    assert result["status"] == "error"
    assert result["reason"] == "not-downloadable"
    assert "source_outcome" not in result


def test_add_paper_carries_retryable(monkeypatch):
    def colbert_add(path):
        raise requests.ConnectionError("connection refused")

    monkeypatch.setattr(rag, "colbert_add", colbert_add)

    result = rag.add_paper("data/papers/missing.pdf")

    assert {key: result[key] for key in ("status", "message", "reason", "retryable")} == {
        "status": "error",
        "message": "connection refused",
        "reason": "indexing-failed",
        "retryable": True,
    }


def test_answer_from_docs_carries_retryable(monkeypatch):
    def unanswered(question, papers):
        raise requests.ReadTimeout("ColBERT timed out")

    monkeypatch.setattr(rag, "caller_papers", lambda tool_context: frozenset({"paper.pdf"}))
    monkeypatch.setattr(rag, "_rag", unanswered)

    assert rag.answer_from_docs("How does ColBERTv2 compress its index?")["retryable"] is True
