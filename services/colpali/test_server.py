"""The MCP tool an agent sees at /mcp/: its name and parameters, and one call.

A renamed tool or a changed parameter fails here before an agent fails at run time.
"""


def test_tools_list_names_search_media_and_its_parameters(mcp):
    tools = mcp.list_tools()

    assert list(tools) == ["search_media"]
    schema = tools["search_media"]["inputSchema"]
    assert list(schema["properties"]) == ["query", "k", "source"]
    assert schema["required"] == ["query"]


def test_search_media_returns_the_model_and_the_store_hits(mcp, server):
    answer = mcp.call_tool("search_media", {"query": "index size chart", "k": 3, "source": "colbertv2.pdf"})

    assert answer["model"] == server.CHECKPOINT
    assert [(hit["kind"], hit["label"], hit["page"]) for hit in answer["topk"]] == [("figure", "Figure 2", 4)]
