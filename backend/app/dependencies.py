"""Every service the gateway calls: where it is, how the call is signed, and whether it answers.

The gateway logs this once at startup, and `/health` returns it. A wrong URL then shows before
an analysis fails on it minutes later. Each check is one short GET that changes nothing.

    python -m app.dependencies
"""

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple
from urllib.parse import urlsplit

from app.clients.service_auth import auth_headers, sends_key
from app.config import (
    ANALYSES_DB,
    COLBERT_URL,
    COLPALI_URL,
    GROBID_URL,
    REDIS_URL,
    SERVICE_AUTH,
    VLLM_API_KEY,
    VLLM_MODEL,
    VLLM_URL,
)
from app.queue import ping as redis_ping
from app.queue import worker_status

TIMEOUT = 5  # seconds per check; a service slower than this to say it is alive is a problem too
CACHE_SECONDS = 30  # /health answers from the last report this recent, so polling it stays cheap

# What each feature the web app offers needs. An analysis runs on the worker, which reads the
# paper with GROBID and checks it with ColBERT and the LLM; Ask runs in the gateway itself.
# Each name is a dependency's "name" in check() below.
FEATURE_NEEDS = {
    "analyses": ("worker", "grobid", "colbert", "llm"),
    "ask": ("colbert", "llm"),
}

# uvicorn sets up this logger at INFO; the app configures no logging of its own.
log = logging.getLogger("uvicorn.error")


def _shown(url: str) -> str:
    """The URL without a password or query string, safe to log and to return from /health."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{host}{port}{parts.path}" if parts.scheme else url


def _signed(url: str) -> str:
    return "api key" if sends_key(url) else "none"


class Answer(NamedTuple):
    """What one GET found: whether it answered 2xx, a short description, and the JSON body."""

    ok: bool
    detail: str
    body: object = None
    timed_out: bool = False  # connected, but no answer within TIMEOUT


def _get(url: str, headers: dict) -> Answer:
    """GET url and describe the answer, or the reason there was none."""
    import requests

    try:
        response = requests.get(url, headers=headers, timeout=TIMEOUT)
    except requests.ReadTimeout:
        return Answer(False, f"no answer in {TIMEOUT} s", timed_out=True)
    except Exception as error:  # the reason, not a traceback: this goes in a log line and JSON
        return Answer(False, f"{type(error).__name__}: {str(error)[:200]}")
    try:
        body = response.json()
    except ValueError:
        body = None
    detail = f"HTTP {response.status_code}"
    if not response.ok:
        # Why it refused, in the service's words: a bare 500 does not say "billing is disabled".
        # A proxy's error page is HTML, so the tags go first.
        detail += f": {' '.join(re.sub(r'<[^>]*>', ' ', response.text).split())[:160]}"
    return Answer(response.ok, detail, body)


def _llm() -> dict:
    headers = {"Authorization": f"Bearer {VLLM_API_KEY}"} if VLLM_API_KEY != "EMPTY" else {}
    ok, detail, body, _ = _get(f"{VLLM_URL.rstrip('/')}/models", headers)
    if ok:
        models = [model.get("id") for model in (body or {}).get("data", []) if isinstance(model, dict)]
        if VLLM_MODEL not in models:
            # It answers, but every call would fail: the model name is wrong.
            ok, detail = False, f"VLLM_MODEL {VLLM_MODEL!r} is not in /models: {models[:5]}"
    return {
        "name": "llm",
        "url": _shown(VLLM_URL),
        "auth": "api key" if headers else "none",
        "required": True,
        "ok": ok,
        "detail": detail,
    }


def _service(name: str, url: str, path: str, required: bool) -> dict:
    target = f"{url.rstrip('/')}{path}"
    try:
        headers = auth_headers(target)
    except Exception as error:  # google-auth could not make a token, so every call would fail
        return {
            "name": name,
            "url": _shown(url),
            "auth": _signed(url),
            "required": required,
            "ok": False,
            "detail": f"no identity token: {type(error).__name__}: {str(error)[:200]}",
        }
    answer = _get(target, headers)
    ok, detail = answer.ok, answer.detail
    return {
        "name": name,
        "url": _shown(url),
        "auth": _signed(url),
        "required": required,
        "ok": ok,
        "detail": detail,
    }


def _supabase() -> dict:
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not (url and key):
        return {
            "name": "supabase",
            "url": "",
            "auth": "none",
            "required": False,
            "ok": None,
            "detail": f"not set: analyses are stored in SQLite at {ANALYSES_DB}, and login is off",
        }
    ok, detail, _, _ = _get(f"{url.rstrip('/')}/auth/v1/health", {"apikey": key})
    return {
        "name": "supabase",
        "url": _shown(url),
        "auth": "service role key",
        "required": True,
        "ok": ok,
        "detail": detail,
    }


def _redis_auth() -> str:
    return "url password" if urlsplit(REDIS_URL).password else "none"


def _redis() -> dict:
    ok, detail = redis_ping()
    return {
        "name": "redis",
        "url": _shown(REDIS_URL),
        "auth": _redis_auth(),
        "required": True,
        "ok": ok,
        "detail": detail,
    }


def _worker() -> dict:
    ok, detail = worker_status()
    return {
        "name": "worker",
        "url": _shown(REDIS_URL),
        "auth": _redis_auth(),
        "required": True,
        "ok": ok,
        "detail": detail,
    }


def _not_probed(name: str, url: str) -> dict:
    """A GPU service that scales to zero. Asking it every minute would keep it up around
    the clock. The pipeline still asks it before each use (retrieval.colpali_available)."""
    return {
        "name": name,
        "url": _shown(url),
        "auth": _signed(url),
        "required": False,
        "ok": None,
        "detail": "not probed: a GPU service that scales to zero, and asking would keep it up",
    }


def check() -> dict:
    """Ask every dependency at once. `degraded` is true when a required one failed, and
    `features` says which features have everything they need. One that is still starting
    (`ok` None) does not count as failed."""
    checks = (
        _llm,
        lambda: _service("grobid", GROBID_URL, "/api/isalive", required=True),
        lambda: _service("colbert", COLBERT_URL, "/health", required=True),
        # Figures are optional, and ColPali is not asked: see _not_probed.
        lambda: _not_probed("colpali", COLPALI_URL),
        _supabase,
        _redis,
        _worker,
    )
    with ThreadPoolExecutor(max_workers=len(checks)) as pool:
        dependencies = list(pool.map(lambda run: run(), checks))
    down = {d["name"] for d in dependencies if d["ok"] is False}
    # A feature is on when none of the dependencies it needs is down.
    return {
        "degraded": any(d["required"] and d["ok"] is False for d in dependencies),
        "features": {feature: down.isdisjoint(needs) for feature, needs in FEATURE_NEEDS.items()},
        "service_auth": SERVICE_AUTH,
        "checked_at": time.time(),
        "dependencies": dependencies,
    }


_last: dict | None = None


def report(max_age: float = CACHE_SECONDS) -> dict:
    """The last check if it is newer than max_age seconds, otherwise a new one."""
    global _last
    if _last is None or time.time() - _last["checked_at"] >= max_age:
        _last = check()
    return _last


def log_report() -> dict:
    """Check every dependency and log one line each, so a wrong setting is in the startup log."""
    result = report(max_age=0)
    for d in result["dependencies"]:
        state = "ok" if d["ok"] else "UNREACHABLE" if d["ok"] is False else "-"
        level = logging.WARNING if d["ok"] is False and d["required"] else logging.INFO
        log.log(
            level, "%-8s %-11s %s (auth: %s) %s", d["name"], state, d["url"] or "-", d["auth"], d["detail"]
        )
    if result["degraded"]:
        log.warning("a required dependency did not answer; analyses will fail until it does")
    return result


if __name__ == "__main__":
    import json

    print(json.dumps(check(), indent=2))
