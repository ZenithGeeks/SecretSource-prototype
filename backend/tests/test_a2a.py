"""The A2A server publishes the coordinator: its agent card names it and its specialists.

rag_agent's tools are local functions, so building the card makes no call to ColBERT.
"""

from types import SimpleNamespace

import a2a_server
import pytest
from app.agents import team
from app.pipeline import rag
from google.adk.a2a.converters.request_converter import AgentRunRequest
from google.adk.agents.run_config import RunConfig
from starlette.testclient import TestClient


@pytest.fixture
def card():
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


def test_an_a2a_run_is_capped_and_signed_out(monkeypatch):
    """SCRUM-553: a caller cannot loop the tools without end, and the paper tools read the
    unowned papers only, whatever state the session held before."""

    def adk_request(request, part_converter):
        return AgentRunRequest(user_id="A2A_USER_ctx", run_config=RunConfig(), state_delta={"seen": 1})

    monkeypatch.setattr(a2a_server, "convert_a2a_request_to_agent_run_request", adk_request)
    owners = []
    monkeypatch.setattr("app.main.papers_of", lambda user: owners.append(user) or frozenset())

    run = a2a_server.signed_out_run(request=None, part_converter=None)
    rag.caller_papers(SimpleNamespace(state={"user": "ada", **run.state_delta}))

    assert run.run_config.max_llm_calls == team.MAX_LLM_CALLS
    assert run.state_delta == {"seen": 1, "user": None}
    assert owners == [None]
