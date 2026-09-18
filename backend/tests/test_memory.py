"""Memory over past analyses (SCRUM-172): what load_memory finds, and whose analyses it may read.
No database: store.load_all is replaced by a list of analyses."""

import asyncio

from app import memory


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
    found = memory.search("what did we find for late interaction index size?", ANALYSES, owner="user-ada")
    assert found
    best = texts(found)[0]
    assert "Analysis old1" in best and "2112.01488" in best
    assert "Verdict: supports" in best and "space footprint by 6-10x" in best
    assert found[0].custom_metadata == {"analysis": "old1"}
    assert found[0].timestamp == "2026-09-10"  # when analysis old1 started


def test_another_users_analyses_are_never_read():
    found = texts(memory.search("late interaction index size", ANALYSES, owner="user-ada"))
    assert not any("Analysis theirs" in text for text in found)
    assert texts(memory.search("ColPali page images", ANALYSES, owner="user-ada"))[0].startswith(
        "Analysis mine"
    )


def test_without_an_owner_only_ownerless_analyses_are_read():
    found = texts(memory.search("ColPali page images late interaction", ANALYSES, owner=""))
    assert found and all(text.startswith("Analysis old1") for text in found)


def test_sources_that_could_not_be_checked_are_found_too():
    found = texts(memory.search("did we check the blog post?", ANALYSES, owner=""))
    assert any("could not be checked against Some blog post (web-source)" in text for text in found)


def test_nothing_matching_returns_nothing():
    assert memory.search("protein folding in yeast", ANALYSES, owner="user-ada") == []
    assert memory.search("what did we find?", ANALYSES, owner="user-ada") == []  # only stop words


def test_the_service_reads_the_store_and_uses_memory_owner(monkeypatch):
    monkeypatch.setattr(memory.store, "load_all", lambda: {a["id"]: a for a in ANALYSES})
    monkeypatch.setenv("MEMORY_OWNER", "user-bo")
    service = memory.AnalysisMemory()
    response = asyncio.run(
        service.search_memory(app_name="a", user_id="user-ada", query="index size tenfold")
    )
    found = texts(response.memories)
    # MEMORY_OWNER decides, not the caller's user id: the chat agents do not know who is asking.
    assert any("Analysis theirs" in text for text in found)
    assert not any("Analysis mine" in text for text in found)
    assert asyncio.run(service.add_session_to_memory(None)) is None
