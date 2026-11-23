"""The owner of an analysis uploads the PDF of a cited work with no open-access copy, and the
claims citing it are checked again against that PDF (#983). The check itself is replaced, so
these tests make no network or LLM calls.
"""

import asyncio
import copy

import pytest
from app import main
from app.pipeline import sources, verify
from fastapi.testclient import TestClient

GMRES = "GMRES: A generalized minimal residual algorithm"
ANALYSIS = {
    "id": "a1",
    "owner": None,
    "status": "done",
    "stages": [],
    "references": {"b13": {"ref": "b13", "title": GMRES}, "b2": {"ref": "b2", "doi": "10.1/x"}},
    "claims": [
        {
            "claim": "GMRES minimises the residual over a Krylov subspace.",
            "sentence": "GMRES minimises the residual over a Krylov subspace [b13].",
            "citations": [{"ref": "b13", "title": GMRES, "doi": ""}],
            "unchecked": [{"source": GMRES, "reason": "no-open-access", "message": "no open-access PDF"}],
        },
        {
            "claim": "Another claim.",
            "sentence": "Another claim [b2].",
            "citations": [{"ref": "b2", "doi": "10.1/x"}],
            "verdicts": [{"status": "ok", "verdict": "supports", "cited": "10.1/x", "source": "x.pdf"}],
        },
    ],
}


@pytest.fixture
def api(monkeypatch, tmp_path):
    """A client with one finished analysis, and the detached re-check kept for the test to run."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)  # login off: no token needed
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(main, "_save_soon", lambda analysis_id: None)
    detached = []
    monkeypatch.setattr(main, "_detach", detached.append)
    main.analyses.clear()
    analysis = copy.deepcopy(ANALYSIS)
    main.analyses["a1"] = analysis
    return TestClient(main.app), analysis, detached


def upload(client: TestClient, ref: str = "b13", content: bytes = b"%PDF-1.4 gmres"):
    return client.post(f"/analyses/a1/references/{ref}/pdf", files={"file": ("gmres.pdf", content)})


def test_a_retry_rechecks_only_the_cited_reference_when_the_failure_is_retryable(api, monkeypatch):
    client, analysis, detached = api
    analysis["claims"][0]["unchecked"][0]["source_outcome"] = {
        "source_kind": "unknown",
        "outcome": "temporary-failure",
        "retryable": True,
        "attempts": [],
    }
    prepared = []
    monkeypatch.setattr(
        main,
        "prepare_source",
        lambda source, expected=None: (
            prepared.append((source, expected)) or {"status": "ok", "path": "gmres.pdf"}
        ),
    )
    monkeypatch.setattr(
        main,
        "check_prepared",
        lambda claim, source_path, path, judged, other: {
            "status": "ok",
            "verdict": "supports",
            "source": path.name,
            "evidence": [],
        },
    )

    response = client.post("/analyses/a1/references/b13/retry")
    assert response.status_code == 202
    asyncio.run(detached[0])

    assert prepared == [(GMRES, ANALYSIS["claims"][0]["citations"][0])]
    assert analysis["claims"][0]["unchecked"] == []
    assert analysis["claims"][0]["needs_review"] is True
    assert analysis["claims"][1]["verdicts"] == ANALYSIS["claims"][1]["verdicts"]


def test_a_corrected_url_replaces_the_citation_only_after_its_claims_pass_check(api, monkeypatch):
    client, analysis, detached = api
    analysis["pdfs"] = {"b13": "old-upload.pdf"}
    prepared = []
    monkeypatch.setattr(
        main,
        "prepare_source",
        lambda source, expected=None: (
            prepared.append((source, expected))
            or {
                "status": "ok",
                "path": "replacement.pdf",
                "source_outcome": {
                    "source_kind": "paper",
                    "outcome": "readable",
                    "retryable": False,
                    "attempts": [],
                },
            }
        ),
    )
    monkeypatch.setattr(
        main,
        "check_prepared",
        lambda claim, source_path, path, judged, other, *rest: {
            "status": "ok",
            "verdict": "supports",
            "source": path.name,
            "evidence": [{"text": "replacement evidence"}],
        },
    )

    response = client.post(
        "/analyses/a1/references/b13/repair", json={"url": "https://example.org/gmres.pdf"}
    )
    assert response.status_code == 202
    asyncio.run(detached[0])

    citation = analysis["claims"][0]["citations"][0]
    assert citation["url"] == "https://example.org/gmres.pdf"
    assert citation["doi"] == ""
    assert analysis["references"]["b13"]["url"] == citation["url"]
    assert analysis["claims"][0]["unchecked"] == []
    assert analysis["claims"][0]["verdicts"][0]["cited"] == citation["url"]
    assert analysis["claims"][0]["needs_review"] is True
    assert "b13" not in analysis["pdfs"]
    assert prepared[0][0] == citation["url"]
    assert prepared[0][1]["title"] == GMRES


def test_a_failed_corrected_url_keeps_the_original_source_and_explanation(api, monkeypatch):
    client, analysis, detached = api
    old_citation = copy.deepcopy(analysis["claims"][0]["citations"][0])
    old_unchecked = copy.deepcopy(analysis["claims"][0]["unchecked"])
    monkeypatch.setattr(
        main,
        "prepare_source",
        lambda *args, **kwargs: {
            "status": "error",
            "reason": "web-page-unavailable",
            "message": "page timed out",
            "source_outcome": {
                "source_kind": "web-page",
                "outcome": "temporary-failure",
                "retryable": True,
                "attempts": [],
            },
        },
    )

    response = client.post("/analyses/a1/references/b13/repair", json={"url": "https://example.org/gmres"})
    assert response.status_code == 202
    asyncio.run(detached[0])

    claim = analysis["claims"][0]
    assert claim["citations"][0] == old_citation
    assert claim["unchecked"] == old_unchecked
    assert claim["citation_repairs"]["b13"]["message"] == "page timed out"
    assert analysis["references"]["b13"].get("url") is None


def test_a_repair_requires_exactly_one_doi_or_url(api):
    client, _, detached = api
    assert client.post("/analyses/a1/references/b13/repair", json={}).status_code == 422
    assert (
        client.post(
            "/analyses/a1/references/b13/repair", json={"doi": "10.1234/x", "url": "https://example.org"}
        ).status_code
        == 422
    )
    assert detached == []


def test_another_owner_cannot_retry_repair_or_upload_a_reference(api):
    client, analysis, detached = api
    analysis["owner"] = "someone-else"

    assert client.post("/analyses/a1/references/b13/retry").status_code == 404
    assert (
        client.post("/analyses/a1/references/b13/repair", json={"doi": "10.1234/correct"}).status_code == 404
    )
    assert (
        client.post("/analyses/a1/references/b13/pdf", files={"file": ("paper.pdf", b"%PDF-1.4")}).status_code
        == 404
    )
    assert detached == []


def test_a_named_or_confirmed_no_copy_citation_cannot_be_retried(api):
    client, _, detached = api
    response = client.post("/analyses/a1/references/b13/retry")
    assert response.status_code == 409
    assert detached == []


def test_an_uploaded_pdf_replaces_the_unchecked_result_of_its_citation(api, monkeypatch):
    client, analysis, detached = api
    checked = []
    monkeypatch.setattr(main, "prepare_source", lambda path, expected=None: {"status": "ok", "path": path})

    def check(claim, source_pdf_path, source, judged, other_citations):
        checked.append((claim, judged))
        return {"status": "ok", "verdict": "supports", "source": source.name, "evidence": []}

    monkeypatch.setattr(main, "check_prepared", check)

    response = upload(client)
    assert response.status_code == 202
    pdf = response.json()["pdf"]
    assert analysis.get("pdfs", {}) == {}  # do not attach a replacement until it passed the check
    asyncio.run(detached[0])
    assert analysis["pdfs"] == {"b13": pdf}

    gmres, other = analysis["claims"]
    assert gmres["unchecked"] == []
    assert [(v["cited"], v["source"], v["verdict"]) for v in gmres["verdicts"]] == [(GMRES, pdf, "supports")]
    assert gmres["needs_review"] is True
    assert checked == [(gmres["claim"], "GMRES minimises the residual over a Krylov subspace [cited].")]
    assert other["verdicts"] == ANALYSIS["claims"][1]["verdicts"]  # cites another work
    stages = [(stage["stage"], stage["ref"]) for stage in analysis["stages"]]
    assert stages == [("rechecking", "b13"), ("rechecked", "b13")]


def test_a_pdf_that_cannot_be_read_leaves_the_citation_unchecked_with_why(api, monkeypatch):
    client, analysis, detached = api
    failed = {"status": "error", "reason": "failed", "message": "no text in the PDF", "retryable": False}
    monkeypatch.setattr(main, "prepare_source", lambda path, expected=None: failed)

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    assert analysis["claims"][0]["unchecked"] == ANALYSIS["claims"][0]["unchecked"]
    assert analysis["claims"][0]["citation_repairs"]["b13"] == {
        "status": "error",
        "reason": "failed",
        "message": "no text in the PDF",
        "source_outcome": None,
    }


def test_a_failed_replacement_keeps_the_previous_verdict_and_evidence(api, monkeypatch):
    client, analysis, detached = api
    claim = analysis["claims"][0]
    previous = {
        "status": "ok",
        "verdict": "supports",
        "cited": GMRES,
        "source": "old.pdf",
        "evidence": [{"text": "the original passage", "page": 2}],
    }
    claim["verdicts"] = [previous]
    claim["unchecked"] = []
    analysis["pdfs"] = {"b13": "old.pdf"}
    monkeypatch.setattr(
        main,
        "prepare_source",
        lambda path, expected=None: {
            "status": "error",
            "reason": "identity-mismatch",
            "message": "wrong paper",
            "retryable": False,
        },
    )

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    assert claim["verdicts"] == [previous]
    assert claim["unchecked"] == []
    assert claim["citation_repairs"]["b13"]["message"] == "wrong paper"
    assert analysis["pdfs"]["b13"] == "old.pdf"


def test_an_uploaded_pdf_with_a_conflicting_title_does_not_replace_the_previous_source(api, monkeypatch):
    client, analysis, detached = api
    claim = analysis["claims"][0]
    previous = {
        "status": "ok",
        "verdict": "supports",
        "cited": GMRES,
        "source": "old.pdf",
        "evidence": [{"text": "the original passage", "page": 2}],
    }
    claim["verdicts"] = [previous]
    claim["unchecked"] = []
    analysis["pdfs"] = {"b13": "old.pdf"}
    monkeypatch.setattr(verify, "_index_once", lambda *args, **kwargs: pytest.fail("wrong work was indexed"))
    import pymupdf

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "An unrelated paper", fontsize=20)
    document.set_metadata({"title": "An unrelated paper", "author": "Some Author"})
    content = document.tobytes()
    document.close()

    response = upload(client, content=content)
    assert response.status_code == 202
    asyncio.run(detached[0])

    assert claim["verdicts"] == [previous]
    assert analysis["pdfs"]["b13"] == "old.pdf"
    assert claim["citation_repairs"]["b13"]["reason"] == "identity-mismatch"


def test_pdf_identity_validation_checks_title_author_and_doi(tmp_path):
    import pymupdf

    path = tmp_path / "candidate.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "The work title", fontsize=20)
    page.insert_text((72, 500), "DOI: 10.1234/wrong", fontsize=12)
    document.set_metadata({"title": "The work title", "author": "Wrong Author"})
    document.save(path)
    document.close()

    with pytest.raises(sources.IdentityMismatch, match="author"):
        verify.validate_pdf_identity(
            path, {"title": "The work title", "authors": ["Right Person"], "doi": "10.1234/right"}
        )

    with pytest.raises(sources.IdentityMismatch, match="DOI"):
        verify.validate_pdf_identity(
            path, {"title": "The work title", "authors": ["Wrong Author"], "doi": "10.1234/right"}
        )

    assert (
        verify.validate_pdf_identity(
            path, {"title": "The work title", "authors": ["Wrong Author"], "doi": "10.1234/wrong"}
        )
        is None
    )


def test_the_owner_can_open_an_upload_no_check_could_read(api, monkeypatch):
    client, _, detached = api
    failed = {"status": "error", "reason": "failed", "message": "no text in the PDF", "retryable": False}
    monkeypatch.setattr(main, "prepare_source", lambda path, expected=None: failed)

    pdf = upload(client).json()["pdf"]
    asyncio.run(detached[0])

    assert client.get(f"/papers/{pdf}").status_code == 200


def test_a_crash_in_the_check_is_logged_and_leaves_the_old_result(api, monkeypatch, caplog):
    client, analysis, detached = api
    monkeypatch.setattr(main, "prepare_source", lambda path, expected=None: {"status": "ok", "path": path})

    def crash(*args):
        raise RuntimeError("the judge is down")

    monkeypatch.setattr(main, "check_prepared", crash)

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    assert analysis["claims"][0]["unchecked"] == ANALYSIS["claims"][0]["unchecked"]
    assert analysis["stages"][-1]["stage"] == "rechecked"
    assert "checking analysis a1 again against a replacement for b13 failed" in caplog.text


def test_a_running_analysis_takes_no_upload(api):
    client, analysis, detached = api
    analysis["status"] = "running"
    assert upload(client).status_code == 409
    assert detached == []


def test_a_reference_the_paper_does_not_have_is_404(api):
    client, _, detached = api
    assert upload(client, ref="b99").status_code == 404
    assert detached == []


def test_an_oversized_file_is_refused_and_not_saved(api, monkeypatch, tmp_path):
    client, analysis, _ = api
    monkeypatch.setattr(main.uploads, "MAX_UPLOAD_BYTES", 10)
    assert upload(client, content=b"%PDF-1.4 " + b"x" * 10).status_code == 413
    assert "pdfs" not in analysis
    assert [p for p in tmp_path.iterdir() if p.suffix == ".pdf"] == []


def test_a_file_that_is_not_a_pdf_is_refused_and_not_saved(api, tmp_path):
    client, analysis, _ = api
    assert upload(client, content=b"<html></html>").status_code == 422
    assert "pdfs" not in analysis
    assert [p for p in tmp_path.iterdir() if p.suffix == ".pdf"] == []
