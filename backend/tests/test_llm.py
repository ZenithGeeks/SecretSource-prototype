"""app.llm counts LLM calls that the gateway refuses with HTTP 429 (#511), and keeps the
number of requests in flight under the key's limit, for both clients.

The models talk to a local server, so each hook is tested inside its client's real request
path.
"""

import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from app import llm
from dspy.utils.exceptions import LMRateLimitError
from google.adk.models.llm_request import LlmRequest
from google.genai import types
from prometheus_client import REGISTRY


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
def refusing_gateway(monkeypatch):
    """Point app.llm at a local server that answers every request with 429."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), TooManyRequests)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(llm, "VLLM_URL", f"http://127.0.0.1:{server.server_port}/v1")
    yield
    server.shutdown()


def _rate_limited() -> float:
    return REGISTRY.get_sample_value("llm_rate_limited_total")


def test_dspy_call_refused_with_429_is_counted(refusing_gateway):
    # No retries, so the first 429 is final; no cache, so the call reaches the server.
    lm = llm.dspy_lm().copy(num_retries=0, cache=False)
    before = _rate_limited()

    with pytest.raises(LMRateLimitError):
        lm("hi")

    assert _rate_limited() == before + 1


def test_adk_call_refused_with_429_is_counted(refusing_gateway):
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


class SlowAnswer(BaseHTTPRequestHandler):
    """Answer each chat request after 0.3 s, and record the most requests open at once."""

    lock = threading.Lock()
    open_now = 0
    most_open = 0

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        with SlowAnswer.lock:
            SlowAnswer.open_now += 1
            SlowAnswer.most_open = max(SlowAnswer.most_open, SlowAnswer.open_now)
        time.sleep(0.3)
        with SlowAnswer.lock:
            SlowAnswer.open_now -= 1
        body = json.dumps(
            {
                "id": "answer-1",
                "object": "chat.completion",
                "created": 0,
                "model": "test",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }
        )
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass


@pytest.fixture
def slow_gateway(monkeypatch):
    """Point app.llm at a slow local server, with 2 request slots for the tests' 5 callers."""
    SlowAnswer.open_now = SlowAnswer.most_open = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), SlowAnswer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(llm, "VLLM_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setattr(llm, "_slots", threading.BoundedSemaphore(2))
    yield
    server.shutdown()


def test_dspy_calls_from_many_threads_wait_for_a_slot(slow_gateway):
    lm = llm.dspy_lm().copy(cache=False)

    with ThreadPoolExecutor(max_workers=5) as pool:
        answers = list(pool.map(lambda i: lm(f"question {i}"), range(5)))

    # A dspy.LM call returns one completion per choice, so each answer is a list.
    assert answers == [["ok"]] * 5
    assert SlowAnswer.most_open == 2


def test_adk_calls_on_one_event_loop_wait_for_a_slot(slow_gateway):
    model = llm.adk_model()

    async def ask(i: int) -> str:
        request = LlmRequest(
            model=model.model,
            contents=[types.Content(role="user", parts=[types.Part(text=f"question {i}")])],
        )
        async for response in model.generate_content_async(request):
            return response.content.parts[0].text

    async def ask_five():
        return await asyncio.gather(*(ask(i) for i in range(5)))

    assert asyncio.run(ask_five()) == ["ok"] * 5
    assert SlowAnswer.most_open == 2


def test_cancelled_wait_does_not_keep_a_slot(monkeypatch):
    monkeypatch.setattr(llm, "_slots", threading.BoundedSemaphore(1))

    async def wait_then_cancel():
        async def take_slot():
            async with llm._async_slot():
                pass

        llm._slots.acquire()
        waiting = asyncio.create_task(take_slot())
        await asyncio.sleep(0.1)  # long enough for the task to start polling
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        llm._slots.release()

    asyncio.run(wait_then_cancel())

    assert llm._slots.acquire(blocking=False)
