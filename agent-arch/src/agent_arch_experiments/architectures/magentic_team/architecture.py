"""A1: manager-led team orchestration with shared worker context."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ...agents.adapters.microsoft_adapter import build_magentic_workflow
from ...agents.mock_agents import WORKER_ROLES
from ...agents.provider import build_agents
from ...common.interfaces import AgentRegistry, invoke_agent
from ...common.models import AgentContext, AgentResult, ArchitectureResult, Task
from ...common.tracing import TraceRecorder, build_architecture_result

ARCHITECTURE_NAME = "magentic_team"


def _fallback_route(completed_roles: Sequence[str]) -> dict[str, Any]:
    next_role = next((role for role in WORKER_ROLES if role not in completed_roles), None)
    if next_role is None:
        return {"action": "finalize"}
    return {"action": "delegate", "agent": next_role, "instruction": f"Perform the {next_role} check."}


class MagenticTeamArchitecture:
    """Offline deterministic coordinator for the A1 information-flow test.

    The control flow mirrors the official Magentic idea: a team lead creates a
    plan, selects workers dynamically, observes results, and synthesizes a
    final answer. The worker context is deliberately open to prior worker
    results. ``OfficialMagenticRunner`` below is the separate model-backed
    path using Microsoft's actual builder.
    """

    name = ARCHITECTURE_NAME

    def __init__(self, agents: AgentRegistry | None = None, *, max_round_count: int = 4) -> None:
        self.agents = build_agents() if agents is None else agents
        self.max_round_count = max_round_count

    async def run(self, task: Task) -> ArchitectureResult:
        trace = TraceRecorder(self.name)
        worker_results: list[AgentResult] = []
        completed_roles: list[str] = []

        plan_response = await invoke_agent(
            self.agents,
            "team_lead",
            task,
            AgentContext(
                task=task,
                objective="Create the verification plan.",
                visible_evidence=task.evidence,
                metadata={"phase": "magentic_plan", "context_policy": "open"},
            ),
            trace,
        )
        plan = tuple(str(item) for item in plan_response.metadata.get("plan", ()))
        trace.record("team_lead", "plan_created", "Created the shared Magentic task plan.", plan=list(plan))

        for round_number in range(1, self.max_round_count + 1):
            route_response = await invoke_agent(
                self.agents,
                "team_lead",
                task,
                AgentContext(
                    task=task,
                    objective="Choose the next worker or finalize.",
                    global_information={"plan": plan},
                    visible_evidence=task.evidence,
                    visible_agent_results=tuple(worker_results),
                    private_memory={"completed_roles": tuple(completed_roles)},
                    metadata={
                        "phase": "magentic_route",
                        "round": round_number,
                        "completed_roles": tuple(completed_roles),
                        "context_policy": "open",
                    },
                ),
                trace,
            )
            decision = dict(route_response.metadata)
            if decision.get("action") not in {"delegate", "finalize"}:
                decision = _fallback_route(completed_roles)

            action = str(decision.get("action"))
            if action == "finalize":
                trace.record(
                    "team_lead",
                    "supervisor_selected_agent",
                    "The team lead selected final synthesis.",
                    round=round_number,
                    action="finalize",
                )
                break

            role = str(decision.get("agent", ""))
            if role not in WORKER_ROLES or role not in self.agents:
                fallback = _fallback_route(completed_roles)
                role = str(fallback.get("agent", ""))
            if not role:
                break
            instruction = str(decision.get("instruction", f"Perform the {role} check."))
            trace.record(
                "team_lead",
                "supervisor_selected_agent",
                f"Selected {role} for the next task.",
                round=round_number,
                selected_agent=role,
            )
            trace.record(
                "team_lead",
                "delegated_task",
                f"Delegated the task to {role}.",
                round=round_number,
                selected_agent=role,
            )

            worker_context = AgentContext(
                task=task,
                objective=instruction,
                global_information={"plan": plan},
                visible_evidence=task.evidence,
                # A1's independent variable is open peer-result visibility.
                visible_agent_results=tuple(worker_results),
                private_memory={"completed_roles": tuple(completed_roles)},
                metadata={
                    "phase": "magentic_worker",
                    "round": round_number,
                    "context_policy": "open",
                },
            )
            result = await invoke_agent(self.agents, role, task, worker_context, trace)
            worker_results.append(result)
            completed_roles.append(role)
            trace.record(
                role,
                "worker_output_shared",
                "Worker output entered the shared team context.",
                round=round_number,
                visible_to_future_workers=True,
            )

        final_response = await invoke_agent(
            self.agents,
            "team_lead",
            task,
            AgentContext(
                task=task,
                objective="Synthesize the final verification result.",
                global_information={"plan": plan, "worker_results": tuple(worker_results)},
                visible_evidence=task.evidence,
                visible_agent_results=tuple(worker_results),
                private_memory={"completed_roles": tuple(completed_roles)},
                metadata={"phase": "magentic_finalize", "context_policy": "open"},
            ),
            trace,
        )
        trace.record(
            "team_lead",
            "final_decision",
            "Finalized from the open shared team context.",
            worker_result_count=len(worker_results),
        )
        return build_architecture_result(
            self.name,
            final_response,
            trace,
            participating_agents=("team_lead", *completed_roles),
            metadata={
                "runtime": "offline_deterministic_coordinator",
                "information_flow": "open_worker_context",
                "plan": list(plan),
                "worker_results": [item.to_dict() for item in worker_results],
                "max_round_count": self.max_round_count,
            },
        )


class OfficialMagenticRunner:
    """Opt-in runner around Microsoft's official ``MagenticBuilder``.

    ``participants`` and ``manager_agent`` must be official Agent Framework
    objects. This class intentionally does not wrap deterministic mock agents
    as fake framework agents.
    """

    name = ARCHITECTURE_NAME

    def __init__(
        self,
        participants: Sequence[Any],
        *,
        manager_agent: Any | None = None,
        max_round_count: int = 8,
        max_stall_count: int = 3,
        max_reset_count: int = 2,
    ) -> None:
        if not participants:
            raise ValueError("OfficialMagenticRunner requires at least one participant.")
        self.participants = tuple(participants)
        self.manager_agent = manager_agent
        self.max_round_count = max_round_count
        self.max_stall_count = max_stall_count
        self.max_reset_count = max_reset_count

    async def run(self, task: Task) -> ArchitectureResult:
        trace = TraceRecorder(self.name)
        workflow = build_magentic_workflow(
            self.participants,
            manager_agent=self.manager_agent,
            max_round_count=self.max_round_count,
            max_stall_count=self.max_stall_count,
            max_reset_count=self.max_reset_count,
        )
        stream = workflow.run(task.to_prompt(), stream=True)
        observed_outputs: list[str] = []
        async for event in stream:
            event_type = str(getattr(event, "type", "unknown"))
            actor = str(getattr(event, "executor_id", "magentic_manager"))
            if event_type == "group_chat":
                trace.agent_calls += 1
                trace.record(actor, "delegated_task", "Official Magentic requested a participant response.")
            elif event_type == "magentic_orchestrator":
                trace.record(
                    actor,
                    "magentic_orchestrator_event",
                    "Observed an official Magentic manager event.",
                )
            elif event_type in {"output", "intermediate"}:
                text = _official_text(getattr(event, "data", None))
                if text:
                    observed_outputs.append(text)
                trace.record(
                    actor,
                    "official_agent_output",
                    "Observed official workflow output.",
                    event_type=event_type,
                )

        final_response = await stream.get_final_response()
        output_items = (
            final_response.get_outputs() if hasattr(final_response, "get_outputs") else ()
        ) or ()
        final_text = "\n".join(filter(None, (_official_text(item) for item in output_items)))
        if not final_text:
            final_text = (
                observed_outputs[-1]
                if observed_outputs
                else "Official Magentic returned no textual output."
            )
        final_result = AgentResult(
            agent="magentic_manager",
            verdict="unknown",
            confidence=0.0,
            findings=(final_text,),
            metadata={"runtime": "official_microsoft_agent_framework", "output_count": len(output_items)},
        )
        trace.record("magentic_manager", "final_decision", "Official Magentic workflow completed.")
        return build_architecture_result(
            self.name,
            final_result,
            trace,
            participating_agents=(
                "magentic_manager",
                *(str(getattr(item, "name", "participant")) for item in self.participants),
            ),
            metadata={
                "runtime": "official_microsoft_agent_framework",
                "note": (
                    "Agent-call count is based on observed group-chat requests, "
                    "not provider token usage."
                ),
            },
        )


def _official_text(value: Any) -> str:
    if value is None:
        return ""
    text = getattr(value, "text", None)
    if text is not None:
        return str(text)
    content = getattr(value, "content", None)
    if content is not None and isinstance(content, str):
        return content
    return str(value) if isinstance(value, str) else ""
