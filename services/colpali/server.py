"""ColPali visual retrieval service: plain HTTP under /api, MCP under /mcp.

    python server.py            # http://0.0.0.0:8894  (COLPALI_PORT to change)

HTTP:
    GET  /api/search?query=...&k=5       -> {"topk": [{"rank", "score", "page", "kind", "label",
                                                        "caption", "image", "title", "source"}, ...]}
    POST /api/search {"query", "k"}      -> same
    POST /api/add    {"path": "x.pdf"}   -> {"added": pages, "total": rows}   whole pages
    POST /api/add_figures {"source", "title", "figures": [{"label", "page", "caption", "image"}]}
    GET  /health

MCP (streamable HTTP at /mcp): tool search_media — same store, same results.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from encoder import CHECKPOINT
from fastapi import FastAPI, HTTPException
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel
from store import Store

PORT = int(os.getenv("COLPALI_PORT", "8894"))

_store: Store | None = None


def store() -> Store:
    assert _store is not None, "store is created in the lifespan"
    return _store


mcp = FastMCP("colpali-retrieval", stateless_http=True, json_response=True, streamable_http_path="/")


@mcp.tool()
def search_media(query: str, k: int = 5) -> dict:
    """Search indexed figures and pages visually; returns labeled hits with captions."""
    return {"model": CHECKPOINT, "topk": store().search(query, min(k, 50))}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store
    _store = Store()  # loads the model + connects to Qdrant once
    print(f"{CHECKPOINT}: {len(_store)} rows on {_store.encoder.device}")
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="ColPali page retrieval", lifespan=lifespan)
app.mount("/mcp", mcp.streamable_http_app())


class SearchBody(BaseModel):
    query: str
    k: int = 5


class AddBody(BaseModel):
    path: str


class Figure(BaseModel):
    label: str = ""
    page: int = 0
    caption: str = ""
    image: str  # the crop on disk, written by the pipeline and shared through the papers volume


class AddFiguresBody(BaseModel):
    source: str  # the cited paper's file name, which search results are filtered by
    title: str = ""
    figures: list[Figure]


@app.get("/api/search")
def search(query: str, k: int = 5):
    return {"model": CHECKPOINT, "topk": store().search(query, min(k, 50))}


@app.post("/api/search")
def search_post(body: SearchBody):
    return search(body.query, body.k)


@app.post("/api/add")
def add(body: AddBody):
    if not Path(body.path).is_file():
        raise HTTPException(404, f"no such file: {body.path}")
    return {"added": store().add_pdf(body.path), "total": len(store())}


@app.post("/api/add_figures")
def add_figures(body: AddFiguresBody):
    """Index a paper's cropped figures instead of its whole pages."""
    figures = [figure.model_dump() for figure in body.figures]
    missing = [figure["image"] for figure in figures if not Path(figure["image"]).is_file()]
    if missing:
        raise HTTPException(404, f"no such crop: {missing[0]}")
    added = store().add_figures(body.source, body.title or body.source, figures)
    return {"added": added, "total": len(store())}


@app.get("/health")
def health():
    return {"ok": True, "model": CHECKPOINT, "rows": len(store())}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
