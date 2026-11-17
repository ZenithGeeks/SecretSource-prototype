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
    "references": {
        "b13": {"ref": "b13", "title": GMRES},
        "b2": {"ref": "b2", "doi": "10.1/x"},
    },
    "claims": [
        {
            "claim": "GMRES minimises the residual over a Krylov subspace.",
            "sentence": "GMRES minimises the residual over a Krylov subspace [b13].",
            "citations": [{"ref": "b13", "title": GMRES, "doi": ""}],
            "unchecked": [
                {
                    "source": GMRES,
                    "reason": "no-open-access",
                    "message": "no open-access PDF",
                }
            ],
        },
        {
            "claim": "Another claim.",
            "sentence": "Another claim [b2].",
            "citations": [{"ref": "b2", "doi": "10.1/x"}],
            "verdicts": [
                {
                    "status": "ok",
                    "verdict": "supports",
                    "cited": "10.1/x",
                    "source": "x.pdf",
                }
            ],
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
    return client.post(
        f"/analyses/a1/references/{ref}/pdf", files={"file": ("gmres.pdf", content)}
    )


def test_an_uploaded_pdf_replaces_the_unchecked_result_of_its_citation(
    api, monkeypatch
):
    client, analysis, detached = api
    checked = []
    monkeypatch.setattr(
        main, "prepare_source", lambda path: {"status": "ok", "path": path}
    )

    def check(claim, source_pdf_path, source, judged, other_citations):
        checked.append((claim, judged))
        return {
            "status": "ok",
            "verdict": "supports",
            "source": source.name,
            "evidence": [],
        }

    monkeypatch.setattr(main, "check_prepared", check)

    response = upload(client)
    assert response.status_code == 202
    pdf = response.json()["pdf"]
    assert analysis["pdfs"] == {"b13": pdf}
    asyncio.run(detached[0])

    gmres, other = analysis["claims"]
    assert gmres["unchecked"] == []
    assert [(v["cited"], v["source"], v["verdict"]) for v in gmres["verdicts"]] == [
        (GMRES, pdf, "supports")
    ]
    assert checked == [
        (gmres["claim"], "GMRES minimises the residual over a Krylov subspace [cited].")
    ]
    assert other["verdicts"] == ANALYSIS["claims"][1]["verdicts"]  # cites another work
    stages = [(stage["stage"], stage["ref"]) for stage in analysis["stages"]]
    assert stages == [("rechecking", "b13"), ("rechecked", "b13")]


def test_a_pdf_that_cannot_be_read_leaves_the_citation_unchecked_with_why(
    api, monkeypatch
):
    client, analysis, detached = api
    failed = {
        "status": "error",
        "reason": "failed",
        "message": "no text in the PDF",
        "retryable": False,
    }
    monkeypatch.setattr(main, "prepare_source", lambda path: failed)

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    assert analysis["claims"][0]["unchecked"] == [
        {"source": GMRES, "reason": "failed", "message": "no text in the PDF"}
    ]


def test_the_owner_can_open_an_upload_no_check_could_read(api, monkeypatch):
    client, _, detached = api
    failed = {
        "status": "error",
        "reason": "failed",
        "message": "no text in the PDF",
        "retryable": False,
    }
    monkeypatch.setattr(main, "prepare_source", lambda path: failed)

    pdf = upload(client).json()["pdf"]
    asyncio.run(detached[0])

    assert client.get(f"/papers/{pdf}").status_code == 200


def test_a_crash_in_the_check_is_logged_and_leaves_the_old_result(
    api, monkeypatch, caplog
):
    client, analysis, detached = api
    monkeypatch.setattr(
        main, "prepare_source", lambda path: {"status": "ok", "path": path}
    )

    def crash(*args):
        raise RuntimeError("the judge is down")

    monkeypatch.setattr(main, "check_prepared", crash)

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    assert analysis["claims"][0]["unchecked"] == ANALYSIS["claims"][0]["unchecked"]
    assert analysis["stages"][-1]["stage"] == "recheck-failed"
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


def test_a_mid_loop_failure_leaves_every_citation_unchanged(api, monkeypatch, caplog):
    client, analysis, detached = api
    # A second claim also cites b13, so the first check can succeed and the second can crash.
    analysis["claims"].append(
        {
            "claim": "GMRES is iterative.",
            "sentence": "GMRES is iterative [b13].",
            "citations": [{"ref": "b13", "title": GMRES, "doi": ""}],
            "unchecked": [
                {
                    "source": GMRES,
                    "reason": "no-open-access",
                    "message": "no open-access PDF",
                }
            ],
        }
    )
    monkeypatch.setattr(
        main, "prepare_source", lambda path: {"status": "ok", "path": path}
    )
    calls = {"n": 0}

    def check(*args):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("the judge is down")
        return {
            "status": "ok",
            "verdict": "supports",
            "source": "new.pdf",
            "evidence": [],
        }

    monkeypatch.setattr(main, "check_prepared", check)

    assert upload(client).status_code == 202
    asyncio.run(detached[0])

    first, other, second = analysis["claims"]
    assert first["unchecked"] == ANALYSIS["claims"][0]["unchecked"]
    assert "verdicts" not in first
    assert second["unchecked"] == [
        {"source": GMRES, "reason": "no-open-access", "message": "no open-access PDF"}
    ]
    assert analysis["stages"][-1]["stage"] == "recheck-failed"
    assert other["verdicts"] == ANALYSIS["claims"][1]["verdicts"]


def test_a_second_upload_replaces_the_verdict_and_keeps_the_lookup_key(
    api, monkeypatch
):
    client, analysis, detached = api
    monkeypatch.setattr(
        main, "prepare_source", lambda path: {"status": "ok", "path": path}
    )

    def check(claim, source_pdf_path, source, judged, other_citations):
        return {
            "status": "ok",
            "verdict": "supports",
            "source": source.name,
            "evidence": [],
        }

    monkeypatch.setattr(main, "check_prepared", check)

    first = upload(client, content=b"%PDF-1.4 first").json()["pdf"]
    asyncio.run(detached[0])
    second = upload(client, content=b"%PDF-1.4 second").json()["pdf"]
    asyncio.run(detached[1])

    assert first != second
    assert analysis["pdfs"] == {"b13": second}
    assert [
        (v["cited"], v["source"], v["verdict"])
        for v in analysis["claims"][0]["verdicts"]
    ] == [(GMRES, second, "supports")]


TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}


@pytest.fixture
def signed_in(monkeypatch, tmp_path):
    """Login on, with ada owning a1 and bo a teammate. The detached re-check is kept for tests."""
    from app import auth
    from app.labeling import pool as labeling_pool

    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(main, "_save_soon", lambda analysis_id: None)
    monkeypatch.setattr(labeling_pool, "pooled", lambda: {"a1": "HPC"})
    detached = []
    monkeypatch.setattr(main, "_detach", detached.append)
    main.analyses.clear()
    analysis = copy.deepcopy(ANALYSIS)
    analysis["owner"] = "user-ada"
    analysis["file"] = "paper.pdf"
    (tmp_path / "paper.pdf").write_bytes(b"%PDF-1.4 paper")
    main.analyses["a1"] = analysis
    return TestClient(main.app), analysis, detached, tmp_path


def test_a_non_owner_post_is_404_and_saves_nothing(signed_in):
    client, analysis, detached, tmp_path = signed_in
    bo = {"Authorization": "Bearer token-bo"}
    response = client.post(
        "/analyses/a1/references/b13/pdf",
        files={"file": ("gmres.pdf", b"%PDF-1.4 stolen")},
        headers=bo,
    )
    assert response.status_code == 404
    assert "pdfs" not in analysis
    assert detached == []
    assert [p.name for p in tmp_path.iterdir() if p.suffix == ".pdf"] == ["paper.pdf"]


def test_a_teammate_cannot_open_an_uploaded_cited_pdf(signed_in, monkeypatch):
    client, analysis, detached, tmp_path = signed_in
    monkeypatch.setattr(
        main, "prepare_source", lambda path: {"status": "ok", "path": path}
    )
    monkeypatch.setattr(
        main,
        "check_prepared",
        lambda *args: {
            "status": "ok",
            "verdict": "supports",
            "source": "x.pdf",
            "evidence": [],
        },
    )
    ada = {"Authorization": "Bearer token-ada"}
    bo = {"Authorization": "Bearer token-bo"}
    pdf = client.post(
        "/analyses/a1/references/b13/pdf",
        files={"file": ("gmres.pdf", b"%PDF-1.4 gmres")},
        headers=ada,
    ).json()["pdf"]
    asyncio.run(detached[0])

    assert client.get(f"/papers/{pdf}", headers=ada).status_code == 200
    assert client.get(f"/papers/{pdf}", headers=bo).status_code == 404
    assert client.get(f"/papers/{pdf}").status_code == 401
    # The analysed paper itself is still openable by the team once shared.
    assert client.get("/papers/paper.pdf", headers=bo).status_code == 200


def test_build_session_and_ask_hide_an_upload_from_a_teammate(tmp_path, monkeypatch):
    from app import config
    from app.labeling import router as labeling

    monkeypatch.setattr(config, "PAPERS_DIR", tmp_path)
    (tmp_path / "gmres-aaa.pdf").write_bytes(b"%PDF-1.4 gmres")
    analysis = {
        "id": "a1",
        "owner": "user-ada",
        "file": "paper.pdf",
        "pdfs": {"b13": "gmres-aaa.pdf"},
        "claims": [
            {
                "claim": "c",
                "citations": [{"ref": "b13", "title": GMRES}],
                "verdicts": [
                    {
                        "source": "gmres-aaa.pdf",
                        "cited": GMRES,
                        "evidence": [{"text": "p", "page": 1}],
                    }
                ],
            }
        ],
    }
    owner = labeling.build_session(analysis, "user-ada")
    teammate = labeling.build_session(analysis, "user-bo")
    assert owner["references"][0]["file"] == "gmres-aaa.pdf"
    assert teammate["references"][0]["file"] == ""
    assert owner["claims"][0]["candidates"][0]["reference_file"] == "gmres-aaa.pdf"
    assert teammate["claims"][0]["candidates"][0]["reference_file"] == ""
    assert labeling._reference_path(analysis, "gmres-aaa", "user-ada") == str(
        tmp_path / "gmres-aaa.pdf"
    )
    assert labeling._reference_path(analysis, "gmres-aaa", "user-bo") is None


def test_a_stuck_rechecking_stage_is_marked_failed_on_restore(monkeypatch):
    saved = []
    stuck = {
        "id": "a1",
        "owner": None,
        "status": "done",
        "stages": [{"stage": "rechecking", "ref": "b13", "at": 1.0}],
        "pdfs": {"b13": "gmres.pdf"},
        "claims": [],
    }
    finished = {
        "id": "a2",
        "owner": None,
        "status": "done",
        "stages": [
            {"stage": "rechecking", "ref": "b13", "at": 1.0},
            {"stage": "rechecked", "ref": "b13", "at": 2.0},
        ],
        "claims": [],
    }
    monkeypatch.setattr(
        main.store, "load_startup", lambda n: {"a1": stuck, "a2": finished}
    )
    monkeypatch.setattr(main.store, "save", saved.append)
    main.analyses.clear()

    main.restore()

    assert stuck["stages"][-1]["stage"] == "recheck-failed"
    assert stuck["stages"][-1]["ref"] == "b13"
    assert finished["stages"][-1]["stage"] == "rechecked"
    assert saved == [stuck]
