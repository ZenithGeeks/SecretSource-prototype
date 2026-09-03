"""The architecture-neutral agent seam."""

from __future__ import annotations

import inspect
from collections.abc import Mapping
from typing import Any, Protocol, TypeAlias

from .models import AgentContext, AgentResult, Task
from .tracing import TraceRecorder


class Agent(Protocol):
    """Minimal async interface required by the architecture code."""

    name: str
    role: str

    async def run(self, task: Task, context: AgentContext) -> AgentResult:
        """Process one task using only the supplied application context."""


AgentRegistry: TypeAlias = Mapping[str, Agent]


def normalize_agent_result(agent_name: str, raw: Any) -> AgentResult:
    """Normalize a compatible future adapter result without framework imports."""

    if isinstance(raw, AgentResult):
        return raw
    if isinstance(raw, str):
        return AgentResult(agent=agent_name, verdict="unknown", confidence=0.0, findings=(raw,))
    if isinstance(raw, Mapping):
        raw_evidence = raw.get("evidence", ())
        evidence = tuple(item for item in raw_evidence if hasattr(item, "evidence_id"))
        raw_findings = raw.get("findings", raw.get("facts", ()))
        if isinstance(raw_findings, str):
            raw_findings = (raw_findings,)
        return AgentResult(
            agent=str(raw.get("agent", agent_name)),
            verdict=str(raw.get("verdict", "unknown")),
            confidence=float(raw.get("confidence", 0.0)),
            evidence=evidence,
            findings=tuple(str(item) for item in raw_findings or ()),
            metadata=dict(raw.get("metadata", {})),
            success=bool(raw.get("success", True)),
            error=raw.get("error"),
        )
    return AgentResult(agent=agent_name, verdict="unknown", confidence=0.0, findings=(str(raw),))


async def invoke_agent(
    agents: AgentRegistry,
    role: str,
    task: Task,
    context: AgentContext,
    trace: TraceRecorder,
    *,
    metadata: Mapping[str, Any] | None = None,
) -> AgentResult:
    """Call one named agent and add standard start/finish trace events."""

    if role not in agents:
        available = ", ".join(sorted(agents))
        raise KeyError(f"Agent role {role!r} is not configured. Available roles: {available}")

    agent = agents[role]
    call_metadata = {"role": role, **dict(metadata or {})}
    trace.record(role, "agent_started", f"Started {role}.", **call_metadata)
    trace.agent_calls += 1
    try:
        raw_result = agent.run(task, context)
        if inspect.isawaitable(raw_result):
            raw_result = await raw_result
        result = normalize_agent_result(getattr(agent, "name", role), raw_result)
    except Exception as exc:
        trace.record(
            role,
            "agent_failed",
            f"{role} raised {type(exc).__name__}.",
            error=str(exc),
            **call_metadata,
        )
        raise
    trace.record(
        role,
        "agent_finished",
        f"Finished {role}.",
        verdict=result.verdict,
        confidence=result.confidence,
        success=result.success,
        **call_metadata,
    )
    return result
