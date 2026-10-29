"""The screen agent's routes with a scripted model: a screen tool call ends the stream for the
browser, the browser's result goes on with the run, and a session belongs to its owner."""

import json
import sys
from pathlib import Path

import pytest
from app import agent_runs
from app.agents import data_tools, screen
from app.agents.data_tools import DATA_TOOLS
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.tools import load_memory
from google.genai import types


class ScriptedModel(BaseLlm):
    """Answers each model turn with the next reply in `replies`: a dict is a tool call, a str is text."""

    model: str = "scripted"
    replies: list = []
    seen: list = []

    async def generate_content_async(self, llm_request, stream=False):
        self.seen.append(llm_request)
        reply = self.replies.pop(0)
        if isinstance(reply, dict):
            call = types.FunctionCall(
                id=f"call-{len(self.seen)}", name=reply["name"], args=reply.get("args", {})
            )
            part = types.Part(function_call=call)
        else:
            part = types.Part(text=reply)
        yield LlmResponse(content=types.Content(role="model", parts=[part]))


@pytest.fixture
def api(monkeypatch):
    model = ScriptedModel(replies=[], seen=[])
    monkeypatch.setattr(screen.screen_agent, "model", model)
    agent_runs.get_runner.cache_clear()
    app = FastAPI()
    app.include_router(agent_runs.router)
    app.dependency_overrides[agent_runs.current_user] = lambda: "user-1"
    yield TestClient(app), model, app
    agent_runs.get_runner.cache_clear()


def events(response):
    return [json.loads(chunk[6:]) for chunk in response.text.split("\n\n") if chunk.startswith("data: ")]


def test_a_screen_tool_call_pauses_for_the_browser_and_its_result_goes_on(api):
    client, model, _ = api
    model.replies = [
        {"name": "point_at", "args": {"target": "field:library-search", "note": "Search here"}},
        "There it is.",
    ]

    first = events(client.post("/agent/runs", json={"message": "Where do I search?", "screen": "library"}))
    session = first[0]["id"]
    assert first[0]["type"] == "session"
    [tool] = [e for e in first if e["type"] == "tool"]
    assert (tool["name"], tool["args"]) == (
        "point_at",
        {"target": "field:library-search", "note": "Search here"},
    )
    assert first[-1] == {"type": "done"}
    # The model saw which screen the person was on.
    assert "[On the library screen] Where do I search?" in str(model.seen[0].contents)

    result = {"id": tool["id"], "name": "point_at", "result": {"status": "done"}}
    second = events(client.post(f"/agent/runs/{session}/results", json=result))
    assert [e for e in second if e["type"] == "say"] == [{"type": "say", "text": "There it is."}]
    assert second[-1] == {"type": "done"}


def test_a_server_tool_runs_here_and_shows_as_a_step(api, monkeypatch):
    client, model, _ = api

    async def papers(tool_context):
        """The person's papers."""
        return [{"id": "a1", "title": "ColBERTv2", "status": "done"}]

    papers.__name__ = "list_papers"
    monkeypatch.setattr(screen.screen_agent, "tools", [*screen.screen_agent.tools[:5], papers])
    model.replies = [{"name": "list_papers"}, {"name": "open_paper", "args": {"analysis_id": "a1"}}]
    got = events(client.post("/agent/runs", json={"message": "Open ColBERT"}))
    assert [e["type"] for e in got] == ["session", "step", "tool", "done"]
    # The paper list reached the model as the tool's response.
    responses = [
        part.function_response for c in model.seen[1].contents for part in c.parts if part.function_response
    ]
    assert responses[0].response["result"][0]["title"] == "ColBERTv2"


def test_a_conversation_belongs_to_the_person_who_started_it(api):
    client, model, app = api
    model.replies = [{"name": "read_screen"}]
    session = events(client.post("/agent/runs", json={"message": "What is here?"}))[0]["id"]
    app.dependency_overrides[agent_runs.current_user] = lambda: "someone-else"
    result = {"id": "call-1", "name": "read_screen", "result": {}}
    assert client.post(f"/agent/runs/{session}/results", json=result).status_code == 404


def test_only_a_screen_tool_can_be_answered_from_the_browser(api):
    client, model, _ = api
    model.replies = [{"name": "read_screen"}]
    session = events(client.post("/agent/runs", json={"message": "What is here?"}))[0]["id"]
    result = {"id": "call-1", "name": "list_papers", "result": {}}
    assert client.post(f"/agent/runs/{session}/results", json=result).status_code == 422


def test_a_run_that_keeps_calling_server_tools_stops_at_the_cap(api, monkeypatch):
    client, model, _ = api
    monkeypatch.setattr(agent_runs, "MAX_LLM_CALLS", 3)
    model.replies = [{"name": "list_papers"}] * 5

    async def papers(tool_context):
        """The person's papers."""
        return []

    papers.__name__ = "list_papers"
    monkeypatch.setattr(screen.screen_agent, "tools", [*screen.screen_agent.tools[:5], papers])
    got = events(client.post("/agent/runs", json={"message": "loop"}))
    assert any(e["type"] == "say" and "I stopped after 3 steps" in e["text"] for e in got)
    assert got[-1] == {"type": "done"}


def test_the_agent_is_built_from_the_documented_tools():
    names = [getattr(tool, "name", getattr(tool, "__name__", "")) for tool in screen.SCREEN_TOOLS]
    assert names == ["read_screen", "open_screen", "open_paper", "point_at", "fill_field", "list_papers"]
    # The data tools belong to the specialist the screen agent hands work to; ADK lists it as a tool.
    assert [agent.name for agent in screen.screen_agent.sub_agents] == ["data_agent"]
    assert screen.screen_agent.tools[-1].name == "data_agent"
    # load_memory is data_agent's own ADK tool, not one the MCP server or /commands list.
    assert screen.data_agent.tools == [*DATA_TOOLS, load_memory]
    text = (Path(__file__).parents[2] / "docs" / "agent-tools.md").read_text(encoding="utf-8")
    listed = [*names, "data_agent", *[tool.__name__ for tool in DATA_TOOLS], "load_memory"]
    assert all(f"`{name}" in text for name in listed)


def test_a_data_request_goes_to_the_data_agent_and_the_stream_says_so(api, monkeypatch):
    client, model, _ = api
    data_model = ScriptedModel(replies=["Two claims are contradicted."], seen=[])
    monkeypatch.setattr(screen.data_agent, "model", data_model)
    model.replies = [
        {"name": "data_agent", "args": {"request": "Which claims are contradicted?"}},
        "Two claims are contradicted.",
    ]

    got = events(client.post("/agent/runs", json={"message": "Which claims are contradicted?"}))

    agents = [e for e in got if e["type"] == "agent"]
    assert agents == [
        {"type": "agent", "name": "data_agent", "state": "working", "task": "Which claims are contradicted?"},
        {"type": "agent", "name": "data_agent", "state": "done"},
    ]
    said = [e for e in got if e["type"] == "say"]
    assert said == [{"type": "say", "text": "Two claims are contradicted."}]  # the coordinator's, once
    assert got.index(agents[0]) < got.index(agents[1]) < got.index(said[0])
    # The coordinator's request, not the whole chat, is what the specialist was asked.
    assert "Which claims are contradicted?" in str(data_model.seen[0].contents)


def test_a_command_from_the_ask_panel_runs_a_data_tool_for_the_person(api, monkeypatch):
    client, _, _ = api
    seen = []

    async def get_gaps(tool_context):
        seen.append(tool_context.state["user"])
        return {"notBacked": [], "contradicted": [], "missing": []}

    monkeypatch.setattr(data_tools, "DATA_TOOLS", [get_gaps])

    assert client.post("/agent/tools/get_gaps", json={}).json() == {
        "notBacked": [], "contradicted": [], "missing": []
    }
    assert seen == ["user-1"]
    assert client.post("/agent/tools/delete_everything", json={}).status_code == 404
    assert client.post("/agent/tools/get_gaps", json={"extra": 1}).status_code == 422


def test_the_gateway_builds_the_agents_before_its_first_request():
    from app import main, mcp_server

    agent_runs.get_runner.cache_clear()
    mcp_server._tools.cache_clear()

    # A decorator left above it once made this return a context manager that never ran.
    assert main._warm_agents() is None
    assert agent_runs.get_runner.cache_info().currsize == 1
    assert mcp_server._tools.cache_info().currsize == 1
    assert "litellm.types.secret_managers.main" in sys.modules


def tool_names(agent) -> list[str]:
    return [getattr(tool, "name", getattr(tool, "__name__", "")) for tool in agent.tools]


def test_each_role_has_its_own_agent_and_each_can_ask_to_switch_role():
    assert set(screen.ROLE_AGENTS) == {"researcher", "labeler", "writer"}
    assert all("switch_role" in tool_names(agent) for agent in screen.ROLE_AGENTS.values())
    # The MCP server lists SCREEN_TOOLS and takes SCREEN_TOOL_NAMES: a coding agent has no role.
    assert "switch_role" not in screen.SCREEN_TOOL_NAMES
    assert "switch_role" in screen.BROWSER_TOOL_NAMES


def test_only_the_author_agent_reads_the_draft_and_only_from_the_browser():
    assert "read_draft" in tool_names(screen.author_agent)
    assert "read_draft" not in tool_names(screen.screen_agent)
    assert "read_draft" not in tool_names(screen.labeler_agent)
    # The web app's editor answers it; a coding agent over MCP has no editor to read.
    assert "read_draft" in screen.BROWSER_TOOL_NAMES
    assert "read_draft" not in screen.SCREEN_TOOL_NAMES
    text = (Path(__file__).parents[2] / "docs" / "agent-tools.md").read_text(encoding="utf-8")
    assert "| `read_draft` |" in text


def test_a_read_draft_call_waits_for_the_editor_and_its_text_goes_to_the_author_agent(api, monkeypatch):
    client, _, _ = api
    replies = [{"name": "read_draft", "args": {"start_line": 3, "end_line": 3}}, "It says hi."]
    author_model = ScriptedModel(replies=replies, seen=[])
    monkeypatch.setattr(screen.author_agent, "model", author_model)

    body = {"message": "What does line 3 say?", "screen": "editor", "role": "writer"}
    first = events(client.post("/agent/runs", json=body))
    session = first[0]["id"]
    [tool] = [e for e in first if e["type"] == "tool"]
    assert (tool["name"], tool["args"]) == ("read_draft", {"start_line": 3, "end_line": 3})

    draft = {"file": "main.tex", "first_line": 3, "last_line": 3, "total_lines": 9, "text": "3\thi"}
    result = {"id": tool["id"], "name": "read_draft", "result": draft, "role": "writer"}
    second = events(client.post(f"/agent/runs/{session}/results", json=result))
    assert {"type": "say", "text": "It says hi."} in second
    # The author agent read the editor's text.
    assert "3\\thi" in str(author_model.seen[-1].contents)


def test_a_tool_result_over_the_cap_reaches_the_agent_as_an_error(api, monkeypatch):
    client, _, _ = api
    replies = [{"name": "read_draft", "args": {}}, "It was too large."]
    author_model = ScriptedModel(replies=replies, seen=[])
    monkeypatch.setattr(screen.author_agent, "model", author_model)
    body = {"message": "What does my draft say?", "screen": "editor", "role": "writer"}
    first = events(client.post("/agent/runs", json=body))
    session = first[0]["id"]
    [tool] = [e for e in first if e["type"] == "tool"]

    huge = {"file": "main.tex", "text": "x" * (agent_runs.MAX_TOOL_RESULT_BYTES + 1)}
    result = {"id": tool["id"], "name": "read_draft", "result": huge, "role": "writer"}
    second = events(client.post(f"/agent/runs/{session}/results", json=result))
    assert {"type": "say", "text": "It was too large."} in second
    seen = str(author_model.seen[-1].contents)
    assert "tool result too large" in seen
    assert "x" * 1000 not in seen


def test_the_largest_real_browser_tool_results_fit_under_the_cap():
    # read_draft filled to its frontend caps (frontend/src/lib/agentTools.ts: 24,000 characters of
    # text, 4,000 of files and 8,000 of .bib keys as JSON) with Thai, 3 bytes a character in UTF-8.
    text = "\n".join(f"{n}\t" + "ก" * 100 for n in range(1, 301))[:24_000]
    files = [{"name": "ก" * 40, "kind": "tex", "dirty": False} for _ in range(50)]
    files = files[: 4_000 // (len(json.dumps(files[0], ensure_ascii=False)) + 1)]
    keys = ["ก" * 13 for _ in range(500)][: 8_000 // 16]
    draft = {
        "draft": {"id": "d" * 36, "title": "ก" * 200},
        "file": "main.tex",
        "files": files,
        "first_line": 1,
        "last_line": 300,
        "total_lines": 900,
        "truncated": True,
        "text": text,
        "bib_keys": keys,
    }
    # read_screen at its cap: 60 targets, labels of 80 characters.
    targets = [{"target": f"button:{'t' * 60}{n}", "label": "ก" * 80} for n in range(60)]
    for result in (draft, {"screen": "editor", "targets": targets}):
        size = len(json.dumps(result, ensure_ascii=False).encode())
        assert size < agent_runs.MAX_TOOL_RESULT_BYTES * 0.9, size


def test_the_labeler_agent_cannot_write_or_see_a_verdict():
    names = set(tool_names(screen.labeler_agent))
    verdicts = {"get_claim", "get_analysis", "check_text", "ask_library", "search_claims", "get_gaps"}
    assert not names & ({"fill_field", "submit_analysis", "data_agent"} | verdicts)
    assert screen.labeler_agent.sub_agents == []


def test_after_a_switch_the_new_roles_agent_goes_on_in_the_same_conversation(api, monkeypatch):
    client, model, _ = api
    labeler_model = ScriptedModel(replies=["Claim 4 is next."], seen=[])
    monkeypatch.setattr(screen.labeler_agent, "model", labeler_model)
    model.replies = [
        {"name": "switch_role", "args": {"role": "labeler", "reason": "Labeling is in the Labeler role"}},
        "Switched to the Labeler role.",
    ]

    first = events(client.post("/agent/runs", json={"message": "Which claim do I label next?"}))
    session = first[0]["id"]
    [tool] = [e for e in first if e["type"] == "tool"]
    assert tool["name"] == "switch_role"
    result = {"id": tool["id"], "name": "switch_role", "result": {"status": "switched"}, "role": "researcher"}
    second = events(client.post(f"/agent/runs/{session}/results", json=result))
    assert {"type": "say", "text": "Switched to the Labeler role."} in second

    body = {"message": "Go on", "role": "labeler", "session_id": session}
    third = events(client.post("/agent/runs", json=body))
    assert third[0] == {"type": "session", "id": session}
    assert {"type": "say", "text": "Claim 4 is next."} in third
    # The Labeler's agent read the conversation the Researcher's agent started.
    assert "Which claim do I label next?" in str(labeler_model.seen[0].contents)


def test_going_on_in_someone_elses_conversation_is_a_404(api):
    client, model, app = api
    model.replies = ["Hello."]
    session = events(client.post("/agent/runs", json={"message": "hi"}))[0]["id"]
    app.dependency_overrides[agent_runs.current_user] = lambda: "user-2"
    body = {"message": "hi", "role": "labeler", "session_id": session}
    assert client.post("/agent/runs", json=body).status_code == 404


def test_a_role_without_an_agent_is_refused(api):
    client, _, _ = api
    assert client.post("/agent/runs", json={"message": "hi", "role": "teacher"}).status_code == 422
