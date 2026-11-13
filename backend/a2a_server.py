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

from app.agents.team import root_agent
from app.memory import SIGNED_OUT, AnalysisMemory
from app.sessions import session_service
from app.tracing import setup_tracing
from google.adk.a2a.utils.agent_to_a2a import to_a2a
from google.adk.artifacts import InMemoryArtifactService
from google.adk.auth.credential_service.in_memory_credential_service import InMemoryCredentialService
from google.adk.runners import Runner

HOST = os.getenv("A2A_HOST", "localhost")
PORT = int(os.getenv("A2A_PORT", "8002"))

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


app = to_a2a(root_agent, host=HOST, port=PORT, runner=runner, lifespan=lifespan)
