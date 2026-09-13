"""The agent tree over A2A, so another agent can use it without importing this codebase.

    docker compose --profile a2a up -d a2a       # then http://localhost:8002
    python -m uvicorn a2a_server:app --port 8002 # or on the host

Serves the coordinator from app/agents/team.py: an agent card at
/.well-known/agent-card.json describing what it can do, and the JSON-RPC endpoint that
runs a task. The same tree `python backend/cli.py` talks to, reached over the wire.

A2A_HOST and A2A_PORT are the address the card advertises back to callers, not what the
server binds. A client that cannot reach the URL in the card cannot send the task. From
another compose service that is `a2a:8002`; from the host, `localhost:8002`.
"""

import os

from app.agents.team import root_agent
from google.adk.a2a.utils.agent_to_a2a import to_a2a

HOST = os.getenv("A2A_HOST", "localhost")
PORT = int(os.getenv("A2A_PORT", "8002"))

app = to_a2a(root_agent, host=HOST, port=PORT)
