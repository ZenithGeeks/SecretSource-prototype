"""_evidence and _visual pass the cited paper's name to the retrieval services as `source`,
so Qdrant filters server-side. They also keep the client-side source check as a guard: a
ColBERT/ColPali service that has not been redeployed yet ignores the unknown field and
returns global results, and those must still be dropped.
"""

from pathlib import Path

from app.pipeline import verify

SOURCE = "cited.pdf"
OTHER = "other.pdf"


def _passage(source):
    return {"source": source, "text": "some text", "page": 1, "start": 0, "end": 9, "score": 1.0}


def _hit(source):
    return {
        "source": source, "page": 1, "score": 0.5,
        "kind": "page", "label": "", "caption": "", "image": "",
    }


def test_evidence_passes_source_and_still_drops_other_sources(monkeypatch):
    calls = {}

    def colbert_search(claim, k, source=None):
        calls["source"] = source
        return [_passage(SOURCE), _passage(OTHER)]

    monkeypatch.setattr(verify.retrieval, "colbert_search", colbert_search)

    found = verify._evidence("some claim", SOURCE)

    assert calls["source"] == SOURCE
    assert len(found) == 1


def test_visual_passes_source_and_still_drops_other_sources(monkeypatch):
    calls = {}

    def colpali_search(claim, k, source=None):
        calls["source"] = source
        return {"topk": [_hit(SOURCE), _hit(OTHER)], "model": "colqwen"}

    monkeypatch.setattr(verify.retrieval, "colpali_available", lambda: True)
    monkeypatch.setattr(verify.retrieval, "colpali_search", colpali_search)

    found, model = verify._visual("some claim", Path(SOURCE))

    assert calls["source"] == SOURCE
    assert len(found) == 1
    assert model == "colqwen"
