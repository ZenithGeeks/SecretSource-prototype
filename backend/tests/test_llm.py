"""app.llm counts LLM calls that the gateway refuses with HTTP 429 (#511), and keeps the
number of requests in flight under the key's limit, for both clients.

The models talk to a local server, so each hook is tested inside its client's real request
path.
"""

import asyncio
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from app import llm
from app.auth import acting_user
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
    # No waiting out the 429: these tests check what happens when it is final.
    monkeypatch.setattr(llm, "BUSY_RETRY_SECONDS", 0)
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


def test_each_call_records_how_long_it_waited_for_a_slot():
    def waits():
        return REGISTRY.get_sample_value("llm_slot_wait_seconds_count") or 0

    before = waits()
    with llm._slot():
        pass

    async def hold_async_slot():
        async with llm._async_slot():
            pass

    asyncio.run(hold_async_slot())
    assert waits() == before + 2


OK_ANSWER = {
    "id": "answer-1",
    "object": "chat.completion",
    "created": 0,
    "model": "test",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
}


class RecordedAnswer(BaseHTTPRequestHandler):
    """Answer each chat request with "ok", and keep the request bodies."""

    bodies: list[dict] = []

    def do_POST(self):
        RecordedAnswer.bodies.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(OK_ANSWER).encode())

    def log_message(self, *args):
        pass


@pytest.fixture
def recording_gateway(monkeypatch):
    """Point app.llm at a local server that records what each request sent."""
    RecordedAnswer.bodies = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), RecordedAnswer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(llm, "VLLM_URL", f"http://127.0.0.1:{server.server_port}/v1")
    yield RecordedAnswer.bodies
    server.shutdown()


@pytest.fixture
def as_user():
    """Act as a user for one test, then go back to nobody."""
    tokens = []
    yield lambda user: tokens.append(acting_user.set(user))
    for token in reversed(tokens):
        acting_user.reset(token)


def test_dspy_call_sends_the_acting_user(recording_gateway, as_user):
    as_user("user-a")

    llm.dspy_lm().copy(cache=False)("hi")

    assert recording_gateway[-1]["user"] == "user-a"


def test_call_for_nobody_sends_no_user(recording_gateway, as_user):
    as_user(None)

    llm.dspy_lm().copy(cache=False)("hi")

    assert "user" not in recording_gateway[-1]


def test_two_people_share_one_cached_answer(recording_gateway, as_user):
    # A new question each run, so the disk cache from an earlier run cannot answer it.
    question = f"cached question {uuid.uuid4()}"
    lm = llm.dspy_lm()

    as_user("user-a")
    lm(question)
    as_user("user-b")
    lm(question)

    assert len(recording_gateway) == 1


def test_adk_call_sends_the_acting_user(recording_gateway, as_user):
    as_user("user-a")
    model = llm.adk_model()
    request = LlmRequest(
        model=model.model, contents=[types.Content(role="user", parts=[types.Part(text="hi")])]
    )

    async def ask():
        async for _ in model.generate_content_async(request):
            pass

    asyncio.run(ask())

    assert recording_gateway[-1]["user"] == "user-a"


class BusyThenAnswer(BaseHTTPRequestHandler):
    """Refuse the first `busy` requests as the provider does when its slots are full, then answer."""

    busy = 0
    seen = 0

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        BusyThenAnswer.seen += 1
        if BusyThenAnswer.seen <= BusyThenAnswer.busy:
            status, body = 429, {"error": {"message": "No deployments available", "code": 429}}
        else:
            status, body = 200, OK_ANSWER
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def log_message(self, *args):
        pass


@pytest.fixture
def busy_gateway(monkeypatch):
    """A local server that is busy for the first few requests; waits are cut to milliseconds."""
    BusyThenAnswer.seen = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), BusyThenAnswer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(llm, "VLLM_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setattr(llm, "BUSY_WAITS", (0.01,))
    monkeypatch.setattr(llm.random, "uniform", lambda low, high: 0)
    yield BusyThenAnswer
    server.shutdown()


def test_dspy_call_waits_out_a_busy_provider(busy_gateway):
    busy_gateway.busy = 3
    lm = llm.dspy_lm().copy(num_retries=0, cache=False)

    assert lm("hi") == ["ok"]
    assert busy_gateway.seen == 4


def test_dspy_call_gives_up_when_the_provider_stays_busy(busy_gateway, monkeypatch):
    busy_gateway.busy = 1000
    monkeypatch.setattr(llm, "BUSY_RETRY_SECONDS", 0.05)
    lm = llm.dspy_lm().copy(num_retries=0, cache=False)

    with pytest.raises(LMRateLimitError):
        lm("hi")
    assert busy_gateway.seen > 1


def test_adk_turn_waits_out_a_busy_provider(busy_gateway):
    busy_gateway.busy = 2
    model = llm.adk_model()
    request = LlmRequest(
        model=model.model, contents=[types.Content(role="user", parts=[types.Part(text="hi")])]
    )

    async def ask():
        return [response async for response in model.generate_content_async(request)]

    responses = asyncio.run(ask())

    assert responses[-1].content.parts[0].text == "ok"
    assert busy_gateway.seen == 3


def test_a_wait_gives_the_slot_back(busy_gateway, monkeypatch):
    # One slot: the retry only gets through if the first try released it before waiting.
    monkeypatch.setattr(llm, "_slots", threading.BoundedSemaphore(1))
    busy_gateway.busy = 1
    lm = llm.dspy_lm().copy(num_retries=0, cache=False)

    assert lm("hi") == ["ok"]
    assert llm._slots.acquire(blocking=False)
