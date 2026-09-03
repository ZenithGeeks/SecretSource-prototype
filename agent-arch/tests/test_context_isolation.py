from __future__ import annotations

import asyncio

from agent_arch_experiments.agents.mock_agents import WORKER_ROLES
from agent_arch_experiments.agents.provider import build_agents
from agent_arch_experiments.architectures.magentic_context_isolation.architecture import (
    MagenticContextIsolationArchitecture,
)
from agent_arch_experiments.examples.sample_tasks import sample_task


def test_context_policy_excludes_peer_results_from_every_worker() -> None:
    agents = build_agents()
    result = asyncio.run(MagenticContextIsolationArchitecture(agents).run(sample_task()))

    for role in WORKER_ROLES:
        contexts = agents[role].received_contexts
        assert contexts
        assert all(context.visible_agent_results == () for context in contexts)
        assert all("worker_results" not in context.global_information for context in contexts)

    manager_contexts = agents["team_lead"].received_contexts
    assert any(
        context.metadata.get("phase") == "isolated_finalize" and len(context.visible_agent_results) == 3
        for context in manager_contexts
    )
    audits = result.metadata["context_audits"]
    assert len(audits) == 3
    assert all(audit["peer_results_excluded"] for audit in audits)
    assert all(audit["fresh_request"] for audit in audits)
    assert result.metadata["hidden_chain_of_thought_claim"] is False
