"""Run architectures by name without coupling them to one another."""

from __future__ import annotations

import importlib
from collections.abc import Sequence
from dataclasses import dataclass

from ..agents.provider import build_agents
from ..common.interfaces import AgentRegistry
from ..common.models import ArchitectureResult, Task

ARCHITECTURE_TARGETS: dict[str, tuple[str, str]] = {
    "magentic_team": (
        "agent_arch_experiments.architectures.magentic_team.architecture",
        "MagenticTeamArchitecture",
    ),
    "hierarchical_langgraph": (
        "agent_arch_experiments.architectures.hierarchical_langgraph.architecture",
        "HierarchicalLangGraphArchitecture",
    ),
    "blackboard_team": (
        "agent_arch_experiments.architectures.blackboard_team.architecture",
        "BlackboardTeamArchitecture",
    ),
    "magentic_context_isolation": (
        "agent_arch_experiments.architectures.magentic_context_isolation.architecture",
        "MagenticContextIsolationArchitecture",
    ),
}


@dataclass(frozen=True, slots=True)
class ArchitectureEvaluation:
    """One successful architecture result or an explicit unavailable/error record."""

    architecture_name: str
    result: ArchitectureResult | None = None
    error: str | None = None
    error_kind: str | None = None

    @property
    def success(self) -> bool:
        return self.result is not None and self.result.success


@dataclass(frozen=True, slots=True)
class TaskEvaluation:
    """Results for one task across the requested architecture set."""

    task: Task
    evaluations: tuple[ArchitectureEvaluation, ...]


async def run_named_architecture(
    name: str,
    task: Task,
    *,
    agents: AgentRegistry,
) -> ArchitectureResult:
    """Import and execute one architecture without importing the others."""

    try:
        module_name, class_name = ARCHITECTURE_TARGETS[name]
    except KeyError as exc:
        raise KeyError(f"Unknown architecture {name!r}. Available: {sorted(ARCHITECTURE_TARGETS)}") from exc
    module = importlib.import_module(module_name)
    architecture_class = getattr(module, class_name)
    return await architecture_class(agents=agents).run(task)


async def run_suite(
    task: Task,
    *,
    agents: AgentRegistry | None = None,
    architecture_names: tuple[str, ...] | None = None,
) -> list[ArchitectureEvaluation]:
    """Run the same task with one shared provider registry.

    Missing optional dependencies are returned as explicit records so the
    offline comparison script can still report the other architectures.
    Unexpected architecture failures are also retained for inspection instead
    of silently changing the comparison set.
    """

    configured_agents = build_agents() if agents is None else agents
    names = architecture_names or tuple(ARCHITECTURE_TARGETS)
    evaluations: list[ArchitectureEvaluation] = []
    for name in names:
        try:
            result = await run_named_architecture(name, task, agents=configured_agents)
        except Exception as exc:
            error_kind = "optional_dependency" if exc.__class__.__name__ in {
                "LangGraphUnavailable",
                "MicrosoftAgentFrameworkUnavailable",
            } else "execution_error"
            evaluations.append(
                ArchitectureEvaluation(
                    architecture_name=name,
                    error=str(exc),
                    error_kind=error_kind,
                )
            )
        else:
            evaluations.append(ArchitectureEvaluation(architecture_name=name, result=result))
    return evaluations


async def run_tasks(
    tasks: Sequence[Task],
    *,
    agents: AgentRegistry | None = None,
    architecture_names: tuple[str, ...] | None = None,
) -> list[TaskEvaluation]:
    """Run several tasks with one controlled provider registry.

    Each task is sent through the same architecture set. The provider registry
    is constructed once and reused across the case suite, while mock agents
    remain deterministic and stateless with respect to earlier tasks.
    """

    configured_agents = build_agents() if agents is None else agents
    results: list[TaskEvaluation] = []
    for task in tasks:
        evaluations = await run_suite(
            task,
            agents=configured_agents,
            architecture_names=architecture_names,
        )
        results.append(TaskEvaluation(task=task, evaluations=tuple(evaluations)))
    return results
