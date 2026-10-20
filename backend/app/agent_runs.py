"""Routes for the screen agent (app/agents/screen.py), as server-sent events.

POST /agent/runs starts a conversation with the person's message. Whenever the agent calls a
screen tool the stream sends `{"type": "tool", "id", "name", "args"}` and ends. The browser does
it and POSTs the result to /agent/runs/{session_id}/results, which goes on with a new stream.
Other events: `{"type": "session", "id"}` first, `{"type": "step", "name"}` for a server tool,
`{"type": "say", "text"}` for the agent's words, and `{"type": "done"}` last.

Sessions live in this process's memory for an hour: one gateway instance serves the app today
(memory gateway-multi-instance-state). A second instance would need them in the database.
"""

import functools
import json
import logging
import time

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

_sessions = InMemorySessionService()
_started: dict[str, tuple[float, str]] = {}  # session id -> (when it began, user id)


class RunStart(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    screen: str = Field(default="", max_length=40)  # the screen the person is on, for the agent


class ToolResult(BaseModel):
    id: str = Field(min_length=1, max_length=200)  # the function call's id from the "tool" event
    name: str = Field(min_length=1, max_length=40)
    result: dict


@router.post("/runs")
async def start_run(body: RunStart, user: str | None = Depends(current_user)):
    """Start a conversation with the screen agent and stream its first turn."""
    await _forget_old_sessions()
    owner = user or ""  # "" is the signed-out space, as in app/sessions.py
    session = await _sessions.create_session(app_name=APP_NAME, user_id=owner, state={"user": owner})
    _started[session.id] = (time.monotonic(), owner)
    text = f"[On the {body.screen} screen] {body.message}" if body.screen else body.message
    message = types.Content(role="user", parts=[types.Part(text=text)])
    return _stream(session.id, owner, message, session_event={"type": "session", "id": session.id})


@router.post("/runs/{session_id}/results")
async def send_result(session_id: str, body: ToolResult, user: str | None = Depends(current_user)):
    """Give the agent what a screen tool did in the browser, and stream what it does next."""
    from app.agents.screen import SCREEN_TOOL_NAMES  # see get_runner for why not at the top

    owner = user or ""
    session = await _sessions.get_session(app_name=APP_NAME, user_id=owner, session_id=session_id)
    if session is None:
        raise HTTPException(404, "no such conversation, or it ended an hour after it began")
    if body.name not in SCREEN_TOOL_NAMES:
        raise HTTPException(
            422, f"{body.name} is not a screen tool; expected one of {sorted(SCREEN_TOOL_NAMES)}"
        )
    response = types.FunctionResponse(id=body.id, name=body.name, response=body.result)
    message = types.Content(role="user", parts=[types.Part(function_response=response)])
    return _stream(session_id, owner, message)


def _stream(session_id: str, user_id: str, message: types.Content, session_event: dict | None = None):
    from app import main  # main includes this router, so not at the top

    events = _events(session_id, user_id, message, session_event)
    return StreamingResponse(main._keep_alive(events), media_type="text/event-stream")


async def _events(session_id: str, user_id: str, message: types.Content, session_event: dict | None):
    """One request's run, as server-sent events; it ends at a screen tool or at the agent's reply."""
    if session_event:
        yield _sse(session_event)
    run_config = RunConfig(max_llm_calls=MAX_LLM_CALLS)
    try:
        async for event in get_runner().run_async(
            user_id=user_id, session_id=session_id, new_message=message, run_config=run_config
        ):
            calls = event.get_function_calls()
            for call in calls:
                if call.id in (event.long_running_tool_ids or ()):
                    yield _sse({"type": "tool", "id": call.id, "name": call.name, "args": call.args or {}})
                else:
                    yield _sse({"type": "step", "name": call.name})
            if event.content and not calls and not event.get_function_responses():
                if text := "".join(part.text or "" for part in event.content.parts or []).strip():
                    yield _sse({"type": "say", "text": text})
    except LlmCallsLimitExceededError:
        yield _sse({"type": "say", "text": f"I stopped after {MAX_LLM_CALLS} steps. Try a smaller request."})
    except Exception:
        log.exception("screen agent run %s failed", session_id)
        yield _sse({"type": "error", "message": "the agent could not go on"})
    yield _sse({"type": "done"})


@functools.cache
def get_runner() -> Runner:
    """The screen agent's runner, built on first use: app.agents.screen imports DSPy and
    LiteLLM, which take seconds, so the gateway does not import it at start."""
    from app.agents.screen import screen_agent

    return Runner(agent=screen_agent, app_name=APP_NAME, session_service=_sessions)


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
