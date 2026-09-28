"""add_pdf's store-backed dedup: the same PDF content under the same source name skips the
encode-and-write (the expensive part), while different content or a different source name
still goes through it. Also covers search, restricted to one paper and across all of them.

No real vector store or model: PaperFiles and Encoder are both monkeypatched at module
level, the same way the rest of this codebase fakes a lazily-imported client (see
backend/tests/test_sources.py).
"""

import pytest
import store
import torch


class FakePaperFiles:
    """In-memory stand-in for vectorfiles.PaperFiles: enough of its shape for Store to run."""

    def __init__(self, root=None, kind=None):
        self.papers: dict[str, tuple] = {}  # source -> (rows, vectors, content_hash)
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
    def __init__(self, device=None):
        self.doc_calls = 0

    def docs(self, texts):
        self.doc_calls += 1
        return [torch.ones((1, 4)) for _ in texts]

    def query(self, text):
        return torch.ones((1, 4))


@pytest.fixture
def fresh_store(monkeypatch):
    monkeypatch.setattr(store, "PaperFiles", FakePaperFiles)
    monkeypatch.setattr(store, "Encoder", FakeEncoder)
    monkeypatch.setattr(
        store, "pdf_passages",
        lambda path: [{"text": path.read_text(), "page": 1, "start": 0, "end": len(path.read_text())}],
    )
    return store.Store()


def _write_pdf(tmp_path, name: str, text: str):
    """Not a real PDF -- the fake pdf_passages above reads this file's raw text back out, so
    the dedup path under test (hash the bytes, decide whether to re-encode) never needs one."""
    path = tmp_path / name
    path.write_text(text)
    return path


def test_identical_content_skips_encoding(tmp_path, fresh_store):
    pdf = _write_pdf(tmp_path, "paper.pdf", "hello world this is a paper")

    first = fresh_store.add_pdf(pdf)
    assert first > 0
    assert fresh_store.encoder.doc_calls == 1
    assert fresh_store.files.write_calls == 1

    again = fresh_store.add_pdf(pdf)
    assert again == first
    assert fresh_store.encoder.doc_calls == 1  # not called again
    assert fresh_store.files.write_calls == 1  # not re-written


def test_changed_content_under_the_same_name_re_encodes_and_replaces(tmp_path, fresh_store):
    pdf = _write_pdf(tmp_path, "paper.pdf", "hello world this is a paper")
    fresh_store.add_pdf(pdf)

    changed = _write_pdf(tmp_path, "paper.pdf", "a completely different paper entirely")
    fresh_store.add_pdf(changed)

    assert fresh_store.encoder.doc_calls == 2  # re-encoded
    assert fresh_store.files.write_calls == 2  # replaced


def test_different_source_name_re_encodes(tmp_path, fresh_store):
    pdf_a = _write_pdf(tmp_path, "a.pdf", "same text")
    pdf_b = _write_pdf(tmp_path, "b.pdf", "same text")

    fresh_store.add_pdf(pdf_a)
    fresh_store.add_pdf(pdf_b)

    assert fresh_store.encoder.doc_calls == 2
    assert fresh_store.files.write_calls == 2


def test_search_with_source_returns_only_that_paper_ranked(tmp_path, fresh_store):
    for name, text in (("a.pdf", "alpha"), ("b.pdf", "beta")):
        _write_pdf(tmp_path, name, text)
        fresh_store.add_pdf(tmp_path / name)

    results = fresh_store.search("query", k=5, source="a.pdf")

    assert len(results) == 1
    assert results[0]["source"] == "a.pdf"
    assert results[0]["rank"] == 1


def test_search_without_source_ranks_across_papers(tmp_path, fresh_store):
    for name, text in (("a.pdf", "alpha"), ("b.pdf", "beta")):
        _write_pdf(tmp_path, name, text)
        fresh_store.add_pdf(tmp_path / name)

    results = fresh_store.search("query", k=5)

    assert {result["source"] for result in results} == {"a.pdf", "b.pdf"}
    assert [result["rank"] for result in results] == list(range(1, len(results) + 1))


def test_len_counts_papers(tmp_path, fresh_store):
    assert len(fresh_store) == 0
    _write_pdf(tmp_path, "a.pdf", "alpha")
    fresh_store.add_pdf(tmp_path / "a.pdf")
    assert len(fresh_store) == 1
