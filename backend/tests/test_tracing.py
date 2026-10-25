"""app/tracing.py: off without an endpoint, and DSPy calls become spans with one."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

import dspy
import pytest
from app import main, queue, tracing
from app.clients import retrieval
from dspy.utils import DummyLM
from openinference.instrumentation.dspy import DSPyInstrumentor
from openinference.instrumentation.google_adk import GoogleADKInstrumentor
from opentelemetry.instrumentation.threading import ThreadingInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def test_tracing_is_off_without_an_endpoint(monkeypatch):
    monkeypatch.setattr(tracing, "PHOENIX_COLLECTOR_ENDPOINT", "")

    assert tracing.setup_tracing() is False


@pytest.fixture
def phoenix(monkeypatch):
    """Stand in for phoenix.otel.register: spans go to memory, not over the network."""
    exporter = InMemorySpanExporter()
    tracer_provider = TracerProvider()
    tracer_provider.add_span_processor(SimpleSpanProcessor(exporter))
    registered = []

    def register(**kwargs):
        registered.append(kwargs)
        return tracer_provider

    monkeypatch.setattr("phoenix.otel.register", register)
    monkeypatch.setattr(tracing, "PHOENIX_COLLECTOR_ENDPOINT", "http://phoenix:6006")
    # The real register() sets the global provider, which app.queue's tracer reads. That can
    # happen once per process, so give the queue this provider's tracer instead.
    monkeypatch.setattr(queue, "tracer", tracer_provider.get_tracer("app.queue"))
    monkeypatch.setattr(retrieval, "tracer", tracer_provider.get_tracer("app.clients.retrieval"))
    yield exporter, registered
    DSPyInstrumentor().uninstrument()
    GoogleADKInstrumentor().uninstrument()
    ThreadingInstrumentor().uninstrument()


def test_a_dspy_call_becomes_a_span_with_its_prompt_and_answer(phoenix):
    exporter, registered = phoenix

    assert tracing.setup_tracing() is True
    with dspy.context(lm=DummyLM([{"answer": "Paris"}])):
        dspy.Predict("question -> answer")(question="What is the capital of France?")

    assert registered == [{"project_name": "secretsource", "protocol": "http/protobuf", "batch": True}]
    spans = {span.name: span for span in exporter.get_finished_spans()}
    assert "Predict(StringSignature).forward" in spans, sorted(spans)
    predict = spans["Predict(StringSignature).forward"]
    assert "capital of France" in predict.attributes["input.value"]
    assert "Paris" in predict.attributes["output.value"]


def test_the_llm_calls_of_one_queued_analysis_share_one_trace(phoenix, monkeypatch):
    exporter, _ = phoenix
    tracing.setup_tracing()

    def extract_claim(window):
        with dspy.context(lm=DummyLM([{"claim": "BM25 beats dense retrieval"}])):
            return dspy.Predict("window -> claim")(window=window)

    def extract_claims(paper):
        # Like app/pipeline/claims.py: a thread pool inside a thread.
        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(extract_claim, ["window 1", "window 2"]))

    async def run_queued(analysis_id, analysis, paper, verify):
        await asyncio.to_thread(extract_claims, paper)
        analysis["status"] = "done"

    async def saved(analysis_id):
        pass

    monkeypatch.setattr(main, "_run_queued", run_queued)
    monkeypatch.setattr(main, "_saved", saved)

    queue.run_analysis_job("job-traced", "paper.pdf", True, None)

    spans = exporter.get_finished_spans()
    analysis = next(span for span in spans if span.name == "analysis")
    assert analysis.attributes["analysis.id"] == "job-traced"
    assert analysis.attributes["input.value"] == "paper.pdf"
    predicts = [span for span in spans if span.name == "Predict(StringSignature).forward"]
    assert len(predicts) == 2
    assert {span.context.trace_id for span in predicts} == {analysis.context.trace_id}


def test_a_colbert_search_becomes_a_retriever_span_with_its_passages(phoenix, monkeypatch):
    exporter, _ = phoenix
    text = "ColBERT introduces late interaction."
    hits = [{"text": text, "source": "colbert.pdf", "page": 1, "score": 45.0}]

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"topk": hits}

    monkeypatch.setattr(retrieval._session, "post", lambda *args, **kwargs: Response())

    assert retrieval.colbert_search("Who introduced late interaction?", source="colbert.pdf") == hits

    span = next(span for span in exporter.get_finished_spans() if span.name == "colbert_search")
    assert span.attributes["openinference.span.kind"] == "RETRIEVER"
    assert span.attributes["input.value"] == "Who introduced late interaction?"
    assert span.attributes["retrieval.documents.0.document.content"] == text
    assert span.attributes["retrieval.documents.0.document.id"] == "colbert.pdf p1"
    assert span.attributes["retrieval.documents.0.document.score"] == 45.0
