"""ColBERTv2 retrieval service.

Serves the same store over two protocols: plain HTTP under /api (the agreement
dspy.ColBERTv2 expects) and MCP under /mcp. Run with `python server.py`
(http://0.0.0.0:8893, COLBERT_PORT to change).
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, Field
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
def search_passages(
    query: str,
    k: int = 10,
    source: str | None = None,
    snippet_chars: Annotated[int | None, Field(ge=1)] = None,
) -> dict:
    """Search the indexed papers. Returns the top-k passages with page and span for each.

    Set snippet_chars to cut each passage's text to at most that many characters, at the
    end of a word. start and end still give the whole passage's span. Leave it out to get
    whole passages."""
    hits = store().search(query, min(k, 100), source)
    if snippet_chars is not None:
        hits = [{**hit, "text": snippet(hit["text"], snippet_chars)} for hit in hits]
    return {"topk": hits}


def snippet(text: str, chars: int) -> str:
    """Cut text to at most `chars` characters, at the end of a word."""
    if len(text) <= chars:
        return text
    # One character past the limit, so a word that ends exactly at the limit is kept.
    end = text.rfind(" ", 0, chars + 1)
    return text[:end] if end > 0 else text[:chars]


@mcp.tool()
def add_paper(path: str) -> dict:
    """Index a PDF so search_passages can find its passages. Re-adding replaces them."""
    if not Path(path).is_file():
        return {"status": "error", "message": f"no such file: {path}"}
    return {"status": "ok", "added": store().add_pdf(path), "papers": len(store())}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store
    _store = Store()  # loads the model + opens the vector file store once
    # One throwaway encode of each kind: torch sets itself up on its first forward pass, and
    # without this the first real search on a new instance paid for it (about 8 s).
    _store.encoder.query("warm up")
    _store.encoder.docs(["warm up"])
    print(f"{len(_store)} papers on {_store.encoder.device}")
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
    return {"added": store().add_pdf(body.path), "papers": len(store())}


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
    return {"added": store().add_pdf(path), "papers": len(store())}


@app.get("/health")
def health():
    return {"ok": True, "papers": len(store())}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
