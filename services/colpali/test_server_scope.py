"""search_media returns nothing the caller did not name in X-Paper-Scope.

The service has no user accounts. A call with no scope, an empty scope, or a file name
outside the scope gets no figures, including none from anyone else.
"""

import json

from conftest import McpClient

SECRET = "Bo secret caption 91337"
BO = "bo-private-91337.pdf"
ADA = "ada.pdf"


def two_papers(query, k=5, source=None, sources=None):
    """Both papers, then the same limit Store.search applies."""
    hits = [
        {
            "rank": 1, "score": 90.0, "page": 2, "kind": "figure", "label": "Figure 1",
            "caption": SECRET, "image": "data/papers/figures/bo/figure-1.png",
            "title": "bo", "source": BO,
        },
        {
            "rank": 2, "score": 40.0, "page": 1, "kind": "figure", "label": "Figure 2",
            "caption": "Ada late interaction chart", "image": "data/papers/figures/ada/figure-2.png",
            "title": "ada", "source": ADA,
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


def test_mcp_without_a_scope_returns_no_figures(client, server, monkeypatch):
    monkeypatch.setattr(server.store(), "search", two_papers)

    answer = McpClient(client, scope=None).call_tool("search_media", {"query": "chart"})

    assert answer["topk"] == []
    blob = json.dumps(answer)
    assert SECRET not in blob
    assert BO not in blob


def test_mcp_with_adas_papers_does_not_return_bos_figure(client, server, monkeypatch):
    monkeypatch.setattr(server.store(), "search", two_papers)

    answer = McpClient(client, scope=[ADA]).call_tool("search_media", {"query": "chart"})

    blob = json.dumps(answer)
    assert SECRET not in blob
    assert BO not in blob
    assert [hit["source"] for hit in answer["topk"]] == [ADA]


def test_mcp_scope_cannot_be_widened_by_naming_another_file(client, server, monkeypatch):
    called = []

    def search(*args, **kwargs):
        called.append(True)
        return two_papers(*args, **kwargs)

    monkeypatch.setattr(server.store(), "search", search)

    answer = McpClient(client, scope=[ADA]).call_tool(
        "search_media", {"query": "chart", "source": BO}
    )

    assert answer["topk"] == []
    assert called == []


def test_mcp_with_no_papers_returns_nothing(client, server, monkeypatch):
    called = []

    def search(*args, **kwargs):
        called.append(kwargs)
        return two_papers(*args, **kwargs)

    monkeypatch.setattr(server.store(), "search", search)

    answer = McpClient(client, scope=[]).call_tool("search_media", {"query": "chart"})

    assert answer["topk"] == []
    assert called == []
    assert SECRET not in json.dumps(answer)
