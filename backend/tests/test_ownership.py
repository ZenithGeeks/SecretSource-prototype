"""Each signed-in user sees only their own analyses. With login on, a request without a token is
refused; with login off, every caller shares the analyses that have no owner.

Supabase is not called: the token check is replaced by a table of known tokens. The client is
used without its context manager, so the app's startup (which loads the store) does not run.
"""

import logging

import pytest
from app import auth, main
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main.store, "delete", lambda analysis_id: True)
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    main.analyses.clear()
    for analysis_id, owner in (("a1", "user-ada"), ("b1", "user-bo"), ("shared", None)):
        main.analyses[analysis_id] = {"id": analysis_id, "paper": "x.pdf", "status": "done",
                                      "owner": owner, "stages": [], "claims": []}
    yield TestClient(main.app)
    main.analyses.clear()


def ids(response):
    return sorted(analysis["id"] for analysis in response.json())


def test_each_user_lists_only_their_own_analyses(client):
    assert ids(client.get("/analyses", headers={"Authorization": "Bearer token-ada"})) == ["a1"]
    assert ids(client.get("/analyses", headers={"Authorization": "Bearer token-bo"})) == ["b1"]


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


def test_someone_elses_analysis_is_not_found(client):
    ada = {"Authorization": "Bearer token-ada"}
    assert client.get("/analyses/b1", headers=ada).status_code == 404
    assert client.delete("/analyses/b1", headers=ada).status_code == 404
    assert client.get("/analyses/a1", headers=ada).status_code == 200


def test_the_event_stream_takes_the_token_from_the_header(client):
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


def test_papers_are_served_only_to_the_user_whose_analyses_they_belong_to(client, monkeypatch, tmp_path):
    for name in ("ada-upload.pdf", "cited-by-ada.pdf", "bo-upload.pdf"):
        (tmp_path / name).write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    main.analyses["a1"].update(
        file="data/papers/ada-upload.pdf",
        claims=[{"claim": "c", "citations": [], "verdicts": [{"source": "cited-by-ada.pdf"}]}],
    )
    main.analyses["b1"]["file"] = "data/papers/bo-upload.pdf"
    ada, bo = {"Authorization": "Bearer token-ada"}, {"Authorization": "Bearer token-bo"}

    assert client.get("/papers/ada-upload.pdf", headers=ada).status_code == 200
    assert client.get("/papers/cited-by-ada.pdf", headers=ada).status_code == 200
    assert client.get("/papers/bo-upload.pdf", headers=ada).status_code == 404
    assert client.get("/papers/ada-upload.pdf", headers=bo).status_code == 404
    assert client.get("/papers/ada-upload.pdf").status_code == 401
    # The other routes under a paper take the same check.
    assert client.get("/papers/ada-upload.pdf/figures/figure-1.png", headers=bo).status_code == 404
    assert client.get("/papers/ada-upload.pdf/find?q=x", headers=bo).status_code == 404
    assert client.get("/papers/ada-upload.pdf/pages/1.png", headers=bo).status_code == 404
