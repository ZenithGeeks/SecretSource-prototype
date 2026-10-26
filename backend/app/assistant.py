"""The assistant's answer: short statements, each citing a passage and checked by the judge.

    async for event in answer("Who proposed late interaction?", papers=papers_of(user)):
        ...

A follow-up is first rewritten to stand alone (standalone_question), so "its index" names
the paper the chat was about. A question about one paper is answered from that paper's most
relevant passages. Any other question is answered from the caller's papers in the ColBERT
index, and each statement names the passage it rests on. What the user studied in earlier
chats (app/memory.py) goes along to help the model read the question, never as a source.
Every statement is then judged against its paper with check_prepared, the same check an
analysis runs. A statement the judge does not call "supports" is shown as not backed, not
hidden. With no passage that answers the question there are no statements.

answer() yields the statements as soon as the answer is written, then each verdict as its check
ends, so a reader sees the answer before the slowest check. docs/ideas/secretsource-assistant.md
has the plan; eval_assistant.py and eval_assistant_stream.py measure this code (#504, #506).
"""

import asyncio
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import NamedTuple

import dspy
from pydantic import BaseModel, Field

from app.clients.retrieval import colbert_search
from app.config import PAPERS_DIR, PARALLEL_CHECKS
from app.llm import dspy_lm
from app.pipeline import verify

MAX_STATEMENTS = 6
CHAT_LINES = 12  # the chat's last lines a follow-up is read against, about the last 2-3 turns
LIBRARY_PASSAGES = 8  # several papers can share the answer, so more than one paper's EVIDENCE_COUNT
# How many of the caller's own passages to rank before keeping LIBRARY_PASSAGES. The search
# names those papers, so other people's passages are not in the result.
LIBRARY_SEARCH = 100

# Checks for every answer in this process share these threads, so answers at once queue here
# instead of filling the event loop's default pool, which every to_thread route uses.
_checks = ThreadPoolExecutor(max_workers=PARALLEL_CHECKS, thread_name_prefix="assistant-check")


class StandaloneQuestion(dspy.Signature):
    """Rewrite the user's latest question so it can be read without the chat. Replace words
    such as "it", "they" or "that paper" with what they mean in the chat. Return a question
    that already stands alone unchanged."""

    chat: list[str] = dspy.InputField(desc="The chat so far, oldest first")
    question: str = dspy.InputField()
    standalone: str = dspy.OutputField()


class AnswerAsStatements(dspy.Signature):
    """Answer the question about one paper using only its passages. Write short statements that
    each say one fact the passages state, covering whichever of who, what, when, where, why and
    how the question asks about. What the user studied earlier only helps you see what they
    mean: never state something because it is remembered."""

    passages: list[str] = dspy.InputField()
    remembered: list[str] = dspy.InputField(desc="What this user studied or asked in earlier chats")
    question: str = dspy.InputField()
    statements: list[str] = dspy.OutputField(desc=f"At most {MAX_STATEMENTS} statements, one fact each")


class Statement(BaseModel):
    text: str
    passage: int = Field(description="The number of the passage this statement rests on")


class AnswerFromLibrary(dspy.Signature):
    """Answer the question using only the numbered passages, which can come from several papers.
    Write short statements that each say one fact a passage states, and give that passage's
    number. Return no statements when the passages do not answer the question. What the user
    studied earlier only helps you see what they mean: never state something because it is
    remembered."""

    passages: list[str] = dspy.InputField()
    remembered: list[str] = dspy.InputField(desc="What this user studied or asked in earlier chats")
    question: str = dspy.InputField()
    statements: list[Statement] = dspy.OutputField(desc=f"At most {MAX_STATEMENTS}, one fact each")


class Cited(NamedTuple):
    """One statement and the paper it is judged against. No path: the statement cannot be checked."""

    text: str
    source: str
    path: Path | None
    page: int | None = None  # the page of the passage it names, when it names one


_language_model = None  # built on first use, like the judge in verify.py


def _answer_model() -> dspy.LM:
    global _language_model
    if _language_model is None:
        _language_model = dspy_lm(max_tokens=600)
    return _language_model


def standalone_question(question: str, chat: list[str]) -> str:
    """The question as it reads without the chat. A chat's first question comes back as it is,
    with no LLM call."""
    if not chat:
        return question
    with dspy.context(lm=_answer_model()):
        rewritten = dspy.Predict(StandaloneQuestion)(chat=chat[-CHAT_LINES:], question=question)
    return rewritten.standalone.strip() or question


def answer_about_paper(
    question: str, paper: str, path: Path, remembered: list[str] | None = None
) -> list[Cited]:
    """Statements from one paper's passages, each judged against that paper."""
    passages = [item["text"] for item in verify.evidence_from(question, path.name)]
    with dspy.context(lm=_answer_model()):
        statements = dspy.Predict(AnswerAsStatements)(
            passages=passages, remembered=remembered or [], question=question
        ).statements
    return [Cited(text, paper, path) for text in statements[:MAX_STATEMENTS]]


def library_passages(question: str, papers: frozenset[str] | None = None) -> list[dict]:
    """The passages most relevant to the question, from `papers` only, or from the whole index
    when `papers` is None (the eval scripts). An empty set searches nothing: that caller has
    no papers, and an unscoped search would read everyone else's."""
    if papers is None:
        return colbert_search(question, k=LIBRARY_PASSAGES)
    if not papers:
        return []
    hits = colbert_search(question, k=LIBRARY_SEARCH, sources=papers, visible=papers)
    return [hit for hit in hits if hit["source"] in papers][:LIBRARY_PASSAGES]


def answer_from_library(
    question: str, papers: frozenset[str] | None = None, remembered: list[str] | None = None
) -> list[Cited]:
    """Statements from the library, each judged against the paper of the passage it names."""
    hits = library_passages(question, papers)
    if not hits:
        return []  # nothing in this library to answer from, so no LLM call
    numbered = [f"[{number}] {hit['text']}" for number, hit in enumerate(hits, 1)]
    with dspy.context(lm=_answer_model()):
        statements = dspy.Predict(AnswerFromLibrary)(
            passages=numbered, remembered=remembered or [], question=question
        ).statements
    return [cite(statement, hits) for statement in statements[:MAX_STATEMENTS]]


def cite(statement: Statement, hits: list[dict]) -> Cited:
    """The statement with the paper of the passage it names, or no path if the number is wrong."""
    if 1 <= statement.passage <= len(hits):
        hit = hits[statement.passage - 1]
        return Cited(statement.text, hit["source"], PAPERS_DIR / hit["source"], hit.get("page"))
    return Cited(statement.text, f"passage {statement.passage}", None)


def prepare(item: Cited) -> Cited:
    """The statement pointing at its paper once indexed, or at no path if the PDF is not on
    this disk or cannot be indexed. Indexing runs once per paper per process."""
    if item.path is None or not item.path.is_file():
        return item._replace(path=None)
    prepared = verify.prepare_source(item.path.as_posix())
    path = Path(prepared["path"]) if prepared["status"] == "ok" else None
    return item._replace(path=path)


def check(item: Cited) -> dict:
    """The judge's verdict on one statement: verdict, quote and reasoning. The verdict is
    "unchecked" when the statement has no paper, and "error" when the check failed."""
    item = prepare(item)
    if item.path is None:
        return {"verdict": "unchecked", "quote": "", "reasoning": ""}
    result = verify.check_prepared(item.text, item.source, item.path)
    if result["status"] != "ok":
        return {"verdict": "error", "quote": "", "reasoning": result.get("message", "")}
    return {key: result.get(key, "") for key in ("verdict", "quote", "reasoning")}


async def check_text(sentences: list[str], papers: frozenset[str]) -> list[dict]:
    """Judge each sentence against the paper of the library passage that fits it best, with the
    same check as an answer's statements. A sentence no passage fits is "unchecked". The search
    and the judge run on the assistant's check threads, so a long text queues behind them."""
    loop = asyncio.get_running_loop()

    def judged(sentence: str) -> dict:
        hits = library_passages(sentence, papers)
        if not hits:
            return {"text": sentence, "source": None, "page": None, "verdict": "unchecked",
                    "quote": "", "reasoning": "no passage in your papers fits this sentence"}
        item = cite(Statement(text=sentence, passage=1), hits)
        return {"text": sentence, "source": item.source, "page": item.page, **check(item)}

    return list(await asyncio.gather(*(loop.run_in_executor(_checks, judged, text) for text in sentences)))


async def answer(
    question: str,
    paper: Path | None = None,
    papers: frozenset[str] | None = None,
    remembered: list[str] | None = None,
) -> AsyncIterator[dict]:
    """Answer a question and check each statement, as events in the order they happen.

    With `paper`, the answer comes from that PDF, which must already be indexed
    (verify.prepare_source). Otherwise it comes from the passages of `papers` (see
    library_passages). `remembered` is what the user studied before (memory.remembered_for).
    Yields, in order:

        {"type": "statement", "index": 0, "text", "source", "page"}   one per statement
        {"type": "verdict", "index": 0, "verdict", "quote", "reasoning"}   as each check ends
        {"type": "done", "statements": n}
    """
    if paper is not None:
        cited = await asyncio.to_thread(answer_about_paper, question, paper.name, paper, remembered)
    else:
        cited = await asyncio.to_thread(answer_from_library, question, papers, remembered)
    for index, item in enumerate(cited):
        yield {
            "type": "statement",
            "index": index,
            "text": item.text,
            "source": item.source,
            "page": item.page,
        }

    loop = asyncio.get_running_loop()

    async def checked(index: int, item: Cited) -> dict:
        return {"type": "verdict", "index": index, **await loop.run_in_executor(_checks, check, item)}

    checks = [asyncio.create_task(checked(index, item)) for index, item in enumerate(cited)]
    try:
        for finished in asyncio.as_completed(checks):
            yield await finished
    finally:
        # The reader left: checks still queued are dropped. One already running finishes in
        # its thread, since a thread cannot be stopped.
        for task in checks:
            task.cancel()
    yield {"type": "done", "statements": len(cited)}
