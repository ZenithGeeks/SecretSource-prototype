"""_grobid_pdf retries GROBID once on a timeout, a dropped connection or a 5xx, and never on a
4xx, so one GROBID hiccup no longer fails a whole analysis."""

import sys

import pytest
import requests
from app.pipeline import claims


class _Response:
    def __init__(self, status):
        self.status_code = status
        self.text = "<TEI/>"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")


@pytest.fixture
def grobid(monkeypatch, tmp_path):
    """Replays a scripted list of outcomes (an int is a status code, an exception is raised)."""
    outcomes, calls, sleeps = [], [], []

    def post(url, files=None, data=None, headers=None, timeout=None):
        calls.append(url)
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return _Response(outcome)

    fake = type("requests", (), {
        "post": staticmethod(post),
        "Timeout": requests.Timeout,
        "ConnectionError": requests.ConnectionError,
    })
    monkeypatch.setitem(sys.modules, "requests", fake)
    monkeypatch.setattr("app.clients.service_auth.auth_headers", lambda url: {})
    monkeypatch.setattr(claims.store, "recall_cache", lambda key: None)
    monkeypatch.setattr(claims.store, "remember_cache", lambda key, value: None)
    monkeypatch.setattr(claims.time, "sleep", sleeps.append)
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    return outcomes, calls, sleeps, str(pdf)


def test_a_timeout_then_success_returns_the_tei(grobid):
    outcomes, calls, sleeps, pdf = grobid
    outcomes += [requests.Timeout("slow"), 200]
    assert claims._grobid_pdf("processFulltextDocument", pdf).tag == "TEI"
    assert len(calls) == 2
    assert sleeps == [claims.GROBID_RETRY_PAUSE]


def test_a_busy_503_then_success_returns_the_tei(grobid):
    outcomes, calls, _, pdf = grobid
    outcomes += [503, 200]
    assert claims._grobid_pdf("processFulltextDocument", pdf).tag == "TEI"
    assert len(calls) == 2


def test_a_4xx_is_not_retried(grobid):
    outcomes, calls, sleeps, pdf = grobid
    outcomes += [400]
    with pytest.raises(requests.HTTPError):
        claims._grobid_pdf("processFulltextDocument", pdf)
    assert len(calls) == 1
    assert sleeps == []


def test_two_timeouts_still_fail(grobid):
    outcomes, calls, _, pdf = grobid
    outcomes += [requests.Timeout("slow"), requests.Timeout("slow again")]
    with pytest.raises(requests.Timeout):
        claims._grobid_pdf("processFulltextDocument", pdf)
    assert len(calls) == 2


def test_two_5xx_still_fail(grobid):
    outcomes, calls, _, pdf = grobid
    outcomes += [503, 502]
    with pytest.raises(requests.HTTPError):
        claims._grobid_pdf("processFulltextDocument", pdf)
    assert len(calls) == 2
