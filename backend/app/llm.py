"""One model behind two frameworks. ADK agents get a LiteLlm.
DSPy programs get a dspy.LM. Both use the OpenAI wire format,
which is what vLLM serves. Together they keep at most LLM_PARALLEL_REQUESTS requests
in flight in this process, and wait out a busy provider instead of failing."""

import asyncio
import itertools
import random
import threading
import time
from contextlib import asynccontextmanager, contextmanager

import dspy
from dspy.clients.cache import Cache
from dspy.utils.callback import BaseCallback
from dspy.utils.exceptions import LMRateLimitError
from google.adk.models.lite_llm import LiteLlm, LiteLLMClient

from app.auth import acting_user
from app.config import LLM_BUSY_RETRY_SECONDS, LLM_PARALLEL_REQUESTS, VLLM_API_KEY, VLLM_MODEL, VLLM_URL
from app.metrics import LLM_RATE_LIMITED, LLM_SLOT_WAIT_SECONDS

# One slot per request in flight, for every model in this process. dspy calls come from
# worker threads and ADK calls from the event loop, so this is a threading semaphore.
_slots = threading.BoundedSemaphore(LLM_PARALLEL_REQUESTS)

# HTTP statuses that mean "try again later": the provider's parallel slots are full (429), or
# it has no route to the model right now (503). Waits between tries, then 30 s each.
BUSY_STATUSES = {429, 503}
BUSY_WAITS = (5, 10, 20, 30)
BUSY_RETRY_SECONDS = LLM_BUSY_RETRY_SECONDS


def _busy_wait(error: Exception, attempt: int, waited: float) -> float | None:
    """Seconds to wait before trying again after `error`, or None to give up.

    dspy raises a DSPyError with `.status`; LiteLLM's errors carry `.status_code`.
    """
    status = getattr(error, "status", None) or getattr(error, "status_code", None)
    left = BUSY_RETRY_SECONDS - waited
    if status not in BUSY_STATUSES or left <= 0:
        return None
    # A little jitter, so calls refused together do not all come back together.
    wait = BUSY_WAITS[min(attempt, len(BUSY_WAITS) - 1)] + random.uniform(0, 2)
    return min(wait, left)


_dspy_cache_key = Cache.cache_key


def _cache_key_without_user(self, request: dict, ignored_args_for_cache_key=None) -> str:
    """dspy's cache key without the user in extra_body, so people share cached answers."""
    extra_body = request.get("extra_body")
    if isinstance(extra_body, dict) and "user" in extra_body:
        rest = {key: value for key, value in extra_body.items() if key != "user"}
        request = {**request, "extra_body": rest}
    return _dspy_cache_key(self, request, ignored_args_for_cache_key)


# dspy keys its cache on the whole request, and its ignore list only covers top-level fields.
# test_two_people_share_one_cached_answer fails if a dspy upgrade moves the field.
Cache.cache_key = _cache_key_without_user


@contextmanager
def _slot():
    """Hold a request slot, blocking this thread until one is free."""
    started = time.perf_counter()
    with _slots:
        LLM_SLOT_WAIT_SECONDS.observe(time.perf_counter() - started)
        yield


@asynccontextmanager
async def _async_slot():
    """Hold a request slot without blocking the event loop."""
    started = time.perf_counter()
    # Polling, not asyncio.to_thread(_slots.acquire): a cancelled to_thread call still takes
    # the slot in its thread, and nothing gives it back.
    while not _slots.acquire(blocking=False):
        await asyncio.sleep(0.05)
    LLM_SLOT_WAIT_SECONDS.observe(time.perf_counter() - started)
    try:
        yield
    finally:
        _slots.release()


class CappedLM(dspy.LM):
    """A dspy.LM that holds a request slot for each call, and retries while the provider is busy.

    The slot is given back during each wait, so a call waiting out a 429 does not block the others.
    """

    def __call__(self, *args, **kwargs):
        kwargs = self._with_user(kwargs)
        waited = 0.0
        for attempt in itertools.count():
            try:
                with _slot():
                    return super().__call__(*args, **kwargs)
            except Exception as error:
                wait = _busy_wait(error, attempt, waited)
                if wait is None:
                    raise
            time.sleep(wait)
            waited += wait

    async def acall(self, *args, **kwargs):
        kwargs = self._with_user(kwargs)
        waited = 0.0
        for attempt in itertools.count():
            try:
                async with _async_slot():
                    return await super().acall(*args, **kwargs)
            except Exception as error:
                wait = _busy_wait(error, attempt, waited)
                if wait is None:
                    raise
            await asyncio.sleep(wait)
            waited += wait

    def _with_user(self, kwargs: dict) -> dict:
        """Send the acting user as `user`, the OpenAI field LiteLLM counts usage per person by."""
        user = acting_user.get()
        if not user:
            return kwargs
        # dspy's own lm15 client drops a top-level `user`, but sends what is in extra_body.
        # A call's extra_body replaces the LM's, so both are merged here.
        extra_body = {**self.kwargs.get("extra_body", {}), **kwargs.get("extra_body", {})}
        return {**kwargs, "extra_body": {**extra_body, "user": user}}


class UserLiteLLMClient(LiteLLMClient):
    """ADK's LiteLLM client, sending the acting user as `user` with each request."""

    async def acompletion(self, model, messages, tools, **kwargs):
        user = acting_user.get()
        if user:
            # LiteLLM drops a top-level `user` for an openai/ model on our api_base.
            kwargs = {**kwargs, "extra_body": {**kwargs.get("extra_body", {}), "user": user}}
        return await super().acompletion(model, messages, tools, **kwargs)


class CappedLiteLlm(LiteLlm):
    """An ADK LiteLlm that holds a request slot for each model turn, and retries a turn the
    provider refused as busy before any of it reached the caller."""

    async def generate_content_async(self, llm_request, stream=False):
        waited = 0.0
        for attempt in itertools.count():
            sent = False
            try:
                # Held until the caller has read the last response, so a streamed turn keeps its slot.
                async with _async_slot():
                    async for response in super().generate_content_async(llm_request, stream):
                        sent = True
                        yield response
                return
            except Exception as error:
                # Part of a reply already went out: a retry would send it twice.
                wait = None if sent else _busy_wait(error, attempt, waited)
                if wait is None:
                    raise
            await asyncio.sleep(wait)
            waited += wait


# Qwen3 thinks before it answers unless told not to. The compose vLLM is started with
# `--default-chat-template-kwargs '{"enable_thinking": false}'`. A vLLM somewhere else
# may not be. Then the model spends its whole max_tokens budget on reasoning_content
# and returns content=None ("The LM returned an empty or null response." from DSPy).
# Asking per request works against both.
def no_thinking(model: str) -> dict:
    """The request fields that turn thinking off for `model`: only Qwen's chat template reads
    them, and gpt-oss behind the gateway rejects the field with HTTP 400 (#978)."""
    return {"chat_template_kwargs": {"enable_thinking": False}} if model.startswith("qwen") else {}


NO_THINKING = no_thinking(VLLM_MODEL)


# A dspy callback, not a LiteLLM one: dspy 3.4 sends some requests through LiteLLM and some
# through its own lm15 client, and on_lm_end runs for both, once dspy has stopped retrying.
class CountRateLimits(BaseCallback):
    """Count dspy.LM calls that still got HTTP 429 after dspy's retries."""

    def on_lm_end(self, call_id, outputs, exception=None):
        if isinstance(exception, LMRateLimitError):
            LLM_RATE_LIMITED.inc()


# A LiteLLM failure_callback, passed on each ADK request: setting the global
# litellm.failure_callback here would import litellm at startup, which takes 3 s.
def count_adk_rate_limit(kwargs, completion_response, start_time, end_time):
    """Count LiteLLM calls that still got HTTP 429 after the OpenAI client's retries."""
    if getattr(kwargs.get("exception"), "status_code", None) == 429:
        LLM_RATE_LIMITED.inc()


def adk_model() -> CappedLiteLlm:
    """The vLLM model for ADK agents, with thinking off and the shared request limit."""
    return CappedLiteLlm(
        model=f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=0.3,
        extra_body=NO_THINKING,
        failure_callback=[count_adk_rate_limit],
        llm_client=UserLiteLLMClient(),
    )


def dspy_lm(temperature: float = 0.3, max_tokens: int = 2000) -> CappedLM:
    """The vLLM model for DSPy programs, with thinking off and the shared request limit."""
    return CappedLM(
        f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=NO_THINKING,
        callbacks=[CountRateLimits()],
    )
