"""cli.py: a turn runs with a cap on model calls and says so when it hits the cap (SCRUM-553).

The runner is a fake, so no model is called.
"""

import asyncio

import cli
from app.agents import team
from google.adk.agents.invocation_context import LlmCallsLimitExceededError


class LoopingRunner:
    """Records the run config, then fails the way ADK does when a run passes max_llm_calls."""

    def __init__(self):
        self.run_config = None

    async def run_async(self, *, user_id, session_id, new_message, run_config):
        self.run_config = run_config
        raise LlmCallsLimitExceededError("Max number of llm calls limit exceeded.")
        yield  # an async generator, like Runner.run_async


def test_a_turn_stops_with_a_message_at_the_call_cap(capsys):
    runner = LoopingRunner()

    asyncio.run(cli.ask(runner, "session-1", "check this claim"))

    assert runner.run_config.max_llm_calls == team.MAX_LLM_CALLS
    assert f"I stopped after {team.MAX_LLM_CALLS} model calls" in capsys.readouterr().out
