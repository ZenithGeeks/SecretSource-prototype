"""Public A2 architecture wrapper."""

from __future__ import annotations

from ...agents.provider import build_agents
from ...common.interfaces import AgentRegistry
from ...common.models import ArchitectureResult, Task
from ...common.tracing import build_architecture_result
from .graph import run_hierarchical


class HierarchicalLangGraphArchitecture:
    """Root supervisor → sub-team supervisor → worker hierarchy."""

    name = "hierarchical_langgraph"

    def __init__(self, agents: AgentRegistry | None = None) -> None:
        self.agents = build_agents() if agents is None else agents

    async def run(self, task: Task) -> ArchitectureResult:
        final_result, trace, metadata = await run_hierarchical(task, agents=self.agents)
        return build_architecture_result(
            self.name,
            final_result,
            trace,
            participating_agents=(
                "root_supervisor",
                "evidence_supervisor",
                "evidence_verifier",
                "verification_supervisor",
                "quantitative_verifier",
                "validity_verifier",
                "finalizer",
            ),
            metadata={"runtime": "langgraph", **metadata},
        )
