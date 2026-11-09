"""verify.py paths the other verify tests leave out: when the judge is built, background figure
indexing, the visual search when ColPali is down or fails, and the page-image fallback.

The judge, ColBERT and ColPali are fakes. Nothing here reaches a model.
"""

import logging
from pathlib import Path

import pytest
from app.pipeline import figures, sources, verify

PAPER = Path("data/papers/cited.pdf")
VERDICT = {"verdict": "supports", "quote": "q", "reasoning": "r"}


@pytest.fixture
def built(monkeypatch):
    """verify._judge starts unbuilt; _build_judge returns a fake judge and counts its builds."""
    builds = []

    def build():
        builds.append(1)
        return lambda claim, passages, figure=None: VERDICT

    monkeypatch.setattr(verify, "_judge", None)
    monkeypatch.setattr(verify, "_build_judge", build)
    return builds


def test_judge_passages_builds_the_judge_on_first_use_and_keeps_it(built):
    assert verify.judge_passages("A claim.", ["A passage."]) == VERDICT
    assert verify.judge_passages("A claim.", ["A passage."]) == VERDICT
    assert built == [1]


def test_check_prepared_builds_the_judge_on_first_use(built, monkeypatch):
    monkeypatch.setattr(verify, "evidence_from", lambda claim, name: [{"text": "A passage."}])
    monkeypatch.setattr(verify, "_figures_ready", lambda source: False)
    monkeypatch.setattr(sources, "known_index", lambda pdf: {})
    monkeypatch.setattr(sources, "version_of", lambda source: {})

    result = verify.check_prepared("A claim.", "2112.01488", PAPER)

    assert result["verdict"] == "supports"
    assert built == [1]


def test_a_paper_without_crops_is_indexed_by_its_pages(monkeypatch):
    added = []
    monkeypatch.setattr(verify, "_crops", lambda source: [])
    monkeypatch.setattr(verify.retrieval, "colpali_add_pdf", added.append)

    verify._index_visually(PAPER)

    assert added == [PAPER.as_posix()]


def test_a_paper_with_crops_is_indexed_by_them(monkeypatch):
    added = []
    crops = [{"image": "figure-1.png"}]
    monkeypatch.setattr(verify, "_crops", lambda source: crops)
    monkeypatch.setattr(verify.retrieval, "colpali_add_figures", lambda *args: added.append(args))

    verify._index_visually(PAPER)

    assert added == [(PAPER.name, PAPER.stem, crops)]


def test_crops_are_empty_when_the_media_could_not_be_read(monkeypatch):
    monkeypatch.setattr(figures, "paper_media", lambda path: {"status": "error", "message": "boom"})

    assert verify._crops(PAPER) == []


def test_crops_are_the_figures_and_tables_that_have_an_image(monkeypatch):
    media = {
        "status": "ok",
        "figures": [{"image": "figure-1.png"}, {"caption": "no crop"}],
        "tables": [{"image": "table-1.png"}],
    }
    monkeypatch.setattr(figures, "paper_media", lambda path: media)

    assert verify._crops(PAPER) == [{"image": "figure-1.png"}, {"image": "table-1.png"}]


def test_nothing_is_indexed_visually_while_colpali_is_down(monkeypatch):
    def unexpected(source):
        raise AssertionError("ColPali is down")

    monkeypatch.setattr(verify.retrieval, "colpali_available", lambda: False)
    monkeypatch.setattr(verify, "_index_visually", unexpected)

    verify._index_visually_if_available(PAPER)


def test_a_failed_visual_index_is_logged_and_not_raised(monkeypatch, caplog):
    def refuse(source):
        raise RuntimeError("gpu out of memory")

    monkeypatch.setattr(verify.retrieval, "colpali_available", lambda: True)
    monkeypatch.setattr(verify, "_index_visually", refuse)

    with caplog.at_level(logging.WARNING, logger=verify.logger.name):
        verify._index_visually_if_available(PAPER)

    assert "indexing cited.pdf in ColPali failed: gpu out of memory" in caplog.text


def test_the_visual_search_is_skipped_while_colpali_is_down(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("ColPali is down")

    monkeypatch.setattr(verify.retrieval, "colpali_available", lambda: False)
    monkeypatch.setattr(verify.retrieval, "colpali_search", unexpected)

    assert verify._visual("A claim.", PAPER) == ([], "")


def test_a_failed_visual_search_leaves_the_check_without_pages(monkeypatch):
    def refuse(*args, **kwargs):
        raise ConnectionError("colpali dropped the connection")

    monkeypatch.setattr(verify.retrieval, "colpali_available", lambda: True)
    monkeypatch.setattr(verify.retrieval, "colpali_search", refuse)

    assert verify._visual("A claim.", PAPER) == ([], "")
