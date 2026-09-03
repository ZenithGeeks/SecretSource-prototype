"""The single agent construction and replacement point."""

from __future__ import annotations

from ..common.interfaces import AgentRegistry
from .mock_agents import MockAgent


def build_agents() -> AgentRegistry:
    """Build the deterministic registry shared by the architecture harness.

    To connect real verification agents later, replace the construction in
    this function (or import a replacement mapping here). Architecture folders
    should not need to change.
    """

    roles = (
        "team_lead",
        "evidence_verifier",
        "quantitative_verifier",
        "validity_verifier",
        "root_supervisor",
        "evidence_supervisor",
        "verification_supervisor",
        "finalizer",
        "synthesizer",
    )
    return {role: MockAgent(role) for role in roles}
