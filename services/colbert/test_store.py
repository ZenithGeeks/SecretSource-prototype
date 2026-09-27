"""add_pdf's Qdrant-backed dedup: the same PDF content under the same source name skips the
encode-and-upsert entirely (the expensive part), while different content or a different source
name still goes through it, storing the new content hash for next time.

No real Qdrant or model: QdrantClient and Encoder are both monkeypatched at module level, the
same way the rest of this codebase fakes a lazily-imported client (see backend/tests/test_sources.py).
"""

import numpy as np
import pytest
import store


class FakePoint:
    def __init__(self, payload):
        self.payload = payload


class FakeCount:
    def __init__(self, count):
        self.count = count


class FakeQdrantClient:
    """One collection's worth of points, keyed by source. Enough of the real client's shape for
    Store to run: collection_exists/create_collection/create_payload_index are no-ops (the
    collection already "exists"), scroll/count/delete/upsert operate on the in-memory dict."""

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
    def __init__(self, device=None):
        self.doc_calls = 0

    def docs(self, texts):
        self.doc_calls += 1
        return [np.ones((1, 4), dtype=np.float32) for _ in texts]


@pytest.fixture
def fresh_store(monkeypatch):
    monkeypatch.setattr(store, "QdrantClient", FakeQdrantClient)
    monkeypatch.setattr(store, "Encoder", FakeEncoder)
    # add_pdf's dedup hashes the file's own bytes and only calls pdf_passages on a miss — real
    # PDF generation (and pypdf's parsing of it) is not what this test is about, so this fake
    # turns whatever bytes _write_pdf wrote into one passage carrying that same text.
    monkeypatch.setattr(
        store, "pdf_passages",
        lambda path: [{"text": path.read_text(), "page": 1, "start": 0, "end": len(path.read_text())}],
    )
    return store.Store()


def _write_pdf(tmp_path, name: str, text: str):
    """Not a real PDF — the fake pdf_passages above reads this file's raw text back out, so the
    dedup path under test (hash the bytes, decide whether to re-run pdf_passages+encode) never
    needs a real one."""
    path = tmp_path / name
    path.write_text(text)
    return path


def test_identical_content_skips_encoding_and_reuses_the_existing_points(tmp_path, fresh_store):
    pdf = _write_pdf(tmp_path, "paper.pdf", "hello world this is a paper")

    first = fresh_store.add_pdf(pdf)
    assert first > 0
    assert fresh_store.encoder.doc_calls == 1
    assert fresh_store.client.upsert_calls == 1

    again = fresh_store.add_pdf(pdf)
    assert again == first  # same count, read back from the existing points
    assert fresh_store.encoder.doc_calls == 1  # not called again
    assert fresh_store.client.upsert_calls == 1  # not re-upserted
    # One delete total, from the first (genuinely new) call — _delete_source runs unconditionally
    # before a real upsert even for a brand new source; the second call is a hit and never
    # reaches it, so the count does not grow.
    assert fresh_store.client.deletes == ["paper.pdf"]


def test_changed_content_under_the_same_name_re_encodes_and_replaces(tmp_path, fresh_store):
    pdf = _write_pdf(tmp_path, "paper.pdf", "hello world this is a paper")
    fresh_store.add_pdf(pdf)

    changed = _write_pdf(tmp_path, "paper.pdf", "a completely different paper entirely")
    fresh_store.add_pdf(changed)

    assert fresh_store.encoder.doc_calls == 2  # re-encoded
    assert fresh_store.client.deletes == ["paper.pdf", "paper.pdf"]  # old points replaced each time
