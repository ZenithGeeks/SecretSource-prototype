"""One model behind two frameworks. ADK agents get a LiteLlm.
DSPy programs get a dspy.LM. Both use the OpenAI wire format,
which is what vLLM serves. Together they keep at most LLM_PARALLEL_REQUESTS requests
in flight in this process."""

import asyncio
import threading
import time
from contextlib import asynccontextmanager, contextmanager

import dspy
from dspy.utils.callback import BaseCallback
from dspy.utils.exceptions import LMRateLimitError
from google.adk.models.lite_llm import LiteLlm

from app.config import LLM_PARALLEL_REQUESTS, VLLM_API_KEY, VLLM_MODEL, VLLM_URL
from app.metrics import LLM_RATE_LIMITED, LLM_SLOT_WAIT_SECONDS

# One slot per request in flight, for every model in this process. dspy calls come from
# worker threads and ADK calls from the event loop, so this is a threading semaphore.
_slots = threading.BoundedSemaphore(LLM_PARALLEL_REQUESTS)


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
    """A dspy.LM that holds a request slot for each call, retries included."""

    def __call__(self, *args, **kwargs):
        with _slot():
            return super().__call__(*args, **kwargs)

    async def acall(self, *args, **kwargs):
        async with _async_slot():
            return await super().acall(*args, **kwargs)


class CappedLiteLlm(LiteLlm):
    """An ADK LiteLlm that holds a request slot for each model turn."""

    async def generate_content_async(self, llm_request, stream=False):
        # Held until the caller has read the last response, so a streamed turn keeps its slot.
        async with _async_slot():
            async for response in super().generate_content_async(llm_request, stream):
                yield response


# Qwen3 thinks before it answers unless told not to. The compose vLLM is started with
# `--default-chat-template-kwargs '{"enable_thinking": false}'`. A vLLM somewhere else
# may not be. Then the model spends its whole max_tokens budget on reasoning_content
# and returns content=None ("The LM returned an empty or null response." from DSPy).
# Asking per request works against both.
NO_THINKING = {"chat_template_kwargs": {"enable_thinking": False}}


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
