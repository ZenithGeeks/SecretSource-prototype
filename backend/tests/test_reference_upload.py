"""The owner of an analysis uploads the PDF of a cited work with no open-access copy, and the
claims citing it are checked again against that PDF (#983). The check itself is replaced, so
these tests make no network or LLM calls.
"""

import asyncio
import copy

import pytest
from app import main
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


def test_an_uploaded_pdf_replaces_the_unchecked_result_of_its_citation(api, monkeypatch):
    client, analysis, detached = api
    checked = []
    monkeypatch.setattr(main, "prepare_source", lambda path: {"status": "ok", "path": path})

    def check(claim, source_pdf_path, source, judged, other_citations):
        checked.append((claim, judged))
        return {"status": "ok", "verdict": "supports", "source": source.name, "evidence": []}

    monkeypatch.setattr(main, "check_prepared", check)

    response = upload(client)
    assert response.status_code == 202
    pdf = response.json()["pdf"]
    assert analysis["pdfs"] == {"b13": pdf}
    asyncio.run(detached[0])

    gmres, other = analysis["claims"]
    assert gmres["unchecked"] == []
    assert [(v["cited"], v["source"], v["verdict"]) for v in gmres["verdicts"]] == [(GMRES, pdf, "supports")]
    assert checked == [(gmres["claim"], "GMRES minimises the residual over a Krylov subspace [cited].")]
    assert other["verdicts"] == ANALYSIS["claims"][1]["verdicts"]  # cites another work
    stages = [(stage["stage"], stage["ref"]) for stage in analysis["stages"]]
    assert stages == [("rechecking", "b13"), ("rechecked", "b13")]


def test_a_pdf_that_cannot_be_read_leaves_the_citation_unchecked_with_why(api, monkeypatch):
    client, analysis, detached = api
    failed = {"status": "error", "reason": "failed", "message": "no text in the PDF", "retryable": False}
    monkeypatch.setattr(main, "prepare_source", lambda path: failed)

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    assert analysis["claims"][0]["unchecked"] == [
        {"source": GMRES, "reason": "failed", "message": "no text in the PDF"}
    ]


def test_the_owner_can_open_an_upload_no_check_could_read(api, monkeypatch):
    client, _, detached = api
    failed = {"status": "error", "reason": "failed", "message": "no text in the PDF", "retryable": False}
    monkeypatch.setattr(main, "prepare_source", lambda path: failed)

    pdf = upload(client).json()["pdf"]
    asyncio.run(detached[0])

    assert client.get(f"/papers/{pdf}").status_code == 200


def test_a_crash_in_the_check_is_logged_and_leaves_the_old_result(api, monkeypatch, caplog):
    client, analysis, detached = api
    monkeypatch.setattr(main, "prepare_source", lambda path: {"status": "ok", "path": path})

    def crash(*args):
        raise RuntimeError("the judge is down")

    monkeypatch.setattr(main, "check_prepared", crash)

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    assert analysis["claims"][0]["unchecked"] == ANALYSIS["claims"][0]["unchecked"]
    assert analysis["stages"][-1]["stage"] == "rechecked"
    assert "checking analysis a1 again against an uploaded b13 failed" in caplog.text


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
