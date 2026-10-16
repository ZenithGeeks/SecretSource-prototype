"""Fixtures for the server tests: server.py running on a fake Store.

store.py loads torch and the ColBERT model, so the tests give server.py a fake `store`
module instead. Run from this folder: `python -m pytest -q test_server*.py`.
"""

import importlib
import json
import sys
import types

import pytest
from fastapi.testclient import TestClient

PASSAGE = (
    "ColBERTv2 compresses each token vector to a centroid id and a small residual, "
    "which cuts the index size by six to ten times."
)


class FakeEncoder:
    device = "cpu"

    def query(self, text):
        return None

    def docs(self, texts):
        return []


class FakeStore:
    """Answers like store.Store, with one indexed paper and no model."""

    def __init__(self):
        self.encoder = FakeEncoder()
        self.added: list[str] = []

    def search(self, query, k=10, source=None):
        hits = [
            {
                "rank": 1,
                "score": 21.5,
                "text": PASSAGE,
                "title": "colbertv2",
                "source": "colbertv2.pdf",
                "page": 3,
                "start": 120,
                "end": 120 + len(PASSAGE),
            },
        ]
        return [hit for hit in hits if source in (None, hit["source"])][:k]

    def add_pdf(self, path):
        self.added.append(str(path))
        return 12

    def __len__(self):
        return 1


class McpClient:
    """Sends JSON-RPC requests to /mcp/, the way an agent's McpToolset does."""

    def __init__(self, http: TestClient):
        self.http = http
        self.next_id = 0

    def request(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        response = self.http.post(
            "/mcp/",
            json={"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}},
            headers={"Accept": "application/json, text/event-stream"},
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
    """Import server.py with the fake store module in place of the real one."""
    fake_store = types.ModuleType("store")
    fake_store.Store = FakeStore
    with pytest.MonkeyPatch.context() as patch:
        patch.setitem(sys.modules, "store", fake_store)
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
    return McpClient(client)
