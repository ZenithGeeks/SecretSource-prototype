"""One model behind two frameworks. ADK agents get a LiteLlm.
DSPy programs get a dspy.LM. Both use the OpenAI wire format,
which is what vLLM serves."""

from google.adk.models.lite_llm import LiteLlm

from app.config import VLLM_API_KEY, VLLM_MODEL, VLLM_URL

# Qwen3 thinks before it answers unless told not to. The compose vLLM is started with
# `--default-chat-template-kwargs '{"enable_thinking": false}'`. A vLLM somewhere else
# may not be. Then the model spends its whole max_tokens budget on reasoning_content
# and returns content=None ("The LM returned an empty or null response." from DSPy).
# Asking per request works against both.
NO_THINKING = {"chat_template_kwargs": {"enable_thinking": False}}


def adk_model() -> LiteLlm:
    return LiteLlm(
        model=f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=0.3,
        extra_body=NO_THINKING,
    )


def dspy_lm(temperature: float = 0.3, max_tokens: int = 2000):
    import dspy

    return dspy.LM(
        f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=NO_THINKING,
    )
