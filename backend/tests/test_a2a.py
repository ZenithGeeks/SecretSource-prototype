"""The A2A server publishes the coordinator: its agent card names it and its specialists.

The card lists every agent's tools, which for rag_agent means asking ColBERT's MCP endpoint.
The test gives that toolset no tools, so it makes no network call.
"""

import a2a_server
import pytest
from app.agents import team
from starlette.testclient import TestClient


@pytest.fixture
def card(monkeypatch):
    async def no_tools(readonly_context=None):
        return []

    monkeypatch.setattr(team.colbert_mcp, "get_tools", no_tools)
    with TestClient(a2a_server.app) as client:
        response = client.get("/.well-known/agent-card.json")
    response.raise_for_status()
    return response.json()


def test_the_agent_card_names_the_coordinator(card):
    assert card["name"] == team.root_agent.name
    assert card["description"] == team.root_agent.description


def test_the_agent_card_lists_the_specialists(card):
    skills = " ".join(skill["name"] + " " + skill["description"] for skill in card["skills"])

    for agent in team.root_agent.sub_agents:
        assert agent.name in skills
