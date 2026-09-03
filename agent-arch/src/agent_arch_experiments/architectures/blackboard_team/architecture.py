"""A3: independent workers coordinate through a structured blackboard."""

from __future__ import annotations

import asyncio
from dataclasses import replace

from ...agents.mock_agents import WORKER_ROLES
from ...agents.provider import build_agents
from ...common.interfaces import AgentRegistry, invoke_agent
from ...common.models import AgentContext, AgentResult, ArchitectureResult, Task
from ...common.tracing import TraceRecorder, build_architecture_result
from .blackboard import Blackboard

ARCHITECTURE_NAME = "blackboard_team"


class BlackboardTeamArchitecture:
    """Run specialists that publish findings instead of receiving directives."""

    name = ARCHITECTURE_NAME

    def __init__(self, agents: AgentRegistry | None = None) -> None:
        self.agents = build_agents() if agents is None else agents

    async def run(self, task: Task) -> ArchitectureResult:
        trace = TraceRecorder(self.name)
        board = Blackboard(task)
        worker_results: list[AgentResult] = []

        async def run_worker(role: str) -> None:
            board_before = board.get_snapshot()
            trace.record(
                role,
                "blackboard_read",
                f"{role} read structured board version {board_before['version']}.",
                board_version=board_before["version"],
            )
            result = await invoke_agent(
                self.agents,
                role,
                task,
                AgentContext(
                    task=task,
                    objective=f"Perform the {role} check and publish structured findings.",
                    visible_evidence=task.evidence,
                    global_information={"blackboard": board_before},
                    # Blackboard state, not peer message history, is the shared channel.
                    visible_agent_results=(),
                    metadata={
                        "phase": "blackboard_worker",
                        "blackboard_version": board_before["version"],
                        "context_policy": "blackboard_only",
                    },
                ),
                trace,
            )
            for evidence in result.evidence:
                board.add_evidence(evidence, agent=result.agent)
            evidence_ids = tuple(item.evidence_id for item in result.evidence)
            for finding in result.findings:
                board.add_finding(
                    agent=result.agent,
                    kind=role,
                    statement=finding,
                    confidence=result.confidence,
                    evidence_ids=evidence_ids,
                )
            if result.verdict == "refuted":
                board.add_contradiction(
                    agent=result.agent,
                    statement="Mock worker reported a refutation.",
                    evidence_ids=evidence_ids,
                )
            board.record_confidence(
                agent=result.agent,
                value=result.confidence,
                rationale=f"{role} assessment.",
            )
            worker_results.append(result)
            after = board.get_snapshot()
            trace.record(
                role,
                "blackboard_write",
                f"{role} published structured findings at board version {after['version']}.",
                board_version=after["version"],
                evidence_count=len(result.evidence),
                finding_count=len(result.findings),
            )

        # The workers are independent. They read the board and publish to it;
        # there is deliberately no Magentic or other supervisor in this path.
        await asyncio.gather(*(run_worker(role) for role in WORKER_ROLES))

        synthesis_snapshot = board.get_snapshot()
        trace.record(
            "synthesizer",
            "blackboard_read",
            "Synthesizer read the complete structured blackboard.",
            board_version=synthesis_snapshot["version"],
        )
        synthesis = await invoke_agent(
            self.agents,
            "synthesizer",
            task,
            AgentContext(
                task=task,
                objective="Synthesize the final result from the structured blackboard.",
                visible_evidence=tuple(board.state.evidence),
                visible_agent_results=tuple(worker_results),
                global_information={
                    "blackboard": synthesis_snapshot,
                    "worker_results": tuple(worker_results),
                },
                metadata={
                    "phase": "blackboard_synthesis",
                    "blackboard_version": synthesis_snapshot["version"],
                },
            ),
            trace,
        )
        final_result = replace(
            synthesis,
            evidence=tuple(board.state.evidence),
            metadata={**dict(synthesis.metadata), "blackboard_version": board.state.version},
        )
        board.add_finding(
            agent="synthesizer",
            kind="synthesis",
            statement="The final result was generated from the complete blackboard snapshot.",
            confidence=final_result.confidence,
            evidence_ids=[item.evidence_id for item in board.state.evidence],
        )
        trace.record(
            "synthesizer",
            "blackboard_write",
            "Synthesizer recorded the final board-linked finding.",
            board_version=board.state.version,
        )
        trace.record("synthesizer", "final_decision", "Finalized from structured blackboard state.")
        return build_architecture_result(
            self.name,
            final_result,
            trace,
            participating_agents=(*WORKER_ROLES, "synthesizer"),
            metadata={
                "runtime": "offline_structured_blackboard",
                "information_flow": "shared_structured_state",
                "blackboard": board.get_snapshot(),
            },
        )
