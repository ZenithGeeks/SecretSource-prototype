"""_grobid_pdf sends GROBID a PDF over Cloud Run's 32 MiB limit with its images at about 72 dpi,
and keys the cache on the original file, so a 34 MiB paper no longer stops with a 413."""

import hashlib
import os
import sys
import types

import pytest
from app.clients import cloud_run
from app.pipeline import claims


class _Response:
    status_code = 200
    text = "<TEI/>"

    def raise_for_status(self):
        pass


@pytest.fixture
def sent(monkeypatch):
    """The bytes of each PDF posted to GROBID, and the cache keys looked up. The cache always
    misses (list.append returns None), so every call posts."""
    bodies, keys = [], []

    def post(url, files=None, data=None, headers=None, timeout=None):
        bodies.append(files["input"])
        return _Response()

    # _grobid_pdf imports requests inside the function, so the fake module is what it gets
    monkeypatch.setitem(sys.modules, "requests", types.SimpleNamespace(post=post))
    monkeypatch.setattr("app.clients.service_auth.auth_headers", lambda url: {})
    monkeypatch.setattr(claims.store, "recall_cache", lambda key: keys.append(key))
    monkeypatch.setattr(claims.store, "remember_cache", lambda key, value: None)
    return bodies, keys


def _pdf_with_image(path):
    """A one-page PDF with a line of text and a 1200x1200 noise image in a 400 pt box (216 dpi)."""
    import pymupdf

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Qwen2-VL reads images at any resolution.")
    noise = pymupdf.Pixmap(pymupdf.csRGB, 1200, 1200, os.urandom(1200 * 1200 * 3), False)
    page.insert_image(pymupdf.Rect(72, 100, 472, 500), pixmap=noise)
    document.save(path)
    return path


def test_a_pdf_under_the_limit_is_sent_unchanged(sent, tmp_path):
    bodies, _ = sent
    pdf = _pdf_with_image(tmp_path / "2409.12191.pdf")

    claims._grobid_pdf("processFulltextDocument", str(pdf))

    assert bodies == [pdf.read_bytes()]


def test_a_pdf_over_the_limit_is_sent_with_its_images_resampled(sent, monkeypatch, tmp_path):
    import pymupdf

    bodies, keys = sent
    pdf = _pdf_with_image(tmp_path / "2409.12191.pdf")
    monkeypatch.setattr(cloud_run, "UPLOAD_LIMIT_BYTES", pdf.stat().st_size - 1)

    claims._grobid_pdf("processFulltextDocument", str(pdf), coordinates=("ref", "head"))

    (body,) = bodies
    assert len(body) < pdf.stat().st_size / 3
    with pymupdf.open(stream=body) as copy, pymupdf.open(pdf) as original:
        assert copy[0].get_text("words") == original[0].get_text("words")  # same text, same boxes
        # the image stays in its box, so GROBID still sees a figure there
        (image,) = copy[0].get_image_info()
        assert image["bbox"] == original[0].get_image_info()[0]["bbox"]
        assert 1 < image["width"] < 1200  # resampled, not deleted
    # the cache is keyed on the original, so the same upload is found again
    original_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
    assert keys == [claims.store.cache_key("grobid", "processFulltextDocument", "ref,head", original_hash)]
