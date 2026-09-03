"""Thin adapter around Microsoft's current MagenticBuilder API.

The adapter intentionally does not manufacture fake Microsoft agents. Callers
must provide official Agent Framework participant objects, normally backed by
a real model client.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


class MicrosoftAgentFrameworkUnavailable(RuntimeError):
    """Raised when the optional Microsoft Agent Framework is unavailable."""


def build_magentic_workflow(
    participants: Sequence[Any],
    *,
    manager_agent: Any | None = None,
    max_round_count: int = 8,
    max_stall_count: int = 3,
    max_reset_count: int = 2,
):
    """Build an official Magentic workflow using the current builder API."""

    try:
        from agent_framework.orchestrations import MagenticBuilder
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise MicrosoftAgentFrameworkUnavailable(
            "Microsoft Agent Framework is not installed. Install it with: "
            "python -m pip install -e \".[magentic]\""
        ) from exc

    options: dict[str, Any] = {
        "participants": list(participants),
        # Current agent-framework-orchestrations exposes this allow-list
        # instead of the older ``intermediate_outputs`` boolean.
        "intermediate_output_from": "all_other",
        "max_round_count": max_round_count,
        "max_stall_count": max_stall_count,
        "max_reset_count": max_reset_count,
    }
    if manager_agent is not None:
        options["manager_agent"] = manager_agent
    return MagenticBuilder(**options).build()
