"""Memory over past analyses (SCRUM-172): what load_memory finds, and whose analyses it may read.
No database: store.load_owned is replaced by a list of analyses."""

import asyncio

from app import memory
from app.memory import SIGNED_OUT


def analysis(analysis_id, owner, claim, cited, verdict, quote, title="ColBERTv2", at=1789300000.0):
    return {
        "id": analysis_id,
        "owner": owner,
        "title": title,
        "paper": f"data/papers/{analysis_id}.pdf",
        "stages": [{"stage": "extracting", "at": at}],
        "claims": [
            {
                "claim": claim,
                "verdicts": [
                    {"cited": cited, "verdict": verdict, "quote": quote, "reasoning": "It says so."}
                ],
                "unchecked": [{"source": "Some blog post", "reason": "web-source"}],
            }
        ],
    }


ANALYSES = [
    analysis("old1", None, "Late interaction reduces the index size tenfold", "2112.01488", "supports",
             "residual compression reduces the space footprint by 6-10x", at=1789000000.0),
    analysis("mine", "user-ada", "ColPali retrieves pages from their images", "2407.01449", "supports",
             "ColPali embeds page images directly"),
    analysis("theirs", "user-bo", "Late interaction reduces the index size tenfold", "2004.12832", "refutes",
             "the index is larger than a single-vector index"),
]  # fmt: skip


def texts(entries):
    return [entry.content.parts[0].text for entry in entries]


def test_the_best_matching_verdict_comes_first_with_its_quote():
    found = memory.search("what did we find for late interaction index size?", ANALYSES, SIGNED_OUT)
    assert found
    best = texts(found)[0]
    assert "Analysis old1" in best and "2112.01488" in best
    assert "Verdict: supports" in best and "space footprint by 6-10x" in best
    assert found[0].custom_metadata == {"analysis": "old1"}
    assert found[0].timestamp == "2026-09-10"  # when analysis old1 started


def test_a_user_reads_only_their_own_analyses():
    found = texts(memory.search("late interaction index size ColPali page images", ANALYSES, "user-ada"))
    assert found and all(text.startswith("Analysis mine") for text in found)


def test_analyses_without_an_owner_are_not_shared_with_signed_in_users():
    # "old1" matches the question, but it has no owner, so a signed-in user never sees it.
    assert memory.search("late interaction index size tenfold", ANALYSES, "user-ada") == []


def test_signed_out_reads_only_analyses_without_an_owner():
    found = texts(memory.search("ColPali page images late interaction", ANALYSES, SIGNED_OUT))
    assert found and all(text.startswith("Analysis old1") for text in found)


def test_sources_that_could_not_be_checked_are_found_too():
    found = texts(memory.search("did we check the blog post?", ANALYSES, SIGNED_OUT))
    assert any("could not be checked against Some blog post (web-source)" in text for text in found)


def test_nothing_matching_returns_nothing():
    assert memory.search("protein folding in yeast", ANALYSES, "user-ada") == []
    assert memory.search("what did we find?", ANALYSES, "user-ada") == []  # only stop words


def stand_in_store(monkeypatch):
    """Replace store.load_owned with every row, and record which owners were asked for."""
    asked = []

    def load_owned(owner):
        asked.append(owner)
        return list(ANALYSES)

    monkeypatch.setattr(memory.store, "load_owned", load_owned)
    return asked


def search_memory(service, user_id, query):
    response = asyncio.run(service.search_memory(app_name="a", user_id=user_id, query=query))
    return texts(response.memories)


def test_the_service_reads_the_callers_own_analyses(monkeypatch):
    asked = stand_in_store(monkeypatch)
    service = memory.AnalysisMemory()
    found = search_memory(service, "user-bo", "late interaction index size")
    assert found and all(text.startswith("Analysis theirs") for text in found)
    found = search_memory(service, "user-ada", "late interaction index size ColPali")
    assert found and all(text.startswith("Analysis mine") for text in found)
    assert asyncio.run(service.add_session_to_memory(None)) is None
    assert asked == ["user-bo", "user-ada"]  # each search reads only that user's rows


def test_a_service_with_as_user_ignores_the_runners_user_id(monkeypatch):
    # a2a_server.py: ADK names an A2A caller A2A_USER_<context id>, which must not matter.
    asked = stand_in_store(monkeypatch)
    service = memory.AnalysisMemory(as_user=SIGNED_OUT)
    found = search_memory(service, "user-bo", "late interaction index size")
    assert found and all(text.startswith("Analysis old1") for text in found)
    assert asked == [None]  # SIGNED_OUT reads the rows with no owner
