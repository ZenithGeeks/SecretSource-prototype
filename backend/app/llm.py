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


# Each framework gets its own hook. dspy 3.4 picks a client per request: LiteLLM for ours
# (extra_body), its own lm15 client for others, and a dspy callback sees both. The LiteLLM hook
# goes on each ADK request, because a global litellm.failure_callback means importing litellm
# here, which takes 3 s.
class CountRateLimits(BaseCallback):
    """Count dspy.LM calls that got HTTP 429 on every try."""

    def on_lm_end(self, call_id, outputs, exception=None):
        if isinstance(exception, LMRateLimitError):
            LLM_RATE_LIMITED.inc()


def count_adk_rate_limit(kwargs, completion_response, start_time, end_time):
    """Count LiteLLM calls that got HTTP 429 on every try."""
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
