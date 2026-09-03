"""Deterministic offline agents used by every architecture."""

from __future__ import annotations

from collections.abc import Iterable

from ..common.models import AgentContext, AgentResult, EvidenceItem, Task

WORKER_ROLES = ("evidence_verifier", "quantitative_verifier", "validity_verifier")

_WORKER_CASE_PROFILES: dict[str, dict[str, tuple[str, float, str, bool]]] = {
    "supported_claim": {
        "evidence_verifier": (
            "The supplied paragraph directly compares Method A with baseline B.",
            0.84,
            "supported",
            True,
        ),
        "quantitative_verifier": (
            "The table reports a 12.3 percentage-point improvement for Method A.",
            0.82,
            "supported",
            True,
        ),
        "validity_verifier": (
            "The claim is supported for the reported experiment but should not be generalized beyond it.",
            0.76,
            "supported",
            True,
        ),
    },
    "refuted_claim": {
        "evidence_verifier": (
            "The supplied source contradicts the claimed improvement.",
            0.87,
            "refuted",
            True,
        ),
        "quantitative_verifier": (
            "The reported values show Method C is 5 points below baseline D.",
            0.91,
            "refuted",
            True,
        ),
        "validity_verifier": (
            "The claim is not valid for the reported experiment because the difference is reversed.",
            0.86,
            "refuted",
            True,
        ),
    },
    "overclaim": {
        "evidence_verifier": (
            "The supplied evidence supports an improvement on one held-out test set.",
            0.80,
            "supported",
            True,
        ),
        "quantitative_verifier": (
            "The reported values support the comparison within the tested dataset.",
            0.81,
            "supported",
            True,
        ),
        "validity_verifier": (
            "The evidence does not justify generalizing across all datasets or production settings.",
            0.70,
            "partially_supported",
            True,
        ),
    },
    "insufficient_evidence": {
        "evidence_verifier": (
            "The supplied source does not report data needed to verify the claim.",
            0.35,
            "insufficient_evidence",
            False,
        ),
        "quantitative_verifier": (
            "No numerical comparison is available in the supplied evidence.",
            0.30,
            "insufficient_evidence",
            False,
        ),
        "validity_verifier": (
            "The scope of the claim cannot be assessed without supporting results.",
            0.32,
            "insufficient_evidence",
            False,
        ),
    },
}


def _deduplicate_evidence(results: Iterable[AgentResult]) -> tuple[EvidenceItem, ...]:
    items: dict[str, EvidenceItem] = {}
    for result in results:
        for item in result.evidence:
            items.setdefault(item.evidence_id, item)
    return tuple(items.values())


def _worker_case_profile(task: Task, role: str) -> tuple[str, float, str, bool]:
    """Select a deterministic fixture profile without inspecting hidden state."""

    case_name = str(task.metadata.get("mock_case", "supported_claim"))
    profile = _WORKER_CASE_PROFILES.get(case_name, _WORKER_CASE_PROFILES["supported_claim"])
    return profile[role]


def _aggregate_verdict(results: Iterable[AgentResult]) -> str:
    """Combine fixture worker labels into one transparent mock label."""

    verdicts = {result.verdict for result in results}
    if "refuted" in verdicts:
        return "refuted"
    if "insufficient_evidence" in verdicts:
        return "insufficient_evidence"
    if "partially_supported" in verdicts:
        return "partially_supported"
    if verdicts == {"supported"}:
        return "supported"
    return "mixed" if verdicts else "unknown"


class MockAgent:
    """A small deterministic stand-in that exercises orchestration seams.

    The object records received contexts so tests can inspect observable
    application context. It does not call a model, use the network, or infer
    hidden reasoning state.
    """

    def __init__(self, role: str) -> None:
        self.role = role
        self.name = role
        self.received_contexts: list[AgentContext] = []

    async def run(self, task: Task, context: AgentContext) -> AgentResult:
        self.received_contexts.append(context)
        phase = str(context.metadata.get("phase", "worker"))

        if self.role == "team_lead":
            return self._team_lead(task, context, phase)
        if self.role == "root_supervisor":
            return self._root_supervisor(context)
        if self.role in {"evidence_supervisor", "verification_supervisor"}:
            return self._subteam_supervisor(context)
        if self.role in WORKER_ROLES:
            return self._worker(task, context)
        if self.role in {"finalizer", "synthesizer"}:
            return self._synthesis(task, context)
        return AgentResult(
            agent=self.role,
            verdict="unknown",
            confidence=0.0,
            findings=(f"Mock agent {self.role} completed its request.",),
            metadata={"mock": True, "phase": phase},
        )

    def _team_lead(self, task: Task, context: AgentContext, phase: str) -> AgentResult:
        if phase == "magentic_plan":
            return AgentResult(
                agent=self.role,
                verdict="in_progress",
                confidence=1.0,
                findings=("The team lead created a three-role verification plan.",),
                metadata={
                    "mock": True,
                    "phase": phase,
                    "plan": [
                        "Verify whether the supplied source supports the claim.",
                        "Check the numerical comparison against the reported data.",
                        "Check validity boundaries and possible overclaiming.",
                    ],
                },
            )

        if phase in {"magentic_route", "isolated_route"}:
            completed = set(context.metadata.get("completed_roles", ()))
            next_role = next((role for role in WORKER_ROLES if role not in completed), None)
            if next_role is None:
                return AgentResult(
                    agent=self.role,
                    verdict="in_progress",
                    confidence=1.0,
                    metadata={"mock": True, "phase": phase, "action": "finalize"},
                )
            return AgentResult(
                agent=self.role,
                verdict="in_progress",
                confidence=1.0,
                metadata={
                    "mock": True,
                    "phase": phase,
                    "action": "delegate",
                    "agent": next_role,
                    "instruction": f"Perform the {next_role} check and return structured findings.",
                },
            )

        if phase in {"magentic_finalize", "isolated_finalize"}:
            return self._synthesis(task, context, agent_name=self.role)

        return AgentResult(
            agent=self.role,
            verdict="in_progress",
            confidence=1.0,
            metadata={"mock": True, "phase": phase},
        )

    def _root_supervisor(self, context: AgentContext) -> AgentResult:
        completed = set(context.metadata.get("completed_nodes", ()))
        next_node = next(
            (node for node in ("evidence_team", "verification_team") if node not in completed),
            "finalizer",
        )
        return AgentResult(
            agent=self.role,
            verdict="in_progress",
            confidence=1.0,
            metadata={"mock": True, "phase": "root_route", "next": next_node},
        )

    def _subteam_supervisor(self, context: AgentContext) -> AgentResult:
        completed = set(context.metadata.get("completed_roles", ()))
        if self.role == "evidence_supervisor":
            candidates = ("evidence_verifier",)
        else:
            candidates = ("quantitative_verifier", "validity_verifier")
        next_role = next((role for role in candidates if role not in completed), None)
        return AgentResult(
            agent=self.role,
            verdict="in_progress",
            confidence=1.0,
            metadata={
                "mock": True,
                "phase": "team_route",
                "next": next_role or "done",
            },
        )

    def _worker(self, task: Task, context: AgentContext) -> AgentResult:
        finding, confidence, verdict, include_evidence = _worker_case_profile(task, self.role)
        return AgentResult(
            agent=self.role,
            verdict=verdict,
            confidence=confidence,
            evidence=tuple(task.evidence) if include_evidence else (),
            findings=(finding,),
            metadata={
                "mock": True,
                "focus": self.role,
                "mock_case": task.metadata.get("mock_case", "supported_claim"),
                "visible_peer_result_count": len(context.visible_agent_results),
                "context_policy": context.metadata.get("context_policy", "open"),
            },
        )

    def _synthesis(
        self,
        task: Task,
        context: AgentContext,
        *,
        agent_name: str | None = None,
    ) -> AgentResult:
        results = tuple(context.visible_agent_results)
        if not results:
            raw_results = context.global_information.get("worker_results", ())
            results = tuple(item for item in raw_results if isinstance(item, AgentResult))
        confidence = sum(item.confidence for item in results) / len(results) if results else 0.0
        findings = tuple(item.findings[0] for item in results if item.findings)
        verdict = (
            _aggregate_verdict(results)
            if results and all(item.success for item in results)
            else "unknown"
        )
        evidence = _deduplicate_evidence(results)
        if not results:
            evidence = tuple(context.visible_evidence)
        return AgentResult(
            agent=agent_name or self.role,
            verdict=verdict,
            confidence=round(confidence, 3),
            evidence=evidence,
            findings=("The mock synthesis combines the specialist checks.", *findings),
            metadata={
                "mock": True,
                "phase": context.metadata.get("phase", "synthesis"),
                "worker_result_count": len(results),
                "worker_verdicts": [item.verdict for item in results],
                "blackboard_version": context.global_information.get("blackboard", {}).get("version")
                if isinstance(context.global_information.get("blackboard"), dict)
                else None,
            },
        )
