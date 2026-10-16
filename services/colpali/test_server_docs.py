"""tools/list carries what an agent needs to pick and fill search_media: every parameter
described, the k cap, and that the tool only reads."""


def test_search_media_describes_its_parameters_and_result(mcp):
    description = mcp.list_tools()["search_media"]["description"]

    for name in ("query:", "k:", "source:", "Returns:"):
        assert name in description
    assert "50" in description


def test_search_media_is_read_only(mcp):
    assert mcp.list_tools()["search_media"]["annotations"]["readOnlyHint"] is True
