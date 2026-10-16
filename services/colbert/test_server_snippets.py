"""search_passages cuts each passage to snippet_chars on a word boundary when asked, and
keeps the whole passage otherwise. /api/search, which the pipeline uses, never cuts."""

from conftest import PASSAGE


def texts(answer):
    return [hit["text"] for hit in answer["topk"]]


def test_snippet_ends_at_a_word_within_the_length_asked(mcp):
    answer = mcp.call_tool("search_passages", {"query": "index size", "snippet_chars": 40})

    assert texts(answer) == ["ColBERTv2 compresses each token vector"]


def test_a_word_that_ends_at_the_limit_is_kept(mcp):
    answer = mcp.call_tool("search_passages", {"query": "index size", "snippet_chars": 38})

    assert texts(answer) == ["ColBERTv2 compresses each token vector"]


def test_whole_passage_without_snippet_chars_or_when_it_is_short_enough(mcp):
    whole = mcp.call_tool("search_passages", {"query": "index size"})
    long_limit = mcp.call_tool("search_passages", {"query": "index size", "snippet_chars": 1000})

    assert texts(whole) == texts(long_limit) == [PASSAGE]


def test_snippet_chars_below_one_is_refused(mcp):
    arguments = {"query": "index size", "snippet_chars": 0}
    result = mcp.request("tools/call", {"name": "search_passages", "arguments": arguments})

    assert result["isError"] is True


def test_api_search_keeps_the_whole_passage(client):
    response = client.get("/api/search", params={"query": "index size"})

    assert [hit["text"] for hit in response.json()["topk"]] == [PASSAGE]
