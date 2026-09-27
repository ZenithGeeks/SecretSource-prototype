"""Every analysis, paper, and researcher view is private to its owner — no signed-in user reads
another's data. With login on, a request without a token is refused; with login off, every
caller shares the analyses that have no owner (the same space that existed before login did).

Supabase is not called: the token check is replaced by a table of known tokens. The client is
used without its context manager, so the app's startup (which loads the store) does not run.
"""

import logging

import pytest
from app import auth, main
from app.pipeline import figures as figures_module
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}


@pytest.fixture
def fake_projects(monkeypatch):
    """A tiny in-memory stand-in for app/store.py's project table, owner-scoped like the real
    one, so researcher/projects routes can be exercised without touching Supabase or SQLite."""
    saved: dict[str, dict] = {}
    monkeypatch.setattr(main.store, "save_project", lambda project: saved.__setitem__(project["id"], project))
    monkeypatch.setattr(
        main.store, "load_projects", lambda owner: [p for p in saved.values() if p.get("owner") == owner]
    )
    return saved


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    # SUPABASE_URL only turns login on; the store (papers_of reads the Author role's rows)
    # stays on a temp SQLite file
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main.store, "delete", lambda analysis_id: True)
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    main.analyses.clear()
    for analysis_id, owner in (("a1", "user-ada"), ("b1", "user-bo"), ("shared", None)):
        claim = {"claim": f"{analysis_id}-exclusive-claim", "citations": [], "verdicts": []}
        main.analyses[analysis_id] = {
            "id": analysis_id, "paper": f"{analysis_id}.pdf", "status": "done", "owner": owner,
            "stages": [], "claims": [claim],
        }
    yield TestClient(main.app)
    main.analyses.clear()


def ids(response):
    return sorted(analysis["id"] for analysis in response.json())


def test_each_signed_in_user_reads_only_their_own_analyses(client):
    ada = {"Authorization": "Bearer token-ada"}
    bo = {"Authorization": "Bearer token-bo"}
    assert ids(client.get("/analyses", headers=ada)) == ["a1"]
    assert ids(client.get("/analyses", headers=bo)) == ["b1"]


def test_with_login_on_a_request_without_a_token_is_refused(client):
    # Not "nobody": a signed-in user whose token went missing would see every ownerless
    # analysis, and anyone could list, open or delete them (#147).
    assert client.get("/analyses").status_code == 401
    assert client.get("/analyses/shared").status_code == 401
    assert client.delete("/analyses/shared").status_code == 401
    assert client.post("/analyses", json={"paper": "x.pdf"}).status_code == 401
    assert client.get("/researcher/home").status_code == 401
    assert client.get("/health").status_code == 200


def test_with_login_off_a_request_without_a_token_sees_the_shared_analyses(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    assert ids(client.get("/analyses")) == ["shared"]


def test_another_users_analysis_is_neither_readable_nor_deletable(client):
    ada = {"Authorization": "Bearer token-ada"}
    assert client.get("/analyses/b1", headers=ada).status_code == 404
    assert client.delete("/analyses/b1", headers=ada).status_code == 404
    assert client.get("/analyses/a1", headers=ada).status_code == 200


def test_the_event_stream_requires_ownership(client):
    ada = {"Authorization": "Bearer token-ada"}
    assert client.get("/analyses/b1/events", headers=ada).status_code == 404
    assert client.get("/analyses/a1/events", headers=ada).status_code == 200


def test_a_token_in_the_url_is_ignored(client):
    # Access logs record URLs, so a token there would be readable by anyone with the logs.
    assert client.get("/analyses/a1/events?access_token=token-ada").status_code == 401
    assert client.get("/analyses?access_token=token-ada").status_code == 401


def test_the_access_log_leaves_out_the_query():
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
        ("172.21.0.6:46100", "GET", "/analyses/a1/events?access_token=secret", "1.1", 200), None,
    )
    main.PathWithoutQuery().filter(record)
    assert record.getMessage() == '172.21.0.6:46100 - "GET /analyses/a1/events HTTP/1.1" 200'


def test_a_token_supabase_rejects_is_a_401(client):
    assert client.get("/analyses", headers={"Authorization": "Bearer expired"}).status_code == 401


def test_without_supabase_a_token_is_ignored_and_the_space_is_shared(client, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    assert ids(client.get("/analyses", headers={"Authorization": "Bearer token-ada"})) == ["shared"]


def test_papers_are_private_to_their_owner(client, monkeypatch, tmp_path):
    for name in ("ada-upload.pdf", "cited-by-ada.pdf", "bo-upload.pdf"):
        (tmp_path / name).write_bytes(b"%PDF-1.4")
    figures = tmp_path / "figures" / "ada-upload"
    figures.mkdir(parents=True)
    (figures / "figure-1.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    # figures_dir() reads its own module-level PAPERS_DIR (imported separately from app.config),
    # so patching main's binding alone leaves it pointed at the real directory.
    monkeypatch.setattr(figures_module, "PAPERS_DIR", tmp_path)
    main.analyses["a1"].update(
        file="data/papers/ada-upload.pdf",
        claims=[{"claim": "c", "citations": [], "verdicts": [{"source": "cited-by-ada.pdf"}]}],
    )
    main.analyses["b1"]["file"] = "data/papers/bo-upload.pdf"
    ada, bo = {"Authorization": "Bearer token-ada"}, {"Authorization": "Bearer token-bo"}

    assert client.get("/papers/ada-upload.pdf", headers=ada).status_code == 200
    assert client.get("/papers/cited-by-ada.pdf", headers=ada).status_code == 200
    # Private: bo may not open ada's paper, and ada may not open bo's.
    assert client.get("/papers/bo-upload.pdf", headers=ada).status_code == 404
    assert client.get("/papers/ada-upload.pdf", headers=bo).status_code == 404
    # Signed out (no token) still gets nothing.
    assert client.get("/papers/ada-upload.pdf").status_code == 401
    # figures/, find and pages/ all resolve the paper through the same _paper() check first
    # (see app/main.py) — figures needs no real PDF content, so it is the one exercised here.
    assert client.get("/papers/ada-upload.pdf/figures/figure-1.png", headers=bo).status_code == 404
    assert client.get("/papers/ada-upload.pdf/figures/figure-1.png", headers=ada).status_code == 200


def test_researcher_home_only_reflects_the_callers_own_papers(client):
    bo = {"Authorization": "Bearer token-bo"}
    response = client.get("/researcher/home", headers=bo)
    assert response.status_code == 200
    body = response.json()
    assert "a1-exclusive-claim" not in str(body)
    assert body["library"]["papers"] == 1


def test_researcher_graph_only_reflects_the_callers_own_papers(client):
    bo = {"Authorization": "Bearer token-bo"}
    body = client.get("/researcher/graph", headers=bo).json()
    labels = [node.get("label", "") for node in body["nodes"]]
    assert not any("a1-exclusive-claim" in label for label in labels)
    assert any("b1-exclusive-claim" in label for label in labels)


def test_researcher_consensus_only_searches_the_callers_own_papers(client):
    bo = {"Authorization": "Bearer token-bo"}
    body = client.post(
        "/researcher/consensus", json={"question": "exclusive claim"}, headers=bo
    ).json()
    assert "a1-exclusive-claim" not in str(body)


def test_projects_and_their_library_are_private_to_the_owner(client, fake_projects):
    ada = {"Authorization": "Bearer token-ada"}
    bo = {"Authorization": "Bearer token-bo"}

    created = client.post("/researcher/projects", json={"name": "Ada's project"}, headers=ada).json()
    project_id = created["id"]

    # bo cannot even see the project exists.
    assert client.get(f"/researcher/projects/{project_id}/library", headers=bo).status_code == 404
    assert project_id not in [p["id"] for p in client.get("/researcher/projects", headers=bo).json()]

    # bo cannot add ada's analysis to bo's own project either, since bo may not read a1.
    bo_project = client.post("/researcher/projects", json={"name": "Bo's project"}, headers=bo).json()
    response = client.post(
        f"/researcher/projects/{bo_project['id']}/papers", json={"analysis_id": "a1"}, headers=bo
    )
    assert response.status_code == 404

    # ada can add her own analysis to her own project.
    response = client.post(
        f"/researcher/projects/{project_id}/papers", json={"analysis_id": "a1"}, headers=ada
    )
    assert response.status_code == 200
