"""A caller cannot read another user's passages through rag_agent or its spans.

answer_from_docs and search_passages are the tools rag_agent runs. Both take the caller's
papers from papers_of. The ColBERT service in these tests answers with both users' passages
anyway; the gateway has to drop the other user's before the answer, the DSPy context, the
ADK tool span and the retriever span. A caller with no papers gets nothing, and the index
is not searched.
"""

from types import SimpleNamespace

import pytest
from app import tracing
from app.agents import team
from app.clients import retrieval
from app.pipeline import rag
from dspy.utils import DummyLM
from google.adk.events.event import Event
from google.adk.telemetry import tracing as adk_tracing
from google.adk.tools.function_tool import FunctionTool
from google.genai import types
from openinference.instrumentation.dspy import DSPyInstrumentor
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from opentelemetry.instrumentation.threading import ThreadingInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

SECRET = "Bo secret token 91337"
BO = "bo-private-91337.pdf"
ADA = "Ada late interaction token 4242"
HITS = [
    {
        "text": SECRET, "source": BO, "page": 4, "score": 90.0,
        "title": "bo", "start": 0, "end": 8, "rank": 1,
    },
    {
        "text": ADA, "source": "ada.pdf", "page": 1, "score": 40.0,
        "title": "ada", "start": 0, "end": 8, "rank": 2,
    },
]
LIBRARIES = {
    "ada": frozenset({"ada.pdf"}),
    "bo": frozenset({BO}),
    "nobody": frozenset(),
}


def caller(user: str):
    return SimpleNamespace(state={"user": user})


@pytest.fixture
def phoenix(monkeypatch):
    """Spans stay in memory. Same stand-in as test_tracing.py."""
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))

    def register(**kwargs):
        return tracer_provider

    monkeypatch.setattr("phoenix.otel.register", register)
    monkeypatch.setattr(tracing, "PHOENIX_COLLECTOR_ENDPOINT", "http://phoenix:6006")
    monkeypatch.setattr(retrieval, "tracer", tracer_provider.get_tracer("app.clients.retrieval"))
    yield exporter
    DSPyInstrumentor().uninstrument()
    GoogleADKInstrumentor().uninstrument()
    ThreadingInstrumentor().uninstrument()


def install_index(monkeypatch):
    """ColBERT returns both users' passages. Record every request body."""
    sent = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"topk": HITS}

    def post(url, json=None, **kwargs):
        sent.append(json)
        return Response()

    monkeypatch.setattr(retrieval._session, "post", post)
    monkeypatch.setattr("app.main.papers_of", lambda user: LIBRARIES.get(user, frozenset()))
    monkeypatch.setattr(rag, "_rag", None)
    replies = [{"reasoning": "The passage says so.", "answer": "Late interaction."}] * 4
    monkeypatch.setattr("app.llm.dspy_lm", lambda *args, **kwargs: DummyLM(replies))
    return sent


def span_text(exporter) -> str:
    parts = []
    for span in exporter.get_finished_spans():
        parts.append(span.name)
        for value in span.attributes.values():
            parts.append(str(value))
    return "\n".join(parts)


def record_tool(tool, args: dict, result: dict):
    """The same call ADK makes after a tool returns, which copies the result onto the span."""
    event = Event(
        invocation_id="privacy",
        author="rag_agent",
        content=types.Content(
            role="user",
            parts=[
                types.Part(
                    function_response=types.FunctionResponse(
                        id="call-1", name=tool.__name__, response=result
                    )
                )
            ],
        ),
    )
    with adk_tracing.tracer.start_as_current_span(f"execute_tool {tool.__name__}"):
        adk_tracing.trace_tool_call(
            tool=FunctionTool(tool), args=args, function_response_event=event
        )


def test_rag_agent_exposes_the_scoped_tools_and_hides_the_caller():
    assert [tool.__name__ for tool in team.rag_agent.tools] == [
        "answer_from_docs", "add_paper", "search_passages",
    ]
    for tool in (team.answer_from_docs, team.search_passages):
        schema = FunctionTool(tool)._get_declaration().parameters_json_schema
        assert "tool_context" not in schema.get("properties", {})


def test_user_a_cannot_read_user_b_through_answer_from_docs(phoenix, monkeypatch):
    sent = install_index(monkeypatch)
    tracing.setup_tracing()

    result = rag.answer_from_docs("Who introduced late interaction?", tool_context=caller("ada"))
    record_tool(rag.answer_from_docs, {"question": "Who introduced late interaction?"}, result)

    assert result["status"] == "ok"
    assert SECRET not in result["answer"]
    assert result["sources"] == [ADA]
    assert sent == [{"query": "Who introduced late interaction?", "k": 3, "sources": ["ada.pdf"]}]
    blob = span_text(phoenix)
    assert SECRET not in blob
    assert BO not in blob
    assert ADA in blob
    names = {span.name for span in phoenix.get_finished_spans()}
    assert "colbert_search" in names
    assert any("answer_from_docs" in name or name.startswith("execute_tool") for name in names)


def test_user_a_cannot_read_user_b_through_search_passages(phoenix, monkeypatch):
    sent = install_index(monkeypatch)
    tracing.setup_tracing()

    result = rag.search_passages("late interaction", full_text=True, tool_context=caller("ada"))
    record_tool(rag.search_passages, {"query": "late interaction"}, result)

    blob = span_text(phoenix)
    assert SECRET not in blob and BO not in blob
    assert [hit["source"] for hit in result["topk"]] == ["ada.pdf"]
    assert result["topk"][0]["text"] == ADA
    assert sent == [{"query": "late interaction", "k": 5, "sources": ["ada.pdf"]}]
    assert ADA in blob

    narrowed = rag.search_passages("late interaction", source=BO, full_text=True, tool_context=caller("ada"))
    assert narrowed == {"topk": [], "low_confidence": True}
    assert len(sent) == 1


def test_a_caller_with_no_papers_gets_nothing_and_does_not_search(phoenix, monkeypatch):
    sent = install_index(monkeypatch)
    tracing.setup_tracing()

    answer = rag.answer_from_docs("Who introduced late interaction?", tool_context=caller("nobody"))
    passages = rag.search_passages("late interaction", full_text=True, tool_context=caller("nobody"))
    record_tool(rag.answer_from_docs, {"question": "Who introduced late interaction?"}, answer)
    record_tool(rag.search_passages, {"query": "late interaction"}, passages)

    assert answer == {"status": "ok", "answer": "", "sources": []}
    assert passages == {"topk": [], "low_confidence": True}
    assert sent == []
    blob = span_text(phoenix)
    assert SECRET not in blob
    assert BO not in blob
    assert not any(span.name == "colbert_search" for span in phoenix.get_finished_spans())
