"""The assistant's answer (app/assistant.py): which passages it reads, and the order of its events.
No LLM and no ColBERT: the answer, the search and the judge are replaced."""

import asyncio
import threading
import time
from pathlib import Path
from types import SimpleNamespace

from app import assistant
from app.assistant import Cited, Statement

HITS = [
    {"text": "ColBERT scores by late interaction.", "source": "ada.pdf", "page": 2},
    {"text": "Bo's private notes.", "source": "bo.pdf", "page": 1},
    {"text": "PLAID prunes centroids.", "source": "ada-2.pdf", "page": 5},
]


def refuse(*args, **kwargs):
    raise AssertionError("must not be called")


def events_of(question, **kwargs):
    async def collect():
        return [event async for event in assistant.answer(question, **kwargs)]

    return asyncio.run(collect())


def test_an_empty_library_is_not_searched(monkeypatch):
    monkeypatch.setattr(assistant, "colbert_search", refuse)
    assert assistant.library_passages("late interaction", frozenset()) == []


def test_library_passages_search_names_the_callers_papers(monkeypatch):
    seen = {}

    def search(question, k, **kwargs):
        seen.update(question=question, k=k, **kwargs)
        return HITS

    monkeypatch.setattr(assistant, "colbert_search", search)
    assistant.library_passages("late interaction", frozenset({"ada.pdf", "ada-2.pdf"}))

    assert seen["k"] == assistant.LIBRARY_SEARCH
    assert set(seen["sources"]) == {"ada.pdf", "ada-2.pdf"}
    assert set(seen["visible"]) == {"ada.pdf", "ada-2.pdf"}


def test_library_passages_keep_only_the_callers_papers(monkeypatch):
    monkeypatch.setattr(assistant, "colbert_search", lambda question, k, **kwargs: HITS)
    kept = assistant.library_passages("late interaction", frozenset({"ada.pdf", "ada-2.pdf"}))
    assert [hit["source"] for hit in kept] == ["ada.pdf", "ada-2.pdf"]


def test_a_library_with_no_matching_passage_asks_no_llm(monkeypatch):
    monkeypatch.setattr(assistant, "colbert_search", lambda question, k, **kwargs: HITS)
    monkeypatch.setattr(assistant, "_answer_model", refuse)
    assert assistant.answer_from_library("late interaction", frozenset({"carol.pdf"})) == []


def test_remembered_facts_go_to_the_answer_step_beside_the_passages(monkeypatch):
    inputs = {}

    class Predict:
        def __init__(self, signature):
            pass

        def __call__(self, **given):
            inputs.update(given)
            return SimpleNamespace(statements=[])

    monkeypatch.setattr(assistant, "colbert_search", lambda question, k, **kwargs: HITS)
    monkeypatch.setattr(assistant, "_answer_model", lambda: None)
    monkeypatch.setattr(assistant.dspy, "Predict", Predict)
    remembered = ["Remembered paper, ColBERT '20: asked why BEIR disagrees with it"]
    assistant.answer_from_library("late interaction", frozenset({"ada.pdf"}), remembered)
    assert inputs["remembered"] == remembered
    assert inputs["passages"] == ["[1] ColBERT scores by late interaction."]


def test_a_statement_cites_the_paper_and_page_of_its_passage():
    cited = assistant.cite(Statement(text="PLAID prunes centroids.", passage=3), HITS)
    assert (cited.source, cited.path.name, cited.page) == ("ada-2.pdf", "ada-2.pdf", 5)
    wrong = assistant.cite(Statement(text="Made up.", passage=9), HITS)
    assert wrong.path is None and wrong.source == "passage 9"


def test_statements_come_first_then_each_verdict_as_its_check_ends(monkeypatch):
    cited = [Cited("slow", "a.pdf", Path("a.pdf")), Cited("fast", "b.pdf", Path("b.pdf"))]
    monkeypatch.setattr(assistant, "answer_from_library", lambda question, papers, remembered: cited)
    fast_done = threading.Event()

    def check(item):
        if item.text == "slow":
            fast_done.wait(5)  # the slow check ends only after the fast one has returned
            time.sleep(0.3)
            return {"verdict": "supports", "quote": "q", "reasoning": "r"}
        fast_done.set()
        return {"verdict": "insufficient", "quote": "", "reasoning": "no passage says so"}

    monkeypatch.setattr(assistant, "check", check)
    events = events_of("which is faster?", papers=frozenset())
    assert [event["type"] for event in events] == ["statement", "statement", "verdict", "verdict", "done"]
    assert [event["text"] for event in events[:2]] == ["slow", "fast"]
    verdicts = [(event["index"], event["verdict"]) for event in events[2:4]]
    assert verdicts == [(1, "insufficient"), (0, "supports")]
    assert events[-1] == {"type": "done", "statements": 2}


def test_a_question_about_one_paper_is_answered_from_that_paper(monkeypatch):
    asked = {}

    def about_paper(question, paper, path, remembered):
        asked.update(question=question, paper=paper, path=path)
        return []

    monkeypatch.setattr(assistant, "answer_about_paper", about_paper)
    events = events_of("who wrote it?", paper=Path("data/papers/ada.pdf"))
    assert asked == {"question": "who wrote it?", "paper": "ada.pdf", "path": Path("data/papers/ada.pdf")}
    assert events == [{"type": "done", "statements": 0}]


def test_a_statement_with_no_paper_is_unchecked_without_asking_the_judge(monkeypatch):
    monkeypatch.setattr(assistant.verify, "check_prepared", refuse)
    assert assistant.check(Cited("Made up.", "passage 9", None))["verdict"] == "unchecked"


def test_a_paper_not_on_this_disk_is_unchecked_and_never_fetched_by_name(monkeypatch, tmp_path):
    # Fetching "<name>-<hash>" by name could download a different paper and judge against it.
    monkeypatch.setattr(assistant.verify, "prepare_source", refuse)
    monkeypatch.setattr(assistant.verify, "check_prepared", refuse)
    missing = Cited("ColPali reads page images.", "upload-1a2b.pdf", tmp_path / "upload-1a2b.pdf")
    assert assistant.check(missing)["verdict"] == "unchecked"
