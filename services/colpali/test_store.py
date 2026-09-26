"""add_pdf's and add_figures's Qdrant-backed dedup: identical content under the same source name
skips the encode-and-upsert entirely, while changed content still goes through it, storing the
new content hash for next time. See services/colbert/test_store.py for the same pattern on the
other retrieval service — no real Qdrant or model, both faked at module level.
"""

import numpy as np
import PIL.Image
import pytest
import store


class FakePoint:
    def __init__(self, payload):
        self.payload = payload


class FakeCount:
    def __init__(self, count):
        self.count = count


class FakeQdrantClient:
    def __init__(self, url=None, api_key=None, timeout=None):
        self.points_by_source: dict[str, list[dict]] = {}
        self.deletes = []
        self.upsert_calls = 0

    def collection_exists(self, name):
        return True

    def create_collection(self, *args, **kwargs):
        pass

    def create_payload_index(self, *args, **kwargs):
        pass

    def _source_of(self, filter_):
        return filter_.must[0].match.value

    def scroll(self, collection, scroll_filter, limit, with_payload):
        source = self._source_of(scroll_filter)
        points = self.points_by_source.get(source, [])
        return ([FakePoint(points[0])] if points else []), None

    def count(self, collection, count_filter):
        source = self._source_of(count_filter)
        return FakeCount(len(self.points_by_source.get(source, [])))

    def delete(self, collection, points_selector):
        source = self._source_of(points_selector.filter)
        self.deletes.append(source)
        self.points_by_source.pop(source, None)

    def upsert(self, collection, points):
        self.upsert_calls += 1
        for point in points:
            self.points_by_source.setdefault(point.payload["source"], []).append(point.payload)


class FakeEncoder:
    dim = 4

    def __init__(self, device=None):
        self.page_calls = 0

    def pages(self, images):
        self.page_calls += 1
        return [np.ones((1, self.dim), dtype=np.float32) for _ in images]


@pytest.fixture
def fresh_store(monkeypatch):
    monkeypatch.setattr(store, "QdrantClient", FakeQdrantClient)
    monkeypatch.setattr(store, "Encoder", FakeEncoder)
    return store.Store()


def _write_image(path, content: bytes):
    path.write_bytes(content)
    return path


def test_identical_pdf_skips_rendering_and_encoding(tmp_path, monkeypatch, fresh_store):
    calls = []
    monkeypatch.setattr(store, "pdf_pages", lambda path, dpi=150: (calls.append(path), [object()])[1])
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"same bytes every time")

    first = fresh_store.add_pdf(pdf)
    assert first == 1
    assert len(calls) == 1
    assert fresh_store.encoder.page_calls == 1

    again = fresh_store.add_pdf(pdf)
    assert again == first
    assert len(calls) == 1  # pdf_pages not called again
    assert fresh_store.encoder.page_calls == 1  # not re-encoded


def test_changed_pdf_bytes_re_renders_and_replaces(tmp_path, monkeypatch, fresh_store):
    monkeypatch.setattr(store, "pdf_pages", lambda path, dpi=150: [object()])
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"version one")
    fresh_store.add_pdf(pdf)

    pdf.write_bytes(b"version two, genuinely different")
    fresh_store.add_pdf(pdf)

    assert fresh_store.encoder.page_calls == 2
    assert fresh_store.client.deletes == ["paper.pdf", "paper.pdf"]


def test_identical_figures_skip_encoding(tmp_path, monkeypatch, fresh_store):
    monkeypatch.setattr(
        PIL.Image, "open", lambda path: type("Img", (), {"convert": lambda self, mode: self})()
    )
    figure_path = _write_image(tmp_path / "fig1.png", b"figure bytes")
    figures = [{"image": str(figure_path), "page": 1, "label": "Figure 1", "caption": "A caption"}]

    first = fresh_store.add_figures("paper.pdf", "Paper Title", figures)
    assert first == 1
    assert fresh_store.encoder.page_calls == 1

    again = fresh_store.add_figures("paper.pdf", "Paper Title", figures)
    assert again == first
    assert fresh_store.encoder.page_calls == 1  # not re-encoded: same image bytes, same metadata


def test_changed_caption_is_treated_as_different_content(tmp_path, monkeypatch, fresh_store):
    monkeypatch.setattr(
        PIL.Image, "open", lambda path: type("Img", (), {"convert": lambda self, mode: self})()
    )
    figure_path = _write_image(tmp_path / "fig1.png", b"figure bytes")
    figures = [{"image": str(figure_path), "page": 1, "label": "Figure 1", "caption": "A caption"}]
    fresh_store.add_figures("paper.pdf", "Paper Title", figures)

    reworded = [{**figures[0], "caption": "A different caption"}]
    fresh_store.add_figures("paper.pdf", "Paper Title", reworded)

    assert fresh_store.encoder.page_calls == 2  # caption is part of the hash, so this re-ran
