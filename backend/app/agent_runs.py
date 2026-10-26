"""Routes for the screen agent (app/agents/screen.py), as server-sent events.

POST /agent/tools/{name} runs one data tool for the Ask panel's /commands.
POST /agent/runs starts a conversation with the person's message, or goes on in one when the body
names its `session_id`. `role` picks the role's agent (agents/screen.py ROLE_AGENTS). Whenever the
agent calls a screen tool the stream sends `{"type": "tool", "id", "name", "args"}` and ends. The
browser does it and POSTs the result, with the same `role`, to /agent/runs/{session_id}/results,
which goes on with a new stream. After switch_role says "switched", the browser sends the next
message with the new role and the same session_id.
Other events: `{"type": "session", "id"}` first, `{"type": "step", "name"}` for a server tool,
`{"type": "agent", "name", "state", "task"}` when the agent hands work to a specialist
(`state` is "working", then "done" or "failed"), `{"type": "say", "text"}` for the agent's words,
and `{"type": "done"}` last.

Sessions live in this process's memory for an hour: one gateway instance serves the app today
(memory gateway-multi-instance-state). A second instance would need them in the database.
"""

import functools
import json
import logging
import time
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from google.adk.agents.invocation_context import LlmCallsLimitExceededError
from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel, Field

from app.auth import current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["agent"])

APP_NAME = "secretsource-screen"
MAX_LLM_CALLS = 8  # per request; a task takes 3-5 in eval_screen_agent.py, so this stops a loop, not a task
SESSION_SECONDS = 3600
# The specialists the screen agent hands work to (app/agents/screen.py), reported to the browser.
DELEGATES = frozenset({"data_agent"})

_sessions = InMemorySessionService()
_started: dict[str, tuple[float, str]] = {}  # session id -> (when it began, user id)


# The web app's role ids with a screen agent (agents/screen.py ROLE_AGENTS). The Teacher has none.
Role = Literal["researcher", "labeler", "writer"]


class RunStart(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    screen: str = Field(default="", max_length=40)  # the screen the person is on, for the agent
    role: Role = "researcher"  # whose agent answers; after switch_role the browser sends the new one
    # Go on in this conversation instead of starting one: after switch_role, the new role's agent
    # reads what was said before (one session service for every role, see get_runner).
    session_id: str | None = Field(default=None, max_length=200)


class ToolResult(BaseModel):
    id: str = Field(min_length=1, max_length=200)  # the function call's id from the "tool" event
    name: str = Field(min_length=1, max_length=40)
    result: dict
    # The role whose agent made the call: ADK hands the result back to the agent that asked for it.
    role: Role = "researcher"


@router.post("/runs")
async def start_run(body: RunStart, user: str | None = Depends(current_user)):
    """Start a conversation with the role's screen agent, or go on in one, and stream the turn."""
    await _forget_old_sessions()
    owner = user or ""  # "" is the signed-out space, as in app/sessions.py
    if body.session_id:
        session = await _sessions.get_session(app_name=APP_NAME, user_id=owner, session_id=body.session_id)
        if session is None:
            raise HTTPException(404, "no such conversation, or it ended an hour after it began")
    else:
        session = await _sessions.create_session(app_name=APP_NAME, user_id=owner, state={"user": owner})
        _started[session.id] = (time.monotonic(), owner)
    text = f"[On the {body.screen} screen] {body.message}" if body.screen else body.message
    message = types.Content(role="user", parts=[types.Part(text=text)])
    return _stream(body.role, session.id, owner, message, session_event={"type": "session", "id": session.id})


@router.post("/runs/{session_id}/results")
async def send_result(session_id: str, body: ToolResult, user: str | None = Depends(current_user)):
    """Give the agent what a screen tool did in the browser, and stream what it does next."""
    from app.agents.screen import BROWSER_TOOL_NAMES  # see get_runner for why not at the top

    owner = user or ""
    session = await _sessions.get_session(app_name=APP_NAME, user_id=owner, session_id=session_id)
    if session is None:
        raise HTTPException(404, "no such conversation, or it ended an hour after it began")
    if body.name not in BROWSER_TOOL_NAMES:
        raise HTTPException(
            422, f"{body.name} is not a screen tool; expected one of {sorted(BROWSER_TOOL_NAMES)}"
        )
    response = types.FunctionResponse(id=body.id, name=body.name, response=body.result)
    message = types.Content(role="user", parts=[types.Part(function_response=response)])
    return _stream(body.role, session_id, owner, message)


@router.post("/tools/{name}")
async def run_tool(name: str, args: dict, user: str | None = Depends(current_user)):
    """Run one data tool (app/agents/data_tools.py) for the person, for the Ask panel's /commands.
    The result is what the tool gives the agent."""
    from app.agents.data_tools import DATA_TOOLS  # see get_runner for why not at the top

    tool = next((tool for tool in DATA_TOOLS if tool.__name__ == name), None)
    if tool is None:
        raise HTTPException(404, f"there is no tool named {name}")
    try:
        return await tool(**args, tool_context=SimpleNamespace(state={"user": user or ""}))
    except TypeError as error:  # a missing or unknown argument
        raise HTTPException(422, f"{name}: {error}") from None


def _stream(
    role: Role, session_id: str, user_id: str, message: types.Content, session_event: dict | None = None
):
    from app import main  # main includes this router, so not at the top

    events = _events(role, session_id, user_id, message, session_event)
    return StreamingResponse(main._keep_alive(events), media_type="text/event-stream")


async def _events(
    role: Role, session_id: str, user_id: str, message: types.Content, session_event: dict | None
):
    """One request's run, as server-sent events; it ends at a screen tool or at the agent's reply."""
    if session_event:
        yield _sse(session_event)
    run_config = RunConfig(max_llm_calls=MAX_LLM_CALLS)
    try:
        async for event in get_runner(role).run_async(
            user_id=user_id, session_id=session_id, new_message=message, run_config=run_config
        ):
            calls = event.get_function_calls()
            for call in calls:
                if call.id in (event.long_running_tool_ids or ()):
                    yield _sse({"type": "tool", "id": call.id, "name": call.name, "args": call.args or {}})
                elif call.name in DELEGATES:
                    task = (call.args or {}).get("request", "")
                    yield _sse({"type": "agent", "name": call.name, "state": "working", "task": task})
                else:
                    yield _sse({"type": "step", "name": call.name})
            responses = event.get_function_responses()
            for response in responses:
                if response.name in DELEGATES:
                    state = "failed" if "error" in (response.response or {}) else "done"
                    yield _sse({"type": "agent", "name": response.name, "state": state})
            # A specialist's reply goes back to the coordinator, which words the answer.
            if event.author not in DELEGATES and event.content and not calls and not responses:
                if text := "".join(part.text or "" for part in event.content.parts or []).strip():
                    yield _sse({"type": "say", "text": text})
    except LlmCallsLimitExceededError:
        yield _sse({"type": "say", "text": f"I stopped after {MAX_LLM_CALLS} steps. Try a smaller request."})
    except Exception:
        log.exception("screen agent run %s failed", session_id)
        yield _sse({"type": "error", "message": "the agent could not go on"})
    yield _sse({"type": "done"})


@functools.cache
def get_runner(role: Role = "researcher") -> Runner:
    """The runner for one role's screen agent, built on first use: app.agents.screen imports DSPy
    and LiteLLM, which take seconds, so the gateway does not import it at start. Every role's
    runner shares one session service and app name, so a conversation keeps its history when the
    person switches role."""
    from app.agents.screen import ROLE_AGENTS
    from app.memory import AssistantMemory

    return Runner(
        agent=ROLE_AGENTS[role],
        app_name=APP_NAME,
        session_service=_sessions,
        memory_service=AssistantMemory(),  # load_memory reads the owner's facts, then their analyses
    )


async def _forget_old_sessions() -> None:
    """Delete sessions older than SESSION_SECONDS. Runs at each new conversation, so an old
    session lingers until the next one starts."""
    cutoff = time.monotonic() - SESSION_SECONDS
    for session_id, (started, user_id) in list(_started.items()):
        if started < cutoff:
            del _started[session_id]
            await _sessions.delete_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"
