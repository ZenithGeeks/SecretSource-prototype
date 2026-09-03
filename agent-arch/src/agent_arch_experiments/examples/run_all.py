"""Run the same task through all four architecture entry points."""

from __future__ import annotations

import argparse
import asyncio
import json

from ..agents.provider import build_agents
from ..common.models import Task
from ..evaluation.metrics import summarize_result
from ..evaluation.runner import ArchitectureEvaluation, TaskEvaluation, run_suite, run_tasks
from .sample_tasks import get_sample_task, sample_task, sample_tasks


def _print_table(evaluations: list[ArchitectureEvaluation]) -> None:
    print(f"{'Architecture':<34} {'Calls':>5} {'Steps':>6} {'Time (s)':>9}  Status")
    print("-" * 73)
    for evaluation in evaluations:
        if evaluation.result is None:
            print(
                f"{evaluation.architecture_name:<34} {'-':>5} {'-':>6} {'-':>9}  "
                f"{evaluation.error_kind}: {evaluation.error}"
            )
            continue
        metrics = summarize_result(evaluation.result)
        status = "success" if evaluation.success else "failure"
        print(
            f"{evaluation.architecture_name:<34} "
            f"{metrics['agent_call_count']:>5} "
            f"{metrics['execution_steps']:>6} "
            f"{metrics['execution_time']:>9.4f}  {status}"
        )


def _print_case(case_evaluation: TaskEvaluation) -> None:
    task = case_evaluation.task
    expected = task.metadata.get("fixture_expected_verdict")
    print(f"\nCase: {task.task_id}")
    print(f"Claim: {task.claim}")
    if expected:
        print(f"Mock fixture expectation: {expected} (not scientific ground truth)")
    _print_table(list(case_evaluation.evaluations))

    verdicts = []
    for evaluation in case_evaluation.evaluations:
        if evaluation.result is None:
            verdicts.append(f"{evaluation.architecture_name}=unavailable")
        else:
            verdicts.append(f"{evaluation.architecture_name}={evaluation.result.final_result.verdict}")
    print("Mock fixture verdicts: " + ", ".join(verdicts))


def _print_aggregate(case_evaluations: list[TaskEvaluation]) -> None:
    """Print descriptive averages, not a scientific architecture ranking."""

    if not case_evaluations:
        return
    architecture_names = [evaluation.architecture_name for evaluation in case_evaluations[0].evaluations]
    print("\nAggregate across cases (descriptive; successful runs only)")
    print(
        f"{'Architecture':<34} {'Cases':>5} {'Success':>7} {'Mock match':>11} "
        f"{'Avg calls':>10} {'Avg steps':>10} {'Avg time':>10}"
    )
    print("-" * 96)
    for architecture_name in architecture_names:
        records = [
            evaluation
            for case_evaluation in case_evaluations
            for evaluation in case_evaluation.evaluations
            if evaluation.architecture_name == architecture_name
        ]
        successful = [evaluation for evaluation in records if evaluation.result is not None]
        mock_matches = [
            evaluation
            for case_evaluation in case_evaluations
            for evaluation in case_evaluation.evaluations
            if evaluation.architecture_name == architecture_name
            and evaluation.result is not None
            and case_evaluation.task.metadata.get("fixture_expected_verdict")
            == evaluation.result.final_result.verdict
        ]
        if not successful:
            print(f"{architecture_name:<34} {len(records):>5} {0:>7} {0:>11} {'-':>10} {'-':>10} {'-':>10}")
            continue
        metrics = [summarize_result(evaluation.result) for evaluation in successful if evaluation.result]
        average_calls = sum(item["agent_call_count"] for item in metrics) / len(metrics)
        average_steps = sum(item["execution_steps"] for item in metrics) / len(metrics)
        average_time = sum(item["execution_time"] for item in metrics) / len(metrics)
        print(
            f"{architecture_name:<34} {len(records):>5} {len(successful):>7} "
            f"{len(mock_matches):>11} {average_calls:>10.2f} {average_steps:>10.2f} {average_time:>10.4f}"
        )


async def run_all(task: Task | None = None) -> list[ArchitectureEvaluation]:
    """Execute one task through all architectures.

    This keeps the small single-task API used by callers that want the
    original fixture. The command-line entry point uses ``run_all_cases``.
    """

    return await run_suite(task or sample_task(), agents=build_agents())


async def run_all_cases(tasks: tuple[Task, ...] | None = None) -> list[TaskEvaluation]:
    """Execute all configured architectures with one provider instance."""

    return await run_tasks(tasks or sample_tasks(), agents=build_agents())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--trace",
        action="store_true",
        help="Print full structured traces after the summary.",
    )
    parser.add_argument(
        "--case",
        choices=[task.task_id for task in sample_tasks()],
        help="Run one case instead of the complete deterministic case suite.",
    )
    parser.add_argument(
        "--list-cases",
        action="store_true",
        help="List available deterministic cases and exit.",
    )
    args = parser.parse_args()
    available_tasks = sample_tasks()
    if args.list_cases:
        print("Available deterministic cases:")
        for task in available_tasks:
            print(
                f"- {task.task_id}: {task.metadata.get('fixture_description', task.claim)} "
                f"[mock fixture verdict: {task.metadata.get('fixture_expected_verdict', 'n/a')}]"
            )
        return

    selected_tasks = (get_sample_task(args.case),) if args.case else available_tasks
    case_evaluations = asyncio.run(run_all_cases(selected_tasks))
    for case_evaluation in case_evaluations:
        _print_case(case_evaluation)
    if len(case_evaluations) > 1:
        _print_aggregate(case_evaluations)
    print("\nResult guide: docs/results.md")
    if args.trace:
        payload = [
            {
                "task": case_evaluation.task.to_dict(),
                "evaluations": [
                    evaluation.result.to_dict() if evaluation.result is not None else {
                        "architecture_name": evaluation.architecture_name,
                        "error": evaluation.error,
                        "error_kind": evaluation.error_kind,
                    }
                    for evaluation in case_evaluation.evaluations
                ],
            }
            for case_evaluation in case_evaluations
        ]
        print(json.dumps(payload, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
