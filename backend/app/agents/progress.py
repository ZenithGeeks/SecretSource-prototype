"""How far a slow data tool got, for the person watching the chat.

app/agent_runs.py sets `reporter` for one streamed run and sends each line as a "progress" event.
The MCP server and the /commands route leave it unset, so report() does nothing there. Kept apart
from data_tools.py so the gateway can import it at start without loading DSPy.
"""

from collections.abc import Callable
from contextvars import ContextVar

reporter: ContextVar[Callable[[str], None] | None] = ContextVar("progress_reporter", default=None)


def report(text: str) -> None:
    """Send one progress line to the chat, when a streamed run is listening."""
    if (send := reporter.get()) is not None:
        send(text)
