"""The MCP tools an agent sees at /mcp/: their names and parameters, and one call each.

A renamed tool or a changed parameter fails here before an agent fails at run time.
"""

from conftest import PASSAGE


def test_tools_list_names_each_tool_and_its_parameters(mcp):
    tools = mcp.list_tools()

    assert sorted(tools) == ["add_paper", "search_passages"]
    search = tools["search_passages"]["inputSchema"]
    assert list(search["properties"]) == ["query", "k", "source", "snippet_chars"]
    assert search["required"] == ["query"]
    add = tools["add_paper"]["inputSchema"]
    assert list(add["properties"]) == ["path"]
    assert add["required"] == ["path"]


def test_search_passages_returns_the_store_hits(mcp):
    answer = mcp.call_tool("search_passages", {"query": "index size", "k": 5, "source": "colbertv2.pdf"})

    assert [(hit["source"], hit["page"], hit["text"]) for hit in answer["topk"]] == [
        ("colbertv2.pdf", 3, PASSAGE)
    ]


def test_add_paper_indexes_a_pdf(mcp, server, monkeypatch, tmp_path):
    monkeypatch.setattr(server, "PAPERS_DIR", tmp_path)
    paper = tmp_path / "colbertv2.pdf"
    paper.write_bytes(b"%PDF-1.4")

    answer = mcp.call_tool("add_paper", {"path": str(paper)})

    assert answer == {"status": "ok", "added": 12, "papers": 1}
