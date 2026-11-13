"""Send LLM traces to Arize Phoenix when PHOENIX_COLLECTOR_ENDPOINT is set.

Each DSPy call (the analysis pipeline) and each ADK agent run (the chat agents) becomes a span
with its prompt, answer, token counts and time. Open the Phoenix UI at the endpoint to read
them. The gateway, the worker, the A2A server, cli.py and the eval scripts call setup_tracing()
once at start. See backend/README.md#tracing.
"""

import logging

from app.config import PHOENIX_COLLECTOR_ENDPOINT, PHOENIX_PROJECT_NAME

logger = logging.getLogger(__name__)


def setup_tracing() -> bool:
    """Instrument DSPy and ADK and export their spans to Phoenix.

    Returns:
        True when tracing is on, False when PHOENIX_COLLECTOR_ENDPOINT is unset.
    """
    if not PHOENIX_COLLECTOR_ENDPOINT:
        return False
    # Imported here so a run without tracing never loads the OpenTelemetry exporter.
    from openinference.instrumentation.dspy import DSPyInstrumentor
    from openinference.instrumentation.google_adk import GoogleADKInstrumentor
    from opentelemetry.instrumentation.threading import ThreadingInstrumentor
    from phoenix.otel import register

    # register() reads PHOENIX_COLLECTOR_ENDPOINT (and PHOENIX_API_KEY for Phoenix Cloud) from
    # the environment. Left to itself it sends gRPC to port 4317; http/protobuf sends to
    # {endpoint}/v1/traces instead, the same port as the UI, which is all Phoenix Cloud and the
    # compose service expose. batch=True exports from a background thread, so an LLM call never
    # waits on Phoenix.
    tracer_provider = register(project_name=PHOENIX_PROJECT_NAME, protocol="http/protobuf", batch=True)
    DSPyInstrumentor().instrument(tracer_provider=tracer_provider)
    GoogleADKInstrumentor().instrument(tracer_provider=tracer_provider)
    # Claim extraction maps windows over a ThreadPoolExecutor (app/pipeline/claims.py), which
    # does not carry the trace into its threads. This instrumentor does, so those calls join the
    # analysis trace.
    ThreadingInstrumentor().instrument()
    logger.info("tracing to Phoenix at %s, project %r", PHOENIX_COLLECTOR_ENDPOINT, PHOENIX_PROJECT_NAME)
    return True
