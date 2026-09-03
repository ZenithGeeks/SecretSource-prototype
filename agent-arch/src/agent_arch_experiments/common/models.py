"""Small typed models shared by every architecture."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def _jsonable(value: Any) -> Any:
    """Convert the small model graph into JSON-friendly values."""

    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value


@dataclass(frozen=True, slots=True)
class EvidenceItem:
    """One application-visible piece of source evidence."""

    evidence_id: str
    source: str
    excerpt: str
    location: str = ""
    kind: str = "paragraph"
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))


@dataclass(frozen=True, slots=True)
class Task:
    """A generic scientific-verification-like task."""

    task_id: str
    claim: str
    evidence: tuple[EvidenceItem, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_prompt(self) -> str:
        evidence_text = "\n".join(
            f"- {item.evidence_id} ({item.source}, {item.location}): {item.excerpt}"
            for item in self.evidence
        )
        return f"Claim: {self.claim}\nEvidence:\n{evidence_text}".strip()

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))


@dataclass(frozen=True, slots=True)
class AgentContext:
    """The application-visible context supplied to one agent call.

    ``visible_agent_results`` is deliberately explicit. Architectures that
    isolate workers leave it empty; open-context architectures populate it.
    This is an application boundary, not a claim about hidden model state.
    """

    task: Task
    objective: str = ""
    global_information: Mapping[str, Any] = field(default_factory=dict)
    visible_evidence: tuple[EvidenceItem, ...] = ()
    visible_agent_results: tuple[AgentResult, ...] = ()
    private_memory: Mapping[str, Any] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(
            {
                "task": self.task,
                "objective": self.objective,
                "global_information": dict(self.global_information),
                "visible_evidence": list(self.visible_evidence),
                "visible_agent_results": list(self.visible_agent_results),
                "private_memory": dict(self.private_memory),
                "metadata": dict(self.metadata),
            }
        )


@dataclass(frozen=True, slots=True)
class AgentResult:
    """Normalized result returned by a mock or future real agent."""

    agent: str
    verdict: str
    confidence: float
    evidence: tuple[EvidenceItem, ...] = ()
    findings: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)
    success: bool = True
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))


@dataclass(frozen=True, slots=True)
class TraceEvent:
    """One structured, application-level execution event."""

    step: int
    actor: str
    event: str
    detail: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))


@dataclass(frozen=True, slots=True)
class ArchitectureResult:
    """Common result envelope returned by all offline architecture runners."""

    architecture_name: str
    final_result: AgentResult
    participating_agents: tuple[str, ...]
    trace: tuple[TraceEvent, ...]
    number_of_agent_calls: int
    execution_steps: int
    execution_time: float
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return self.final_result.success

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))
