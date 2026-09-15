"""Agents `adk web` serves. Each folder is one entry in the agent list.
Each `agent.py` exposes `root_agent`. Run from the repo root, with the app
package importable:

    docker compose --profile dev up -d adk-web        # http://localhost:8001
    PYTHONPATH=backend adk web --port 8001 backend/adk_agents   (host run)
"""
