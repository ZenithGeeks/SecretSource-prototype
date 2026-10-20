"""The screen agent's tools as an MCP server at /mcp/, for coding agents such as Claude Code or Codex.

The tool list comes from screen_agent's own tools through ADK's adk_to_mcp_tool_type, so an MCP
client reads the same descriptions as the screen agent, plus review_claim, the labeler's review.
list_papers and review_claim run here. The screen tools run in the caller's open tab
(app/screen_bridge.py). Callers come through Gatehouse, which checks their key (app/auth.py,
gatehouse_user). docs/agent-tools.md says how to connect.
"""

import contextlib
import functools

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

from app import screen_bridge
from app.auth import gatehouse_user
from app.labeling import router as labeling

server = Server("secretsource-screen")
_sessions: StreamableHTTPSessionManager | None = None  # set while the app runs, by running()


async def review_claim(analysis_id: str, claim_number: int) -> dict:
    """Review a claim the person labeled in the labeler, as Review in Ask AI does: it checks what
    they saved (passages left out, levels without a reason) and what the judge reads in the
    passages behind each level, and lists what it finds. It never changes a label, and it works
    only on a claim the person has saved. It takes a minute or more.

    Args:
        analysis_id: the paper's analysis id, from list_papers or the labeler's address (?analysis=).
        claim_number: the claim's number in the labeler's claim bar, from 1.
    """
    raise NotImplementedError  # call_tool runs it with the caller; this only declares the tool


@server.list_tools()
async def list_tools() -> list[types.Tool]:
    """The screen agent's tools and review_claim, with the descriptions and arguments they declare."""
    return list(_tools().values())


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> dict:
    """Run a tool for the caller: list_papers and review_claim here, a screen tool in the caller's tab."""
    from app.agents.screen import SCREEN_TOOL_NAMES, papers_for  # see _tools for why not at the top

    # handle_mcp put the caller there before MCP saw the request.
    user = server.request_context.request.state.user
    if name == "list_papers":
        return {"papers": await papers_for(user)}
    if name == "review_claim":
        try:
            findings = await labeling.review_for(arguments["analysis_id"], arguments["claim_number"], user)
        except HTTPException as error:
            raise ValueError(error.detail) from None
        return {"findings": findings}
    if name not in SCREEN_TOOL_NAMES:
        raise ValueError(f"there is no tool named {name}")
    try:
        return await screen_bridge.call_tab(user or "", name, arguments)
    # The low-level server turns an exception into a tool result with isError, which the client reads.
    except screen_bridge.NoTab:
        raise ValueError(
            "no SecretSource tab is connected: open SecretSource with ?connect=agent in the "
            "address and press Allow"
        ) from None
    except TimeoutError:
        raise ValueError(f"the tab gave no answer in {screen_bridge.CALL_SECONDS} s") from None


@functools.cache
def _tools() -> dict[str, types.Tool]:
    """The MCP tools, by name, built on first use: app.agents.screen imports DSPy and LiteLLM,
    which take seconds, so the gateway does not import it at start."""
    from google.adk.tools import BaseTool, FunctionTool
    from google.adk.tools.mcp_tool.conversion_utils import adk_to_mcp_tool_type

    from app.agents.screen import screen_agent

    tools = {}
    for tool in screen_agent.tools:
        mcp_tool = adk_to_mcp_tool_type(tool if isinstance(tool, BaseTool) else FunctionTool(tool))
        # A tool with no arguments comes out as {}; MCP needs an object schema.
        mcp_tool.inputSchema = mcp_tool.inputSchema or {"type": "object", "properties": {}}
        tools[mcp_tool.name] = mcp_tool
    tools["review_claim"] = adk_to_mcp_tool_type(FunctionTool(review_claim))
    return tools


async def handle_mcp(scope, receive, send) -> None:
    """The ASGI app at /mcp/: check the Gatehouse caller, then hand the request to MCP."""
    request = Request(scope)
    try:
        # MCP builds its own Request on the same scope, so call_tool reads this back.
        request.state.user = await gatehouse_user(request)
    except HTTPException as error:
        await JSONResponse({"detail": error.detail}, error.status_code)(scope, receive, send)
        return
    if _sessions is None:
        raise RuntimeError("the MCP server is not running; enter mcp_server.running() in the lifespan")
    await _sessions.handle_request(scope, receive, send)


@contextlib.asynccontextmanager
async def running():
    """Run the MCP server for as long as the app runs. Stateless: each request stands alone,
    so there is no MCP session to keep or clean up."""
    global _sessions
    _sessions = StreamableHTTPSessionManager(app=server, stateless=True, json_response=True)
    async with _sessions.run():
        yield
    _sessions = None
