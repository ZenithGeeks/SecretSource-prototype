"""ColPali visual retrieval service: plain HTTP under /api, MCP under /mcp.

    python server.py            # http://0.0.0.0:8894  (COLPALI_PORT to change)

HTTP:
    GET  /api/search?query=...&k=5&source=...  -> {"topk": [{"rank", "score", "page", "kind",
                                                    "label", "caption", "image", "title", "source"}, ...]}
    POST /api/search {"query", "k", "source"}  -> same. source (optional) restricts to one paper.
        With no source the route searches the whole index. The gateway always names one paper
        and drops any other hit. This route has no user of its own.
    POST /api/add    {"path": "x.pdf"}   -> {"added": pages, "total": rows}   whole pages
    POST /api/add_figures {"source", "title", "figures": [{"label", "page", "caption", "image"}]}
    POST /api/upload          multipart "file"                        -> like /api/add
    POST /api/upload_figures  form source, title, figures (JSON) + "images" files -> like /api/add_figures
    The /add routes take paths on this machine. The /upload routes carry the files.
    Use them when the caller does not share this disk (a gateway on another machine,
    or on Cloud Run).
    GET  /health

MCP (streamable HTTP at /mcp): tool search_media. It returns figures only for the file
names in the X-Paper-Scope header. With no header it returns nothing: this service cannot
tell callers apart, so it does not search the whole index.
"""

import json
import os
from contextlib import asynccontextmanager
from contextvars import ContextVar
from pathlib import Path

import uvicorn
from encoder import CHECKPOINT
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
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

# Set by the HTTP middleware from the X-Paper-Scope header: the file names the caller may
# read. None means the header was absent. search_media searches only this set. The service
# has no account of its own, so a call with no scope returns nothing rather than every paper.
paper_scope: ContextVar[frozenset[str] | None] = ContextVar("paper_scope", default=None)
SCOPE_HEADER = "x-paper-scope"


def store() -> Store:
    assert _store is not None, "store is created in the lifespan"
    return _store


# The SDK's DNS-rebinding guard only allows localhost Host headers. It returns 421 for
# every request that comes through Cloud Run or a compose service name. Nothing here is
# bound to a loopback address, so the guard is off.
mcp = FastMCP(
    "colpali-retrieval",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
def search_media(query: str, k: int = 5, source: str | None = None) -> dict:
    """Find figures and pages in the indexed papers that look like a match for a query.

    It compares the query with the image of each figure or page, not with extracted
    text, so it can find charts, tables and diagrams that a text search misses.

    Args:
        query: What to look for, for example "bar chart of accuracy per dataset".
        k: How many hits to return. Values above 50 are cut to 50.
        source: The file name of one indexed paper, for example "2112.01488.pdf", to
            search only that paper. It has to be one of the papers named in the
            X-Paper-Scope header. Leave source out to search every paper in that
            header. With no header, or a header that does not list the paper, the
            tool returns no figures: this service cannot tell callers apart, so it
            does not search the whole index.

    Returns:
        {"model": the ColPali checkpoint, "topk": [hit, ...]}, best first. Each hit has
        rank (1 is the best), score, page (1 is the first page), kind ("figure" for a
        cropped figure, "page" for a whole page), label (for example "Figure 3"),
        caption, image (the crop's path on this service, empty for a whole page),
        title and source (the paper's file name). score is the ColPali MaxSim score:
        higher is a closer match. It has no fixed range, so compare scores only within
        one answer.
    """
    allowed = paper_scope.get()
    if not allowed or (source is not None and source not in allowed):
        # No scope, an empty scope, or a paper the caller did not name: nothing, not the index.
        return {"model": CHECKPOINT, "topk": []}
    names = [source] if source is not None else sorted(allowed)
    return {"model": CHECKPOINT, "topk": store().search(query, min(k, 50), sources=names)}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _store
    _store = Store()  # loads the model and opens the vector file store once
    print(f"{CHECKPOINT}: {len(_store)} papers on {_store.encoder.device}")
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="ColPali page retrieval", lifespan=lifespan)


@app.middleware("http")
async def read_paper_scope(request, call_next):
    """Remember X-Paper-Scope for the MCP tool. A missing or unreadable header is no scope."""
    raw = request.headers.get(SCOPE_HEADER)
    names: frozenset[str] | None
    if raw is None:
        names = None
    else:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = []
        if isinstance(parsed, list):
            names = frozenset(name for name in parsed if isinstance(name, str))
        else:
            names = frozenset()
    token = paper_scope.set(names)
    try:
        return await call_next(request)
    finally:
        paper_scope.reset(token)


app.mount("/mcp", mcp.streamable_http_app())


class SearchBody(BaseModel):
    query: str
    k: int = 5
    source: str | None = None


class AddBody(BaseModel):
    path: str


class Figure(BaseModel):
    label: str = ""
    page: int = 0
    caption: str = ""
    image: str  # the crop on disk. The pipeline writes it and shares it through the papers volume


class AddFiguresBody(BaseModel):
    source: str  # the cited paper's file name. Search results are filtered by it
    title: str = ""
    figures: list[Figure]


@app.get("/api/search")
def search(query: str, k: int = 5, source: str | None = None):
    return {"model": CHECKPOINT, "topk": store().search(query, min(k, 50), source)}


@app.post("/api/search")
def search_post(body: SearchBody):
    return search(body.query, body.k, body.source)


@app.post("/api/add")
def add(body: AddBody):
    if not Path(body.path).is_file():
        raise HTTPException(404, f"no such file: {body.path}")
    return {"added": store().add_pdf(body.path), "papers": len(store())}


@app.post("/api/add_figures")
def add_figures(body: AddFiguresBody):
    """Index a paper's cropped figures, not its whole pages."""
    figures = [figure.model_dump() for figure in body.figures]
    missing = [figure["image"] for figure in figures if not Path(figure["image"]).is_file()]
    if missing:
        raise HTTPException(404, f"no such crop: {missing[0]}")
    added = store().add_figures(body.source, body.title or body.source, figures)
    return {"added": added, "papers": len(store())}


def receive(upload: UploadFile, folder: Path) -> Path:
    """Write an uploaded file under `folder` and return its path. Only the base name
    is kept. It is a file name from an HTTP request, not a path."""
    name = Path(upload.filename or "").name
    if not name:
        raise HTTPException(400, "the upload needs a file name")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(upload.file.read())
    return path


@app.post("/api/upload")
def upload(file: UploadFile = PDF_UPLOAD):
    """Index a PDF's pages from a file in the request body."""
    path = receive(file, PAPERS_DIR)
    return {"added": store().add_pdf(path), "papers": len(store())}


@app.post("/api/upload_figures")
def upload_figures(
    source: str = SOURCE_FORM,
    title: str = TITLE_FORM,
    figures: str = FIGURES_FORM,
    images: list[UploadFile] = IMAGES_UPLOAD,
):
    """add_figures for a caller on another machine. The crops travel with the request.

    `figures` is the JSON list add_figures takes. Each image is matched to an upload by
    file name. Its path is then set to where it lands here."""
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
    return {"added": added, "papers": len(store())}


@app.get("/health")
def health():
    return {"ok": True, "model": CHECKPOINT, "papers": len(store())}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
