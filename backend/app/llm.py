"""One model behind two frameworks. ADK agents get a LiteLlm.
DSPy programs get a dspy.LM. Both use the OpenAI wire format,
which is what vLLM serves."""

import dspy
from dspy.utils.callback import BaseCallback
from dspy.utils.exceptions import LMRateLimitError
from google.adk.models.lite_llm import LiteLlm

from app.config import VLLM_API_KEY, VLLM_MODEL, VLLM_URL
from app.metrics import LLM_RATE_LIMITED

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


def adk_model() -> LiteLlm:
    return LiteLlm(
        model=f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=0.3,
        extra_body=NO_THINKING,
        failure_callback=[count_adk_rate_limit],
    )


def dspy_lm(temperature: float = 0.3, max_tokens: int = 2000):
    return dspy.LM(
        f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=NO_THINKING,
        callbacks=[CountRateLimits()],
    )
