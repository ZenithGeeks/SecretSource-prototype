"""POST /checks: one claim against one citation, outside any paper analysis (SCRUM-236).

Same scoping and persistence rules as /analyses — this file only tests what's specific to
checks: the route shapes, the "kind" discriminator keeping them out of the researcher list,
and that a pipeline failure surfaces honestly rather than as a fabricated verdict.
"""

import asyncio

import pytest
from app import auth, main
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    # login on, storage (and the verification cache) in a temp SQLite file, not Supabase
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main.store, "delete", lambda item_id: True)
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    main.analyses.clear()
    yield TestClient(main.app)
    main.analyses.clear()


def test_starting_a_check_is_scoped_to_its_owner(client, monkeypatch):
    started = []

    def stub(claim, source, owner):
        started.append((claim, source, owner))
        return {"id": "x"}

    monkeypatch.setattr(main, "_start_check", stub)
    response = client.post(
        "/checks", json={"claim": "c", "source": "s"}, headers={"Authorization": "Bearer token-ada"}
    )
    assert response.status_code == 200
    assert response.json() == {"id": "x"}
    assert started == [("c", "s", "user-ada")]


def test_someone_elses_check_is_not_found(client):
    main.analyses["a1"] = {"id": "a1", "kind": "check", "owner": "user-ada", "status": "done", "stages": []}
    main.streams["a1"] = asyncio.Queue()
    bo = {"Authorization": "Bearer token-bo"}
    ada = {"Authorization": "Bearer token-ada"}

    assert client.get("/checks/a1", headers=bo).status_code == 404
    assert client.delete("/checks/a1", headers=bo).status_code == 404
    assert client.get("/checks/a1/events", headers=bo).status_code == 404
    assert client.get("/checks/a1", headers=ada).status_code == 200
    assert client.get("/checks/a1/events", headers=ada).status_code == 200

    main.streams.pop("a1", None)


def test_deleting_a_check_removes_it(client):
    main.analyses["a1"] = {"id": "a1", "kind": "check", "owner": "user-ada", "status": "done", "stages": []}
    ada = {"Authorization": "Bearer token-ada"}

    assert client.delete("/checks/a1", headers=ada).json() == {"deleted": "a1"}
    assert "a1" not in main.analyses
    assert client.get("/checks/a1", headers=ada).status_code == 404


def test_checks_do_not_appear_in_the_researcher_analyses_list(client):
    main.analyses["p1"] = {"id": "p1", "kind": "paper", "owner": "user-ada", "status": "done", "stages": []}
    main.analyses["c1"] = {"id": "c1", "kind": "check", "owner": "user-ada", "status": "done", "stages": []}
    ada = {"Authorization": "Bearer token-ada"}

    ids = [row["id"] for row in client.get("/analyses", headers=ada).json()]
    assert ids == ["p1"]


def test_an_old_analysis_with_no_kind_field_still_lists(client):
    # Rows saved before checks (SCRUM-236) existed have no "kind" at all.
    main.analyses["p1"] = {"id": "p1", "owner": "user-ada", "status": "done", "stages": []}
    ada = {"Authorization": "Bearer token-ada"}

    ids = [row["id"] for row in client.get("/analyses", headers=ada).json()]
    assert ids == ["p1"]


# --- _run_check: the background task, exercised directly (mirrors test_saving.py / ---
# --- test_shared_limits.py, which call main's async helpers under asyncio.run rather ---
# --- than through TestClient, since a fire-and-forget asyncio.create_task does not ---
# --- reliably finish within one TestClient request). ---


@pytest.fixture
def running_check(monkeypatch, tmp_path):
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    # every case verifies the same claim and source; the cache must not carry one case's
    # verdict into the next
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    main.analyses.clear()
    main.streams.clear()

    def seed(check_id: str) -> None:
        main.analyses[check_id] = {
            "id": check_id, "kind": "check", "claim": "c", "source": "s",
            "status": "running", "owner": None, "stages": [],
        }
        main.streams[check_id] = asyncio.Queue()

    yield seed
    main.analyses.clear()
    main.streams.clear()


def test_a_successful_check_records_the_real_verdict(running_check, monkeypatch):
    monkeypatch.setattr(
        main, "verify_claim",
        lambda claim, source: {
            "status": "ok", "claim": claim, "source": source, "verdict": "supports",
            "quote": "the evidence says so", "reasoning": "it matches",
            "evidence": [{"page": 4}], "indexed_in": {"index": "arxiv", "ids": {}},
        },
    )
    running_check("a1")

    asyncio.run(main._run_check("a1", "c", "s"))

    check = main.analyses["a1"]
    assert check["status"] == "done"
    assert check["verdict"] == "supports"
    assert check["quote"] == "the evidence says so"
    assert check["reasoning"] == "it matches"
    assert check["evidence"] == [{"page": 4}]
    assert [stage["stage"] for stage in check["stages"]] == ["resolving", "done"]


def test_a_failed_check_surfaces_an_honest_error_not_a_fake_verdict(running_check, monkeypatch):
    monkeypatch.setattr(
        main, "verify_claim",
        lambda claim, source: {
            "status": "error", "reason": "no-open-access", "message": "no free copy published",
        },
    )
    running_check("a1")

    asyncio.run(main._run_check("a1", "c", "s"))

    check = main.analyses["a1"]
    assert check["status"] == "error"
    assert check["reason"] == "no-open-access"
    assert check["message"] == "no free copy published"
    assert "verdict" not in check
    assert "quote" not in check
    assert [stage["stage"] for stage in check["stages"]] == ["resolving", "error"]


def test_an_unexpected_failure_is_also_an_honest_error(running_check, monkeypatch):
    def boom(claim, source):
        raise RuntimeError("colbert unreachable")

    monkeypatch.setattr(main, "verify_claim", boom)
    running_check("a1")

    asyncio.run(main._run_check("a1", "c", "s"))

    check = main.analyses["a1"]
    assert check["status"] == "error"
    assert check["message"] == "colbert unreachable"
    assert "verdict" not in check


# --- a check's id on an analysis route, and the reverse, is a 404 (PR #291 review) ---


def test_a_check_id_is_not_found_on_the_analysis_routes(client):
    main.analyses["c1"] = {"id": "c1", "kind": "check", "owner": "user-ada", "status": "done", "stages": []}
    main.streams["c1"] = asyncio.Queue()
    ada = {"Authorization": "Bearer token-ada"}

    assert client.get("/analyses/c1", headers=ada).status_code == 404
    assert client.get("/analyses/c1/events", headers=ada).status_code == 404
    assert client.delete("/analyses/c1", headers=ada).status_code == 404
    assert "c1" in main.analyses  # the check was not deleted through the wrong route

    main.streams.pop("c1", None)


def test_an_analysis_id_is_not_found_on_the_check_routes(client):
    main.analyses["p1"] = {"id": "p1", "kind": "paper", "owner": "user-ada", "status": "done", "stages": []}
    main.analyses["p0"] = {"id": "p0", "owner": "user-ada", "status": "done", "stages": []}  # before `kind`
    main.streams["p1"] = asyncio.Queue()
    ada = {"Authorization": "Bearer token-ada"}

    for analysis_id in ("p1", "p0"):
        assert client.get(f"/checks/{analysis_id}", headers=ada).status_code == 404
        assert client.get(f"/checks/{analysis_id}/events", headers=ada).status_code == 404
        assert client.delete(f"/checks/{analysis_id}", headers=ada).status_code == 404
        assert analysis_id in main.analyses
    assert client.get("/analyses/p1", headers=ada).status_code == 200
    assert client.get("/analyses/p0", headers=ada).status_code == 200

    main.streams.pop("p1", None)
