"""RAG over indexed papers: DSPy + the ColBERT retrieval service.

ADK builds each tool's schema from the type hints and docstring. Both tools answer from the
caller's own papers (papers_of). A caller with none gets nothing: the search is not run
against the shared index.
"""

import re
import threading

from app.clients.retrieval import colbert_add, colbert_search
from app.pipeline.sources import tool_error

_rag = None  # lazy: needs dspy, a running LM and the ColBERT service
# The agents call answer_from_docs from worker threads, so two first calls could build it twice.
_rag_lock = threading.Lock()

# The same cut and the same weak-match line as services/colbert/server.py. /api/search returns
# whole passages and no flag; search_passages is what the agent reads, so it matches the tool
# the agent used to call over MCP.
DEFAULT_SNIPPET_CHARS = 280
MAX_K = 100
LOW_CONFIDENCE_BELOW = 14.105 * 64 / 32


def _build_rag():
    import dspy

    from app.llm import dspy_lm

    language_model = dspy_lm()

    class GenerateAnswer(dspy.Signature):
        """Answer the question using only the retrieved context."""

        context: list[str] = dspy.InputField(desc="Retrieved passages that may contain relevant facts")
        question: str = dspy.InputField()
        answer: str = dspy.OutputField(desc="Short factual answer, 1-2 sentences")

    class RAG(dspy.Module):
        def __init__(self, k: int = 3):
            super().__init__()
            self.k = k
            self.generate = dspy.ChainOfThought(GenerateAnswer)

        def forward(self, question: str, papers: frozenset[str]):
            # colbert_search, not dspy.ColBERTv2. dspy's client cannot send the identity
            # token. The Cloud Run service requires it. `papers` is the caller's own set:
            # the request names them, and an empty set never reaches here.
            hits = colbert_search(question, k=self.k, sources=papers, visible=papers)
            passages = [hit["text"] for hit in hits]
            if not passages:
                return dspy.Prediction(context=[], answer="")
            # dspy.context is thread-safe, dspy.configure is not.
            # ADK runs tools in worker threads.
            with dspy.context(lm=language_model):
                prediction = self.generate(context=passages, question=question)
            return dspy.Prediction(context=passages, answer=prediction.answer)

    return RAG()


def caller_papers(tool_context) -> frozenset[str]:
    """The file names this caller may read. No user counts as signed out, whose papers are the
    unowned ones, never every paper in the index."""
    from app.main import papers_of

    user = None
    state = getattr(tool_context, "state", None)
    if state is not None:
        user = state.get("user") or None
    return papers_of(user)


def answer_from_docs(question: str, tool_context=None) -> dict:
    """Answer a question from this person's indexed papers with ColBERTv2 retrieval (RAG).

    It reads only the papers they may open. Someone with no papers gets an empty answer and
    no sources.

    Args:
        question: a question about their papers, like "How does ColBERTv2 compress its index?".

    Returns:
        {"status": "ok", "answer", "sources"}, or {"status": "error", "message", "reason",
        "retryable"}. Retry only when `retryable` is true. `sources` is empty when none of
        their papers answer.
    """
    global _rag
    try:
        papers = caller_papers(tool_context)
        if not papers:
            return {"status": "ok", "answer": "", "sources": []}
        with _rag_lock:
            if _rag is None:
                _rag = _build_rag()
        prediction = _rag(question=question, papers=papers)
        return {"status": "ok", "answer": prediction.answer, "sources": list(prediction.context)}
    except Exception as error:
        return tool_error(error)


def snippet(text: str, chars: int) -> str:
    """Cut text to at most `chars` characters, at the end of a word. Same cut as the ColBERT service."""
    if len(text) <= chars:
        return text
    breaks = [match.start() for match in re.finditer(r"\s", text[: chars + 1])]
    return text[: breaks[-1]] if breaks and breaks[-1] > 0 else text[:chars]


def _present(hit: dict, limit: int | None) -> dict:
    """One hit for the agent. limit None keeps the whole passage."""
    if limit is None:
        return {**hit, "truncated": False}
    text = snippet(hit["text"], limit)
    return {**hit, "text": text, "truncated": text != hit["text"]}


def search_passages(
    query: str,
    k: int = 5,
    source: str | None = None,
    snippet_chars: int | None = None,
    full_text: bool = False,
    tool_context=None,
) -> dict:
    """Find passages in this person's papers that match a query, best match first.

    It searches only the papers they may open. `source` narrows that to one of those papers.
    A paper that is not theirs, or a person with no papers, returns no passages. The answer
    is short snippets unless full_text is set.

    Args:
        query: What to look for: a few words, a question or a sentence from a claim.
        k: How many passages to return. The default is 5. Values below 1 are refused.
            Values above 100 are cut to 100.
        source: The file name of one of this person's papers, for example "2112.01488.pdf".
            Leave it out to search all of their papers.
        snippet_chars: Cut each passage's text to at most this many characters, at the end
            of a word. The default is 280. Ignored when full_text is true.
        full_text: Return each passage's whole text. Leave it false to get snippets.

    Returns:
        {"topk": [hit, ...], "low_confidence": bool}, best first, or {"status": "error",
        "message", "retryable"} when k or snippet_chars is below 1. Each hit has rank, score,
        text, truncated, title, source, page, start and end. low_confidence is true when there
        are no hits or the best score is under 28.21. Do not quote a hit as support then.
    """
    if k < 1:
        return {"status": "error", "message": "k must be at least 1", "retryable": False}
    if snippet_chars is not None and snippet_chars < 1:
        return {"status": "error", "message": "snippet_chars must be at least 1", "retryable": False}
    try:
        papers = caller_papers(tool_context)
        if source is not None:
            papers = papers & {source}
        if not papers:
            return {"topk": [], "low_confidence": True}
        hits = colbert_search(query, k=min(k, MAX_K), sources=papers, visible=papers)
        if full_text:
            limit = None
        elif snippet_chars is None:
            limit = DEFAULT_SNIPPET_CHARS
        else:
            limit = snippet_chars
        shown = [_present(hit, limit) for hit in hits]
        top = shown[0]["score"] if shown else None
        return {"topk": shown, "low_confidence": top is None or top < LOW_CONFIDENCE_BELOW}
    except Exception as error:
        return tool_error(error)


def add_paper(pdf_path: str) -> dict:
    """Add a research paper (PDF) to the document index. answer_from_docs can use it then.

    Args:
        pdf_path: path to a PDF file, for example "data/papers/colbertv2.pdf".

    Returns:
        The index service's answer, or {"status": "error", "message", "reason", "retryable"}.
        Retry only when `retryable` is true.
    """
    try:
        return colbert_add(pdf_path)
    except Exception as error:
        return {**tool_error(error), "reason": "indexing-failed"}
