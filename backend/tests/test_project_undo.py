"""Deleting a researcher project hides it instead of removing it, so the Library's Undo can
bring it back with its name, description and paper list (SCRUM-517).

Same fixture shape as test_author_routes.py: login is on with a table of known tokens and
storage is a temp SQLite file, so the real store code runs. No migration is involved: the
project is one JSON blob and `deleted` is a field in it.
"""

from datetime import UTC, datetime, timedelta

import pytest
from app import auth, main, store
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}
ADA = {"Authorization": "Bearer token-ada"}
BO = {"Authorization": "Bearer token-bo"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path / "papers")
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    main.analyses.clear()
    main.analyses["undo-paper"] = {
        "id": "undo-paper",
        "paper": "undo-paper.pdf",
        "status": "done",
        "owner": "user-ada",
        "stages": [],
        "claims": [],
    }
    yield TestClient(main.app)
    main.analyses.clear()


def make_project(client, name="Survey", description="Late interaction"):
    created = client.post(
        "/researcher/projects", headers=ADA, json={"name": name, "description": description}
    ).json()
    client.post(
        f"/researcher/projects/{created['id']}/papers", headers=ADA, json={"analysis_id": "undo-paper"}
    )
    return created["id"]


def listed(client, headers=ADA):
    return [project["id"] for project in client.get("/researcher/projects", headers=headers).json()]


def test_a_deleted_project_leaves_the_list_but_its_row_stays(client):
    project_id = make_project(client)
    assert client.delete(f"/researcher/projects/{project_id}", headers=ADA).json() == {"deleted": project_id}
    assert project_id not in listed(client)
    kept = {p["id"]: p for p in store.load_projects("user-ada", include_deleted=True)}
    assert kept[project_id]["deleted"]


def test_restore_brings_back_the_name_description_and_papers(client):
    project_id = make_project(client)
    client.delete(f"/researcher/projects/{project_id}", headers=ADA)
    restored = client.post(f"/researcher/projects/{project_id}/restore", headers=ADA)
    assert restored.status_code == 200
    assert restored.json()["name"] == "Survey"
    assert project_id in listed(client)
    stored = next(p for p in store.load_projects("user-ada") if p["id"] == project_id)
    assert stored["description"] == "Late interaction"
    assert stored["analyses"] == ["undo-paper"]
    assert "deleted" not in stored


def test_a_deleted_project_cannot_be_renamed_filled_or_read(client):
    project_id = make_project(client)
    client.delete(f"/researcher/projects/{project_id}", headers=ADA)
    assert (
        client.patch(f"/researcher/projects/{project_id}", headers=ADA, json={"name": "New"}).status_code
        == 404
    )
    assert client.get(f"/researcher/projects/{project_id}/library", headers=ADA).status_code == 404
    paper = client.post(
        f"/researcher/projects/{project_id}/papers", headers=ADA, json={"analysis_id": "undo-paper"}
    )
    assert paper.status_code == 404
    assert client.delete(f"/researcher/projects/{project_id}", headers=ADA).status_code == 404


def test_restoring_a_project_that_is_not_deleted_changes_nothing(client):
    project_id = make_project(client)
    before = next(p for p in store.load_projects("user-ada") if p["id"] == project_id)
    again = client.post(f"/researcher/projects/{project_id}/restore", headers=ADA)
    assert again.status_code == 200
    assert next(p for p in store.load_projects("user-ada") if p["id"] == project_id) == before


def test_only_the_owner_can_restore_and_an_unknown_id_is_a_404(client):
    project_id = make_project(client)
    client.delete(f"/researcher/projects/{project_id}", headers=ADA)
    assert client.post(f"/researcher/projects/{project_id}/restore", headers=BO).status_code == 404
    assert project_id not in listed(client, BO)
    assert client.post("/researcher/projects/nope/restore", headers=ADA).status_code == 404
    assert client.post(f"/researcher/projects/{project_id}/restore", headers=ADA).status_code == 200


def test_a_project_deleted_longer_ago_than_the_window_is_removed_by_the_next_delete(client):
    old = make_project(client, "Old")
    client.delete(f"/researcher/projects/{old}", headers=ADA)
    stale = next(p for p in store.load_projects("user-ada", include_deleted=True) if p["id"] == old)
    stale["deleted"] = (datetime.now(UTC) - timedelta(days=main.PROJECT_RESTORE_DAYS + 1)).isoformat()
    store.save_project(stale)
    recent = make_project(client, "Recent")
    client.delete(f"/researcher/projects/{recent}", headers=ADA)

    assert client.post(f"/researcher/projects/{old}/restore", headers=ADA).status_code == 404
    assert client.post(f"/researcher/projects/{recent}/restore", headers=ADA).status_code == 200


def test_the_purge_only_touches_the_owner_of_the_delete(client):
    store.save_project(
        {
            "id": "bo-old",
            "owner": "user-bo",
            "name": "Bo",
            "analyses": [],
            "deleted": (datetime.now(UTC) - timedelta(days=30)).isoformat(),
        }
    )
    project_id = make_project(client)
    client.delete(f"/researcher/projects/{project_id}", headers=ADA)
    assert [p["id"] for p in store.load_projects("user-bo", include_deleted=True)] == ["bo-old"]


def test_delete_all_removes_the_hidden_projects_too(client):
    project_id = make_project(client)
    client.delete(f"/researcher/projects/{project_id}", headers=ADA)
    assert client.delete("/user/data?scope=researcher", headers=ADA).status_code == 200
    assert client.post(f"/researcher/projects/{project_id}/restore", headers=ADA).status_code == 404
    assert store.load_projects("user-ada", include_deleted=True) == []
