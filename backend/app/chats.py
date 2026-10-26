"""The assistant's chats, kept as ADK sessions (app/sessions.py): one session per chat.

A chat belongs to the user who started it. Its ADK user id is theirs (memory.SIGNED_OUT with
login off), and ADK looks a session up by app, user and id, so another user's chat id finds
nothing and the route answers 404, as ownership.require_owner does for analyses.

Each question is a user event. Its state_delta records the screen it was asked from, so the
session state holds the current screen, analysis and graph node, and the prompt history does
not. Each reply is one event by "assistant" whose custom_metadata holds the statements with
their verdicts, so a chat reopened later shows the same stamps.

ADK is imported on first use, not with the gateway: it adds about 0.6 s to a cold start.
"""

import time
import uuid
from typing import TYPE_CHECKING, NamedTuple

from app.sessions import SIGNED_OUT, session_service

if TYPE_CHECKING:
    from google.adk.sessions import Session

APP_NAME = "secretsource-assistant"
TITLE_LENGTH = 80  # a chat's title is its first question, cut to this many characters
APPEND_ATTEMPTS = 3
IDLE_SECONDS = 30 * 60  # a chat untouched this long is finished, and its facts can be distilled
# Writing the distilled_at marker is itself an event, which moves the chat's last update to
# about distilled_at. A later question moves it well past this.
MARKER_SLACK_SECONDS = 5

_service = None  # built on first use: a database service opens its engine when built


def service():
    """The session service every chat uses, from app/sessions.py."""
    global _service
    if _service is None:
        _service = session_service()
    return _service


def adk_user(user: str | None) -> str:
    """The ADK user id for a gateway user: their Supabase id, or SIGNED_OUT when login is off."""
    return SIGNED_OUT if user is None else user


def summary(session: "Session") -> dict:
    """The chat as a list shows it: id, title and when it last changed."""
    return {
        "id": session.id,
        "title": session.state.get("title", ""),
        "updated": session.last_update_time,
    }


def messages(session: "Session") -> list[dict]:
    """The chat's questions and replies, oldest first."""
    shown = []
    for event in session.events:
        if event.author == "user" and event.content:
            text = "".join(part.text or "" for part in event.content.parts or [])
            shown.append({"role": "user", "text": text, "at": event.timestamp})
        elif event.author == "assistant" and event.custom_metadata:
            shown.append({"role": "assistant", **event.custom_metadata, "at": event.timestamp})
    return shown


def distill_lines(chat_messages: list[dict]) -> list[str]:
    """The chat as the distill step (app/distill.py) and the follow-up rewrite
    (assistant.standalone_question) see it: each question, and each statement the judge backed,
    meaning its verdict is "supports". Any other statement is left out, so it can never become
    a fact or change what a follow-up means."""
    lines = []
    for message in chat_messages:
        if message["role"] == "user":
            lines.append(f"user asked: {message['text']}")
            continue
        for statement in message.get("statements", []):
            if statement.get("verdict") == "supports":
                lines.append(f"assistant said, backed by {statement['source']}: {statement['text']}")
    return lines


async def start(user: str | None, context: dict) -> "Session":
    """A new chat of this user's, opened from the screen in `context`."""
    return await service().create_session(
        app_name=APP_NAME, user_id=adk_user(user), state={"title": "", **context}
    )


async def find(user: str | None, chat_id: str) -> "Session | None":
    """The chat, or None if this user has no chat with this id."""
    return await service().get_session(app_name=APP_NAME, user_id=adk_user(user), session_id=chat_id)


async def mine(user: str | None) -> list["Session"]:
    """This user's chats, newest first, without their events."""
    listed = await service().list_sessions(app_name=APP_NAME, user_id=adk_user(user))
    return sorted(listed.sessions, key=lambda session: session.last_update_time, reverse=True)


class Asked(NamedTuple):
    """A recorded question: its turn's invocation id, and the chat before it (distill_lines)."""

    turn: str
    earlier: list[str]


async def add_question(user: str | None, chat_id: str, question: str, context: dict) -> Asked | None:
    """Record a question and the screen it came from. Returns its turn and the chat before it,
    or None if this user has no chat with this id."""
    from google.adk.events import Event, EventActions
    from google.genai import types

    turn = f"e-{uuid.uuid4()}"
    earlier: list[str] = []

    def question_event(session: "Session") -> Event:
        # _append has just read the chat, so the lines before this question cost no extra read.
        nonlocal earlier
        earlier = distill_lines(messages(session))
        state = dict(context)
        if not session.state.get("title"):
            state["title"] = question[:TITLE_LENGTH]
        return Event(
            invocation_id=turn,
            author="user",
            content=types.Content(role="user", parts=[types.Part(text=question)]),
            actions=EventActions(state_delta=state),
            timestamp=time.time(),
        )

    return Asked(turn, earlier) if await _append(user, chat_id, question_event) else None


async def add_reply(user: str | None, chat_id: str, turn: str, statements: list[dict]) -> None:
    """Record the reply's statements and verdicts."""
    from google.adk.events import Event
    from google.genai import types

    text = "\n".join(statement["text"] for statement in statements)
    reply = Event(
        invocation_id=turn,
        author="assistant",
        content=types.Content(role="model", parts=[types.Part(text=text)]),
        custom_metadata={"statements": statements},
        timestamp=time.time(),
    )
    await _append(user, chat_id, lambda session: reply)


async def mark_distilled(user: str, chat_id: str, at: float) -> None:
    """Record `at`, the time the chat was queued for distilling, as distilled_at in its state.
    due_for_distill compares it with the chat's last update."""
    from google.adk.events import Event, EventActions

    marker = Event(
        invocation_id=f"e-{uuid.uuid4()}",
        author="distill",
        actions=EventActions(state_delta={"distilled_at": at}),
        timestamp=at,
    )
    await _append(user, chat_id, lambda session: marker)


def due_for_distill(sessions: list["Session"], now: float, leaving: str | None = None) -> list[str]:
    """The chats to distill: changed since their last distill, and either idle for IDLE_SECONDS
    or the one the user is leaving. `sessions` come from mine(), which carries their state."""
    due = []
    for session in sessions:
        distilled_at = session.state.get("distilled_at", 0)
        if session.last_update_time <= distilled_at + MARKER_SLACK_SECONDS:
            continue
        if session.id == leaving or now - session.last_update_time > IDLE_SECONDS:
            due.append(session.id)
    return due


async def _append(user: str | None, chat_id: str, build_event) -> bool:
    """Append build_event(session) to the chat. False if the chat is not this user's.

    The database service refuses an event for a session read before another write to it
    (StaleSessionError): two questions to one chat, from two tabs. Read it again and retry.
    """
    from google.adk.errors import StaleSessionError

    for attempt in range(APPEND_ATTEMPTS):
        session = await find(user, chat_id)
        if session is None:
            return False
        try:
            await service().append_event(session, build_event(session))
            return True
        except StaleSessionError:
            if attempt == APPEND_ATTEMPTS - 1:
                raise
    return False
