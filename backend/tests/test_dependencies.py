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


class ReadTimeout(OSError):
    """Stands in for requests.ReadTimeout: connected, but no answer in time."""


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

    monkeypatch.setitem(sys.modules, "requests", types.SimpleNamespace(get=get, ReadTimeout=ReadTimeout))
    monkeypatch.setattr(dependencies, "VLLM_URL", "https://llm.example/v1")
    monkeypatch.setattr(dependencies, "VLLM_MODEL", "qwen")
    monkeypatch.setattr(dependencies, "VLLM_API_KEY", "sk-secret")
    monkeypatch.setattr(dependencies, "GROBID_URL", "http://grobid:8070")
    monkeypatch.setattr(dependencies, "COLBERT_URL", "http://colbert:8893")
    monkeypatch.setattr(dependencies, "COLPALI_URL", "http://colpali:8894")
    monkeypatch.setattr(dependencies, "auth_headers", lambda url: {})
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setattr(dependencies, "REDIS_URL", "redis://default:hunter2@redis:6379/0")
    monkeypatch.setattr(dependencies, "redis_ping", lambda: (True, "PONG"))
    monkeypatch.setattr(dependencies, "worker_status", lambda: (True, "1 worker, 0 waiting"))
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
        "colpali": None,  # not probed, see test_colpali_is_never_asked
        "supabase": True,
        "redis": True,
        "worker": True,
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


def test_a_cloud_run_service_still_starting_is_not_degraded(services, monkeypatch):
    # GROBID and ColBERT on Cloud Run scale to zero, and the first GET wakes them.
    services.answers["http://colbert:8893/health"] = ReadTimeout("read timed out")
    monkeypatch.setattr(dependencies, "signs", lambda url: True)

    result = dependencies.check()

    colbert = by_name(result)["colbert"]
    assert colbert["ok"] is None
    assert colbert["detail"].startswith("starting: no answer in 5 s")
    assert not result["degraded"]


def test_a_local_service_that_times_out_is_unreachable(services):
    services.answers["http://colbert:8893/health"] = ReadTimeout("read timed out")

    result = dependencies.check()

    assert by_name(result)["colbert"]["ok"] is False
    assert result["degraded"]


def test_a_refusal_says_why_in_the_services_words(services):
    services.answers["http://grobid:8070/api/isalive"] = Response(
        500, text="<html>\n  Error: billing is disabled for this project\n</html>"
    )
    grobid = by_name(dependencies.check())["grobid"]
    assert grobid["ok"] is False
    assert grobid["detail"] == "HTTP 500: Error: billing is disabled for this project"


def test_colpali_is_never_asked(services):
    """Asking a scale-to-zero GPU service on every /health kept it billed around the clock."""
    result = dependencies.check()
    colpali = by_name(result)["colpali"]
    assert colpali["ok"] is None and not colpali["required"]
    assert colpali["url"] == "http://colpali:8894"
    assert not any("colpali" in url for url, _ in services.seen)
    assert not result["degraded"]


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


def test_redis_down_makes_redis_and_worker_not_ok_and_degraded(services, monkeypatch):
    monkeypatch.setattr(dependencies, "redis_ping", lambda: (False, "ConnectionError: refused"))
    monkeypatch.setattr(
        dependencies, "worker_status", lambda: (False, "redis unreachable: ConnectionError: refused")
    )
    result = dependencies.check()
    named = by_name(result)
    assert result["degraded"]
    assert named["redis"]["ok"] is False
    assert named["worker"]["ok"] is False
    assert "redis" in named["worker"]["detail"].lower()


def test_redis_up_but_no_worker_is_not_ok_and_degraded(services, monkeypatch):
    monkeypatch.setattr(dependencies, "worker_status", lambda: (False, "0 workers, 2 waiting"))
    result = dependencies.check()
    named = by_name(result)
    assert result["degraded"]
    assert named["redis"]["ok"] is True
    assert named["worker"]["ok"] is False
    assert "0 workers" in named["worker"]["detail"]


def test_worker_detail_mentions_worker_count_and_waiting_jobs(services, monkeypatch):
    monkeypatch.setattr(dependencies, "worker_status", lambda: (True, "1 worker, 3 waiting"))
    worker = by_name(dependencies.check())["worker"]
    assert worker["ok"] is True
    assert "1 worker" in worker["detail"]
    assert "3 waiting" in worker["detail"]


def test_every_dependency_answering_turns_every_feature_on(services):
    assert dependencies.check()["features"] == {"analyses": True, "ask": True}


def test_no_worker_turns_off_analyses_but_not_ask(services, monkeypatch):
    monkeypatch.setattr(dependencies, "worker_status", lambda: (False, "0 workers, 2 waiting"))
    assert dependencies.check()["features"] == {"analyses": False, "ask": True}


def test_colbert_down_turns_off_analyses_and_ask(services, monkeypatch):
    monkeypatch.setattr(dependencies, "COLBERT_URL", "http://colbret:8893")
    assert dependencies.check()["features"] == {"analyses": False, "ask": False}


def test_redis_password_never_reaches_the_report(services):
    result = dependencies.check()
    named = by_name(result)
    text = str(result)
    assert "hunter2" not in text
    assert named["redis"]["url"] == "redis://redis:6379/0"
    assert named["worker"]["url"] == "redis://redis:6379/0"


def test_report_reuses_a_recent_check(services):
    first = dependencies.report()
    calls = len(services.seen)
    assert dependencies.report() is first
    assert len(services.seen) == calls
    assert dependencies.report(max_age=0) is not first
