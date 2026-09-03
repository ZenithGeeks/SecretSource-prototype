"""A4: Magentic-style manager with isolated application-visible workers."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ...agents.mock_agents import WORKER_ROLES
from ...agents.provider import build_agents
from ...common.interfaces import AgentRegistry, invoke_agent
from ...common.models import AgentContext, AgentResult, ArchitectureResult, Task
from ...common.tracing import TraceRecorder, build_architecture_result
from .context_policy import ContextPolicy

ARCHITECTURE_NAME = "magentic_context_isolation"


def _fallback_route(completed_roles: Sequence[str]) -> dict[str, Any]:
    next_role = next((role for role in WORKER_ROLES if role not in completed_roles), None)
    if next_role is None:
        return {"action": "finalize"}
    return {"action": "delegate", "agent": next_role, "instruction": f"Perform the {next_role} check."}


class MagenticContextIsolationArchitecture:
    """Offline controlled coordinator for the A4 context-flow experiment.

    The manager sees the accumulated worker results. Each worker receives a
    newly constructed allow-listed context packet with task/source evidence and
    no peer result or peer message history.
    """

    name = ARCHITECTURE_NAME

    def __init__(self, agents: AgentRegistry | None = None, *, max_round_count: int = 4) -> None:
        self.agents = build_agents() if agents is None else agents
        self.max_round_count = max_round_count
        self.context_policy = ContextPolicy()

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
                objective="Create a plan for isolated verification workers.",
                visible_evidence=task.evidence,
                metadata={"phase": "magentic_plan", "context_policy": "isolated"},
            ),
            trace,
        )
        plan = tuple(str(item) for item in plan_response.metadata.get("plan", ()))
        trace.record(
            "team_lead",
            "plan_created",
            "Created the lead-owned plan for isolated workers.",
            plan=list(plan),
        )

        for round_number in range(1, self.max_round_count + 1):
            route_response = await invoke_agent(
                self.agents,
                "team_lead",
                task,
                AgentContext(
                    task=task,
                    objective="Choose the next isolated worker or finalize.",
                    global_information={"plan": plan},
                    visible_evidence=task.evidence,
                    visible_agent_results=tuple(worker_results),
                    private_memory={"completed_roles": tuple(completed_roles)},
                    metadata={
                        "phase": "isolated_route",
                        "round": round_number,
                        "completed_roles": tuple(completed_roles),
                        "context_policy": "isolated",
                    },
                ),
                trace,
            )
            decision = dict(route_response.metadata)
            if decision.get("action") not in {"delegate", "finalize"}:
                decision = _fallback_route(completed_roles)
            if decision.get("action") == "finalize":
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
                role = str(_fallback_route(completed_roles).get("agent", ""))
            if not role:
                break
            instruction = str(decision.get("instruction", f"Perform the {role} check."))
            trace.record(
                "team_lead",
                "supervisor_selected_agent",
                f"Selected {role} for an isolated context packet.",
                round=round_number,
                selected_agent=role,
            )
            trace.record(
                "team_lead",
                "delegated_task",
                f"Delegated the task to {role} with peer outputs excluded.",
                round=round_number,
                selected_agent=role,
            )

            worker_context = self.context_policy.build_worker_context(
                task,
                agent=role,
                objective=instruction,
                request_id=f"isolated-worker-{round_number:03d}",
                allowed_evidence=task.evidence,
            )
            self.context_policy.assert_worker_isolated(worker_context, tuple(worker_results))
            trace.record(
                "team_lead",
                "context_created",
                f"Created an isolated context for {role}.",
                round=round_number,
                request_id=f"isolated-worker-{round_number:03d}",
                peer_results_visible=False,
            )
            result = await invoke_agent(self.agents, role, task, worker_context, trace)
            worker_results.append(result)
            completed_roles.append(role)
            trace.record(
                role,
                "worker_output_returned",
                "Worker output returned only to the manager context.",
                round=round_number,
                visible_to_peer_workers=False,
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
                metadata={"phase": "isolated_finalize", "context_policy": "isolated"},
            ),
            trace,
        )
        trace.record(
            "team_lead",
            "final_decision",
            "Finalized from manager memory after isolated worker calls.",
            worker_result_count=len(worker_results),
        )
        return build_architecture_result(
            self.name,
            final_response,
            trace,
            participating_agents=("team_lead", *completed_roles),
            metadata={
                "runtime": "offline_deterministic_isolation_coordinator",
                "information_flow": "isolated_worker_contexts_manager_sees_results",
                "plan": list(plan),
                "worker_results": [item.to_dict() for item in worker_results],
                "context_audits": [item.to_dict() for item in self.context_policy.audits],
                "max_round_count": self.max_round_count,
                "hidden_chain_of_thought_claim": False,
            },
        )
