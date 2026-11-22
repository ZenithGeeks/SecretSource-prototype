"""rag.py: the search and answer tools, the snippet cut and the error paths.

ColBERT and the language model are fakes (a DummyLM for the answer). test_retrieval_privacy.py
covers whose papers a caller may read; here papers_of is a fixed set.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from app.pipeline import rag
from dspy.utils import DummyLM

PAPERS = frozenset({"ada.pdf", "bo.pdf"})


def hit(text="Late interaction keeps a vector per token.", score=40.0, source="ada.pdf"):
    return {"text": text, "score": score, "source": source, "page": 1, "start": 0, "end": 5, "rank": 1}


@pytest.fixture
def colbert(monkeypatch):
    """colbert_search returns `hits` and records its arguments in `calls`."""
    state = SimpleNamespace(hits=[hit()], calls=[])

    def search(query, k, sources, visible):
        state.calls.append({"query": query, "k": k, "sources": sources, "visible": visible})
        return state.hits

    monkeypatch.setattr(rag, "colbert_search", search)
    monkeypatch.setattr("app.main.papers_of", lambda user: PAPERS if user == "ada" else frozenset())
    return state


ADA = SimpleNamespace(state={"user": "ada"})


@pytest.mark.parametrize(
    ("text", "chars", "expected"),
    [
        ("short", 10, "short"),
        ("one two three", 8, "one two"),
        ("one two three", 7, "one two"),
        ("abcdefghij klm", 5, "abcde"),
        (" abcdefghij", 5, " abcd"),
    ],
)
def test_snippet_cuts_at_the_end_of_a_word_when_it_can(text, chars, expected):
    assert rag.snippet(text, chars) == expected


def test_a_hit_is_cut_and_marked_truncated():
    shown = rag._present(hit(text="one two three"), 8)

    assert (shown["text"], shown["truncated"]) == ("one two", True)


def test_a_hit_that_fits_is_not_marked_truncated():
    assert rag._present(hit(text="one"), 8)["truncated"] is False


def test_no_limit_keeps_the_whole_passage():
    shown = rag._present(hit(text="one two three"), None)

    assert (shown["text"], shown["truncated"]) == ("one two three", False)


@pytest.mark.parametrize("k", [0, -3])
def test_search_refuses_k_below_one(colbert, k):
    found = rag.search_passages("late interaction", k=k, tool_context=ADA)

    assert found == {"status": "error", "message": "k must be at least 1", "retryable": False}
    assert colbert.calls == []


def test_search_refuses_snippet_chars_below_one(colbert):
    found = rag.search_passages("late interaction", snippet_chars=0, tool_context=ADA)

    assert found["message"] == "snippet_chars must be at least 1"
    assert colbert.calls == []


def test_search_cuts_each_passage_to_the_default_length(colbert):
    colbert.hits = [hit(text="word " * 200)]

    found = rag.search_passages("late interaction", tool_context=ADA)

    assert len(found["topk"][0]["text"]) <= rag.DEFAULT_SNIPPET_CHARS
    assert found["topk"][0]["truncated"] is True


def test_search_cuts_to_the_length_asked_for(colbert):
    colbert.hits = [hit(text="one two three")]

    found = rag.search_passages("late interaction", snippet_chars=8, tool_context=ADA)

    assert found["topk"][0]["text"] == "one two"


def test_search_returns_whole_passages_with_full_text(colbert):
    colbert.hits = [hit(text="word " * 200)]

    found = rag.search_passages("late interaction", full_text=True, snippet_chars=5, tool_context=ADA)

    assert found["topk"][0]["text"] == "word " * 200
    assert found["topk"][0]["truncated"] is False


def test_search_asks_for_at_most_the_largest_k_in_the_callers_papers(colbert):
    rag.search_passages("late interaction", k=500, tool_context=ADA)

    assert colbert.calls == [
        {"query": "late interaction", "k": rag.MAX_K, "sources": PAPERS, "visible": PAPERS}
    ]


def test_search_narrowed_to_a_paper_the_caller_may_read_searches_only_that_paper(colbert):
    rag.search_passages("late interaction", source="ada.pdf", tool_context=ADA)

    assert colbert.calls[0]["sources"] == frozenset({"ada.pdf"})


def test_search_narrowed_to_someone_elses_paper_finds_nothing_and_does_not_search(colbert):
    found = rag.search_passages("late interaction", source="other.pdf", tool_context=ADA)

    assert found == {"topk": [], "low_confidence": True}
    assert colbert.calls == []


def test_search_without_a_tool_context_is_a_signed_out_caller(colbert):
    assert rag.search_passages("late interaction") == {"topk": [], "low_confidence": True}


@pytest.mark.parametrize(
    ("hits", "low"),
    [
        ([], True),
        ([hit(score=rag.LOW_CONFIDENCE_BELOW - 0.1)], True),
        ([hit(score=rag.LOW_CONFIDENCE_BELOW)], False),
    ],
)
def test_search_flags_a_weak_best_match_or_none(colbert, hits, low):
    colbert.hits = hits

    assert rag.search_passages("late interaction", tool_context=ADA)["low_confidence"] is low


def test_search_reports_a_failed_colbert_call_as_a_tool_error(monkeypatch, colbert):
    def refuse(*args, **kwargs):
        raise RuntimeError("colbert is down")

    monkeypatch.setattr(rag, "colbert_search", refuse)

    found = rag.search_passages("late interaction", tool_context=ADA)

    assert (found["status"], found["message"], found["reason"]) == ("error", "colbert is down", "failed")


@pytest.fixture
def answerer(monkeypatch):
    monkeypatch.setattr(rag, "_rag", None)
    replies = [{"reasoning": "The passage says so.", "answer": "Late interaction."}]
    monkeypatch.setattr("app.llm.dspy_lm", lambda *args, **kwargs: DummyLM(replies))


def test_an_answer_comes_with_the_passages_it_was_read_from(colbert, answerer):
    found = rag.answer_from_docs("What is late interaction?", tool_context=ADA)

    assert found == {
        "status": "ok",
        "answer": "Late interaction.",
        "sources": ["Late interaction keeps a vector per token."],
    }
    assert colbert.calls[0]["sources"] == PAPERS


def test_no_passages_is_an_empty_answer_and_the_model_is_not_asked(colbert, answerer):
    colbert.hits = []

    found = rag.answer_from_docs("What is late interaction?", tool_context=ADA)

    assert found == {"status": "ok", "answer": "", "sources": []}


def test_a_caller_with_no_papers_gets_an_empty_answer_without_a_search(colbert, answerer):
    found = rag.answer_from_docs("What is late interaction?")

    assert found == {"status": "ok", "answer": "", "sources": []}
    assert colbert.calls == []


def test_a_failing_model_is_reported_as_a_tool_error(monkeypatch, colbert):
    monkeypatch.setattr(rag, "_rag", None)

    def broken():
        raise RuntimeError("no model")

    monkeypatch.setattr(rag, "_build_rag", broken)

    found = rag.answer_from_docs("What is late interaction?", tool_context=ADA)

    assert (found["status"], found["message"]) == ("error", "no model")


def test_first_calls_from_several_threads_build_the_rag_once(monkeypatch, colbert):
    """SCRUM-553: ADK runs the tool in worker threads, so first calls can arrive together."""
    monkeypatch.setattr(rag, "_rag", None)
    builds = []
    started = threading.Barrier(4)

    def slow_build():
        builds.append(1)
        time.sleep(0.2)
        return lambda question, papers: SimpleNamespace(answer="Late interaction.", context=[])

    monkeypatch.setattr(rag, "_build_rag", slow_build)

    def ask(_):
        started.wait()
        return rag.answer_from_docs("What is late interaction?", tool_context=ADA)

    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = list(pool.map(ask, range(4)))

    assert len(builds) == 1
    assert {answer["answer"] for answer in answers} == {"Late interaction."}


def test_add_paper_returns_what_the_index_answers(monkeypatch):
    monkeypatch.setattr(rag, "colbert_add", lambda path: {"status": "ok", "path": path})

    assert rag.add_paper("data/papers/x.pdf") == {"status": "ok", "path": "data/papers/x.pdf"}


def test_add_paper_names_an_indexing_failure(monkeypatch):
    def refuse(path):
        raise OSError("disk full")

    monkeypatch.setattr(rag, "colbert_add", refuse)

    found = rag.add_paper("data/papers/x.pdf")

    assert (found["status"], found["message"], found["reason"]) == ("error", "disk full", "indexing-failed")
