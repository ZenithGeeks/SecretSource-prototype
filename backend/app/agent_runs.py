"""Routes for the screen agent (app/agents/screen.py), as server-sent events.

POST /agent/tools/{name} runs one data tool for the Ask panel's /commands.
POST /agent/runs starts a conversation with the person's message, or goes on in one when the body
names its `session_id`. `role` picks the role's agent (agents/screen.py ROLE_AGENTS). Whenever the
agent calls a screen tool the stream sends `{"type": "tool", "id", "name", "args"}` and ends. The
browser does it and POSTs the result, with the same `role`, to /agent/runs/{session_id}/results,
which goes on with a new stream. After switch_role says "switched", the browser sends the next
message with the new role and the old session_id; start_run carries only the last plain-text
request into a fresh session for the new role so earlier tool calls and verdicts stay isolated.
Other events: `{"type": "session", "id"}` first, `{"type": "step", "name"}` for a server tool,
`{"type": "agent", "name", "state", "task"}` when the agent hands work to a specialist
(`state` is "working", then "done" or "failed"), `{"type": "progress", "text"}` while a slow data
tool runs (app/agents/progress.py), `{"type": "say", "text"}` for the agent's words, and
`{"type": "done"}` last.

Sessions use app/sessions.py (Postgres in the `adk` schema when SESSION_DB_URL is set, in-memory
otherwise) and expire after an hour of inactivity.
"""

import asyncio
import contextlib
import functools
import json
import logging
import re
import time
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from google.adk.agents.invocation_context import LlmCallsLimitExceededError
from google.adk.agents.run_config import RunConfig
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel, Field

from app.agents import progress
from app.auth import current_user
from app.sessions import session_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/agent", tags=["agent"])

APP_NAME = "secretsource-screen"
MAX_LLM_CALLS = 8  # per request; a task takes 3-5 in eval_screen_agent.py, so this stops a loop, not a task
# Browser tool round-trips allowed in one user turn before stopping a stuck loop (#1023).
MAX_BROWSER_STEPS = 8
SESSION_SECONDS = 3600
# A browser tool's result as UTF-8 JSON. The largest real one is read_draft's: 24,000 characters of
# text plus capped file and .bib key lists (frontend/src/lib/agentTools.ts), about 36,000 characters.
# In Thai or other 3-byte UTF-8 text that is about 100 KB, so 128 KiB keeps every real result while
# a bigger one (a faulty or hostile browser) never reaches the model.
MAX_TOOL_RESULT_BYTES = 128 * 1024
# The specialists the screen agent hands work to (app/agents/screen.py), reported to the browser.
DELEGATES = frozenset({"data_agent"})

_sessions = None  # built on first use: a database service opens its engine when built
# In-memory sweep index (session id -> (last_active_epoch, user_id)) so idle in-memory
# sessions do not accumulate. Database sessions check session.last_update_time on load.
_last_active: dict[str, tuple[float, str]] = {}
_MISSING_SESSION = "no such conversation, or it expired after an hour of inactivity"
_CONTEXT_PREFIX = re.compile(r"^\[(?:On the |open (?:analysis|draft)_id=)[^\]]+\]\s*")


def sessions():
    """The session service screen-agent runs use, from app/sessions.py."""
    global _sessions
    if _sessions is None:
        _sessions = session_service()
    return _sessions


def _touch(session_id: str, owner: str, at: float | None = None) -> None:
    """Record activity for in-memory session cleanup."""
    if isinstance(sessions(), InMemorySessionService):
        _last_active[session_id] = (time.time() if at is None else at, owner)


async def _load_session(owner: str, session_id: str):
    """Return the owner's active session, or None if missing or idle past SESSION_SECONDS."""
    svc = sessions()
    session = await svc.get_session(app_name=APP_NAME, user_id=owner, session_id=session_id)
    if session is None:
        return None
    now = time.time()
    if session.last_update_time and now - session.last_update_time > SESSION_SECONDS:
        _last_active.pop(session_id, None)
        await svc.delete_session(app_name=APP_NAME, user_id=owner, session_id=session_id)
        return None
    _touch(session_id, owner, now)
    return session


# The web app's role ids (agents/screen.py ROLE_AGENTS). Teacher has read-only Classroom tools only.
Role = Literal["researcher", "labeler", "writer", "teacher"]


class RunStart(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    screen: str = Field(default="", max_length=40)  # the screen the person is on, for the agent
    role: Role = "researcher"  # whose agent answers; after switch_role the browser sends the new one
    analysis_id: str | None = Field(default=None, max_length=200)
    draft_id: str | None = Field(default=None, max_length=200)
    # Go on in this conversation instead of starting one: when role changes, start_run opens a
    # fresh session for the target role carrying only the last plain-text user request.
    session_id: str | None = Field(default=None, max_length=200)


class ToolResult(BaseModel):
    id: str = Field(min_length=1, max_length=200)  # the function call's id from the "tool" event
    name: str = Field(min_length=1, max_length=40)
    result: dict
    # The role whose agent made the call: ADK hands the result back to the agent that asked for it.
    role: Role = "researcher"


def _last_user_request(session) -> str | None:
    """Return the latest plain-text user message in `session`, without its context prefix."""
    for event in reversed(session.events):
        if event.author != "user" or not event.content or not event.content.parts:
            continue
        if any(part.function_response is not None for part in event.content.parts):
            continue
        raw = "".join(part.text or "" for part in event.content.parts)
        cleaned = _CONTEXT_PREFIX.sub("", raw, count=1).strip()
        if cleaned:
            return cleaned
    return None


def _pending_browser_calls(session) -> dict[str, str]:
    """Map each unresolved long-running tool call id in `session` to its tool name."""
    pending: dict[str, str] = {}
    for event in session.events:
        long_ids = set(event.long_running_tool_ids or ())
        for call in event.get_function_calls():
            if call.id and call.id in long_ids:
                pending[call.id] = call.name
        for response in event.get_function_responses():
            if response.id:
                pending.pop(response.id, None)
    return pending


async def _new_session(owner: str, role: Role):
    session = await sessions().create_session(
        app_name=APP_NAME, user_id=owner, state={"user": owner, "role": role}
    )
    _touch(session.id, owner, session.last_update_time or time.time())
    return session


def _format_user_message(body: RunStart, message: str | None = None) -> str:
    """Prefix the user's message with the active screen and open paper or draft id, when present."""
    parts = []
    if body.screen:
        parts.append(f"On the {body.screen} screen")
    if body.analysis_id:
        parts.append(f"open analysis_id={body.analysis_id}")
    if body.draft_id:
        parts.append(f"open draft_id={body.draft_id}")
    text = body.message if message is None else message
    return f"[{', '.join(parts)}] {text}" if parts else text


@router.post("/runs")
async def start_run(body: RunStart, user: str | None = Depends(current_user)):
    """Start a conversation with the role's screen agent, or go on in one, and stream the turn."""
    await _forget_old_sessions()
    owner = user or ""  # "" is the signed-out space, as in app/sessions.py
    prompt = body.message
    if body.session_id:
        session = await _load_session(owner, body.session_id)
        if session is None:
            raise HTTPException(404, _MISSING_SESSION)
        prior_role = session.state.get("role")
        if prior_role and prior_role != body.role:
            # Isolate the target role from prior tool calls and verdicts (notably labeler_agent).
            carried = _last_user_request(session)
            session = await _new_session(owner, body.role)
            if carried:
                prompt = f"Earlier request: {carried}\n{body.message}"
    else:
        session = await _new_session(owner, body.role)
    text = _format_user_message(body, prompt)
    message = types.Content(role="user", parts=[types.Part(text=text)])
    return _stream(body.role, session.id, owner, message, session_event={"type": "session", "id": session.id})


def _browser_limit_message(limit: int) -> str:
    return f"I stopped after {limit} browser steps. Try a smaller request."


def _browser_steps_this_turn(session, browser_tools: frozenset[str]) -> int:
    """Count browser tool results submitted since the latest plain-text user message."""
    steps = 0
    for event in reversed(session.events):
        if event.author != "user":
            continue
        responses = event.get_function_responses()
        if not responses:
            break
        steps += sum(1 for response in responses if response.name in browser_tools)
    return steps


def _limit_stream(limit: int) -> StreamingResponse:
    from app import main  # main includes this router, so not at the top

    async def stopped():
        yield _sse({"type": "say", "text": _browser_limit_message(limit)})
        yield _sse({"type": "done"})

    return StreamingResponse(main._keep_alive(stopped()), media_type="text/event-stream")


@router.post("/runs/{session_id}/results")
async def send_result(session_id: str, body: ToolResult, user: str | None = Depends(current_user)):
    """Give the agent what a screen tool did in the browser, and stream what it does next."""
    from app.agents.screen import ROLE_BROWSER_TOOLS  # see get_runner for why not at the top

    owner = user or ""
    session = await _load_session(owner, session_id)
    if session is None:
        raise HTTPException(404, _MISSING_SESSION)
    session_role = session.state.get("role")
    if session_role and body.role != session_role:
        raise HTTPException(422, f"session belongs to role {session_role!r}, not {body.role!r}")
    allowed = ROLE_BROWSER_TOOLS.get(body.role, frozenset())
    if body.name not in allowed:
        raise HTTPException(
            422,
            f"{body.name} is not a browser tool for role {body.role!r}; expected one of {sorted(allowed)}",
        )
    pending = _pending_browser_calls(session)
    if pending.get(body.id) != body.name:
        raise HTTPException(422, f"no pending {body.name!r} call with id {body.id!r} in this session")
    steps = _browser_steps_this_turn(session, allowed)
    if steps >= MAX_BROWSER_STEPS:
        return _limit_stream(MAX_BROWSER_STEPS)
    result = body.result
    size = len(json.dumps(result, ensure_ascii=False).encode())
    if size > MAX_TOOL_RESULT_BYTES:
        # Answer the call rather than refuse the request: the agent's pending call still gets its
        # result, so the conversation goes on and the agent can tell the person.
        log.warning(
            "%s result of %d bytes is over %d; not passed to the agent",
            body.name,
            size,
            MAX_TOOL_RESULT_BYTES,
        )
        result = {"status": "error", "message": "tool result too large"}
    response = types.FunctionResponse(id=body.id, name=body.name, response=result)
    message = types.Content(role="user", parts=[types.Part(function_response=response)])
    return _stream(body.role, session_id, owner, message, browser_steps=steps + 1)


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
    role: Role,
    session_id: str,
    user_id: str,
    message: types.Content,
    session_event: dict | None = None,
    browser_steps: int = 0,
):
    from app import main  # main includes this router, so not at the top

    events = _events(role, session_id, user_id, message, session_event, browser_steps)
    return StreamingResponse(main._keep_alive(events), media_type="text/event-stream")


async def _events(
    role: Role,
    session_id: str,
    user_id: str,
    message: types.Content,
    session_event: dict | None,
    browser_steps: int = 0,
):
    """One request's run, as server-sent events; it ends at a screen tool or at the agent's reply."""
    if session_event:
        yield _sse(session_event)
    run_config = RunConfig(max_llm_calls=MAX_LLM_CALLS)
    try:
        async for event in _run_with_progress(
            get_runner(role).run_async(
                user_id=user_id, session_id=session_id, new_message=message, run_config=run_config
            )
        ):
            if isinstance(event, str):
                yield _sse({"type": "progress", "text": event})
                continue
            calls = event.get_function_calls()
            stopped = False
            for call in calls:
                if call.id in (event.long_running_tool_ids or ()):
                    if browser_steps >= MAX_BROWSER_STEPS:
                        yield _sse({"type": "say", "text": _browser_limit_message(MAX_BROWSER_STEPS)})
                        stopped = True
                        break
                    yield _sse({"type": "tool", "id": call.id, "name": call.name, "args": call.args or {}})
                elif call.name in DELEGATES:
                    task = (call.args or {}).get("request", "")
                    yield _sse({"type": "agent", "name": call.name, "state": "working", "task": task})
                else:
                    yield _sse({"type": "step", "name": call.name})
            if stopped:
                break
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


async def _run_with_progress(run: AsyncGenerator[Event, None]) -> AsyncGenerator[Event | str, None]:
    """The run's events, with the progress lines its data tools report (app/agents/progress.py) as
    plain strings in between. A tool reports while the run waits on it, so the run goes on in its
    own task and both kinds of item meet in one queue."""
    items: asyncio.Queue[tuple[str, Event | str | Exception | None]] = asyncio.Queue()

    async def pump() -> None:
        try:
            async for event in run:
                await items.put(("event", event))
        except Exception as error:  # handed to the reader, which raises it in its own task
            await items.put(("error", error))
        else:
            await items.put(("end", None))

    # The task copies this context, so the tools it runs see the reporter.
    token = progress.reporter.set(lambda text: items.put_nowait(("progress", text)))
    task = asyncio.create_task(pump())
    progress.reporter.reset(token)
    try:
        while True:
            kind, item = await items.get()
            if kind == "end":
                return
            if kind == "error":
                raise item
            yield item
    finally:
        # The reader stopped early (a browser tool cap, or the person left): stop the run too.
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await run.aclose()


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
        session_service=sessions(),
        memory_service=AssistantMemory(),  # load_memory reads the owner's facts, then their analyses
    )


async def _forget_old_sessions() -> None:
    """Delete in-memory sessions idle past SESSION_SECONDS so memory stays bounded."""
    svc = sessions()
    if not isinstance(svc, InMemorySessionService):
        return
    cutoff = time.time() - SESSION_SECONDS
    for session_id, (last_active, user_id) in list(_last_active.items()):
        if last_active < cutoff:
            del _last_active[session_id]
            await svc.delete_session(app_name=APP_NAME, user_id=user_id, session_id=session_id)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"
