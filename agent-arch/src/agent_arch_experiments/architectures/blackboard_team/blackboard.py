"""Structured shared evidence state for A3."""

from __future__ import annotations

from collections.abc import Iterable
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from ...common.models import EvidenceItem, Task


@dataclass(frozen=True, slots=True)
class BlackboardFinding:
    finding_id: str
    agent: str
    kind: str
    statement: str
    confidence: float | None = None
    evidence_ids: tuple[str, ...] = ()
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self) | {"evidence_ids": list(self.evidence_ids)}


@dataclass
class BlackboardState:
    """Typed, inspectable state rather than an unstructured message list."""

    task: Task
    evidence: list[EvidenceItem] = field(default_factory=list)
    findings: list[BlackboardFinding] = field(default_factory=list)
    contradictions: list[dict[str, Any]] = field(default_factory=list)
    confidence: dict[str, float] = field(default_factory=dict)
    provenance: dict[str, list[str]] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    version: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "task": self.task.to_dict(),
            "claim": self.task.claim,
            "evidence": [item.to_dict() for item in self.evidence],
            "findings": [item.to_dict() for item in self.findings],
            "contradictions": deepcopy(self.contradictions),
            "confidence": dict(self.confidence),
            "provenance": deepcopy(self.provenance),
            "events": deepcopy(self.events),
            "version": self.version,
        }


class Blackboard:
    """Central structured state store used as the team communication channel."""

    def __init__(self, task: Task) -> None:
        self.state = BlackboardState(task=task)

    def _event(self, operation: str, actor: str, detail: str) -> None:
        self.state.version += 1
        self.state.events.append(
            {
                "operation": operation,
                "actor": actor,
                "detail": detail,
                "version": self.state.version,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    def add_evidence(self, evidence: EvidenceItem, *, agent: str) -> EvidenceItem:
        """Publish source evidence, retaining its identity and provenance."""

        if not any(item.evidence_id == evidence.evidence_id for item in self.state.evidence):
            self.state.evidence.append(evidence)
        self.state.provenance.setdefault(evidence.evidence_id, [])
        if agent not in self.state.provenance[evidence.evidence_id]:
            self.state.provenance[evidence.evidence_id].append(agent)
        self._event("add_evidence", agent, f"Published evidence {evidence.evidence_id}.")
        return evidence

    def add_finding(
        self,
        *,
        agent: str,
        kind: str,
        statement: str,
        confidence: float | None = None,
        evidence_ids: Iterable[str] = (),
    ) -> BlackboardFinding:
        """Publish a typed finding linked to evidence identifiers."""

        if confidence is not None and not 0.0 <= confidence <= 1.0:
            raise ValueError("Finding confidence must be between 0 and 1.")
        finding = BlackboardFinding(
            finding_id=f"finding-{len(self.state.findings) + 1:04d}",
            agent=agent,
            kind=kind,
            statement=statement,
            confidence=confidence,
            evidence_ids=tuple(evidence_ids),
        )
        self.state.findings.append(finding)
        self.state.provenance[finding.finding_id] = list(finding.evidence_ids)
        self._event("add_finding", agent, f"Published {kind} finding {finding.finding_id}.")
        return finding

    def add_contradiction(
        self,
        *,
        agent: str,
        statement: str,
        evidence_ids: Iterable[str] = (),
    ) -> dict[str, Any]:
        """Publish a structured contradiction and its supporting identifiers."""

        contradiction = {
            "contradiction_id": f"contradiction-{len(self.state.contradictions) + 1:04d}",
            "agent": agent,
            "statement": statement,
            "evidence_ids": list(evidence_ids),
        }
        self.state.contradictions.append(contradiction)
        self._event("add_contradiction", agent, contradiction["contradiction_id"])
        return contradiction

    def record_confidence(self, *, agent: str, value: float, rationale: str = "") -> None:
        """Record the latest confidence assessment for an agent."""

        if not 0.0 <= value <= 1.0:
            raise ValueError("Confidence must be between 0 and 1.")
        self.state.confidence[agent] = value
        self._event("record_confidence", agent, rationale or f"Confidence={value:.3f}.")

    def read(self) -> dict[str, Any]:
        """Read a JSON-friendly snapshot of all structured shared state."""

        return self.get_snapshot()

    def get_snapshot(self) -> dict[str, Any]:
        """Return a defensive copy suitable for an agent context."""

        return deepcopy(self.state.to_dict())

    def snapshot(self) -> dict[str, Any]:
        """Alias used by examples and tests."""

        return self.get_snapshot()
