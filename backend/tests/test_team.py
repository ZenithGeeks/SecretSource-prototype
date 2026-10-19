"""The chat tree: routing hands a request over whole, and check_claim is a tool the coordinator can
call several times in one turn (SCRUM-171). No model is called."""

import asyncio
import inspect
import threading
import time

from app.agents import team
from google.adk.tools.function_tool import FunctionTool


def test_rag_agent_treats_a_weak_search_hit_as_weak():
    instruction = team.rag_agent.instruction

    assert "full_text" in instruction
    assert "low_confidence" in instruction
    assert "do not quote it as support" in instruction


def test_the_coordinator_routes_to_the_chat_specialists_and_calls_check_claim_as_a_tool():
    assert [agent.name for agent in team.root_agent.sub_agents if agent.mode == "chat"] == [
        "rag_agent",
        "paper_agent",
        "verify_agent",
    ]
    # load_memory searches past analyses (SCRUM-172); check_claim is the single-turn verify_agent.
    assert [tool.name for tool in team.root_agent.tools] == ["load_memory", "check_claim"]
    declaration = team.root_agent.tools[1]._get_declaration()
    assert declaration.parameters_json_schema["required"] == ["claim", "source"]


def test_a_wrapped_tool_looks_the_same_to_the_model():
    for plain, wrapped in (
        (team.verify.verify_claim, team.verify_claim),
        (team.claims.extract_claims_with_citations, team.extract_claims_with_citations),
        (team.sources.fetch_source, team.fetch_source),
    ):
        assert FunctionTool(wrapped)._get_declaration() == FunctionTool(plain)._get_declaration()


def test_wrapped_tools_run_off_the_event_loop_so_calls_overlap():
    """ADK calls a plain function tool on its event loop. Three one-second checks gathered
    together must take about one second, not three, and must not block the loop."""
    threads = set()

    def slow_check(claim: str, source_pdf_path: str) -> dict:
        threads.add(threading.get_ident())
        time.sleep(1)
        return {"status": "ok", "source": source_pdf_path}

    tool = team.off_the_loop(slow_check)
    assert inspect.iscoroutinefunction(tool)

    async def three_at_once():
        loop_thread = threading.get_ident()
        start = time.monotonic()
        results = await asyncio.gather(*(tool("claim", source) for source in ("a", "b", "c")))
        return results, time.monotonic() - start, loop_thread

    results, took, loop_thread = asyncio.run(three_at_once())
    assert [result["source"] for result in results] == ["a", "b", "c"]
    assert took < 2
    assert loop_thread not in threads
