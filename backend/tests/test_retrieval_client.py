"""The retrieval client: one shared session with a single retry for a refused connection or a
502/503/504 (never a read timeout), ColPali uploads that raise on failure, and a ColPali
health answer remembered for HEALTH_TTL seconds."""

import threading
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
