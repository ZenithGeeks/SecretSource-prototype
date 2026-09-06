"""ColBERTv2 retrieval service: plain HTTP under /api, MCP under /mcp.

    python server.py            # http://0.0.0.0:8893  (COLBERT_PORT to change)

HTTP (the contract dspy.ColBERTv2 expects):
    GET  /api/search?query=...&k=10      -> {"topk": [{"rank", "score", "text", "title", "source",
                                                       "page", "start", "end"}, ...]}
    POST /api/search {"query", "k"}      -> same
    POST /api/add    {"path": "x.pdf"}   -> {"added": n, "total": m}
    GET  /health

MCP (streamable HTTP at /mcp): tools search_passages, add_paper — same store, same results.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel
from store import Store

PORT = int(os.getenv("COLBERT_PORT", "8893"))

_store: Store | None = None


def store() -> Store:
    assert _store is not None, "store is created in the lifespan"
    return _store


# The SDK's DNS-rebinding guard only admits localhost Host headers, which 421s every request
# that arrives through Cloud Run or a compose service name. Nothing here is bound to a
# loopback address, so the guard is off.
mcp = FastMCP(
    "colbert-retrieval",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@mcp.tool()
def search_passages(query: str, k: int = 10) -> dict:
    """Search the indexed papers; returns the top-k passages with page and span provenance."""
    return {"topk": store().search(query, min(k, 100))}


@mcp.tool()
def add_paper(path: str) -> dict:
    """Index a PDF so search_passages can find its passages. Re-adding replaces them."""
    if not Path(path).is_file():
        return {"status": "error", "message": f"no such file: {path}"}
    return {"status": "ok", "added": store().add_pdf(path), "total": len(store())}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store
    _store = Store()  # loads the model + connects to Qdrant once
    print(f"{len(_store)} passages on {_store.encoder.device}")
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="ColBERTv2 retrieval", lifespan=lifespan)
app.mount("/mcp", mcp.streamable_http_app())


class SearchBody(BaseModel):
    query: str
    k: int = 10


class AddBody(BaseModel):
    path: str


@app.get("/api/search")
def search(query: str, k: int = 10):
    return {"topk": store().search(query, min(k, 100))}


@app.post("/api/search")
def search_post(body: SearchBody):
    return search(body.query, body.k)


@app.post("/api/add")
def add(body: AddBody):
    if not Path(body.path).is_file():
        raise HTTPException(404, f"no such file: {body.path}")
    return {"added": store().add_pdf(body.path), "total": len(store())}


@app.get("/health")
def health():
    return {"ok": True, "passages": len(store())}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
