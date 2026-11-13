"""eval_screen_agent.py's data_agent tasks (#976): the fake library answers like the store, the
fakes look the same to the model, and a perfect agent passes every task."""

import asyncio
from types import SimpleNamespace

import eval_screen_agent as ev
import pytest
from app import main
from app.agents import data_tools
from eval_screen_agent import Run
from google.adk.tools import FunctionTool

EVAL_USER = SimpleNamespace(state={"user": "eval"})


@pytest.fixture
def library(monkeypatch):
    monkeypatch.setattr(main, "_owned", ev.owned)
    monkeypatch.setattr(main, "visible_to", lambda user: ev.LIBRARY)


def run(tool, *args):
    return asyncio.run(tool(*args, tool_context=EVAL_USER))


def test_the_real_data_tools_answer_from_the_fake_library(library):
    assert run(data_tools.get_analysis, "a3")["status"] == "done"
    assert "SPLADEv2" in run(data_tools.get_claim, "a1", 2)["verdicts"][0]["quote"]
    assert run(data_tools.search_claims, "long contexts")["claims"][0]["analysis_id"] == "a3"
    assert run(data_tools.get_gaps)["contradicted"]
    assert "qi2017" in run(data_tools.bibtex, "a2")["bibtex"]


def test_the_callback_records_data_and_role_tools_but_not_browser_tools(monkeypatch):
    monkeypatch.setattr(ev, "DATA_CALLS", [])

    for name in ("get_claim", "point_at", "list_papers", "data_agent", "load_memory"):
        assert ev.record(SimpleNamespace(name=name), {"q": name}, None) is None

    assert [name for name, _ in ev.DATA_CALLS] == ["get_claim", "data_agent", "load_memory"]


@pytest.mark.parametrize("real", list(ev.FAKES), ids=lambda tool: tool.__name__)
def test_each_fake_shows_the_model_the_same_tool_as_the_real_one(real):
    assert FunctionTool(ev.FAKES[real])._get_declaration() == FunctionTool(real)._get_declaration()


# What a perfect agent does for each data_agent task: its browser calls, data calls and reply.
PERFECT = {
    "Which claims in my ColBERTv2": (
        [],
        [("get_analysis", {"analysis_id": "a1"})],
        "Claim 2, about SPLADEv2",
    ),
    "How many claims in my PointNet++": ([], [("get_analysis", {"analysis_id": "a2"})], ""),
    "What evidence backs claim 1": ([], [("get_claim", {"analysis_id": "a1", "claim_number": 1})], ""),
    "Why is claim 2": ([], [("get_claim", {"analysis_id": "a1", "claim_number": 2})], "SPLADEv2 wins on 3"),
    "Find the claims about index size": ([], [("search_claims", {"query": "index size"})], ""),
    "Do any of my papers make claims": (
        [],
        [("search_claims", {"query": "long contexts"})],
        "Lost in the Middle",
    ),
    "Which claims across my library": ([], [("get_gaps", {})], ""),
    "Give me the BibTeX": ([], [("bibtex", {"analysis_id": "a2"})], ""),
    "Check this sentence": ([], [("check_text", {"text": "ColBERTv2 stores ... a centroid id ..."})], ""),
    "Is this paragraph backed": ([], [("check_text", {"text": "Late interaction scores ..."})], ""),
    "Remind me what I was studying": ([], [("load_memory", {"query": "ColBERTv2"})], ""),
    "Open the analyses screen.": ([("open_screen", {"screen": "analyses"})], [], ""),
    "Point at my PointNet++ paper.": ([("point_at", {"target": "paper:a2"})], [], ""),
}


def data_task(prefix: str) -> ev.Task:
    (task,) = [task for task in ev.TASKS if task.message.startswith(prefix)]
    return task


@pytest.mark.parametrize("prefix", PERFECT)
def test_a_perfect_agent_passes_each_data_task_and_doing_nothing_fails_it(prefix):
    calls, data_calls, reply = PERFECT[prefix]
    task = data_task(prefix)

    assert task.check(Run(calls=calls, data_calls=data_calls, reply=reply))
    assert not task.check(Run(calls=[("read_screen", {})], data_calls=[], reply=reply))


def test_asking_whether_an_analysis_finished_passes_from_list_papers_and_fails_if_it_starts_one():
    task = data_task("Is the analysis of my Lost")

    assert task.check(Run(reply="Yes, Lost in the Middle (a3) is done."))
    assert task.check(Run(data_calls=[("get_analysis", {"analysis_id": "a3"})], reply="It finished."))
    assert not task.check(Run(data_calls=[("submit_analysis", {"paper": "2307.03172"})], reply="Done."))
    assert not task.check(Run(reply="I could not find that paper."))
    assert not task.check(Run(reply="It is not finished yet; it is still running."))


def test_a_navigation_task_fails_when_it_also_asks_data_agent():
    task = data_task("Open the analyses screen.")
    run_ = Run(calls=[("open_screen", {"screen": "analyses"})], data_calls=[("get_gaps", {})])

    assert not task.check(run_)
