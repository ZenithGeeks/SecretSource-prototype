"""ColBERTv2 retrieval service.

Serves the same store over two protocols: plain HTTP under /api (the agreement
dspy.ColBERTv2 expects) and MCP under /mcp. Run with `python server.py`
(http://0.0.0.0:8893, COLBERT_PORT to change).
"""

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field
from store import Store

PORT = int(os.getenv("COLBERT_PORT", "8893"))
PAPERS_DIR = Path(os.getenv("PAPERS_DIR", "data/papers"))  # where uploads land before indexing
PDF_UPLOAD = File(...)
# One answer for every refused path, so a caller cannot learn which files exist on this machine.
PATH_REFUSED = "path must name a file inside PAPERS_DIR"

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


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
def search_passages(
    query: str,
    k: int = 10,
    source: str | None = None,
    snippet_chars: Annotated[int | None, Field(ge=1)] = None,
) -> dict:
    """Find passages in the indexed papers that match a query, best match first.

    Use it to read what a paper says in its own words, for example to check a claim
    against the paper it cites. Each passage is about 120 words from one page.

    Args:
        query: What to look for: a few words, a question or a sentence from a claim.
        k: How many passages to return. Values above 100 are cut to 100.
        source: The file name of one indexed paper, for example "2112.01488.pdf", to
            search only that paper. Leave it out to search every indexed paper.
        snippet_chars: Cut each passage's text to at most this many characters, at the
            end of a word, to save tokens. Leave it out to get whole passages.

    Returns:
        {"topk": [hit, ...]}, best first. Each hit has rank (1 is the best), score,
        text (the passage, cut to snippet_chars if set), title, source (the paper's file
        name), page (1 is the first page), and start and end (character offsets of the
        whole passage in that page's text). score is the ColBERT MaxSim score: higher is
        a closer match. It is a sum over the query's 32 tokens (padding included) and has
        no fixed range, so compare scores only within one answer.
    """
    hits = store().search(query, min(k, 100), source)
    if snippet_chars is not None:
        hits = [{**hit, "text": snippet(hit["text"], snippet_chars)} for hit in hits]
    return {"topk": hits}


def snippet(text: str, chars: int) -> str:
    """Cut text to at most `chars` characters, at the end of a word."""
    if len(text) <= chars:
        return text
    # One character past the limit, so a word that ends exactly at the limit is kept.
    breaks = [m.start() for m in re.finditer(r"\s", text[: chars + 1])]
    return text[: breaks[-1]] if breaks and breaks[-1] > 0 else text[:chars]


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, idempotentHint=True, openWorldHint=False))
def add_paper(path: str) -> dict:
    """Index a PDF so search_passages can find its passages.

    Adding the same file again replaces its passages. If the file has not changed,
    nothing is encoded again.

    Args:
        path: Where the PDF is on the ColBERT service's own disk. It must be a file
            inside the papers folder (PAPERS_DIR), for example
            "data/papers/2112.01488.pdf". Its file name becomes the paper's source.

    Returns:
        {"status": "ok", "added": passages in this paper, "papers": papers in the
        index}, or {"status": "error", "message": ...} if the paper was not indexed.
    """
    paper = paper_path(path)
    if paper is None:
        return {"status": "error", "message": PATH_REFUSED}
    return {"status": "ok", "added": store().add_pdf(paper), "papers": len(store())}


def paper_path(path: str) -> Path | None:
    """Return the resolved path if it is a file inside PAPERS_DIR, else None.

    resolve() follows `..` and symlinks first, so neither can point outside the folder."""
    resolved = Path(path).resolve()
    if resolved.is_relative_to(PAPERS_DIR.resolve()) and resolved.is_file():
        return resolved
    return None


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
    paper = paper_path(body.path)
    if paper is None:
        raise HTTPException(400, PATH_REFUSED)
    return {"added": store().add_pdf(paper), "papers": len(store())}


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
