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
# Five snippets is enough for an agent to see the best matches. It can ask for more, up to MAX_K.
# /api/search stays at 10: the pipeline asks for 10 and keeps 4 (verify.evidence_from).
DEFAULT_K = 5
MAX_K = 100
# Same preview length lune-mcp-server uses. A 120-word passage is several times this.
DEFAULT_SNIPPET_CHARS = 280
# Interim weak-match line for 64-token queries (encoder.QUERY_LEN). #490 (5ae41339, 17 Oct 2026
# 16:47 UTC) raised queries from 32 to 64. No analysis has been stored since, so there is no
# 64-token score to draw the line from. While queries were 32 tokens, the lowest top score that
# still settled a claim was 14.105 (69 supports or refutes; 9 of 159 insufficient were under it).
# MaxSim adds one term per query token, padding included, so the interim line scales by 64/32.
# Replace it from a fresh 64/300 run; that needs a GPU. COLBERT_LOW_CONFIDENCE_BELOW overrides it.
DEFAULT_LOW_CONFIDENCE_BELOW = 14.105 * 64 / 32


def float_env(name: str, default: float) -> float:
    """Read a float setting. A blank value keeps the default. Anything else that is not a
    number is a startup error, so a typo does not silently move the line."""
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a number, got {raw!r}") from error


LOW_CONFIDENCE_BELOW = float_env("COLBERT_LOW_CONFIDENCE_BELOW", DEFAULT_LOW_CONFIDENCE_BELOW)

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
    k: Annotated[int, Field(ge=1)] = DEFAULT_K,
    source: str | None = None,
    snippet_chars: Annotated[int | None, Field(ge=1)] = None,
    full_text: bool = False,
) -> dict:
    """Find passages in the indexed papers that match a query, best match first.

    Use it to read what a paper says in its own words, for example to check a claim
    against the paper it cites. Each passage is about 120 words from one page. The
    answer is short snippets unless full_text is set, so a call does not spend tokens
    on text that will not be quoted.

    Args:
        query: What to look for: a few words, a question or a sentence from a claim.
        k: How many passages to return. The default is 5. Values below 1 are refused.
            Values above 100 are cut to 100.
        source: The file name of one indexed paper, for example "2112.01488.pdf", to
            search only that paper. Leave it out to search every indexed paper.
        snippet_chars: Cut each passage's text to at most this many characters, at the
            end of a word. The default is 280. Pass null to keep that default. Ignored
            when full_text is true.
        full_text: Return each passage's whole text. Leave it false to get snippets.

    Returns:
        {"topk": [hit, ...], "low_confidence": bool}, best first. Each hit has rank
        (1 is the best), score, text (a snippet, or the whole passage when full_text
        is true), truncated (true when text was cut), title, source (the paper's file
        name), page (1 is the first page), and start and end (character offsets of the
        whole passage in that page's text). score is the ColBERT MaxSim score: higher
        is a closer match. It is a sum over the query's 64 tokens (padding included)
        and has no fixed range, so compare scores only within one answer.
        low_confidence is true when there are no hits or the best score is under 28.21.
        14.105 was the lowest top score that settled a claim while queries were 32
        tokens. Queries are 64 tokens now, and no analysis has been stored since that
        change, so the line is scaled by the query length until a fresh 64-token run
        replaces it. Do not quote a hit as support then. A false value only means the
        match is not that weak.
    """
    hits = store().search(query, min(k, MAX_K), source)
    if full_text:
        limit = None
    elif snippet_chars is None:
        limit = DEFAULT_SNIPPET_CHARS
    else:
        limit = snippet_chars
    hits = [present(hit, limit) for hit in hits]
    top = hits[0]["score"] if hits else None
    return {"topk": hits, "low_confidence": top is None or top < LOW_CONFIDENCE_BELOW}


def present(hit: dict, limit: int | None) -> dict:
    """One hit for the agent. limit None keeps the whole passage."""
    if limit is None:
        return {**hit, "truncated": False}
    text = snippet(hit["text"], limit)
    return {**hit, "text": text, "truncated": text != hit["text"]}


def snippet(text: str, chars: int) -> str:
    """Cut text to at most `chars` characters, at the end of a word."""
    if len(text) <= chars:
        return text
    # One character past the limit, so a word that ends exactly at the limit is kept.
    breaks = [m.start() for m in re.finditer(r"\s", text[: chars + 1])]
    return text[: breaks[-1]] if breaks and breaks[-1] > 0 else text[:chars]


# No MCP tool adds a paper: an MCP client cannot hand this service a file on its own disk.
# Papers are indexed over HTTP, by POST /api/upload (SCRUM-164).


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
    return {"topk": store().search(query, min(k, MAX_K), source)}


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
