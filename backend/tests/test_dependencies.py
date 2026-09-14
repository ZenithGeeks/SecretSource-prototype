"""The dependency report: each service's URL, how calls to it are signed, and whether it answered.

No network: requests.get is a fake that answers by URL, and Google identity tokens are not made.
"""

import sys
import types

import pytest
from app import dependencies


class Response:
    def __init__(self, status_code=200, body=None, text=""):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._body = body
        self.text = text

    def json(self):
        if self._body is None:
            raise ValueError("no JSON")
        return self._body


@pytest.fixture
def services(monkeypatch):
    """Every dependency answers, until a test changes `answers` (URL prefix -> Response or error)."""
    answers = {
        "https://llm.example/v1/models": Response(200, {"data": [{"id": "qwen"}]}),
        "http://grobid:8070/api/isalive": Response(200),
        "http://colbert:8893/health": Response(200, {"ok": True}),
        "http://colpali:8894/health": Response(200, {"ok": True}),
        "https://project.supabase.co/auth/v1/health": Response(200, {}),
    }
    seen = []

    def get(url, headers=None, timeout=None):
        seen.append((url, headers))
        answer = answers.get(url)
        if answer is None:
            raise ConnectionError(f"cannot connect to {url}")
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setitem(sys.modules, "requests", types.SimpleNamespace(get=get))
    monkeypatch.setattr(dependencies, "VLLM_URL", "https://llm.example/v1")
    monkeypatch.setattr(dependencies, "VLLM_MODEL", "qwen")
    monkeypatch.setattr(dependencies, "VLLM_API_KEY", "sk-secret")
    monkeypatch.setattr(dependencies, "GROBID_URL", "http://grobid:8070")
    monkeypatch.setattr(dependencies, "COLBERT_URL", "http://colbert:8893")
    monkeypatch.setattr(dependencies, "COLPALI_URL", "http://colpali:8894")
    monkeypatch.setattr(dependencies, "auth_headers", lambda url: {})
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(dependencies, "_last", None)
    return types.SimpleNamespace(answers=answers, seen=seen)


def by_name(result):
    return {d["name"]: d for d in result["dependencies"]}


def test_every_dependency_answering_is_not_degraded(services):
    result = dependencies.check()
    assert not result["degraded"]
    assert {name: d["ok"] for name, d in by_name(result).items()} == {
        "llm": True,
        "grobid": True,
        "colbert": True,
        "colpali": True,
        "supabase": True,
    }


def test_a_wrong_colbert_url_shows_as_unreachable_and_degraded(services, monkeypatch):
    monkeypatch.setattr(dependencies, "COLBERT_URL", "http://colbret:8893")
    colbert = by_name(result := dependencies.check())["colbert"]
    assert result["degraded"]
    assert colbert["ok"] is False
    assert colbert["url"] == "http://colbret:8893"
    assert "cannot connect" in colbert["detail"]


def test_an_llm_that_does_not_serve_the_model_is_not_ok(services, monkeypatch):
    monkeypatch.setattr(dependencies, "VLLM_MODEL", "qwen-typo")
    llm = by_name(result := dependencies.check())["llm"]
    assert result["degraded"]
    assert llm["ok"] is False
    assert "qwen-typo" in llm["detail"]


def test_a_refusal_says_why_in_the_services_words(services):
    services.answers["http://grobid:8070/api/isalive"] = Response(
        500, text="<html>\n  Error: billing is disabled for this project\n</html>"
    )
    grobid = by_name(dependencies.check())["grobid"]
    assert grobid["ok"] is False
    assert grobid["detail"] == "HTTP 500: Error: billing is disabled for this project"


def test_colpali_down_is_reported_but_not_degraded(services):
    del services.answers["http://colpali:8894/health"]
    result = dependencies.check()
    assert by_name(result)["colpali"]["ok"] is False
    assert not result["degraded"]  # checks go on with text passages without it


def test_supabase_not_set_means_sqlite_not_a_failure(services, monkeypatch):
    monkeypatch.delenv("SUPABASE_URL")
    result = dependencies.check()
    supabase = by_name(result)["supabase"]
    assert supabase["ok"] is None and not supabase["required"]
    assert "SQLite" in supabase["detail"]
    assert not result["degraded"]


def test_no_secret_reaches_the_report(services, monkeypatch):
    monkeypatch.setattr(dependencies, "VLLM_URL", "https://user:hunter2@llm.example/v1?key=abc")
    services.answers["https://user:hunter2@llm.example/v1?key=abc/models"] = Response(
        200, {"data": [{"id": "qwen"}]}
    )
    text = str(dependencies.check())
    for secret in ("hunter2", "key=abc", "sk-secret", "service-role"):
        assert secret not in text
    assert by_name(dependencies.check())["llm"]["url"] == "https://llm.example/v1"


def test_report_reuses_a_recent_check(services):
    first = dependencies.report()
    calls = len(services.seen)
    assert dependencies.report() is first
    assert len(services.seen) == calls
    assert dependencies.report(max_age=0) is not first
