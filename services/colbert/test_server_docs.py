"""tools/list carries what an agent needs to pick and fill each tool: every parameter
described, the k cap, and whether the tool changes anything."""


def test_each_tool_describes_its_parameters_and_result(mcp):
    tools = mcp.list_tools()

    search = tools["search_passages"]["description"]
    for name in ("query:", "k:", "source:", "Returns:"):
        assert name in search
    assert "100" in search


def test_search_is_read_only(mcp):
    assert mcp.list_tools()["search_passages"]["annotations"]["readOnlyHint"] is True
