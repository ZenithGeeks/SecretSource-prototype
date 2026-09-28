"""ColBERTv2 retrieval service.

Serves the same store over two protocols: plain HTTP under /api (the agreement
dspy.ColBERTv2 expects) and MCP under /mcp. Run with `python server.py`
(http://0.0.0.0:8893, COLBERT_PORT to change).
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel
from store import Store

PORT = int(os.getenv("COLBERT_PORT", "8893"))
PAPERS_DIR = Path(os.getenv("PAPERS_DIR", "data/papers"))  # where uploads land before indexing
PDF_UPLOAD = File(...)

_store: Store | None = None


def store() -> Store:
    assert _store is not None, "store is created in the lifespan"
    return _store


# The SDK's DNS-rebinding guard only accepts localhost Host headers. It would 421 every
# request from Cloud Run or a compose service name. Nothing here is on loopback, so it is off.
mcp = FastMCP(
    "colbert-retrieval",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@mcp.tool()
def search_passages(query: str, k: int = 10, source: str | None = None) -> dict:
    """Search the indexed papers. Returns the top-k passages with page and span for each."""
    return {"topk": store().search(query, min(k, 100), source)}


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
    source: str | None = None


class AddBody(BaseModel):
    path: str


@app.get("/api/search")
def search(query: str, k: int = 10, source: str | None = None):
    return {"topk": store().search(query, min(k, 100), source)}


@app.post("/api/search")
def search_post(body: SearchBody):
    return search(body.query, body.k, body.source)


@app.post("/api/add")
def add(body: AddBody):
    if not Path(body.path).is_file():
        raise HTTPException(404, f"no such file: {body.path}")
    return {"added": store().add_pdf(body.path), "total": len(store())}


def receive(upload: UploadFile, folder: Path) -> Path:
    """Write an uploaded file under `folder` and return its path. Only the base name
    is kept. It is a file name from an HTTP upload, not a path."""
    name = Path(upload.filename or "").name
    if not name:
        raise HTTPException(400, "the upload needs a file name")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(upload.file.read())
    return path


@app.post("/api/upload")
def upload(file: UploadFile = PDF_UPLOAD):
    """Index a PDF sent in the request body. Use this instead of /api/add when the caller
    does not share this disk (a gateway on another machine, or on Cloud Run)."""
    path = receive(file, PAPERS_DIR)
    return {"added": store().add_pdf(path), "total": len(store())}


@app.get("/health")
def health():
    return {"ok": True, "passages": len(store())}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
