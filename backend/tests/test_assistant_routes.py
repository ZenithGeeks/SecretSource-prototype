"""The assistant's chat routes: a chat is its owner's alone, and a question streams back its
statements, then their verdicts. No LLM: assistant.answer is replaced, and chats live in an
in-memory ADK session service. Login works as in test_ownership.py."""

import json

import pytest
from app import assistant, auth, chats, main
from fastapi.testclient import TestClient
from google.adk.sessions import InMemorySessionService

ADA = {"Authorization": "Bearer token-ada"}
BO = {"Authorization": "Bearer token-bo"}
STATEMENT = {"text": "ColBERT uses late interaction.", "source": "a1.pdf", "page": 2}
VERDICT = {"verdict": "supports", "quote": "late interaction", "reasoning": "It says so."}


@pytest.fixture
def asked(monkeypatch):
    """Every call to assistant.answer. Each streams one statement and its verdict."""
    calls = []

    async def answer(question, paper=None, papers=None, remembered=None):
        calls.append({"question": question, "paper": paper, "papers": papers, "remembered": remembered})
        yield {"type": "statement", "index": 0, **STATEMENT}
        yield {"type": "verdict", "index": 0, **VERDICT}
        yield {"type": "done", "statements": 1}

    monkeypatch.setattr(assistant, "answer", answer)
    return calls


@pytest.fixture
def client(monkeypatch, tmp_path, asked):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(auth, "_user_id_for", {"token-ada": "user-ada", "token-bo": "user-bo"}.get)
    monkeypatch.setattr(chats, "_service", InMemorySessionService())
    monkeypatch.setattr(main, "prepare_source", lambda paper: {"status": "ok", "path": paper})
    main.analyses.clear()
    for analysis_id, owner in (("a1", "user-ada"), ("b1", "user-bo"), ("shared", None)):
        main.analyses[analysis_id] = {
            "id": analysis_id, "paper": f"{analysis_id}.pdf", "file": f"data/papers/{analysis_id}.pdf",
            "status": "done", "owner": owner, "stages": [], "claims": [],
        }  # fmt: skip
    yield TestClient(main.app)
    main.analyses.clear()


def events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def ask(client, chat_id, question, context=None, headers=ADA):
    body = {"question": question, "context": context or {}}
    return client.post(f"/assistant/chats/{chat_id}/messages", json=body, headers=headers)


def test_a_question_streams_statements_then_verdicts_and_is_saved(client, asked):
    chat = client.post("/assistant/chats", json={"context": {"screen": "library"}}, headers=ADA).json()
    response = ask(client, chat["id"], "What does ColBERT do?", {"screen": "library"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [event["type"] for event in events(response)] == ["statement", "verdict", "done"]
    # A library question reads only the caller's own papers.
    assert asked[0]["paper"] is None and asked[0]["papers"] == frozenset({"a1.pdf"})

    saved = client.get(f"/assistant/chats/{chat['id']}", headers=ADA).json()
    assert saved["title"] == "What does ColBERT do?"
    assert [message["role"] for message in saved["messages"]] == ["user", "assistant"]
    assert saved["messages"][1]["statements"] == [{**STATEMENT, **VERDICT}]
    assert [listed["id"] for listed in client.get("/assistant/chats", headers=ADA).json()] == [chat["id"]]


def test_a_question_brings_the_askers_matching_facts_and_no_one_elses(client, asked):
    fact = {"kind": "paper", "subject": "ColBERT '20", "summary": "asked why BEIR disagrees"}
    fact["session_id"] = "s1"
    main.store.save_fact("user-ada", fact)
    main.store.save_fact("user-bo", {**fact, "summary": "compared it with SPLADE"})
    chat = client.post("/assistant/chats", headers=ADA).json()
    ask(client, chat["id"], "What does ColBERT do?")
    assert asked[0]["remembered"] == ["Remembered paper, ColBERT '20: asked why BEIR disagrees"]


def test_another_users_chat_is_a_404(client, asked):
    chat = client.post("/assistant/chats", headers=ADA).json()
    assert client.get(f"/assistant/chats/{chat['id']}", headers=BO).status_code == 404
    assert ask(client, chat["id"], "hi", headers=BO).status_code == 404
    assert client.get("/assistant/chats", headers=BO).json() == []
    assert asked == []


def test_the_screen_context_picks_the_paper_and_is_kept_in_the_chat_state(client, asked):
    chat = client.post("/assistant/chats", headers=ADA).json()
    ask(client, chat["id"], "Who wrote it?", {"screen": "graph", "node": "c:a1:3"})
    assert asked[0]["paper"].as_posix() == "data/papers/a1.pdf"
    state = client.get(f"/assistant/chats/{chat['id']}", headers=ADA).json()["context"]
    assert state["screen"] == "graph" and state["node"] == "c:a1:3"


def test_asking_about_another_users_analysis_is_a_404(client, asked):
    chat = client.post("/assistant/chats", headers=ADA).json()
    for context in ({"analysis": "b1"}, {"node": "a:b1"}, {"analysis": "shared"}):
        assert ask(client, chat["id"], "Who?", context).status_code == 404
    assert asked == []


def test_with_login_on_a_request_without_a_token_is_refused(client):
    assert client.post("/assistant/chats").status_code == 401
    assert client.get("/assistant/chats").status_code == 401


def test_with_login_off_the_chats_are_the_signed_out_users(client, asked, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    chat = client.post("/assistant/chats").json()
    assert [event["type"] for event in events(ask(client, chat["id"], "Why?", headers={}))][-1] == "done"
    assert asked[0]["papers"] == frozenset({"shared.pdf"})


def test_a_failed_answer_ends_with_an_error_event(client, monkeypatch):
    async def broken(question, paper=None, papers=None):
        raise RuntimeError("LLM down")
        yield  # an async generator, like the real one

    monkeypatch.setattr(assistant, "answer", broken)
    chat = client.post("/assistant/chats", headers=ADA).json()
    assert [event["type"] for event in events(ask(client, chat["id"], "Why?"))] == ["error"]


def test_a_question_that_finds_the_chat_changed_reads_it_again(client, monkeypatch):
    # Two tabs: another write lands between reading the chat and appending to it.
    from google.adk.errors import StaleSessionError

    service = chats._service
    real_append = service.append_event
    refused = []

    async def append_once_stale(session, event):
        if not refused:
            refused.append(event.author)
            raise StaleSessionError("the session changed")
        return await real_append(session, event)

    monkeypatch.setattr(service, "append_event", append_once_stale)
    chat = client.post("/assistant/chats", headers=ADA).json()
    assert [event["type"] for event in events(ask(client, chat["id"], "Why?"))][-1] == "done"
    saved = client.get(f"/assistant/chats/{chat['id']}", headers=ADA).json()
    assert refused == ["user"]
    assert [message["role"] for message in saved["messages"]] == ["user", "assistant"]
