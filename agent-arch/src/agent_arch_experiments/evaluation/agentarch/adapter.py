"""Explicit, dependency-free adapter to the published AgentArch record style.

ServiceNow AgentArch is a standalone benchmark application with a CLI and
use-case/ground-truth configuration. It does not expose a generic evaluator
object for arbitrary ArchitectureResult instances, so this module translates
our output rather than claiming native AgentArch execution.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...common.models import ArchitectureResult, Task


class AgentArchAdapter:
    """Map local task/result/trace data to an AgentArch-like evaluation record."""

    source_name = "servicenow_agentarch_adapted"

    def to_record(
        self,
        task: Task,
        result: ArchitectureResult,
        *,
        ground_truth: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return a record suitable for a later AgentArch ingestion bridge."""

        return {
            "id": task.task_id,
            "user_utterance": task.claim,
            "ground_truth": dict(ground_truth) if ground_truth is not None else None,
            "architecture": result.architecture_name,
            "mode": result.metadata.get("information_flow", "unknown"),
            "record_history": [event.to_dict() for event in result.trace],
            "result": result.to_dict(),
            "adapter": self.source_name,
            "native_agentarch_metrics_available": False,
            "metric_notes": {
                "directly_observable_locally": [
                    "agent_call_count",
                    "execution_steps",
                    "repeated_calls",
                    "trace_length",
                    "participating_agents",
                ],
                "requires_ground_truth_or_agentarch_schema": [
                    "acceptable_score",
                    "Pass@1",
                    "Pass^K",
                    "tool_selection_accuracy",
                    "scientific_verdict_accuracy",
                ],
            },
        }
