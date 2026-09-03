"""Simple structured tracing and timing helpers."""

from __future__ import annotations

from collections.abc import Mapping
from time import monotonic
from typing import Any

from .models import AgentResult, ArchitectureResult, TraceEvent


class TraceRecorder:
    """Append-only trace recorder used by every architecture."""

    def __init__(self, architecture_name: str) -> None:
        self.architecture_name = architecture_name
        self.events: list[TraceEvent] = []
        self.agent_calls = 0
        self.started_at = monotonic()

    def record(
        self,
        actor: str,
        event: str,
        detail: str = "",
        **metadata: Any,
    ) -> TraceEvent:
        item = TraceEvent(
            step=len(self.events) + 1,
            actor=actor,
            event=event,
            detail=detail,
            metadata={"architecture": self.architecture_name, **metadata},
        )
        self.events.append(item)
        return item

    @property
    def elapsed(self) -> float:
        return monotonic() - self.started_at


def build_architecture_result(
    architecture_name: str,
    final_result: AgentResult,
    trace: TraceRecorder,
    *,
    participating_agents: tuple[str, ...] | list[str] = (),
    metadata: Mapping[str, Any] | None = None,
) -> ArchitectureResult:
    """Build the common result envelope without imposing orchestration policy."""

    return ArchitectureResult(
        architecture_name=architecture_name,
        final_result=final_result,
        participating_agents=tuple(dict.fromkeys(participating_agents)),
        trace=tuple(trace.events),
        number_of_agent_calls=trace.agent_calls,
        execution_steps=len(trace.events),
        execution_time=trace.elapsed,
        metadata=dict(metadata or {}),
    )
