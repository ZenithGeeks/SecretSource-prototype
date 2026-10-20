"""The bridge from /mcp (app/mcp_server.py) to the person's open tab.

A signed-in tab with "Let Claude Code use this tab" on holds GET /agent/bridge open. Each screen
tool call from an MCP client goes down that stream as `{"type": "tool", "id", "name", "args"}`.
The tab runs it with lib/agentTools and POSTs the result to /agent/bridge/results. One tab per
user: a tab that opens the bridge later takes over. State lives in this process's memory, like
the screen agent's sessions (app/agent_runs.py).
"""

import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth import current_user

router = APIRouter(prefix="/agent/bridge", tags=["agent"])

CALL_SECONDS = 120  # long enough to read a fill_field and press Apply

_tabs: dict[str, asyncio.Queue[dict]] = {}  # owner -> the calls waiting for that owner's tab
_pending: dict[str, tuple[str, asyncio.Future[dict]]] = {}  # call id -> (owner, its result)


class NoTab(Exception):
    """No tab of this user has the bridge open."""


class BridgeResult(BaseModel):
    id: str = Field(min_length=1, max_length=64)  # the call's id from the "tool" event
    result: dict


async def call_tab(owner: str, name: str, args: dict) -> dict:
    """Run one screen tool in the owner's tab and return what the tab answered.

    Args:
        owner: the user id, or "" for the signed-out space.
        name: a screen tool, one of app.agents.screen.SCREEN_TOOL_NAMES.
        args: the tool's arguments, as the MCP client sent them.

    Raises:
        NoTab: no tab of the owner has the bridge open.
        TimeoutError: the tab gave no result within CALL_SECONDS.
    """
    queue = _tabs.get(owner)
    if queue is None:
        raise NoTab(owner)
    call_id = uuid.uuid4().hex
    result = asyncio.get_running_loop().create_future()
    _pending[call_id] = (owner, result)
    try:
        await queue.put({"type": "tool", "id": call_id, "name": name, "args": args})
        return await asyncio.wait_for(result, CALL_SECONDS)
    finally:
        del _pending[call_id]


@router.get("")
async def open_bridge(user: str | None = Depends(current_user)):
    """Stream the screen tool calls meant for this user's tab, until the tab closes it."""
    from app import main  # main includes this router, so not at the top

    owner = user or ""  # "" is the signed-out space, as in app/sessions.py
    queue: asyncio.Queue[dict] = asyncio.Queue()
    _tabs[owner] = queue

    async def calls():
        try:
            yield _sse({"type": "ready"})
            while True:
                yield _sse(await queue.get())
        finally:
            # A newer tab may have taken over; leave its queue alone.
            if _tabs.get(owner) is queue:
                del _tabs[owner]

    return StreamingResponse(main._keep_alive(calls()), media_type="text/event-stream")


@router.post("/results")
async def send_result(body: BridgeResult, user: str | None = Depends(current_user)):
    """Hand a tool call's result from the tab back to the MCP call that waits for it."""
    pending = _pending.get(body.id)
    if pending is None or pending[0] != (user or ""):
        raise HTTPException(404, f"no tool call {body.id} is waiting; it may have timed out")
    _, result = pending
    if not result.done():
        result.set_result(body.result)
    return {"status": "ok"}


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"
