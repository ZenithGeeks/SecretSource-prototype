"""The /mcp/ server and the bridge to the tab: the tool list is the screen agent's, a screen tool
runs in the caller's tab, and Gatehouse callers map to SecretSource users by email."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from app import auth, mcp_server, screen_bridge, store
from app.agents import data_tools, screen
from app.agents.data_tools import DATA_TOOLS
from fastapi import FastAPI, HTTPException, Request
from google.adk.tools import FunctionTool
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


@pytest.fixture
def app(monkeypatch):
    async def caller(request):
        return "user-1"

    monkeypatch.setattr(mcp_server, "gatehouse_user", caller)
    # No Settings, Agents choice yet, so full access.
    monkeypatch.setattr(store, "load_preferences", lambda user: None)
    app = FastAPI()
    app.include_router(screen_bridge.router)
    app.mount("/mcp", mcp_server.handle_mcp)
    app.dependency_overrides[screen_bridge.current_user] = lambda: "user-1"
    yield app
    screen_bridge._tabs.clear()


def run_with_client(app, steps):
    """Run `steps(client)` against the app, with the MCP server running."""

    async def main():
        async with mcp_server.running():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await steps(client)

    return asyncio.run(main())


async def rpc(client, method, params=None):
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    response = await client.post("/mcp/", json=body, headers=MCP_HEADERS)
    assert response.status_code == 200, response.text
    return response.json()["result"]


def test_tool_list_is_the_screen_agents(app):
    tools = run_with_client(app, lambda client: rpc(client, "tools/list"))["tools"]

    assert [tool["name"] for tool in tools] == [
        "read_screen",
        "open_screen",
        "open_paper",
        "point_at",
        "fill_field",
        "list_papers",
        *[tool.__name__ for tool in DATA_TOOLS],
        "labeling_papers",
        "claim_passages",
        "saved_labels",
        "review_claim",
    ]
    # The Author editor's read_draft and switch_role are the web app's only.
    assert not {"read_draft", "switch_role"} & {tool["name"] for tool in tools}
    by_name = {tool["name"]: tool for tool in tools}
    assert by_name["point_at"]["description"] == FunctionTool(screen.point_at).description
    assert by_name["point_at"]["inputSchema"]["required"] == ["target", "note"]
    assert by_name["read_screen"]["inputSchema"] == {"type": "object", "properties": {}}
    assert by_name["get_claim"]["inputSchema"]["required"] == ["analysis_id", "claim_number"]
    assert "tool_context" not in by_name["get_claim"]["inputSchema"]["properties"]
    assert by_name["get_analysis"]["annotations"]["readOnlyHint"] is True
    assert by_name["submit_analysis"].get("annotations") is None
    assert by_name["claim_passages"]["annotations"]["readOnlyHint"] is True
    assert by_name["saved_labels"].get("annotations") is None  # it marks the claim AI-reviewed


def allow(monkeypatch, access):
    """Store `access` as user-1's Settings, Agents choice."""
    preferences = {"user-1": {"agentAccess": access}}
    monkeypatch.setattr(store, "load_preferences", preferences.get)


def listed_and_called(app, name, arguments):
    async def steps(client):
        tools = (await rpc(client, "tools/list"))["tools"]
        result = await rpc(client, "tools/call", {"name": name, "arguments": arguments})
        return [tool["name"] for tool in tools], result

    return run_with_client(app, steps)


def test_read_only_lists_and_runs_only_the_tools_that_change_nothing(app, monkeypatch):
    allow(monkeypatch, {"level": "read"})

    names, result = listed_and_called(app, "review_claim", {"analysis_id": "a1", "claim_number": 1})

    assert set(names) == set(mcp_server.READ_ONLY)
    assert result["isError"] is True
    assert "Settings, Agents" in result["content"][0]["text"]


def test_custom_access_lists_only_the_chosen_tools(app, monkeypatch):
    allow(monkeypatch, {"level": "custom", "tools": ["list_papers", "point_at"]})

    names, result = listed_and_called(app, "fill_field", {"target": "field:x", "value": "y"})

    assert names == ["point_at", "list_papers"]
    assert result["isError"] is True
    assert "Settings, Agents" in result["content"][0]["text"]


def test_custom_access_runs_a_tool_it_lists(app, monkeypatch):
    allow(monkeypatch, {"level": "custom", "tools": ["open_screen"]})

    names, result = listed_and_called(app, "open_screen", {"screen": "library"})

    assert names == ["open_screen"]
    assert "?connect=agent" in result["content"][0]["text"]


def test_custom_with_no_tools_allows_nothing(app, monkeypatch):
    allow(monkeypatch, {"level": "custom", "tools": []})

    names, result = listed_and_called(app, "list_papers", {})

    assert names == []
    assert result["isError"] is True
    assert "Settings, Agents" in result["content"][0]["text"]


def test_a_null_access_choice_is_full_access(app, monkeypatch):
    """JSON null is no choice, the same as a missing preference: every tool, not read only."""
    allow(monkeypatch, None)

    names, result = listed_and_called(app, "open_screen", {"screen": "library"})

    assert "open_screen" in names
    assert "submit_analysis" in names
    assert "?connect=agent" in result["content"][0]["text"]


@pytest.mark.parametrize(
    "access",
    ["everything", {"level": "admin"}, {"level": "custom", "tools": "all"}, False, 0, "", []],
)
def test_an_unreadable_access_choice_counts_as_read_only(app, monkeypatch, access):
    allow(monkeypatch, access)

    names, result = listed_and_called(app, "review_claim", {"analysis_id": "a1", "claim_number": 1})

    assert set(names) == set(mcp_server.READ_ONLY)
    assert result["isError"] is True
    assert "Settings, Agents" in result["content"][0]["text"]


def test_a_screen_tool_runs_in_the_callers_tab(app):
    tab = asyncio.Queue()

    async def steps(client):
        screen_bridge._tabs["user-1"] = tab

        async def answer():
            call = await tab.get()
            assert call["name"] == "point_at"
            assert call["args"] == {"target": "field:library-filter", "note": "Search here"}
            await client.post("/agent/bridge/results", json={"id": call["id"], "result": {"status": "done"}})

        answering = asyncio.create_task(answer())
        args = {"target": "field:library-filter", "note": "Search here"}
        result = await rpc(client, "tools/call", {"name": "point_at", "arguments": args})
        await answering
        return result

    result = run_with_client(app, steps)

    assert result["isError"] is False
    assert result["structuredContent"] == {"status": "done"}
    assert screen_bridge._waiting == {}


def test_a_screen_tool_with_no_tab_says_how_to_connect_one(app):
    args = {"screen": "library"}
    result = run_with_client(
        app, lambda client: rpc(client, "tools/call", {"name": "open_screen", "arguments": args})
    )

    assert result["isError"] is True
    assert "?connect=agent" in result["content"][0]["text"]


def test_list_papers_runs_on_the_server(app, monkeypatch):
    async def papers_for(user):
        assert user == "user-1"
        return [{"id": "a1", "title": "ColBERTv2", "status": "done"}]

    monkeypatch.setattr(screen, "papers_for", papers_for)
    result = run_with_client(
        app, lambda client: rpc(client, "tools/call", {"name": "list_papers", "arguments": {}})
    )

    assert result["structuredContent"] == {"papers": [{"id": "a1", "title": "ColBERTv2", "status": "done"}]}


def test_review_claim_runs_the_labelers_review_for_the_caller(app, monkeypatch):
    async def review_for(analysis_id, claim_number, user):
        assert (analysis_id, claim_number, user) == ("a1", 3, "user-1")
        return [{"target": {"kind": "claim", "id": "p#2"}, "tone": "agrees", "text": "Level 3 fits."}]

    monkeypatch.setattr(mcp_server.labeling, "review_for", review_for)
    args = {"analysis_id": "a1", "claim_number": 3}

    async def steps(client):
        tools = (await rpc(client, "tools/list"))["tools"]
        result = await rpc(client, "tools/call", {"name": "review_claim", "arguments": args})
        return tools, result

    tools, result = run_with_client(app, steps)

    review = next(tool for tool in tools if tool["name"] == "review_claim")
    assert set(review["inputSchema"]["required"]) == {"analysis_id", "claim_number"}
    assert result["structuredContent"]["findings"][0]["text"] == "Level 3 fits."


def test_review_claim_on_an_unsaved_claim_says_to_save_it(app, monkeypatch):
    async def review_for(analysis_id, claim_number, user):
        raise HTTPException(409, "save this claim in the labeler before asking for a review")

    monkeypatch.setattr(mcp_server.labeling, "review_for", review_for)
    args = {"analysis_id": "a1", "claim_number": 1}
    result = run_with_client(
        app, lambda client: rpc(client, "tools/call", {"name": "review_claim", "arguments": args})
    )

    assert result["isError"] is True
    assert "save this claim" in result["content"][0]["text"]


def test_saved_labels_runs_for_the_caller(app, monkeypatch):
    async def labels_for(analysis_id, claim_number, user):
        assert (analysis_id, claim_number, user) == ("a1", 2, "user-1")
        return {"claim": "Recall improves.", "labels": [{"paper": "Ref B", "level": 3}], "passages": []}

    monkeypatch.setattr(mcp_server.labeling, "labels_for", labels_for)
    args = {"analysis_id": "a1", "claim_number": 2}
    result = run_with_client(
        app, lambda client: rpc(client, "tools/call", {"name": "saved_labels", "arguments": args})
    )

    assert result["structuredContent"]["labels"] == [{"paper": "Ref B", "level": 3}]


def test_another_user_cannot_answer_a_call(app):
    async def steps(client):
        result = asyncio.get_running_loop().create_future()
        screen_bridge._waiting["call-1"] = ("user-2", result)
        try:
            return await client.post("/agent/bridge/results", json={"id": "call-1", "result": {}})
        finally:
            del screen_bridge._waiting["call-1"]

    assert run_with_client(app, steps).status_code == 404


# gatehouse_user


def gatehouse_request(headers):
    raw = [(name.lower().encode(), value.encode()) for name, value in headers.items()]
    return Request({"type": "http", "headers": raw})


@pytest.fixture
def supabase(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("GATEHOUSE_SECRET", "s3cret")
    users = [
        SimpleNamespace(id="user-1", email="Ann@Example.com", email_confirmed_at="2026-10-01"),
        SimpleNamespace(id="user-2", email="bob@example.com", email_confirmed_at=None),
    ]

    def list_users(page, per_page):
        return users if page == 1 else []

    client = SimpleNamespace(auth=SimpleNamespace(admin=SimpleNamespace(list_users=list_users)))
    monkeypatch.setattr(store, "_supabase", lambda: client)
    auth._ids_by_email.clear()
    yield
    auth._ids_by_email.clear()


def caller_for(headers):
    return asyncio.run(auth.gatehouse_user(gatehouse_request(headers)))


def test_gatehouse_email_maps_to_the_user(supabase):
    headers = {"X-Gatehouse-Secret": "s3cret", "X-Consumer-Custom-ID": "ann@example.com"}
    assert caller_for(headers) == "user-1"


@pytest.mark.parametrize(
    ("headers", "status"),
    [
        ({"X-Consumer-Custom-ID": "ann@example.com"}, 401),
        ({"X-Gatehouse-Secret": "wrong", "X-Consumer-Custom-ID": "ann@example.com"}, 401),
        ({"X-Gatehouse-Secret": "s3cret"}, 403),
        ({"X-Gatehouse-Secret": "s3cret", "X-Consumer-Custom-ID": "nobody@example.com"}, 403),
        # bob never confirmed his email, so the account may not be his
        ({"X-Gatehouse-Secret": "s3cret", "X-Consumer-Custom-ID": "bob@example.com"}, 403),
    ],
)
def test_gatehouse_refuses(supabase, headers, status):
    with pytest.raises(HTTPException) as refused:
        caller_for(headers)
    assert refused.value.status_code == status


def test_gatehouse_without_a_secret_set_refuses_everyone(supabase, monkeypatch):
    monkeypatch.delenv("GATEHOUSE_SECRET")
    with pytest.raises(HTTPException) as refused:
        caller_for({"X-Gatehouse-Secret": "", "X-Consumer-Custom-ID": "ann@example.com"})
    assert refused.value.status_code == 401


def test_gatehouse_with_login_off_is_nobody(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert caller_for({}) is None


def test_a_data_tool_runs_for_the_caller(app, monkeypatch):
    async def get_analysis(analysis_id, tool_context):
        return {"id": analysis_id, "user": tool_context.state["user"]}

    monkeypatch.setattr(data_tools, "DATA_TOOLS", [get_analysis])
    call = {"name": "get_analysis", "arguments": {"analysis_id": "a1"}}
    result = run_with_client(app, lambda client: rpc(client, "tools/call", call))

    assert result["structuredContent"] == {"id": "a1", "user": "user-1"}


@pytest.fixture
def traced(monkeypatch):
    """The MCP server's tracer, writing spans to memory instead of Phoenix."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("test")
    monkeypatch.setattr(mcp_server, "tracer", tracer)
    return tracer, exporter


def test_a_tool_call_is_one_tool_span_with_what_ran_inside_it(app, monkeypatch, traced):
    tracer, exporter = traced

    async def find_support(claim, tool_context):
        def search():  # in a thread, like the real search
            with tracer.start_as_current_span("colbert_search"):
                return {"passages": []}

        return await asyncio.to_thread(search)

    monkeypatch.setattr(data_tools, "DATA_TOOLS", [find_support])
    call = {"name": "find_support", "arguments": {"claim": "late interaction"}}
    run_with_client(app, lambda client: rpc(client, "tools/call", call))

    spans = {span.name: span for span in exporter.get_finished_spans()}
    tool = spans["mcp find_support"]
    assert tool.attributes["openinference.span.kind"] == "TOOL"
    assert tool.attributes["tool.name"] == "find_support"
    assert json.loads(tool.attributes["input.value"]) == {"claim": "late interaction"}
    assert json.loads(tool.attributes["output.value"]) == {"passages": []}
    assert spans["colbert_search"].parent.span_id == tool.context.span_id


def test_a_failed_tool_call_marks_its_span_as_an_error(app, monkeypatch, traced):
    _, exporter = traced

    async def get_analysis(analysis_id, tool_context):
        raise ValueError("no analysis a1")

    monkeypatch.setattr(data_tools, "DATA_TOOLS", [get_analysis])
    call = {"name": "get_analysis", "arguments": {"analysis_id": "a1"}}
    result = run_with_client(app, lambda client: rpc(client, "tools/call", call))

    assert result["isError"] is True
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert "no analysis a1" in span.status.description


def test_the_check_my_draft_prompt_asks_for_check_text(app):
    async def steps(client):
        listed = await rpc(client, "prompts/list")
        got = await rpc(client, "prompts/get", {"name": "check_my_draft", "arguments": {"text": "My draft."}})
        return listed, got

    listed, got = run_with_client(app, steps)

    assert [prompt["name"] for prompt in listed["prompts"]] == ["check_my_draft"]
    assert "check_text" in got["messages"][0]["content"]["text"]
    assert got["messages"][0]["content"]["text"].endswith("My draft.")
