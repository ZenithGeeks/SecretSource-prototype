"""One model behind two frameworks: ADK agents get a LiteLlm, DSPy programs get a dspy.LM.
Both speak OpenAI wire format, which is what vLLM serves. A provider-prefixed VLLM_MODEL
such as vertex_ai/gemini-2.5-flash (deploy/cloudrun.sh MODEL=vertex) is routed by LiteLLM
itself and uses application-default credentials, so no endpoint or key is passed."""

from google.adk.models.lite_llm import LiteLlm

from app.config import VLLM_API_KEY, VLLM_MODEL, VLLM_URL


def _endpoint() -> dict:
    if "/" in VLLM_MODEL:
        return {"model": VLLM_MODEL}
    return {"model": f"openai/{VLLM_MODEL}", "api_base": VLLM_URL, "api_key": VLLM_API_KEY}


def adk_model() -> LiteLlm:
    return LiteLlm(temperature=0.3, **_endpoint())


def dspy_lm(temperature: float = 0.3, max_tokens: int = 2000):
    import dspy

    return dspy.LM(temperature=temperature, max_tokens=max_tokens, **_endpoint())
