"""Thin optional adapters for official orchestration frameworks."""

from .langgraph_adapter import LangGraphUnavailable, require_langgraph
from .microsoft_adapter import MicrosoftAgentFrameworkUnavailable, build_magentic_workflow

__all__ = [
    "LangGraphUnavailable",
    "MicrosoftAgentFrameworkUnavailable",
    "build_magentic_workflow",
    "require_langgraph",
]
