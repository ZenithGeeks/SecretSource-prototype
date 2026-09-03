"""Typed state schemas for the A2 parent graph and its subgraphs."""

from __future__ import annotations

from typing import TypedDict

from ...common.models import AgentResult, Task


class EvidenceTeamState(TypedDict):
    task: Task
    results: list[AgentResult]
    completed_roles: list[str]
    next_node: str


class VerificationTeamState(TypedDict):
    task: Task
    results: list[AgentResult]
    completed_roles: list[str]
    next_node: str


class RootState(TypedDict):
    task: Task
    evidence_results: list[AgentResult]
    verification_results: list[AgentResult]
    completed_nodes: list[str]
    next_node: str
    final_result: AgentResult | None
