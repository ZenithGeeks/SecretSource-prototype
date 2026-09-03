"""Explicit application-visible context isolation policy for A4."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ...common.models import AgentContext, AgentResult, EvidenceItem, Task


@dataclass(frozen=True, slots=True)
class ContextAudit:
    """An inspectable record of what a worker context contained."""

    request_id: str
    agent: str
    visible_context_keys: tuple[str, ...]
    visible_evidence_ids: tuple[str, ...]
    visible_peer_result_agents: tuple[str, ...]
    peer_results_excluded: bool
    fresh_request: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "request_id": self.request_id,
            "agent": self.agent,
            "visible_context_keys": list(self.visible_context_keys),
            "visible_evidence_ids": list(self.visible_evidence_ids),
            "visible_peer_result_agents": list(self.visible_peer_result_agents),
            "peer_results_excluded": self.peer_results_excluded,
            "fresh_request": self.fresh_request,
        }


@dataclass
class ContextPolicy:
    """Build fresh worker packets from an allow-list of global information."""

    allowed_global_metadata: tuple[str, ...] = ("paper_id", "citation_id", "source_metadata")
    audits: list[ContextAudit] = field(default_factory=list)

    def build_worker_context(
        self,
        task: Task,
        *,
        agent: str,
        objective: str,
        request_id: str,
        allowed_evidence: tuple[EvidenceItem, ...] | None = None,
    ) -> AgentContext:
        """Create a worker context with no peer outputs or peer message history."""

        global_information = {
            key: task.metadata[key] for key in self.allowed_global_metadata if key in task.metadata
        }
        visible_evidence = task.evidence if allowed_evidence is None else allowed_evidence
        context = AgentContext(
            task=task,
            objective=objective,
            global_information=global_information,
            visible_evidence=tuple(visible_evidence),
            visible_agent_results=(),
            private_memory={},
            metadata={
                "phase": "isolated_worker",
                "context_policy": "isolated",
                "request_id": request_id,
            },
        )
        self.audits.append(
            ContextAudit(
                request_id=request_id,
                agent=agent,
                visible_context_keys=tuple(sorted(global_information)),
                visible_evidence_ids=tuple(item.evidence_id for item in visible_evidence),
                visible_peer_result_agents=(),
                peer_results_excluded=True,
                fresh_request=True,
            )
        )
        return context

    @staticmethod
    def assert_worker_isolated(context: AgentContext, peer_results: tuple[AgentResult, ...]) -> None:
        """Raise if a worker packet accidentally contains a peer result."""

        peer_agents = {result.agent for result in peer_results}
        visible_agents = {result.agent for result in context.visible_agent_results}
        leaked = peer_agents.intersection(visible_agents)
        if leaked:
            raise AssertionError(f"Worker context leaked peer results from: {sorted(leaked)}")
        if "worker_results" in context.global_information:
            raise AssertionError("Worker context contains the forbidden worker_results field.")
