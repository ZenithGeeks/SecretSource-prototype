"""Architecture-neutral contracts, models, and tracing."""

from .interfaces import Agent, AgentRegistry, invoke_agent
from .models import (
    AgentContext,
    AgentResult,
    ArchitectureResult,
    EvidenceItem,
    Task,
    TraceEvent,
)
from .tracing import TraceRecorder, build_architecture_result

__all__ = [
    "Agent",
    "AgentContext",
    "AgentRegistry",
    "AgentResult",
    "ArchitectureResult",
    "EvidenceItem",
    "Task",
    "TraceEvent",
    "TraceRecorder",
    "build_architecture_result",
    "invoke_agent",
]
