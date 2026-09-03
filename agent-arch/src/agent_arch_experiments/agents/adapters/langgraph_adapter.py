"""Optional import boundary for the official LangGraph primitives."""

from __future__ import annotations


class LangGraphUnavailable(RuntimeError):
    """Raised when the optional LangGraph dependency is not installed."""


def require_langgraph():
    """Return current LangGraph graph primitives or a useful install error."""

    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise LangGraphUnavailable(
            "LangGraph is not installed. Install it with: "
            "python -m pip install -e \".[langgraph]\""
        ) from exc
    return StateGraph, START, END
