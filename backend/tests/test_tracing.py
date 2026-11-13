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
    monkeypatch.setattr(main, "tracer", tracer_provider.get_tracer("app.main"))
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


def _span_text(span) -> str:
    return " ".join(str(value) for value in span.attributes.values())


def test_an_unscoped_search_records_neither_passage_text_nor_file_names(phoenix, monkeypatch):
    """A search that names no papers still opens a span. The file name is hashed and the
    passage text is left off, so another user's paper cannot be read back from the trace."""
    exporter, _ = phoenix
    secret = "Bo secret token 91337"
    filename = "bo-private-91337.pdf"
    hits = [{"text": secret, "source": filename, "page": 2, "score": 5.0}]

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"topk": hits}

    monkeypatch.setattr(retrieval._session, "post", lambda *args, **kwargs: Response())

    assert retrieval.colbert_search("shared index") == hits

    span = next(span for span in exporter.get_finished_spans() if span.name == "colbert_search")
    assert secret not in _span_text(span)
    assert filename not in _span_text(span)
    assert not any(key.endswith("document.content") for key in span.attributes)
    assert span.attributes["retrieval.documents.0.document.id"].startswith("sha256:")
    assert span.attributes["retrieval.documents.0.document.id"].endswith(" p2")
    assert span.attributes["retrieval.documents.0.document.score"] == 5.0


def test_a_scoped_search_drops_another_users_passage_from_the_span(phoenix, monkeypatch):
    exporter, _ = phoenix
    secret = "Bo secret token 91337"
    filename = "bo-private-91337.pdf"
    own = "Ada late interaction token 4242"
    hits = [
        {"text": secret, "source": filename, "page": 4, "score": 90.0},
        {"text": own, "source": "ada.pdf", "page": 1, "score": 20.0},
    ]
    sent = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"topk": hits}

    def post(url, json=None, **kwargs):
        sent["body"] = json
        return Response()

    monkeypatch.setattr(retrieval._session, "post", post)

    kept = retrieval.colbert_search("late interaction", sources=["ada.pdf"], visible=["ada.pdf"])

    assert [hit["source"] for hit in kept] == ["ada.pdf"]
    assert sent["body"]["sources"] == ["ada.pdf"]
    assert "source" not in sent["body"]
    span = next(span for span in exporter.get_finished_spans() if span.name == "colbert_search")
    text = _span_text(span)
    assert secret not in text
    assert filename not in text
    assert span.attributes["retrieval.documents.0.document.content"] == own
    assert span.attributes["retrieval.documents.0.document.id"] == "ada.pdf p1"
    assert "retrieval.documents.1.document.id" not in span.attributes


def test_a_colpali_search_drops_another_users_figure(phoenix, monkeypatch):
    """The visual service is asked for one paper. A hit from any other paper is left out of
    the answer and out of the span, caption and file name included."""
    exporter, _ = phoenix
    secret = "Bo secret caption 91337"
    filename = "bo-private-91337.pdf"
    own = "Ada chart of index size"
    hits = [
        {
            "caption": secret, "source": filename, "page": 4, "score": 90.0,
            "kind": "figure", "label": "Figure 1", "image": "bo/figure-1.png", "title": "bo",
        },
        {
            "caption": own, "source": "ada.pdf", "page": 1, "score": 20.0,
            "kind": "figure", "label": "Figure 2", "image": "ada/figure-2.png", "title": "ada",
        },
    ]

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"model": "colqwen", "topk": hits}

    monkeypatch.setattr(retrieval._session, "post", lambda *args, **kwargs: Response())

    result = retrieval.colpali_search("index size chart", source="ada.pdf")

    assert [hit["source"] for hit in result["topk"]] == ["ada.pdf"]
    assert result["topk"][0]["caption"] == own
    span = next(span for span in exporter.get_finished_spans() if span.name == "colpali_search")
    text = _span_text(span)
    assert secret not in text
    assert filename not in text
    assert span.attributes["retrieval.documents.0.document.content"] == own
    assert span.attributes["retrieval.documents.0.document.id"] == "ada.pdf p1"
    assert "retrieval.documents.1.document.id" not in span.attributes


def test_an_empty_source_list_does_not_search(monkeypatch):
    def post(*args, **kwargs):
        raise AssertionError("an empty scope must not search the index")

    monkeypatch.setattr(retrieval._session, "post", post)

    assert retrieval.colbert_search("late interaction", sources=[]) == []


def test_a_retriever_span_records_at_most_ten_documents(phoenix, monkeypatch):
    exporter, _ = phoenix
    hits = [
        {"text": f"passage {i} of the caller", "source": "ada.pdf", "page": i, "score": float(i)}
        for i in range(15)
    ]

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"topk": hits}

    monkeypatch.setattr(retrieval._session, "post", lambda *args, **kwargs: Response())

    retrieval.colbert_search("late interaction", sources=["ada.pdf"])

    span = next(span for span in exporter.get_finished_spans() if span.name == "colbert_search")
    assert span.attributes["retrieval.documents.9.document.id"] == "ada.pdf p9"
    assert "retrieval.documents.10.document.id" not in span.attributes
    assert "passage 10 of the caller" not in _span_text(span)


class _NullRedis:
    def publish(self, channel, message):
        pass


def test_each_step_of_a_queued_analysis_is_an_agent_span(phoenix, monkeypatch):
    exporter, _ = phoenix
    tracing.setup_tracing()
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: _NullRedis())
    monkeypatch.setattr("app.pipeline.sources.lookup_key", lambda citation: citation["key"])
    monkeypatch.setattr(main, "index_paper", lambda title: "indexed")
    extracted = {
        "status": "ok",
        "file": "paper.pdf",
        "title": "T",
        "claims": [{"claim": "Hard negatives help.", "citations": [{"key": "ance.pdf"}]}],
    }
    monkeypatch.setattr(main, "extract_claims_with_citations", lambda paper: extracted)
    monkeypatch.setattr(main, "prepare_source", lambda source: {"status": "ok", "path": source})
    monkeypatch.setattr(main, "paper_figures", lambda file: [])
    monkeypatch.setattr(main, "add_paper", lambda file: {"status": "ok"})
    monkeypatch.setattr(main, "audit", lambda analysis: [])

    def check_prepared(claim, source, path, judged="", other_citations=False):
        with retrieval.tracer.start_as_current_span("colbert_search"):
            return {"status": "ok", "claim": claim, "source": source, "verdict": "supports"}

    monkeypatch.setattr(main, "check_prepared", check_prepared)

    queue.run_analysis_job("job-steps", "paper.pdf", True, None)

    spans = {span.name: span for span in exporter.get_finished_spans()}
    steps = ["read_paper", "prepare_source", "check_source", "read_figures", "add_paper", "audit_analysis"]
    for name in steps:
        assert spans[name].attributes["openinference.span.kind"] == "AGENT", name
        assert spans[name].attributes["agent.name"] == name
        assert spans[name].parent.span_id == spans["analysis"].context.span_id, name
    check = spans["check_source"]
    assert check.attributes["claim.number"] == 1
    assert check.attributes["claim.source"] == "ance.pdf"
    assert check.attributes["output.value"] == "supports"
    assert spans["colbert_search"].parent.span_id == check.context.span_id
