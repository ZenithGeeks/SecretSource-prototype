"""ColPali visual retrieval service: plain HTTP under /api, MCP under /mcp.

    python server.py            # http://0.0.0.0:8894  (COLPALI_PORT to change)

HTTP:
    GET  /api/search?query=...&k=5       -> {"topk": [{"rank", "score", "page", "kind", "label",
                                                        "caption", "image", "title", "source"}, ...]}
    POST /api/search {"query", "k"}      -> same
    POST /api/add    {"path": "x.pdf"}   -> {"added": pages, "total": rows}   whole pages
    POST /api/add_figures {"source", "title", "figures": [{"label", "page", "caption", "image"}]}
    POST /api/upload          multipart "file"                        -> like /api/add
    POST /api/upload_figures  form source, title, figures (JSON) + "images" files -> like /api/add_figures
    The /add routes take paths on this machine; the /upload routes carry the files, for a
    caller that does not share this disk (a gateway on another machine, or on Cloud Run).
    GET  /health

MCP (streamable HTTP at /mcp): tool search_media — same store, same results.
"""

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from encoder import CHECKPOINT
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel
from store import Store

PORT = int(os.getenv("COLPALI_PORT", "8894"))
PAPERS_DIR = Path(os.getenv("PAPERS_DIR", "data/papers"))  # where uploads land before indexing
PDF_UPLOAD = File(...)
IMAGES_UPLOAD = File(...)
SOURCE_FORM = Form(...)
TITLE_FORM = Form("")
FIGURES_FORM = Form(...)

_store: Store | None = None


def store() -> Store:
    assert _store is not None, "store is created in the lifespan"
    return _store


# The SDK's DNS-rebinding guard only admits localhost Host headers, which 421s every request
# that arrives through Cloud Run or a compose service name. Nothing here is bound to a
# loopback address, so the guard is off.
mcp = FastMCP(
    "colpali-retrieval",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


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


def receive(upload: UploadFile, folder: Path) -> Path:
    """Write an uploaded file under `folder` and return where it landed. Only the base name
    is kept: it is a file name that arrived over HTTP, not a path."""
    name = Path(upload.filename or "").name
    if not name:
        raise HTTPException(400, "the upload needs a file name")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(upload.file.read())
    return path


@app.post("/api/upload")
def upload(file: UploadFile = PDF_UPLOAD):
    """Index a PDF's pages from a file sent in the request body."""
    path = receive(file, PAPERS_DIR)
    return {"added": store().add_pdf(path), "total": len(store())}


@app.post("/api/upload_figures")
def upload_figures(
    source: str = SOURCE_FORM,
    title: str = TITLE_FORM,
    figures: str = FIGURES_FORM,
    images: list[UploadFile] = IMAGES_UPLOAD,
):
    """add_figures for a caller on another machine: the crops travel with the request.
    `figures` is the JSON list add_figures takes; each entry's image is matched to an
    upload by file name and re-pointed at where it lands here."""
    try:
        wanted = [Figure(**figure) for figure in json.loads(figures)]
    except (TypeError, ValueError) as error:
        raise HTTPException(400, f"figures is not a JSON list of figures: {error}") from None
    folder = PAPERS_DIR / "figures" / Path(source).stem
    landed = {Path(image.filename or "").name: receive(image, folder) for image in images}
    rows = []
    for figure in wanted:
        path = landed.get(Path(figure.image).name)
        if path is None:
            raise HTTPException(400, f"no upload for crop {figure.image}")
        rows.append({**figure.model_dump(), "image": path.as_posix()})
    added = store().add_figures(source, title or source, rows)
    return {"added": added, "total": len(store())}


@app.get("/health")
def health():
    return {"ok": True, "model": CHECKPOINT, "rows": len(store())}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
