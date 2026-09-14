"""A check waits for its cited paper's figures, or FIGURE_WAIT seconds at most when it is set (#163).

Indexing figures means Docling reading the whole PDF, up to 150 s per paper. The text index is
what a verdict needs. No services: ColBERT, ColPali, the lookup and the judge are fakes, and
figure indexing blocks on an event the test releases.
"""

import sys
import threading
import time
import types
from pathlib import Path

import pytest
from app.pipeline import sources, verify

PAPER = Path("data/papers/cited.pdf")
PASSAGE = {
    "source": PAPER.name,
    "text": "ColBERT reduces the index 10x.",
    "page": 1,
    "start": 0,
    "end": 30,
    "score": 1.0,
}
FIGURE = {
    "source": PAPER.name,
    "page": 3,
    "score": 0.9,
    "kind": "figure",
    "label": "Figure 2",
    "caption": "Index size",
    "image": "figure-2.png",
}


@pytest.fixture
def services(monkeypatch):
    """Fakes for everything a check calls, and a fresh index state. `release` lets the figure
    indexing finish; `calls` counts what was called."""
    calls = {"add_paper": 0, "index_figures": 0, "colpali_search": 0}
    release = threading.Event()
    text_results = []  # add_paper answers in order; ok once this runs out

    def add_paper(path):
        calls["add_paper"] += 1
        return text_results.pop(0) if text_results else {"status": "ok"}

    def index_figures(source):
        calls["index_figures"] += 1
        assert release.wait(5), "the test never released the figure indexing"

    def colpali_search(claim, k):
        calls["colpali_search"] += 1
        return {"topk": [FIGURE], "model": "colqwen"}

    monkeypatch.setitem(sys.modules, "app.pipeline.rag", types.SimpleNamespace(add_paper=add_paper))
    monkeypatch.setattr(sources, "local_pdf", lambda identifier: PAPER.as_posix())
    monkeypatch.setattr(sources, "known_index", lambda identifier: {"index": "", "ids": {}})
    monkeypatch.setattr(verify.retrieval, "colbert_search", lambda claim, k: [PASSAGE])
    monkeypatch.setattr(verify.retrieval, "colpali_available", lambda: True)
    monkeypatch.setattr(verify.retrieval, "colpali_search", colpali_search)
    monkeypatch.setattr(verify, "_index_visually", index_figures)
    judged = {"verdict": "supports", "quote": "", "reasoning": ""}
    monkeypatch.setattr(verify, "_judge", lambda claim, passages: judged)
    monkeypatch.setattr(verify, "_indexed", set())
    monkeypatch.setattr(verify, "_visual_indexing", {}, raising=False)
    monkeypatch.setattr(verify, "_figures_due", {}, raising=False)
    monkeypatch.setattr(verify, "FIGURE_WAIT", 0.0, raising=False)  # fast mode; tests that wait set their own
    monkeypatch.setattr(verify, "_locks", {})
    yield types.SimpleNamespace(calls=calls, release=release, text_results=text_results)
    release.set()  # never leave a pool thread blocked


def test_the_check_runs_before_the_figures_are_indexed(services):
    start = time.monotonic()
    prepared = verify.prepare_source("2112.01488")
    assert prepared == {"status": "ok", "path": PAPER.as_posix()}

    verdict = verify.check_prepared("ColBERT reduces the index 10x", "2112.01488", PAPER)
    assert time.monotonic() - start < 1  # not the 5 s the figure indexing would hold it
    assert verdict["verdict"] == "supports"
    assert verdict["pages"] == [] and verdict["page_model"] == ""
    assert services.calls["colpali_search"] == 0  # a half-built figure index is never searched


def test_a_later_check_gets_the_figures_once_they_are_indexed(services):
    verify.prepare_source("2112.01488")
    services.release.set()
    verify._visual_indexing[PAPER.name].result(timeout=5)

    verdict = verify.check_prepared("ColBERT reduces the index 10x", "2112.01488", PAPER)
    assert [page["label"] for page in verdict["pages"]] == ["Figure 2"]
    assert verdict["page_model"] == "colqwen"


def test_every_check_of_one_source_skips_the_wait_and_indexes_once(services):
    start = time.monotonic()
    for _ in range(3):
        assert verify.prepare_source("2112.01488")["status"] == "ok"
    assert time.monotonic() - start < 1
    services.release.set()
    verify._visual_indexing[PAPER.name].result(timeout=5)
    assert services.calls == {"add_paper": 1, "index_figures": 1, "colpali_search": 0}


def test_a_failed_text_index_is_tried_again_but_the_figures_only_once(services):
    services.text_results.append({"status": "error", "message": "colbert down"})
    assert verify.prepare_source("2112.01488")["status"] == "error"
    assert verify.prepare_source("2112.01488")["status"] == "ok"
    services.release.set()
    verify._visual_indexing[PAPER.name].result(timeout=5)
    assert services.calls["add_paper"] == 2
    assert services.calls["index_figures"] == 1


def test_by_default_a_check_waits_for_the_figures(services, monkeypatch):
    """Empty FIGURE_WAIT: quality first. A caption turned one verdict in 15 from refutes into
    supports, so the default waits for them however long Docling takes."""
    monkeypatch.setattr(verify, "FIGURE_WAIT", None)
    threading.Timer(0.5, services.release.set).start()
    start = time.monotonic()
    verify.prepare_source("2112.01488")
    assert time.monotonic() - start >= 0.45

    verdict = verify.check_prepared("ColBERT reduces the index 10x", "2112.01488", PAPER)
    assert [page["label"] for page in verdict["pages"]] == ["Figure 2"]


def test_figures_that_are_ready_within_figure_wait_are_used(services, monkeypatch):
    monkeypatch.setattr(verify, "FIGURE_WAIT", 3.0)
    threading.Timer(0.2, services.release.set).start()
    verify.prepare_source("2112.01488")

    verdict = verify.check_prepared("ColBERT reduces the index 10x", "2112.01488", PAPER)
    assert [page["label"] for page in verdict["pages"]] == ["Figure 2"]


def test_slow_figures_hold_the_source_no_longer_than_figure_wait(services, monkeypatch):
    monkeypatch.setattr(verify, "FIGURE_WAIT", 0.3)
    start = time.monotonic()
    assert verify.prepare_source("2112.01488")["status"] == "ok"
    assert 0.25 < time.monotonic() - start < 1

    verdict = verify.check_prepared("ColBERT reduces the index 10x", "2112.01488", PAPER)
    assert verdict["pages"] == []


def test_the_wait_counts_from_when_the_figures_started(services, monkeypatch):
    """A second prepare of the same paper does not wait a second FIGURE_WAIT."""
    monkeypatch.setattr(verify, "FIGURE_WAIT", 0.3)
    verify.prepare_source("2112.01488")
    start = time.monotonic()
    verify.prepare_source("2112.01488")
    assert time.monotonic() - start < 0.1


def test_a_single_verify_claim_waits_for_the_figures(services):
    threading.Timer(0.2, services.release.set).start()
    verdict = verify.verify_claim("ColBERT reduces the index 10x", "2112.01488")
    assert [page["label"] for page in verdict["pages"]] == ["Figure 2"]
