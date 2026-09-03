from __future__ import annotations

import asyncio

from agent_arch_experiments.agents.provider import build_agents
from agent_arch_experiments.evaluation.agentarch.adapter import AgentArchAdapter
from agent_arch_experiments.evaluation.metrics import summarize_result
from agent_arch_experiments.evaluation.runner import run_suite, run_tasks
from agent_arch_experiments.examples.sample_tasks import sample_task, sample_tasks


def test_evaluation_runs_same_task_and_returns_four_named_records() -> None:
    task = sample_task()
    evaluations = asyncio.run(run_suite(task, agents=build_agents()))

    assert [item.architecture_name for item in evaluations] == [
        "magentic_team",
        "hierarchical_langgraph",
        "blackboard_team",
        "magentic_context_isolation",
    ]
    successful = [item for item in evaluations if item.result is not None]
    assert len(successful) >= 3
    for item in successful:
        metrics = summarize_result(item.result)
        assert metrics["architecture_name"] == item.architecture_name
        assert metrics["agent_call_count"] > 0


def test_agentarch_adapter_does_not_claim_native_metrics() -> None:
    evaluations = asyncio.run(
        run_suite(task := sample_task(), agents=build_agents(), architecture_names=("magentic_team",))
    )
    result = evaluations[0].result
    assert result is not None
    record = AgentArchAdapter().to_record(task, result)
    assert record["adapter"] == "servicenow_agentarch_adapted"
    assert record["native_agentarch_metrics_available"] is False
    assert record["record_history"]
    assert record["ground_truth"] is None


def test_multi_case_evaluation_runs_every_architecture_on_every_case() -> None:
    cases = asyncio.run(run_tasks(sample_tasks(), agents=build_agents()))

    assert [case.task.task_id for case in cases] == [
        "sample-method-a-001",
        "sample-method-c-002",
        "sample-method-a-003",
        "sample-method-z-004",
    ]
    for case in cases:
        successful = [item for item in case.evaluations if item.result is not None]
        assert len(successful) >= 3
        for evaluation in successful:
            assert evaluation.result.final_result.verdict == case.task.metadata["fixture_expected_verdict"]
