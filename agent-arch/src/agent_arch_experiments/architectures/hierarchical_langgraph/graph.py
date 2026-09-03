"""Real LangGraph parent/subgraph implementation for A2."""

from __future__ import annotations

from ...agents.adapters.langgraph_adapter import LangGraphUnavailable, require_langgraph
from ...common.interfaces import AgentRegistry, invoke_agent
from ...common.models import AgentContext, AgentResult, Task
from ...common.tracing import TraceRecorder
from .state import EvidenceTeamState, RootState, VerificationTeamState

try:  # Keep importing the package possible when the optional dependency is absent.
    from langgraph.graph import END, START, StateGraph

    LANGGRAPH_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on environment
    END = START = StateGraph = None
    LANGGRAPH_AVAILABLE = False


def _graph_primitives():
    if not LANGGRAPH_AVAILABLE:
        return require_langgraph()
    return StateGraph, START, END


def build_evidence_team_graph(agents: AgentRegistry, trace: TraceRecorder):
    """Build the evidence sub-team: supervisor → evidence worker."""

    GraphState, graph_start, graph_end = _graph_primitives()

    async def evidence_supervisor(state: EvidenceTeamState) -> dict[str, str]:
        response = await invoke_agent(
            agents,
            "evidence_supervisor",
            state["task"],
            AgentContext(
                task=state["task"],
                objective="Choose the next evidence-team worker or finish the sub-team.",
                visible_evidence=state["task"].evidence,
                visible_agent_results=tuple(state.get("results", [])),
                metadata={
                    "phase": "team_route",
                    "completed_roles": tuple(state.get("completed_roles", [])),
                    "team": "evidence",
                },
            ),
            trace,
        )
        next_node = str(response.metadata.get("next", "done"))
        if next_node not in {"evidence_verifier", "done"}:
            next_node = "done"
        trace.record(
            "evidence_supervisor",
            "subteam_selected",
            f"Evidence sub-team selected {next_node}.",
            next_node=next_node,
        )
        return {"next_node": next_node}

    async def evidence_worker(state: EvidenceTeamState) -> dict[str, object]:
        trace.record("evidence_supervisor", "delegated_task", "Delegated work to evidence_verifier.")
        result = await invoke_agent(
            agents,
            "evidence_verifier",
            state["task"],
            AgentContext(
                task=state["task"],
                objective="Verify direct support in the supplied source evidence.",
                visible_evidence=state["task"].evidence,
                metadata={"phase": "hierarchical_worker", "team": "evidence"},
            ),
            trace,
        )
        trace.record(
            "evidence_verifier",
            "worker_finished",
            "Evidence worker returned to its sub-team supervisor.",
        )
        return {
            "results": [*state.get("results", []), result],
            "completed_roles": [*state.get("completed_roles", []), "evidence_verifier"],
        }

    builder = GraphState(EvidenceTeamState)
    builder.add_node("evidence_supervisor", evidence_supervisor)
    builder.add_node("evidence_worker", evidence_worker)
    builder.add_edge(graph_start, "evidence_supervisor")
    builder.add_conditional_edges(
        "evidence_supervisor",
        lambda state: state.get("next_node", "done"),
        {"evidence_verifier": "evidence_worker", "done": graph_end},
    )
    builder.add_edge("evidence_worker", "evidence_supervisor")
    return builder.compile()


def build_verification_team_graph(agents: AgentRegistry, trace: TraceRecorder):
    """Build the verification sub-team: supervisor → quantitative → validity."""

    GraphState, graph_start, graph_end = _graph_primitives()

    async def verification_supervisor(state: VerificationTeamState) -> dict[str, str]:
        response = await invoke_agent(
            agents,
            "verification_supervisor",
            state["task"],
            AgentContext(
                task=state["task"],
                objective="Choose the next verification-team worker or finish the sub-team.",
                visible_evidence=state["task"].evidence,
                visible_agent_results=tuple(state.get("results", [])),
                metadata={
                    "phase": "team_route",
                    "completed_roles": tuple(state.get("completed_roles", [])),
                    "team": "verification",
                },
            ),
            trace,
        )
        next_node = str(response.metadata.get("next", "done"))
        if next_node not in {"quantitative_verifier", "validity_verifier", "done"}:
            next_node = "done"
        trace.record(
            "verification_supervisor",
            "subteam_selected",
            f"Verification sub-team selected {next_node}.",
            next_node=next_node,
        )
        return {"next_node": next_node}

    async def quantitative_worker(state: VerificationTeamState) -> dict[str, object]:
        trace.record("verification_supervisor", "delegated_task", "Delegated work to quantitative_verifier.")
        result = await invoke_agent(
            agents,
            "quantitative_verifier",
            state["task"],
            AgentContext(
                task=state["task"],
                objective="Check the numerical comparison against the supplied table evidence.",
                visible_evidence=state["task"].evidence,
                metadata={"phase": "hierarchical_worker", "team": "verification"},
            ),
            trace,
        )
        trace.record(
            "quantitative_verifier",
            "worker_finished",
            "Quantitative worker returned to its supervisor.",
        )
        return {
            "results": [*state.get("results", []), result],
            "completed_roles": [*state.get("completed_roles", []), "quantitative_verifier"],
        }

    async def validity_worker(state: VerificationTeamState) -> dict[str, object]:
        trace.record("verification_supervisor", "delegated_task", "Delegated work to validity_verifier.")
        result = await invoke_agent(
            agents,
            "validity_verifier",
            state["task"],
            AgentContext(
                task=state["task"],
                objective="Check validity boundaries and possible overclaiming.",
                visible_evidence=state["task"].evidence,
                visible_agent_results=tuple(state.get("results", [])),
                metadata={"phase": "hierarchical_worker", "team": "verification"},
            ),
            trace,
        )
        trace.record("validity_verifier", "worker_finished", "Validity worker returned to its supervisor.")
        return {
            "results": [*state.get("results", []), result],
            "completed_roles": [*state.get("completed_roles", []), "validity_verifier"],
        }

    builder = GraphState(VerificationTeamState)
    builder.add_node("verification_supervisor", verification_supervisor)
    builder.add_node("quantitative_worker", quantitative_worker)
    builder.add_node("validity_worker", validity_worker)
    builder.add_edge(graph_start, "verification_supervisor")
    builder.add_conditional_edges(
        "verification_supervisor",
        lambda state: state.get("next_node", "done"),
        {
            "quantitative_verifier": "quantitative_worker",
            "validity_verifier": "validity_worker",
            "done": graph_end,
        },
    )
    builder.add_edge("quantitative_worker", "verification_supervisor")
    builder.add_edge("validity_worker", "verification_supervisor")
    return builder.compile()


def build_hierarchical_graph(agents: AgentRegistry, trace: TraceRecorder):
    """Build the root graph containing two independently compiled subgraphs."""

    GraphState, graph_start, graph_end = _graph_primitives()
    evidence_team = build_evidence_team_graph(agents, trace)
    verification_team = build_verification_team_graph(agents, trace)

    async def root_supervisor(state: RootState) -> dict[str, str]:
        visible_results = tuple(state.get("evidence_results", [])) + tuple(
            state.get("verification_results", [])
        )
        response = await invoke_agent(
            agents,
            "root_supervisor",
            state["task"],
            AgentContext(
                task=state["task"],
                objective="Choose the next sub-team or the finalizer.",
                visible_evidence=state["task"].evidence,
                visible_agent_results=visible_results,
                metadata={
                    "phase": "root_route",
                    "completed_nodes": tuple(state.get("completed_nodes", [])),
                },
            ),
            trace,
        )
        next_node = str(response.metadata.get("next", "finalizer"))
        if next_node not in {"evidence_team", "verification_team", "finalizer"}:
            next_node = "finalizer"
        trace.record(
            "root_supervisor",
            "supervisor_selected_agent",
            f"Root supervisor selected {next_node}.",
            next_node=next_node,
        )
        return {"next_node": next_node}

    async def run_evidence_team(state: RootState) -> dict[str, object]:
        output = await evidence_team.ainvoke(
            {"task": state["task"], "results": [], "completed_roles": [], "next_node": ""}
        )
        trace.record("evidence_team", "subteam_completed", "Evidence subgraph returned to the root graph.")
        return {
            "evidence_results": list(output.get("results", [])),
            "completed_nodes": [*state.get("completed_nodes", []), "evidence_team"],
        }

    async def run_verification_team(state: RootState) -> dict[str, object]:
        output = await verification_team.ainvoke(
            {"task": state["task"], "results": [], "completed_roles": [], "next_node": ""}
        )
        trace.record(
            "verification_team",
            "subteam_completed",
            "Verification subgraph returned to the root graph.",
        )
        return {
            "verification_results": list(output.get("results", [])),
            "completed_nodes": [*state.get("completed_nodes", []), "verification_team"],
        }

    async def finalizer(state: RootState) -> dict[str, AgentResult]:
        results = tuple(state.get("evidence_results", [])) + tuple(state.get("verification_results", []))
        response = await invoke_agent(
            agents,
            "finalizer",
            state["task"],
            AgentContext(
                task=state["task"],
                objective="Synthesize the final result from every sub-team result.",
                visible_evidence=state["task"].evidence,
                visible_agent_results=results,
                global_information={"worker_results": results},
                metadata={"phase": "hierarchical_finalize"},
            ),
            trace,
        )
        trace.record("finalizer", "final_decision", "Root finalizer synthesized both sub-team outputs.")
        return {"final_result": response}

    builder = GraphState(RootState)
    builder.add_node("root_supervisor", root_supervisor)
    builder.add_node("evidence_team", run_evidence_team)
    builder.add_node("verification_team", run_verification_team)
    builder.add_node("finalizer", finalizer)
    builder.add_edge(graph_start, "root_supervisor")
    builder.add_conditional_edges(
        "root_supervisor",
        lambda state: state.get("next_node", "finalizer"),
        {
            "evidence_team": "evidence_team",
            "verification_team": "verification_team",
            "finalizer": "finalizer",
        },
    )
    builder.add_edge("evidence_team", "root_supervisor")
    builder.add_edge("verification_team", "root_supervisor")
    builder.add_edge("finalizer", graph_end)
    return builder.compile()


async def run_hierarchical(
    task: Task,
    *,
    agents: AgentRegistry,
) -> tuple[AgentResult, TraceRecorder, dict[str, object]]:
    """Execute the compiled hierarchy and return its final state plus trace."""

    if not LANGGRAPH_AVAILABLE:
        raise LangGraphUnavailable(
            "A2 requires LangGraph. Install it with: python -m pip install -e \".[langgraph]\""
        )
    trace = TraceRecorder("hierarchical_langgraph")
    graph = build_hierarchical_graph(agents, trace)
    initial: RootState = {
        "task": task,
        "evidence_results": [],
        "verification_results": [],
        "completed_nodes": [],
        "next_node": "",
        "final_result": None,
    }
    output = await graph.ainvoke(initial)
    final_result = output.get("final_result")
    if not isinstance(final_result, AgentResult):
        raise RuntimeError("Hierarchical graph completed without a normalized final result.")
    return final_result, trace, {"graph_state": output, "mermaid": hierarchical_mermaid()}


def hierarchical_mermaid() -> str:
    """A stable diagram for documentation and result metadata."""

    return """flowchart TD
    R[Root Supervisor] --> E[Evidence Team Supervisor]
    R --> V[Verification Team Supervisor]
    E --> EV[Evidence Verifier]
    V --> Q[Quantitative Verifier]
    V --> VV[Validity Verifier]
    E --> R
    V --> R
    R --> F[Finalizer]
"""
