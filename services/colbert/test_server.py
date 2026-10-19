"""The MCP tools an agent sees at /mcp/: their names and parameters, and one call each.

A renamed tool or a changed parameter fails here before an agent fails at run time.
"""

from conftest import PASSAGE


def test_tools_list_names_each_tool_and_its_parameters(mcp):
    tools = mcp.list_tools()

    assert sorted(tools) == ["search_passages"]
    search = tools["search_passages"]["inputSchema"]
    assert list(search["properties"]) == ["query", "k", "source", "snippet_chars", "full_text"]
    assert search["required"] == ["query"]
    assert search["properties"]["k"]["default"] == 5
    assert search["properties"]["k"]["minimum"] == 1
    # Null keeps the 280-character default. The description says so; the schema default is null.
    snippet = search["properties"]["snippet_chars"]
    assert snippet["default"] is None
    assert any(item.get("type") == "null" for item in snippet["anyOf"])
    assert search["properties"]["full_text"]["default"] is False


def test_search_passages_returns_the_store_hits(mcp):
    answer = mcp.call_tool("search_passages", {"query": "index size", "k": 5, "source": "colbertv2.pdf"})

    assert [(hit["source"], hit["page"], hit["text"]) for hit in answer["topk"]] == [
        ("colbertv2.pdf", 3, PASSAGE)
    ]
    assert answer["low_confidence"] is False
