"""What the assistant remembers (SPEC.md): one row per subject, owner-only reads and deletes,
and AssistantMemory returning the caller's facts before their analyses. SQLite only, no network.
"""

import asyncio

import pytest
from app import auth, main, memory, store
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}
ADA = {"Authorization": "Bearer token-ada"}
BO = {"Authorization": "Bearer token-bo"}


def fact(subject: str, summary: str, kind: str = "paper") -> dict:
    return {"kind": kind, "subject": subject, "summary": summary, "session_id": "s1"}


@pytest.fixture
def sqlite(monkeypatch, tmp_path):
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(store, "_use_supabase", lambda: False)


@pytest.fixture
def client(sqlite, monkeypatch):
    # SUPABASE_URL only turns login on; storage stays in the tmp SQLite db.
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    main.analyses.clear()
    yield TestClient(main.app)
    main.analyses.clear()


def test_a_subject_keeps_one_row_and_the_newest_summary(sqlite):
    store.save_fact("user-ada", fact("ColBERT '20", "asked why BEIR disagrees"))
    store.save_fact("user-ada", fact(" colbert '20 ", "read the late interaction section"))

    facts = store.load_facts("user-ada")
    assert len(facts) == 1
    assert facts[0]["summary"] == "read the late interaction section"


def test_the_same_subject_of_another_kind_is_another_fact(sqlite):
    store.save_fact("user-ada", fact("late interaction", "studied it", kind="concept"))
    store.save_fact("user-ada", fact("late interaction", "faster than a cross-encoder?", kind="question"))

    assert len(store.load_facts("user-ada")) == 2


def test_each_user_lists_only_their_own_facts(client):
    store.save_fact("user-ada", fact("ColBERT '20", "ada's note"))
    store.save_fact("user-bo", fact("ColBERT '20", "bo's note"))

    assert [f["summary"] for f in client.get("/memories", headers=ADA).json()] == ["ada's note"]
    assert [f["summary"] for f in client.get("/memories", headers=BO).json()] == ["bo's note"]


def test_deleting_another_users_fact_answers_404_and_keeps_it(client):
    store.save_fact("user-bo", fact("ColBERT '20", "bo's note"))
    bo_fact = store.load_facts("user-bo")[0]["id"]

    assert client.delete(f"/memories/{bo_fact}", headers=ADA).status_code == 404
    assert client.delete("/memories/not-a-uuid", headers=ADA).status_code == 404
    assert len(store.load_facts("user-bo")) == 1
    assert client.delete(f"/memories/{bo_fact}", headers=BO).json() == {"deleted": 1}
    assert store.load_facts("user-bo") == []


def test_delete_all_removes_only_the_callers_facts(client):
    store.save_fact("user-ada", fact("ColBERT '20", "one"))
    store.save_fact("user-ada", fact("BEIR '21", "two"))
    store.save_fact("user-bo", fact("ColBERT '20", "bo's note"))

    assert client.delete("/memories", headers=ADA).json() == {"deleted": 2}
    assert store.load_facts("user-ada") == []
    assert len(store.load_facts("user-bo")) == 1


def test_deleting_researcher_data_deletes_the_facts_too(client):
    store.save_fact("user-ada", fact("ColBERT '20", "one"))

    assert client.delete("/user/data?scope=researcher", headers=ADA).status_code == 200
    assert store.load_facts("user-ada") == []


def search(user_id: str, query: str) -> list[str]:
    response = asyncio.run(
        memory.AssistantMemory().search_memory(app_name="assistant", user_id=user_id, query=query)
    )
    return [entry.content.parts[0].text for entry in response.memories]


def test_memory_returns_the_callers_facts_and_never_another_users(sqlite):
    store.save_fact("user-ada", fact("ColBERT '20", "asked why BEIR disagrees with it"))
    store.save_fact("user-bo", fact("ColBERT '20", "bo compared it with SPLADE"))

    found = search("user-ada", "what did I ask about ColBERT?")
    assert found == ["Remembered paper, ColBERT '20: asked why BEIR disagrees with it"]
    assert "SPLADE" not in " ".join(found)


def test_a_signed_out_user_gets_no_facts(sqlite):
    store.save_fact("user-ada", fact("ColBERT '20", "asked why BEIR disagrees with it"))

    assert search(memory.SIGNED_OUT, "ColBERT") == []
