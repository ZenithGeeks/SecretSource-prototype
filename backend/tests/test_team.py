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
    ]
    # load_memory searches past analyses (SCRUM-172); check_claim is the one verify specialist.
    assert [tool.name for tool in team.root_agent.tools] == ["load_memory", "check_claim"]
    declaration = team.root_agent.tools[1]._get_declaration()
    assert declaration.parameters_json_schema["required"] == ["claim", "source"]


def test_a_check_against_one_paper_also_goes_through_check_claim():
    """SCRUM-553: handing a one-paper check to a chat specialist stranded the follow-up turns
    in an agent without load_memory or paper_agent."""
    instruction = team.root_agent.instruction

    assert "verify_agent" not in instruction
    assert "call check_claim once for each cited paper" in instruction
    assert all(agent.name != "verify_agent" for agent in team.root_agent.sub_agents)


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


def test_a_paper_tool_reads_only_the_callers_own_local_files(tmp_path, monkeypatch):
    """SCRUM-532: cli.py and the A2A server have no login, so a path must not reach another
    person's upload or a file outside the papers folder."""
    papers = tmp_path / "papers"
    papers.mkdir()
    for name in ("mine.pdf", "theirs.pdf"):
        (papers / name).write_bytes(b"%PDF-1.4")
    outside = tmp_path / "secret.json"
    outside.write_text("{}")
    monkeypatch.setattr(team, "PAPERS_DIR", papers)
    monkeypatch.setattr(team.rag, "caller_papers", lambda tool_context: frozenset({"mine.pdf"}))
    read = []

    def check(claim: str, source_pdf_path: str) -> dict:
        read.append(source_pdf_path)
        return {"status": "ok"}

    tool = team.own_papers_only(check, "source_pdf_path")

    def run(source: str) -> dict:
        return asyncio.run(tool("a claim", source, tool_context=None))

    assert run(str(papers / "mine.pdf")) == {"status": "ok"}
    assert run("10.18653/v1/N18-1202")["status"] == "ok"  # not a file: looked up as before
    for refused in (papers / "theirs.pdf", outside, papers / ".." / "secret.json"):
        assert run(str(refused))["status"] == "error"
    assert read == [str(papers / "mine.pdf"), "10.18653/v1/N18-1202"]


def test_a_scoped_tool_gets_the_tool_context_and_the_same_schema():
    for tool in (team.verify_claim, team.extract_claims, team.add_paper):
        assert "tool_context" in inspect.signature(tool).parameters
    scoped, plain = FunctionTool(team.add_paper), FunctionTool(team.rag.add_paper)
    assert scoped._get_declaration() == plain._get_declaration()
