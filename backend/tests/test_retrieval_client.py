"""The retrieval client: one shared session with a single retry for a refused connection or a
502/503/504 (never a read timeout), ColPali uploads that raise on failure, and a ColPali
health answer remembered for HEALTH_TTL seconds."""

import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests
from app.clients import retrieval


def test_retry_policy_is_one_retry_for_transient_failures_only():
    retry = retrieval._session.get_adapter("https://colbert.example").max_retries
    assert retry.total == 1 and retry.connect == 1 and retry.status == 1
    assert retry.read == 0  # a slow upload is never sent twice
    assert set(retry.status_forcelist) == {502, 503, 504}
    assert "POST" in retry.allowed_methods  # urllib3 skips POST unless told


class _Response:
    def __init__(self, status):
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))


def test_a_failed_colpali_upload_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(retrieval, "auth_headers", lambda url: {})
    monkeypatch.setattr(retrieval._session, "post", lambda *args, **kwargs: _Response(500))
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    with pytest.raises(requests.HTTPError):
        retrieval.colpali_add_pdf(str(pdf))
    image = tmp_path / "fig.png"
    image.write_bytes(b"png")
    with pytest.raises(requests.HTTPError):
        retrieval.colpali_add_figures("paper.pdf", "paper", [{"image": str(image)}])


def test_colpali_health_is_asked_once_per_ttl(monkeypatch):
    monkeypatch.setattr(retrieval, "auth_headers", lambda url: {})
    monkeypatch.setattr(retrieval, "_health", {"at": float("-inf"), "ok": False})
    now = [1000.0]
    monkeypatch.setattr(retrieval.time, "monotonic", lambda: now[0])
    asked = []
    monkeypatch.setattr(retrieval._session, "get", lambda *args, **kwargs: asked.append(1) or _Response(200))

    assert retrieval.colpali_available() is True
    assert retrieval.colpali_available() is True
    assert len(asked) == 1  # the second answer came from memory
    now[0] += retrieval.HEALTH_TTL + 1
    assert retrieval.colpali_available() is True
    assert len(asked) == 2  # asked again once the answer expired


def test_colpali_being_down_is_remembered_too(monkeypatch):
    monkeypatch.setattr(retrieval, "auth_headers", lambda url: {})
    monkeypatch.setattr(retrieval, "_health", {"at": float("-inf"), "ok": False})
    monkeypatch.setattr(retrieval.time, "monotonic", lambda: 5000.0)
    asked = []

    def down(*args, **kwargs):
        asked.append(1)
        raise requests.ConnectionError("refused")

    monkeypatch.setattr(retrieval._session, "get", down)
    assert retrieval.colpali_available() is False
    assert retrieval.colpali_available() is False
    assert len(asked) == 1


def _serve(statuses):
    """A local server that answers each POST with the next status in `statuses`."""
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            seen.append(self.path)
            self.send_response(statuses.pop(0))
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, seen


def test_a_503_upload_is_resent_once_and_succeeds():
    server, seen = _serve([503, 200])
    try:
        url = f"http://127.0.0.1:{server.server_port}/api/upload"
        response = retrieval._session.post(url, files={"file": ("p.pdf", b"%PDF-1.4 body")}, timeout=10)
    finally:
        server.shutdown()
    assert response.status_code == 200
    assert len(seen) == 2


def test_a_400_is_sent_only_once():
    server, seen = _serve([400])
    try:
        url = f"http://127.0.0.1:{server.server_port}/api/search"
        response = retrieval._session.post(url, json={"query": "q"}, timeout=10)
    finally:
        server.shutdown()
    assert response.status_code == 400
    assert len(seen) == 1


def _pdf_with_image(path):
    """A one-page PDF with a line of text and a 400x400 noise image."""
    import os

    import pymupdf

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Late interaction scores every query token.")
    noise = pymupdf.Pixmap(pymupdf.csRGB, 400, 400, os.urandom(400 * 400 * 3), False)
    page.insert_image(pymupdf.Rect(72, 100, 472, 500), pixmap=noise)
    document.save(path)
    return path


def _uploaded(monkeypatch):
    """Replace the session's POST, keeping each upload's file name and bytes."""
    sent = []

    def post(url, files, **kwargs):
        name, handle, _ = files["file"]
        sent.append((name, handle.read()))
        return types.SimpleNamespace(ok=True, json=lambda: {"added": 1, "papers": 1})

    monkeypatch.setattr(retrieval, "auth_headers", lambda url: {})
    monkeypatch.setattr(retrieval._session, "post", post)
    return sent


def test_a_pdf_under_the_limit_is_uploaded_as_it_is(monkeypatch, tmp_path):
    sent = _uploaded(monkeypatch)
    pdf = _pdf_with_image(tmp_path / "2112.01488.pdf")

    assert retrieval.colbert_add(str(pdf))["status"] == "ok"

    assert sent == [("2112.01488.pdf", pdf.read_bytes())]


def test_a_pdf_over_the_limit_is_uploaded_without_its_images(monkeypatch, tmp_path):
    import pymupdf

    sent = _uploaded(monkeypatch)
    pdf = _pdf_with_image(tmp_path / "2312.02139.pdf")
    monkeypatch.setattr(retrieval, "UPLOAD_LIMIT_BYTES", pdf.stat().st_size - 1)

    assert retrieval.colbert_add(str(pdf))["status"] == "ok"

    ((name, content),) = sent
    assert name == "2312.02139.pdf"  # the passages keep their source name
    assert len(content) < pdf.stat().st_size / 10
    with pymupdf.open(stream=content) as copy, pymupdf.open(pdf) as original:
        assert copy[0].get_text() == original[0].get_text()
        # delete_image leaves a 1x1 blank in each image's place
        assert {image[2:4] for image in copy[0].get_images(full=True)} == {(1, 1)}
