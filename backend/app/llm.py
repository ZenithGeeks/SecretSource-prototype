"""One model behind two frameworks: ADK agents get a LiteLlm, DSPy programs get a dspy.LM.
Both speak OpenAI wire format, which is what vLLM serves."""

from google.adk.models.lite_llm import LiteLlm

from app.config import VLLM_API_KEY, VLLM_MODEL, VLLM_URL


def adk_model() -> LiteLlm:
    return LiteLlm(
        model=f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=0.3,
    )


def dspy_lm(temperature: float = 0.3, max_tokens: int = 2000):
    import dspy

    return dspy.LM(
        f"openai/{VLLM_MODEL}",
        api_base=VLLM_URL,
        api_key=VLLM_API_KEY,
        temperature=temperature,
        max_tokens=max_tokens,
    )
