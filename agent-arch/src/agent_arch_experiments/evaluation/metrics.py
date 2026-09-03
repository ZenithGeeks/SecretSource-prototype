"""Observable harness metrics; no scientific accuracy is fabricated."""

from __future__ import annotations

from collections import Counter
from typing import Any

from ..common.models import ArchitectureResult


def summarize_result(result: ArchitectureResult) -> dict[str, Any]:
    """Return control-flow metrics that are available without ground truth."""

    agent_events = [event for event in result.trace if event.event == "agent_started"]
    call_agents = [str(event.metadata.get("role", event.actor)) for event in agent_events]
    repeated_calls = sum(count - 1 for count in Counter(call_agents).values() if count > 1)
    return {
        "architecture_name": result.architecture_name,
        "success": result.success,
        "agent_call_count": result.number_of_agent_calls,
        "execution_steps": result.execution_steps,
        "repeated_calls": repeated_calls,
        "execution_time": result.execution_time,
        "trace_length": len(result.trace),
        "participating_agents": list(result.participating_agents),
    }


def accuracy_metric_status(*, has_ground_truth: bool) -> dict[str, Any]:
    """Describe whether later quality metrics are currently computable."""

    if has_ground_truth:
        return {"available": True, "note": "Ground-truth-dependent metrics may be added by the evaluator."}
    return {
        "available": False,
        "note": (
            "No scientific accuracy, Macro-F1, evidence precision, Brier score, "
            "ECE, or Pass@K is computed without ground truth."
        ),
    }
