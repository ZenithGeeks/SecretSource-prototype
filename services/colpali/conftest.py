"""Fixtures for the server tests: server.py running on a fake Store.

store.py and encoder.py load torch and the ColPali model, so the tests give server.py
fake `store` and `encoder` modules instead. Run from this folder:
`python -m pytest -q test_server*.py`.
"""

import importlib
import json
import sys
import types

import pytest
from fastapi.testclient import TestClient


class FakeStore:
    """Answers like store.Store, with one indexed figure and no model."""

    def __init__(self):
        self.encoder = types.SimpleNamespace(device="cpu")

    def search(self, query, k=5, source=None, sources=None):
        hits = [
            {
                "rank": 1,
                "score": 14.2,
                "page": 4,
                "kind": "figure",
                "label": "Figure 2",
                "caption": "Index size per method.",
                "image": "data/papers/figures/colbertv2/figure-2.png",
                "title": "colbertv2",
                "source": "colbertv2.pdf",
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

    def __len__(self):
        return 1


class McpClient:
    """Sends JSON-RPC requests to /mcp/, the way an agent's McpToolset does.

    `scope` is the X-Paper-Scope header: the file names this caller may read. The fixture
    names the one paper the fake store holds. A client built with scope None sends no header,
    and the tool then returns nothing.
    """

    def __init__(self, http: TestClient, scope: list[str] | None = None):
        self.http = http
        self.scope = scope
        self.next_id = 0

    def request(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        headers = {"Accept": "application/json, text/event-stream"}
        if self.scope is not None:
            headers["x-paper-scope"] = json.dumps(self.scope)
        response = self.http.post(
            "/mcp/",
            json={"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}},
            headers=headers,
        )
        response.raise_for_status()
        return response.json()["result"]

    def list_tools(self) -> dict[str, dict]:
        return {tool["name"]: tool for tool in self.request("tools/list")["tools"]}

    def call_tool(self, name: str, arguments: dict) -> dict:
        result = self.request("tools/call", {"name": name, "arguments": arguments})
        assert not result.get("isError"), result
        return json.loads(result["content"][0]["text"])


@pytest.fixture(scope="module")
def server():
    """Import server.py with the fake store and encoder modules in place of the real ones."""
    fake_store = types.ModuleType("store")
    fake_store.Store = FakeStore
    fake_encoder = types.ModuleType("encoder")
    fake_encoder.CHECKPOINT = "vidore/colqwen2-v1.0"
    with pytest.MonkeyPatch.context() as patch:
        patch.setitem(sys.modules, "store", fake_store)
        patch.setitem(sys.modules, "encoder", fake_encoder)
        sys.modules.pop("server", None)
        yield importlib.import_module("server")
        sys.modules.pop("server", None)


@pytest.fixture(scope="module")
def client(server):
    """Run the app's lifespan once: it makes the store and starts the MCP session manager,
    which can only start once per app."""
    with TestClient(server.app) as client:
        yield client


@pytest.fixture(scope="module")
def mcp(client):
    return McpClient(client, scope=["colbertv2.pdf"])
