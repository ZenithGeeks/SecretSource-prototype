"""search_passages returns short snippets by default, whole passages on request, and
sets low_confidence when the best hit is under the 64-token line.

/api/search, which the pipeline uses, still returns whole passages and no flag.
"""

import pytest
from conftest import LONG_PASSAGE

# 56 words of "abcd" is the 280-character cut: 279 characters, ending at a word.
SNIPPET_280 = " ".join(["abcd"] * 56)


def test_the_default_answer_is_a_280_character_snippet(mcp):
    answer = mcp.call_tool("search_passages", {"query": "long"})

    assert [hit["text"] for hit in answer["topk"]] == [SNIPPET_280]
    assert len(SNIPPET_280) <= 280
    assert LONG_PASSAGE.startswith(SNIPPET_280)
    assert answer["topk"][0]["truncated"] is True
    assert answer["low_confidence"] is False


def test_full_text_returns_the_whole_passage_even_with_snippet_chars(mcp):
    answer = mcp.call_tool("search_passages", {"query": "long", "full_text": True, "snippet_chars": 40})

    assert [hit["text"] for hit in answer["topk"]] == [LONG_PASSAGE]
    assert answer["topk"][0]["truncated"] is False


def test_the_default_k_is_5_and_values_above_100_are_cut(mcp, server):
    answer = mcp.call_tool("search_passages", {"query": "many"})

    assert server.store().last_k == 5
    assert len(answer["topk"]) == 5
    assert [hit["rank"] for hit in answer["topk"]] == [1, 2, 3, 4, 5]

    mcp.call_tool("search_passages", {"query": "many", "k": 250})

    assert server.store().last_k == 100


def test_k_below_one_is_refused(mcp):
    for k in (0, -3):
        arguments = {"query": "many", "k": k}
        result = mcp.request("tools/call", {"name": "search_passages", "arguments": arguments})

        assert result["isError"] is True


def test_a_top_score_under_the_64_token_line_is_low_confidence(mcp, server):
    line = server.DEFAULT_LOW_CONFIDENCE_BELOW
    under = mcp.call_tool("search_passages", {"query": "score=28.20"})
    at_line = mcp.call_tool("search_passages", {"query": f"score={line}"})

    assert line == 28.21
    assert server.LOW_CONFIDENCE_BELOW == line
    assert under["low_confidence"] is True
    assert under["topk"][0]["score"] == 28.2
    assert at_line["low_confidence"] is False


def test_the_threshold_can_be_overridden(mcp, server, monkeypatch):
    monkeypatch.setattr(server, "LOW_CONFIDENCE_BELOW", 30)
    weak = mcp.call_tool("search_passages", {"query": "score=29.5"})
    monkeypatch.setattr(server, "LOW_CONFIDENCE_BELOW", 20)
    strong = mcp.call_tool("search_passages", {"query": "score=29.5"})

    assert weak["low_confidence"] is True
    assert strong["low_confidence"] is False


def test_the_threshold_setting_reads_the_env_var(server, monkeypatch):
    monkeypatch.setenv("COLBERT_LOW_CONFIDENCE_BELOW", "30.5")
    assert server.float_env("COLBERT_LOW_CONFIDENCE_BELOW", 28.21) == 30.5

    monkeypatch.setenv("COLBERT_LOW_CONFIDENCE_BELOW", "  ")
    assert server.float_env("COLBERT_LOW_CONFIDENCE_BELOW", 28.21) == 28.21

    monkeypatch.setenv("COLBERT_LOW_CONFIDENCE_BELOW", "high")
    with pytest.raises(RuntimeError):
        server.float_env("COLBERT_LOW_CONFIDENCE_BELOW", 28.21)


def test_no_hits_is_low_confidence(mcp):
    answer = mcp.call_tool("search_passages", {"query": "index size", "source": "missing.pdf"})

    assert answer["topk"] == []
    assert answer["low_confidence"] is True


def test_api_search_keeps_whole_passages_and_has_no_flag(client):
    response = client.get("/api/search", params={"query": "long", "k": 10})
    body = response.json()

    assert "low_confidence" not in body
    assert "truncated" not in body["topk"][0]
    assert [hit["text"] for hit in body["topk"]] == [LONG_PASSAGE]
