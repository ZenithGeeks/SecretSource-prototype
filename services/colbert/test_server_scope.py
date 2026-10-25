"""search_passages returns nothing the caller did not name in X-Paper-Scope.

The service has no user accounts. A call with no scope, an empty scope, or a file name
outside the scope gets no passages, including none from anyone else. /api/search with
`sources` is the same limit for the gateway.
"""

import json

from conftest import McpClient

SECRET = "Bo secret token 91337"
BO = "bo-private-91337.pdf"
ADA = "Ada late interaction token 4242"


def two_papers(query, k=10, source=None, sources=None):
    """Both papers, then the same limit Store.search applies."""
    hits = [
        {
            "rank": 1, "score": 90.0, "text": SECRET, "title": "bo",
            "source": BO, "page": 2, "start": 0, "end": 10,
        },
        {
            "rank": 2, "score": 40.0, "text": ADA, "title": "ada",
            "source": "ada.pdf", "page": 1, "start": 0, "end": 10,
        },
    ]
    if sources is not None and source is not None:
        allowed = {source} if source in sources else set()
    elif sources is not None:
        allowed = set(sources)
    elif source is not None:
        allowed = {source}
    else:
        allowed = None
    if allowed is not None:
        hits = [hit for hit in hits if hit["source"] in allowed]
    return hits[:k]


def test_mcp_without_a_scope_returns_no_passages(client, server, monkeypatch):
    monkeypatch.setattr(server.store(), "search", two_papers)

    bare = McpClient(client, scope=None)
    answer = bare.call_tool("search_passages", {"query": "residual", "full_text": True})

    assert answer == {"topk": [], "low_confidence": True}
    blob = json.dumps(answer)
    assert SECRET not in blob
    assert BO not in blob


def test_mcp_with_adas_papers_does_not_return_bos_passage(client, server, monkeypatch):
    monkeypatch.setattr(server.store(), "search", two_papers)

    answer = McpClient(client, scope=["ada.pdf"]).call_tool(
        "search_passages", {"query": "interaction", "full_text": True}
    )

    blob = json.dumps(answer)
    assert SECRET not in blob
    assert BO not in blob
    assert [hit["source"] for hit in answer["topk"]] == ["ada.pdf"]
    assert answer["topk"][0]["text"] == ADA


def test_mcp_scope_cannot_be_widened_by_naming_another_file(client, server, monkeypatch):
    called = []

    def search(*args, **kwargs):
        called.append(True)
        return two_papers(*args, **kwargs)

    monkeypatch.setattr(server.store(), "search", search)

    answer = McpClient(client, scope=["ada.pdf"]).call_tool(
        "search_passages", {"query": "interaction", "source": BO, "full_text": True}
    )

    assert answer == {"topk": [], "low_confidence": True}
    assert called == []


def test_mcp_with_no_papers_returns_nothing(client, server, monkeypatch):
    called = []

    def search(*args, **kwargs):
        called.append(True)
        return two_papers(*args, **kwargs)

    monkeypatch.setattr(server.store(), "search", search)

    answer = McpClient(client, scope=[]).call_tool(
        "search_passages", {"query": "interaction", "full_text": True}
    )

    assert answer == {"topk": [], "low_confidence": True}
    assert called == []
    assert SECRET not in json.dumps(answer)


def test_api_search_with_sources_does_not_return_another_paper(client, server, monkeypatch):
    monkeypatch.setattr(server.store(), "search", two_papers)

    response = client.post("/api/search", json={"query": "interaction", "k": 5, "sources": ["ada.pdf"]})

    body = response.json()
    assert [hit["source"] for hit in body["topk"]] == ["ada.pdf"]
    assert SECRET not in json.dumps(body)
    assert BO not in json.dumps(body)


def test_api_search_with_an_empty_source_list_returns_nothing(client, server, monkeypatch):
    seen = {}

    def search(query, k=10, source=None, sources=None):
        seen["sources"] = sources
        return two_papers(query, k, source, sources)

    monkeypatch.setattr(server.store(), "search", search)

    response = client.post("/api/search", json={"query": "interaction", "sources": []})

    assert response.json()["topk"] == []
    assert seen["sources"] == []
    assert SECRET not in response.text
