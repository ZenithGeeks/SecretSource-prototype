from __future__ import annotations

import asyncio

from agent_arch_experiments.agents.provider import build_agents
from agent_arch_experiments.architectures.blackboard_team.architecture import BlackboardTeamArchitecture
from agent_arch_experiments.architectures.blackboard_team.blackboard import Blackboard
from agent_arch_experiments.examples.sample_tasks import sample_task


def test_blackboard_explicit_methods_persist_structured_state() -> None:
    task = sample_task()
    board = Blackboard(task)
    board.add_evidence(task.evidence[0], agent="evidence_verifier")
    board.add_finding(
        agent="evidence_verifier",
        kind="evidence_verifier",
        statement="Direct support found.",
        confidence=0.8,
        evidence_ids=(task.evidence[0].evidence_id,),
    )
    board.add_contradiction(agent="validity_verifier", statement="Scope is limited.")
    board.record_confidence(agent="evidence_verifier", value=0.8)

    snapshot = board.get_snapshot()
    assert snapshot["version"] == 4
    assert snapshot["evidence"][0]["evidence_id"] == "paragraph-1"
    assert snapshot["findings"][0]["evidence_ids"] == ["paragraph-1"]
    assert snapshot["contradictions"]
    assert snapshot["provenance"]["paragraph-1"] == ["evidence_verifier"]
    assert snapshot["events"]


def test_blackboard_team_reads_and_writes_structured_state() -> None:
    result = asyncio.run(BlackboardTeamArchitecture(build_agents()).run(sample_task()))

    event_names = [event.event for event in result.trace]
    board = result.metadata["blackboard"]
    assert result.success
    assert "blackboard_read" in event_names
    assert "blackboard_write" in event_names
    assert board["findings"]
    assert board["evidence"]
    assert board["provenance"]
