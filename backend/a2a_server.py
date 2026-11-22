"""The agent tree over A2A, so another agent can use it without importing this codebase.

    docker compose --profile a2a up -d a2a       # then http://localhost:8002
    python -m uvicorn a2a_server:app --port 8002 # or on the host

Serves the coordinator from app/agents/team.py. It gives an agent card at
/.well-known/agent-card.json that says what it can do. It also gives the JSON-RPC
endpoint that runs a task. It is the same tree `python backend/cli.py` talks to,
reached over the wire.

A2A_HOST and A2A_PORT are the address the card tells callers to use, not what the
server binds. A client that cannot reach the URL in the card cannot send the task.
From another compose service that is `a2a:8002`. From the host, it is `localhost:8002`.

Sessions are kept in Postgres when SESSION_DB_URL is set (app/sessions.py), so a caller's
conversation survives a restart.
"""

import os
from contextlib import asynccontextmanager

from app.agents.team import MAX_LLM_CALLS, root_agent
from app.memory import SIGNED_OUT, AnalysisMemory
from app.sessions import session_service
from app.tracing import setup_tracing
from google.adk.a2a.converters.request_converter import (
    AgentRunRequest,
    convert_a2a_request_to_agent_run_request,
)
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor
from google.adk.a2a.executor.config import A2aAgentExecutorConfig
from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.artifacts import InMemoryArtifactService
from google.adk.auth.credential_service.in_memory_credential_service import InMemoryCredentialService
from google.adk.runners import Runner

HOST = os.getenv("A2A_HOST", "localhost")
PORT = int(os.getenv("A2A_PORT", "8002"))


def signed_out_run(request, part_converter) -> AgentRunRequest:
    """ADK's run request for an A2A task, with a cap on model calls and no signed-in user.

    The paper tools read state["user"] to pick whose papers the caller may open
    (rag.caller_papers). A2A has no login, so the run sets it to None, signed out, on every turn.
    """
    run_request = convert_a2a_request_to_agent_run_request(request, part_converter)
    run_request.run_config.max_llm_calls = MAX_LLM_CALLS
    run_request.state_delta = {**(run_request.state_delta or {}), "user": None}
    return run_request


# The same services to_a2a builds by default, except sessions, which can be kept in Postgres,
# and memory, which reads the saved analyses (app/memory.py). A2A has no login, so memory reads
# only the analyses without an owner, whatever user id ADK gives the caller.
runner = Runner(
    agent=root_agent,
    app_name=root_agent.name,
    session_service=session_service(),
    artifact_service=InMemoryArtifactService(),
    memory_service=AnalysisMemory(as_user=SIGNED_OUT),
    credential_service=InMemoryCredentialService(),
)


@asynccontextmanager
async def lifespan(app):
    # At server start, not at import: the tests import this module before tracing is switched off.
    setup_tracing()
    yield


# A run that reaches MAX_LLM_CALLS raises in the runner, and the executor reports it to the caller
# as a failed task.
app = to_a2a(
    root_agent,
    host=HOST,
    port=PORT,
    runner=runner,
    lifespan=lifespan,
    agent_executor_factory=lambda runner: A2aAgentExecutor(
        runner=runner, config=A2aAgentExecutorConfig(request_converter=signed_out_run)
    ),
)
