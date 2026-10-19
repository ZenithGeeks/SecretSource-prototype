"""search_passages returns short snippets by default, whole passages on request, and
sets low_confidence when the best hit is weaker than any hit that settled a claim.

/api/search, which the pipeline uses, still returns whole passages and no flag.
"""

from conftest import LONG_PASSAGE

# 56 words of "abcd" is the 280-character cut: 279 characters, ending at a word.
SNIPPET_280 = " ".join(["abcd"] * 56)


def test_the_default_answer_is_a_280_character_snippet(mcp):
    answer = mcp.call_tool("search_passages", {"query": "long"})

    assert [hit["text"] for hit in answer["topk"]] == [SNIPPET_280]
    assert len(SNIPPET_280) <= 280
    assert LONG_PASSAGE.startswith(SNIPPET_280)
    assert answer["low_confidence"] is False


def test_full_text_returns_the_whole_passage_even_with_snippet_chars(mcp):
    answer = mcp.call_tool("search_passages", {"query": "long", "full_text": True, "snippet_chars": 40})

    assert [hit["text"] for hit in answer["topk"]] == [LONG_PASSAGE]


def test_the_default_k_is_5_and_values_above_100_are_cut(mcp, server):
    answer = mcp.call_tool("search_passages", {"query": "many"})

    assert server.store().last_k == 5
    assert len(answer["topk"]) == 5
    assert [hit["rank"] for hit in answer["topk"]] == [1, 2, 3, 4, 5]

    mcp.call_tool("search_passages", {"query": "many", "k": 250})

    assert server.store().last_k == 100


def test_a_top_score_under_14_105_is_low_confidence(mcp):
    under = mcp.call_tool("search_passages", {"query": "score=14.104"})
    at_line = mcp.call_tool("search_passages", {"query": "score=14.105"})
    decisive = mcp.call_tool("search_passages", {"query": "score=14.4351"})

    assert under["low_confidence"] is True
    assert under["topk"][0]["score"] == 14.104
    assert at_line["low_confidence"] is False
    assert decisive["low_confidence"] is False


def test_no_hits_is_low_confidence(mcp):
    answer = mcp.call_tool("search_passages", {"query": "index size", "source": "missing.pdf"})

    assert answer["topk"] == []
    assert answer["low_confidence"] is True


def test_api_search_keeps_whole_passages_and_has_no_flag(client):
    response = client.get("/api/search", params={"query": "long", "k": 10})
    body = response.json()

    assert "low_confidence" not in body
    assert [hit["text"] for hit in body["topk"]] == [LONG_PASSAGE]
