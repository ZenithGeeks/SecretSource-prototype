from __future__ import annotations

import asyncio

from agent_arch_experiments.agents.mock_agents import WORKER_ROLES
from agent_arch_experiments.agents.provider import build_agents
from agent_arch_experiments.common.models import AgentContext
from agent_arch_experiments.examples.sample_tasks import sample_task, sample_tasks


def test_provider_builds_all_controlled_roles() -> None:
    agents = build_agents()
    assert set(WORKER_ROLES).issubset(agents)
    assert {"team_lead", "root_supervisor", "finalizer", "synthesizer"}.issubset(agents)


def test_mock_worker_is_deterministic_and_records_context() -> None:
    task = sample_task()
    agents = build_agents()
    context = AgentContext(task=task, visible_evidence=task.evidence, metadata={"phase": "worker"})

    first = asyncio.run(agents["quantitative_verifier"].run(task, context))
    second = asyncio.run(agents["quantitative_verifier"].run(task, context))

    assert first == second
    assert first.verdict == "supported"
    assert first.confidence == 0.82
    assert len(agents["quantitative_verifier"].received_contexts) == 2


def test_mock_case_suite_has_distinct_deterministic_worker_outcomes() -> None:
    expected_verdicts = {
        "sample-method-a-001": "supported",
        "sample-method-c-002": "refuted",
        "sample-method-a-003": "supported",
        "sample-method-z-004": "insufficient_evidence",
    }
    agents = build_agents()

    for task in sample_tasks():
        context = AgentContext(
            task=task,
            visible_evidence=task.evidence,
            metadata={"phase": "worker"},
        )
        result = asyncio.run(agents["quantitative_verifier"].run(task, context))
        assert result.verdict == expected_verdicts[task.task_id]
