from __future__ import annotations

import asyncio

import pytest

from agent_arch_experiments.agents.provider import build_agents
from agent_arch_experiments.architectures.hierarchical_langgraph.architecture import (
    HierarchicalLangGraphArchitecture,
)
from agent_arch_experiments.architectures.hierarchical_langgraph.graph import LANGGRAPH_AVAILABLE
from agent_arch_experiments.examples.sample_tasks import sample_task


@pytest.mark.skipif(not LANGGRAPH_AVAILABLE, reason="LangGraph optional dependency is not installed")
def test_hierarchical_graph_compiles_and_proves_root_subteam_worker_flow() -> None:
    result = asyncio.run(HierarchicalLangGraphArchitecture(build_agents()).run(sample_task()))

    actors = [event.actor for event in result.trace]
    event_names = [event.event for event in result.trace]
    assert result.architecture_name == "hierarchical_langgraph"
    assert result.success
    assert {"root_supervisor", "evidence_supervisor", "verification_supervisor", "finalizer"}.issubset(
        set(actors)
    )
    assert "subteam_selected" in event_names
    assert "delegated_task" in event_names
    assert result.metadata["runtime"] == "langgraph"
    assert "Root Supervisor" in result.metadata["mermaid"]
