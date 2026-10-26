"""add_pdf's and add_figures's store-backed dedup: identical content under the same source
name skips the encode-and-write entirely, while changed content still goes through it.
Also covers search, restricted to one paper and across all of them. See
services/colbert/test_store.py for the same pattern on the other retrieval service -- no
real vector store or model, both faked at module level.
"""

import PIL.Image
import pytest
import store
import torch


class FakePaperFiles:
    def __init__(self, root=None, kind=None):
        self.papers: dict[str, tuple] = {}
        self.write_calls = 0

    def stored_hash(self, source):
        entry = self.papers.get(source)
        return (entry[2], len(entry[0])) if entry else (None, 0)

    def write(self, source, rows, vectors, content_hash):
        self.write_calls += 1
        self.papers[source] = (rows, vectors, content_hash)

    def load(self, source):
        entry = self.papers.get(source)
        if entry is None:
            return None
        rows, vectors, _hash = entry
        from vectorfiles import Paper

        cat = torch.cat(vectors, dim=0) if vectors else torch.zeros((0, 4))
        row_index = torch.repeat_interleave(
            torch.arange(len(rows), dtype=torch.int64),
            torch.tensor([v.shape[0] for v in vectors], dtype=torch.int64),
        )
        return Paper(rows=rows, vectors=cat, row_index=row_index)

    def sources(self):
        return list(self.papers)

    def delete(self, source):
        self.papers.pop(source, None)


class FakeEncoder:
    dim = 4

    def __init__(self, device=None):
        self.page_calls = 0

    def pages(self, images):
        self.page_calls += 1
        return [torch.ones((1, self.dim)) for _ in images]

    def query(self, text):
        return torch.ones((1, self.dim))


@pytest.fixture
def fresh_store(monkeypatch):
    monkeypatch.setattr(store, "PaperFiles", FakePaperFiles)
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
    assert fresh_store.files.write_calls == 2


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


def test_search_with_source_returns_only_that_paper_ranked(tmp_path, monkeypatch, fresh_store):
    monkeypatch.setattr(store, "pdf_pages", lambda path, dpi=150: [object()])
    for name in ("a.pdf", "b.pdf"):
        pdf = tmp_path / name
        pdf.write_bytes(name.encode())
        fresh_store.add_pdf(pdf)

    results = fresh_store.search("query", k=5, source="a.pdf")

    assert len(results) == 1
    assert results[0]["source"] == "a.pdf"
    assert results[0]["rank"] == 1


def test_search_with_sources_returns_only_those_papers(tmp_path, monkeypatch, fresh_store):
    monkeypatch.setattr(store, "pdf_pages", lambda path, dpi=150: [object()])
    for name in ("a.pdf", "b.pdf", "c.pdf"):
        pdf = tmp_path / name
        pdf.write_bytes(name.encode())
        fresh_store.add_pdf(pdf)

    results = fresh_store.search("query", k=5, sources=["c.pdf", "a.pdf"])

    assert {result["source"] for result in results} == {"a.pdf", "c.pdf"}
    assert fresh_store.search("query", sources=[]) == []
    assert fresh_store.search("query", source="b.pdf", sources=["a.pdf"]) == []


def test_search_without_source_ranks_across_papers(tmp_path, monkeypatch, fresh_store):
    monkeypatch.setattr(store, "pdf_pages", lambda path, dpi=150: [object()])
    for name in ("a.pdf", "b.pdf"):
        pdf = tmp_path / name
        pdf.write_bytes(name.encode())
        fresh_store.add_pdf(pdf)

    results = fresh_store.search("query", k=5)

    assert {result["source"] for result in results} == {"a.pdf", "b.pdf"}
    assert [result["rank"] for result in results] == list(range(1, len(results) + 1))
