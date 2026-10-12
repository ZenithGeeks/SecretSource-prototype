"""The single-claim /checks routes are gone (#333); a leftover "check" row stays out of the lists.

Nothing in the web app called them, and any signed-in user could start a full verification
through POST /checks. Author draft checks (/author/...) and POST /verify are separate and
tested elsewhere.
"""

import asyncio

import pytest
from app import auth, main
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada"}
ADA = {"Authorization": "Bearer token-ada"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main.store, "delete", lambda item_id: True)
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    main.analyses.clear()
    yield TestClient(main.app)
    main.analyses.clear()


def test_the_single_claim_check_routes_are_gone(client):
    assert client.post("/checks", json={"claim": "c", "source": "s"}, headers=ADA).status_code in (404, 405)
    assert client.get("/checks/a1", headers=ADA).status_code == 404
    assert client.get("/checks/a1/events", headers=ADA).status_code == 404
    assert client.delete("/checks/a1", headers=ADA).status_code in (404, 405)


def test_checks_do_not_appear_in_the_researcher_analyses_list(client):
    main.analyses["p1"] = {"id": "p1", "kind": "paper", "owner": "user-ada", "status": "done", "stages": []}
    main.analyses["c1"] = {"id": "c1", "kind": "check", "owner": "user-ada", "status": "done", "stages": []}

    ids = [row["id"] for row in client.get("/analyses", headers=ADA).json()]
    assert ids == ["p1"]


def test_an_old_analysis_with_no_kind_field_still_lists(client):
    main.analyses["p1"] = {"id": "p1", "owner": "user-ada", "status": "done", "stages": []}

    ids = [row["id"] for row in client.get("/analyses", headers=ADA).json()]
    assert ids == ["p1"]


def test_a_check_id_is_not_found_on_the_analysis_routes(client):
    main.analyses["c1"] = {"id": "c1", "kind": "check", "owner": "user-ada", "status": "done", "stages": []}
    main.streams["c1"] = asyncio.Queue()

    assert client.get("/analyses/c1", headers=ADA).status_code == 404
    assert client.get("/analyses/c1/events", headers=ADA).status_code == 404
    assert client.delete("/analyses/c1", headers=ADA).status_code == 404
    assert "c1" in main.analyses

    main.streams.pop("c1", None)
