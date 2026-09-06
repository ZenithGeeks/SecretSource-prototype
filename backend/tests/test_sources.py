"""Resolving a cited work through Semantic Scholar: the calls queue, a 429 is waited out,
and giving up says what actually happened. No network: requests is a fake module, since
sources.py imports it lazily inside each function rather than at module level."""

import sys
import threading
import time

import pytest
from app.pipeline import sources


class Response:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"unexpected {self.status_code}")


def fake_requests(monkeypatch, get):
    """Install `get` as the module-level `requests.get` the next `import requests` will see."""
    monkeypatch.setitem(sys.modules, "requests", type("requests", (), {"get": staticmethod(get)}))


@pytest.fixture(autouse=True)
def fast_and_free(monkeypatch):
    """No real waiting and no real network, and the gate starts open."""
    monkeypatch.setattr(sources, "S2_MIN_INTERVAL", 0.05)
    monkeypatch.setattr(sources, "RETRY_WAITS", (0.01, 0.01, 0.01))
    monkeypatch.setattr(sources, "_s2_free_at", 0.0)


def test_calls_never_overlap(monkeypatch):
    """What the service refuses: two requests in flight. The client must not make them."""
    live = 0
    overlapped = False
    guard = threading.Lock()

    def get(url, params=None, headers=None, timeout=None):
        nonlocal live, overlapped
        with guard:
            live += 1
            overlapped = overlapped or live > 1
        time.sleep(0.05)  # a real call takes seconds; this is where an overlap would show
        with guard:
            live -= 1
        return Response(payload={"title": "T"})

    fake_requests(monkeypatch, get)

    threads = [threading.Thread(target=sources._semantic_scholar, args=("/x", {})) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not overlapped


def test_a_429_is_waited_out_then_answered(monkeypatch):
    statuses = [429, 429, 200]

    def get(url, params=None, headers=None, timeout=None):
        return Response(statuses.pop(0), {"title": "T"}, {"Retry-After": "0.01"})

    fake_requests(monkeypatch, get)
    assert sources._semantic_scholar("/x", {})["title"] == "T"
    assert not statuses  # all three attempts were used


def test_giving_up_names_the_real_reason(monkeypatch):
    fake_requests(monkeypatch, lambda url, params=None, headers=None, timeout=None: Response(429))

    monkeypatch.setattr(sources, "S2_API_KEY", "a-key")
    with pytest.raises(sources.LookupUnavailable) as with_key:
        sources._semantic_scholar("/x", {})
    assert "even with S2_API_KEY set" in str(with_key.value)

    monkeypatch.setattr(sources, "S2_API_KEY", "")
    with pytest.raises(sources.LookupUnavailable) as without_key:
        sources._semantic_scholar("/x", {})
    assert "set S2_API_KEY" in str(without_key.value)
