from __future__ import annotations

import asyncio

from agent_arch_experiments.agents.provider import build_agents
from agent_arch_experiments.architectures.magentic_team.architecture import (
    MagenticTeamArchitecture,
    OfficialMagenticRunner,
)
from agent_arch_experiments.examples.sample_tasks import sample_task


def test_magentic_team_dispatches_all_workers_with_open_context() -> None:
    agents = build_agents()
    result = asyncio.run(MagenticTeamArchitecture(agents).run(sample_task()))

    events = [event.event for event in result.trace]
    assert result.architecture_name == "magentic_team"
    assert result.success
    assert result.number_of_agent_calls == 9
    assert "supervisor_selected_agent" in events
    assert "delegated_task" in events
    assert {"evidence_verifier", "quantitative_verifier", "validity_verifier"}.issubset(
        result.participating_agents
    )
    assert result.metadata["information_flow"] == "open_worker_context"
    worker_contexts = [
        context
        for role in ("evidence_verifier", "quantitative_verifier", "validity_verifier")
        for context in agents[role].received_contexts
    ]
    assert any(len(context.visible_agent_results) > 0 for context in worker_contexts)


def test_official_runner_is_explicitly_separate_from_offline_coordinator() -> None:
    assert OfficialMagenticRunner.__name__ == "OfficialMagenticRunner"
    assert OfficialMagenticRunner.name == "magentic_team"
