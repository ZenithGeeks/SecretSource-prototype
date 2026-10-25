"""app/tracing.py: off without an endpoint, and DSPy calls become spans with one."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

import dspy
import pytest
from app import assistant, main, queue, tracing
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
    # The search names one paper, so that paper's passage is the document content.
    assert span.attributes["retrieval.documents.0.document.content"] == text
    assert span.attributes["retrieval.documents.0.document.id"] == "colbert.pdf p1"
    assert span.attributes["retrieval.documents.0.document.score"] == 45.0


def _fake_search(monkeypatch, payload):
    """ColBERT and ColPali both POST JSON and read `topk` back. Record the body."""
    sent = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return payload

    def post(url, json=None, **kwargs):
        sent["body"] = json
        return Response()

    monkeypatch.setattr(retrieval._session, "post", post)
    return sent


def _span_text(span) -> str:
    return " ".join(str(value) for value in span.attributes.values())


def test_a_library_search_never_records_another_users_passage(phoenix, monkeypatch):
    """ask_library and check_text search the shared index, then keep the caller's papers.
    The span may carry those papers, and never a passage from anyone else."""
    exporter, _ = phoenix
    foreign = "Bo's private notes on a result that is not published."
    own = "ColBERT introduces late interaction."
    hits = [
        {"text": foreign, "source": "bo.pdf", "page": 4, "score": 90.0},
        {"text": own, "source": "ada.pdf", "page": 1, "score": 20.0},
    ]
    sent = _fake_search(monkeypatch, {"topk": hits})

    kept = assistant.library_passages("Who introduced late interaction?", frozenset({"ada.pdf"}))

    assert [hit["source"] for hit in kept] == ["ada.pdf"]
    assert sent["body"] == {"query": "Who introduced late interaction?", "k": assistant.LIBRARY_SEARCH}
    span = next(span for span in exporter.get_finished_spans() if span.name == "colbert_search")
    assert foreign not in _span_text(span)
    assert span.attributes["retrieval.documents.0.document.content"] == own
    assert span.attributes["retrieval.documents.0.document.id"] == "ada.pdf p1"
    assert span.attributes["retrieval.documents.0.document.score"] == 20.0
    assert "retrieval.documents.1.document.id" not in span.attributes


def test_a_retriever_span_records_at_most_ten_documents(phoenix, monkeypatch):
    exporter, _ = phoenix
    hits = [
        {"text": f"passage {i} of the caller", "source": "ada.pdf", "page": i, "score": float(i)}
        for i in range(15)
    ]
    _fake_search(monkeypatch, {"topk": hits})

    retrieval.colbert_search("late interaction", visible=frozenset({"ada.pdf"}))

    span = next(span for span in exporter.get_finished_spans() if span.name == "colbert_search")
    assert span.attributes["retrieval.documents.9.document.content"] == "passage 9 of the caller"
    assert "passage 10 of the caller" not in _span_text(span)
    assert "retrieval.documents.10.document.content" not in span.attributes


def test_an_unscoped_search_records_ids_and_scores_but_not_passage_text(phoenix, monkeypatch):
    exporter, _ = phoenix
    secret = "A passage that must not leave this process."
    hits = [{"text": secret, "source": "bo.pdf", "page": 2, "score": 5.0}]
    _fake_search(monkeypatch, {"topk": hits})

    assert retrieval.colbert_search("shared index") == hits

    span = next(span for span in exporter.get_finished_spans() if span.name == "colbert_search")
    assert secret not in _span_text(span)
    assert not any("document.content" in key for key in span.attributes)
    assert span.attributes["retrieval.documents.0.document.id"] == "bo.pdf p2"
    assert span.attributes["retrieval.documents.0.document.score"] == 5.0


def test_a_scoped_colpali_search_does_not_record_another_papers_caption(phoenix, monkeypatch):
    exporter, _ = phoenix
    foreign = "Another user's figure caption about revenue."
    own = "Index size per method."
    hits = [
        {"caption": foreign, "source": "other.pdf", "page": 2, "score": 4.0},
        {"caption": own, "source": "mine.pdf", "page": 1, "score": 1.0},
    ]
    _fake_search(monkeypatch, {"topk": hits})

    assert retrieval.colpali_search("index size", source="mine.pdf")["topk"] == hits

    span = next(span for span in exporter.get_finished_spans() if span.name == "colpali_search")
    assert foreign not in _span_text(span)
    assert span.attributes["retrieval.documents.0.document.content"] == own
    assert span.attributes["retrieval.documents.0.document.id"] == "mine.pdf p1"
    assert "retrieval.documents.1.document.id" not in span.attributes
