"""tools/list carries what an agent needs to pick and fill each tool: every parameter
described, the k cap, and whether the tool changes anything."""


def test_each_tool_describes_its_parameters_and_result(mcp):
    tools = mcp.list_tools()

    search = tools["search_passages"]["description"]
    for name in ("query:", "k:", "source:", "snippet_chars:", "full_text:", "Returns:"):
        assert name in search
    assert "100" in search
    assert "default is 5" in search
    assert "low_confidence" in search
    assert "under 28.21" in search
    assert "truncated" in search


def test_search_is_read_only(mcp):
    assert mcp.list_tools()["search_passages"]["annotations"]["readOnlyHint"] is True
