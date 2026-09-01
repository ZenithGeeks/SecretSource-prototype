"""HTTP gateway for the frontend: start an analysis, watch it run, read the results.

    python -m uvicorn app.main:app --port 8080        (or: docker compose up -d gateway)

POST /analyses          {"paper": "path | DOI | arXiv ID | URL", "verify": true} -> {"id"}
POST /analyses/upload   multipart PDF, same response
GET  /analyses                  -> every analysis, newest first
GET  /analyses/{id}             -> one analysis with its results
GET  /analyses/{id}/events      -> SSE: one event per pipeline stage (including failures)
DELETE /analyses/{id}
GET  /papers/{name}             -> the PDF itself
GET  /papers/{name}/pages/{n}.png?dpi=110   -> that page rendered
GET  /papers/{name}/find?q=...&page=N       -> where that text sits, as boxes
POST /verify            {"claim", "source"} -> one verdict, outside any analysis
GET  /health

Analyses are held in memory while they run and written to SQLite (app/store.py) as they
progress, so a restart keeps the history.
"""

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app import store
from app.config import PAPERS_DIR
from app.pipeline.claims import extract_claims_with_citations, locate
from app.pipeline.sources import lookup_key
from app.pipeline.verify import verify_claim

PORT = int(os.getenv("GATEWAY_PORT", "8080"))
PDF_UPLOAD = File(...)
PAGE_CACHE = Path(os.getenv("PAGE_CACHE", "/tmp/pages"))
DEFAULT_DPI, MAX_DPI = 110, 300

analyses: dict[str, dict] = {}
streams: dict[str, asyncio.Queue] = {}


def restore():
    """Load stored analyses on startup. Anything still marked running was interrupted."""
    analyses.clear()
    analyses.update(store.load_all())
    for analysis in analyses.values():
        if analysis["status"] == "running":
            analysis.update(status="error", message="interrupted by a restart")


@asynccontextmanager
async def lifespan(app: FastAPI):
    restore()
    yield


app = FastAPI(title="SecretSource gateway", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class AnalysisRequest(BaseModel):
    paper: str
    verify: bool = True


async def _publish(analysis_id: str, stage: str, **fields):
    """Record a stage on the analysis and push it to any open event stream."""
    event = {"stage": stage, **fields}
    analyses[analysis_id]["stages"].append(event)
    store.save(analyses[analysis_id])
    await streams[analysis_id].put(event)


def _why(verdict: dict, citation: dict) -> str:
    """Why this claim went unchecked, separating our failures from the paper's.
    An unresolvable citation that carries a link is usually a blog post or a spec —
    a fact about the bibliography, not a lookup of ours that failed."""
    reason = verdict.get("reason", "failed")
    return "web-source" if reason == "unresolvable" and citation.get("url") else reason


async def _run(analysis_id: str, paper: str, verify: bool):
    analysis = analyses[analysis_id]
    try:
        await _publish(analysis_id, "extracting", message=f"reading {paper}")
        extracted = await asyncio.to_thread(extract_claims_with_citations, paper)
        if extracted["status"] == "error":
            raise RuntimeError(extracted["message"])

        claims = extracted["claims"]
        analysis["file"] = extracted["file"]
        analysis["claims"] = claims
        # Both counts: a cap that quietly halved the claims would read as a short paper.
        await _publish(
            analysis_id, "extracted", claims=len(claims),
            extracted=extracted.get("extracted", len(claims)),
            windows=extracted.get("windows", 1),
        )

        if verify:
            for index, claim in enumerate(claims):
                for citation in claim["citations"]:
                    source = lookup_key(citation)
                    if not source:
                        continue
                    await _publish(analysis_id, "verifying", claim=index, source=source)
                    verdict = await asyncio.to_thread(verify_claim, claim["claim"], source)
                    if verdict["status"] == "ok":
                        # Keyed by what we looked the source up by, so the card shows the
                        # verdict against the citation it answers for.
                        claim.setdefault("verdicts", []).append({**verdict, "cited": source})
                        await _publish(analysis_id, "verified", claim=index, verdict=verdict["verdict"])
                    else:
                        # A failure is a result: a claim we could not check must not look
                        # like one nobody tried.
                        reason = _why(verdict, citation)
                        claim.setdefault("unchecked", []).append(
                            {"source": source, "reason": reason,
                             "message": verdict.get("message", "")}
                        )
                        await _publish(
                            analysis_id, "failed", claim=index, source=source,
                            reason=reason, message=verdict.get("message", ""),
                        )

        analysis["status"] = "done"
        await _publish(analysis_id, "done")
    except Exception as error:
        analysis["status"] = "error"
        analysis["message"] = str(error)
        await _publish(analysis_id, "error", message=str(error))
    finally:
        await streams[analysis_id].put(None)  # closes any open stream


def _start(paper: str, verify: bool) -> dict:
    analysis_id = uuid.uuid4().hex[:12]
    analyses[analysis_id] = {"id": analysis_id, "paper": paper, "status": "running",
                             "stages": [], "claims": []}
    streams[analysis_id] = asyncio.Queue()
    asyncio.create_task(_run(analysis_id, paper, verify))
    return {"id": analysis_id}


@app.post("/analyses")
async def start_analysis(request: AnalysisRequest):
    return _start(request.paper, request.verify)


@app.post("/analyses/upload")
async def upload_analysis(file: UploadFile = PDF_UPLOAD, verify: bool = True):
    PAPERS_DIR.mkdir(parents=True, exist_ok=True)
    path = PAPERS_DIR / Path(file.filename).name
    path.write_bytes(await file.read())
    return _start(path.as_posix(), verify)


@app.get("/analyses")
async def list_analyses():
    return [{k: v for k, v in a.items() if k != "stages"} for a in reversed(analyses.values())]


@app.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: str):
    if analysis_id not in analyses:
        raise HTTPException(404, "no such analysis")
    return analyses[analysis_id]


@app.delete("/analyses/{analysis_id}")
async def delete_analysis(analysis_id: str):
    if not store.delete(analysis_id):
        raise HTTPException(404, "no such analysis")
    analyses.pop(analysis_id, None)
    streams.pop(analysis_id, None)
    return {"deleted": analysis_id}


@app.get("/analyses/{analysis_id}/events")
async def analysis_events(analysis_id: str):
    """Server-sent events: the stages already recorded, then each new one as it happens."""
    if analysis_id not in analyses:
        raise HTTPException(404, "no such analysis")

    async def stream():
        replayed = list(analyses[analysis_id]["stages"])
        for event in replayed:
            yield f"data: {json.dumps(event)}\n\n"
        if analyses[analysis_id]["status"] != "running":
            return
        # the queue still holds everything replayed above, in the same order
        while (event := await streams[analysis_id].get()) is not None:
            if replayed:
                replayed.pop(0)
                continue
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


# --- the paper itself, so the UI can show the page a claim or a passage came from ---


def _paper(name: str) -> Path:
    """The PDF called `name`, or 404. The name arrives over HTTP, so it is not a path."""
    if name != Path(name).name or name.startswith("."):
        raise HTTPException(400, "a paper name is a file name, not a path")
    path = PAPERS_DIR / name
    if not path.is_file():
        raise HTTPException(404, f"no such paper: {name}")
    return path


@app.get("/papers/{name}")
async def paper(name: str):
    return FileResponse(_paper(name), media_type="application/pdf", filename=name)


def _render(path: Path, page_number: int, dpi: int) -> Path:
    """Render one page to PNG, once. A rendered page never changes, so it is cached."""
    import pymupdf

    cached = PAGE_CACHE / f"{path.stem}-{page_number}-{dpi}.png"
    if cached.exists():
        return cached
    with pymupdf.open(path) as document:
        if not 1 <= page_number <= document.page_count:
            raise HTTPException(404, f"{path.name} has {document.page_count} pages")
        cached.parent.mkdir(parents=True, exist_ok=True)
        document[page_number - 1].get_pixmap(dpi=dpi).save(cached)
    return cached


@app.get("/papers/{name}/pages/{page_number}.png")
async def page_image(name: str, page_number: int, dpi: int = DEFAULT_DPI):
    path = _paper(name)
    image = await asyncio.to_thread(_render, path, page_number, min(dpi, MAX_DPI))
    return FileResponse(image, media_type="image/png", headers={"Cache-Control": "max-age=31536000"})


@app.get("/papers/{name}/find")
async def find(name: str, q: str, page: int | None = None):
    """Where a piece of text sits in the paper: page, boxes, and the page size to scale by.
    Boxes are PDF points, top-left origin; the browser scales them by dpi / 72."""
    path = _paper(name)
    found = await asyncio.to_thread(locate, path.as_posix(), q, page)
    return found or {"page": None, "boxes": []}


class VerifyRequest(BaseModel):
    claim: str
    source: str


@app.post("/verify")
async def verify(request: VerifyRequest):
    """Check one claim against one source, without running a whole analysis."""
    return await asyncio.to_thread(verify_claim, request.claim, request.source)


@app.get("/health")
async def health():
    return {"ok": True, "analyses": len(analyses)}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
