"""app.llm counts LLM calls that the gateway refuses with HTTP 429 (#511), for both clients.

The models talk to a local server that answers every request with 429, so each hook is
tested inside its client's real request path.
"""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from app import llm
from app.metrics import LLM_RATE_LIMITED
from dspy.utils.exceptions import LMRateLimitError
from google.adk.models.llm_request import LlmRequest
from google.genai import types


class TooManyRequests(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        body = json.dumps({"error": {"message": "Rate limit exceeded for api_key", "code": 429}})
        self.send_response(429)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass


@pytest.fixture
def busy_gateway(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), TooManyRequests)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(llm, "VLLM_URL", f"http://127.0.0.1:{server.server_port}/v1")
    yield
    server.shutdown()


def _rate_limited() -> float:
    return next(s.value for s in LLM_RATE_LIMITED.collect()[0].samples if s.name.endswith("_total"))


def test_dspy_call_refused_with_429_is_counted(busy_gateway):
    lm = llm.dspy_lm().copy(num_retries=0, cache=False)
    before = _rate_limited()

    with pytest.raises(LMRateLimitError):
        lm("hi")

    assert _rate_limited() == before + 1


def test_adk_call_refused_with_429_is_counted(busy_gateway):
    model = llm.adk_model()
    request = LlmRequest(
        model=model.model, contents=[types.Content(role="user", parts=[types.Part(text="hi")])]
    )
    before = _rate_limited()

    async def ask():
        async for _ in model.generate_content_async(request):
            pass

    with pytest.raises(Exception, match="Rate limit exceeded"):
        asyncio.run(ask())

    assert _rate_limited() == before + 1


def test_other_dspy_errors_are_not_counted():
    before = _rate_limited()

    llm.CountRateLimits().on_lm_end("call-1", None, exception=ValueError("bad output"))

    assert _rate_limited() == before
