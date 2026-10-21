"""Distilling a chat into facts (SPEC.md): only questions and backed statements reach the LLM,
the guard drops facts with no real line behind them, and the gateway queues the right chats.
No LLM and no Redis: distill.distill and main.enqueue_distill are replaced."""

import asyncio
from types import SimpleNamespace

import pytest
from app import auth, chats, distill, main, store
from app.distill import Fact
from fastapi.testclient import TestClient
from google.adk.sessions import InMemorySessionService

ADA = {"Authorization": "Bearer token-ada"}
BACKED = {"text": "ColBERT uses late interaction.", "source": "colbert.pdf", "verdict": "supports"}
NOT_BACKED = {"text": "ColBERT beats BM25 on every dataset.", "source": "colbert.pdf", "verdict": "refutes"}


def fact(lines: list[int], subject: str = "ColBERT '20") -> Fact:
    return Fact(kind="paper", subject=subject, summary="asked how late interaction works", lines=lines)


def test_only_questions_and_backed_statements_become_lines():
    messages = [
        {"role": "user", "text": "How does ColBERT score passages?"},
        {"role": "assistant", "statements": [BACKED, NOT_BACKED]},
    ]

    lines = distill.chat_lines(messages)

    assert lines == [
        "user asked: How does ColBERT score passages?",
        "assistant said, backed by colbert.pdf: ColBERT uses late interaction.",
    ]


def test_a_fact_needs_a_line_that_exists():
    assert distill.keepable(fact([2]), line_count=2)
    assert not distill.keepable(fact([]), line_count=2)
    assert not distill.keepable(fact([0, 3]), line_count=2)


def test_distill_drops_facts_without_lines_and_keeps_at_most_five(monkeypatch):
    answered = [fact([1], subject=f"paper {n}") for n in range(7)] + [fact([9])]

    class Predict:
        def __init__(self, signature):
            pass

        def __call__(self, lines):
            return SimpleNamespace(facts=answered)

    monkeypatch.setattr(distill.dspy, "Predict", Predict)

    kept = distill.distill(["user asked: one", "user asked: two"])

    assert len(kept) == distill.MAX_FACTS
    assert all(fact.lines == [1] for fact in kept)


def session(chat_id: str, updated: float, distilled_at: float | None = None):
    state = {} if distilled_at is None else {"distilled_at": distilled_at}
    return SimpleNamespace(id=chat_id, last_update_time=updated, state=state)


def test_due_chats_are_idle_or_being_left_and_changed_since_their_last_distill():
    now = 10_000.0
    idle = session("idle", now - chats.IDLE_SECONDS - 1)
    active = session("active", now - 60)
    left = session("left", now - 60)
    done = session("done", now - chats.IDLE_SECONDS - 1, distilled_at=now - chats.IDLE_SECONDS)

    due = chats.due_for_distill([idle, active, left, done], now, leaving="left")

    assert due == ["idle", "left"]


@pytest.fixture
def sqlite_and_chats(monkeypatch, tmp_path):
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(store, "_use_supabase", lambda: False)
    monkeypatch.setattr(chats, "_service", InMemorySessionService())


def test_a_distilled_chat_saves_its_facts_and_is_marked(sqlite_and_chats, monkeypatch):
    seen = []

    def fake_distill(lines):
        seen.append(lines)
        return [fact([1])]

    monkeypatch.setattr(distill, "distill", fake_distill)

    async def run():
        chat = await chats.start("user-ada", {})
        turn = await chats.add_question("user-ada", chat.id, "How does ColBERT score passages?", {})
        await chats.add_reply("user-ada", chat.id, turn, [BACKED, NOT_BACKED])
        saved = await distill.distill_chat("user-ada", chat.id)
        return chat.id, saved, await chats.find("user-ada", chat.id)

    chat_id, saved, chat = asyncio.run(run())

    assert saved == 1
    assert len(seen[0]) == 2 and "every dataset" not in " ".join(seen[0])
    assert [f["session_id"] for f in store.load_facts("user-ada")] == [chat_id]
    assert chat.state["distilled_at"] > 0
    assert chats.due_for_distill([chat], chat.state["distilled_at"] + 1, leaving=chat.id) == []


def test_another_users_chat_is_never_distilled(sqlite_and_chats):
    async def run():
        chat = await chats.start("user-bo", {})
        return await distill.distill_chat("user-ada", chat.id)

    assert asyncio.run(run()) == 0
    assert store.load_facts("user-ada") == []


def test_starting_a_chat_queues_the_one_being_left(sqlite_and_chats, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(auth, "_user_id_for", {"token-ada": "user-ada"}.get)
    queued = []
    monkeypatch.setattr(main, "enqueue_distill", lambda owner, chat_id: queued.append((owner, chat_id)))
    client = TestClient(main.app)

    first = client.post("/assistant/chats", json={}, headers=ADA).json()["id"]
    client.post("/assistant/chats", json={}, headers=ADA)

    assert queued == [("user-ada", first)]
