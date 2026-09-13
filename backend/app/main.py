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

Analyses live in memory while they run. They are also written to SQLite (app/store.py)
as they progress. A restart keeps the history.
"""

import asyncio
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app import researcher, store
from app.auth import current_user
from app.config import PAPERS_DIR, PARALLEL_CHECKS, PARALLEL_SOURCES
from app.pipeline.audit import audit
from app.pipeline.claims import extract_claims_with_citations, locate
from app.pipeline.figures import figures_dir, paper_figures
from app.pipeline.sources import lookup_key
from app.pipeline.verify import (
    check_prepared,
    fold_check,
    prepare_source,
    unchecked_reason,
    verify_claim,
)

PORT = int(os.getenv("GATEWAY_PORT", "8080"))
PDF_UPLOAD = File(...)
PAGE_CACHE = Path(os.getenv("PAGE_CACHE", "/tmp/pages"))
DEFAULT_DPI, MAX_DPI = 110, 300
# Crops are saved as figure-1.png, figure-2.png ... by pipeline/figures.py.
# We match the whole name. This stops the route from serving any path.
# The request only sends a number, never a directory.
FIGURE_NAME = re.compile(r"figure-\d+")

analyses: dict[str, dict] = {}
streams: dict[str, asyncio.Queue] = {}


def restore():
    """Load stored analyses on startup. Ones still marked running were interrupted."""
    analyses.clear()
    analyses.update(store.load_all())
    for analysis in analyses.values():
        if analysis["status"] == "running":
            analysis.update(status="error", message="interrupted by a restart")
            # Add a final stage. A client that reconnects then sees the run is over.
            analysis["stages"].append(
                {"stage": "error", "message": "interrupted by a restart"}
            )
            store.save(analysis)


@asynccontextmanager
async def lifespan(app: FastAPI):
    restore()
    yield


class PathWithoutQuery(logging.Filter):
    """Keep the query string out of uvicorn's access log. The web app sends tokens only in
    headers, but a query can still carry something private, and anyone who can read the
    container logs reads this (#134). uvicorn's args are (client, method, path, version, status)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) == 5:
            client, method, path, version, status = record.args
            record.args = (client, method, str(path).split("?", 1)[0], version, status)
        return True


logging.getLogger("uvicorn.access").addFilter(PathWithoutQuery())

app = FastAPI(title="SecretSource gateway", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class AnalysisRequest(BaseModel):
    paper: str
    verify: bool = True


async def _publish(analysis_id: str, stage: str, **fields):
    """Record a stage on the analysis and send it to the open event stream. `at` is the Unix
    time, so the web app can show how long a run has taken."""
    event = {"stage": stage, **fields, "at": round(time.time(), 1)}
    analyses[analysis_id]["stages"].append(event)
    store.save(analyses[analysis_id])
    await streams[analysis_id].put(event)


async def _run(analysis_id: str, paper: str, verify: bool):
    analysis = analyses[analysis_id]
    try:
        await _publish(analysis_id, "extracting", message=f"reading {paper}")
        extracted = await asyncio.to_thread(extract_claims_with_citations, paper)
        if extracted["status"] == "error":
            raise RuntimeError(extracted["message"])

        claims = extracted["claims"]
        analysis["file"] = extracted["file"]
        analysis["title"] = extracted.get("title", "")
        analysis["authors"] = extracted.get("authors", [])
        analysis["year"] = extracted.get("year", "")
        analysis["claims"] = claims
        analysis["references"] = extracted.get("references", {})
        analysis["markers"] = extracted.get("markers", [])
        # We send both counts. If a cap cut the claims in half, the paper would look short.
        await _publish(
            analysis_id, "extracted", claims=len(claims),
            extracted=extracted.get("extracted", len(claims)),
            windows=extracted.get("windows", 1),
        )

        # The paper's own figures, so "Figure 2" in a claim can show that crop.
        # Docling takes minutes, so this runs while the claims are checked.
        figures = asyncio.create_task(asyncio.to_thread(paper_figures, analysis["file"]))

        if verify:
            # One job per claim and cited work, the way app/workflow.py plans them.
            jobs = [
                (index, claim, citation, source)
                for index, claim in enumerate(claims)
                for citation in claim["citations"]
                if (source := lookup_key(citation))
            ]

            # The totals, so the web app can show "12 of 33 checks" instead of a growing list.
            await _publish(
                analysis_id, "planned", checks=len(jobs), sources=len({source for *_, source in jobs})
            )

            # Step 1: get each cited paper ready once (download and index), several at a time.
            # Many claims can cite the same paper, so this avoids repeating that slow work.
            source_limit = asyncio.Semaphore(PARALLEL_SOURCES)

            async def prepare(source: str) -> dict:
                async with source_limit:
                    return await asyncio.to_thread(prepare_source, source)

            ready_sources = {}
            for _, _, _, source in jobs:
                if source not in ready_sources:
                    ready_sources[source] = asyncio.create_task(prepare(source))

            # Step 2: judge each claim against its paper as soon as that paper is ready.
            check_limit = asyncio.Semaphore(PARALLEL_CHECKS)

            async def check(index: int, claim: dict, citation: dict, source: str):
                ready = await ready_sources[source]
                async with check_limit:
                    await _publish(analysis_id, "verifying", claim=index, source=source)
                    if ready["status"] == "error":
                        verdict = {**ready, "claim": claim["claim"], "source": source}
                    else:
                        verdict = await asyncio.to_thread(
                            check_prepared, claim["claim"], source, Path(ready["path"])
                        )
                fold_check(claim, source, citation, verdict)
                if verdict["status"] == "ok":
                    await _publish(
                        analysis_id, "verified", claim=index, source=source, verdict=verdict["verdict"]
                    )
                else:
                    await _publish(
                        analysis_id, "failed", claim=index, source=source,
                        reason=unchecked_reason(verdict, citation), message=verdict.get("message", ""),
                    )

            await asyncio.gather(*(check(*job) for job in jobs))

        analysis["figures"] = await figures
        await _publish(analysis_id, "figures", figures=len(analysis["figures"]))

        # We check the run itself before anyone reads it.
        # We only report the findings; we do not fix them.
        analysis["audit"] = audit(analysis)
        await _publish(analysis_id, "audited", findings=len(analysis["audit"]))

        analysis["status"] = "done"
        await _publish(analysis_id, "done")
    except Exception as error:
        analysis["status"] = "error"
        analysis["message"] = str(error)
        await _publish(analysis_id, "error", message=str(error))
    finally:
        await streams[analysis_id].put(None)  # closes any open stream


def _start(paper: str, verify: bool, owner: str | None) -> dict:
    analysis_id = uuid.uuid4().hex[:12]
    analyses[analysis_id] = {"id": analysis_id, "paper": paper, "status": "running",
                             "owner": owner, "stages": [], "claims": []}
    streams[analysis_id] = asyncio.Queue()
    asyncio.create_task(_run(analysis_id, paper, verify))
    return {"id": analysis_id}


def visible_to(user: str | None) -> list[dict]:
    """The analyses this user may see, oldest first. Signed out, only analyses without an owner."""
    return [analysis for analysis in analyses.values() if analysis.get("owner") == user]


def _owned(analysis_id: str, user: str | None) -> dict:
    """The analysis, if this user may see it. Someone else's analysis is a 404, not a 403,
    so an id does not tell anyone that it exists."""
    analysis = analyses.get(analysis_id)
    if analysis is None or analysis.get("owner") != user:
        raise HTTPException(404, "no such analysis")
    return analysis


@app.post("/analyses")
async def start_analysis(request: AnalysisRequest, user: str | None = Depends(current_user)):
    return _start(request.paper, request.verify, user)


@app.post("/analyses/upload")
async def upload_analysis(
    file: UploadFile = PDF_UPLOAD, verify: bool = True, user: str | None = Depends(current_user)
):
    PAPERS_DIR.mkdir(parents=True, exist_ok=True)
    path = PAPERS_DIR / Path(file.filename).name
    path.write_bytes(await file.read())
    return _start(path.as_posix(), verify, user)


@app.get("/analyses")
async def list_analyses(user: str | None = Depends(current_user)):
    # The list leaves out what only one analysis's own view needs.
    left_out = ("stages", "references", "markers")
    return [{k: v for k, v in a.items() if k not in left_out} for a in reversed(visible_to(user))]


@app.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    return _owned(analysis_id, user)


@app.delete("/analyses/{analysis_id}")
async def delete_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    _owned(analysis_id, user)
    if not store.delete(analysis_id):
        raise HTTPException(404, "no such analysis")
    analyses.pop(analysis_id, None)
    streams.pop(analysis_id, None)
    return {"deleted": analysis_id}


@app.get("/analyses/{analysis_id}/events")
async def analysis_events(analysis_id: str, user: str | None = Depends(current_user)):
    """Server-sent events: the stages already recorded, then each new one as it happens.
    The web app reads this with fetch(), so its token travels in the Authorization header."""
    _owned(analysis_id, user)

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
    """The PDF named `name`, or 404 if it is missing.

    The name comes from an HTTP request, so it is not a path.
    """
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
    """Render one page to PNG once. A rendered page never changes, so it is cached."""
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


@app.get("/papers/{name}/figures/{figure}.png")
async def figure_image(name: str, figure: str):
    """One cropped figure of a paper, the image a verdict's `pages` entry points at."""
    paper = _paper(name)
    if not FIGURE_NAME.fullmatch(figure):
        raise HTTPException(400, "a figure is named figure-<n>")
    path = figures_dir(paper) / f"{figure}.png"
    if not path.is_file():
        raise HTTPException(404, f"no such figure: {figure}")
    # A crop never changes once written, so it is cached like a rendered page.
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "max-age=31536000"})


@app.get("/papers/{name}/find")
async def find(name: str, q: str, page: int | None = None):
    """Where a piece of text sits in the paper: page, boxes, and the page size to scale by.
    Boxes are PDF points, top-left origin. The browser scales them by dpi / 72."""
    path = _paper(name)
    found = await asyncio.to_thread(locate, path.as_posix(), q, page)
    return found or {"page": None, "boxes": []}


# --- the researcher screens, built from the caller's own analyses (app/researcher.py) ---


class ProjectRequest(BaseModel):
    name: str
    description: str = ""


class ProjectPaperRequest(BaseModel):
    analysis_id: str


class ConsensusRequest(BaseModel):
    question: str


def _project(project_id: str, stored: list[dict]) -> dict:
    project = next((project for project in stored if project["id"] == project_id), None)
    if project is None:
        raise HTTPException(404, "no such project")
    return project


@app.get("/researcher/home")
async def researcher_home(user: str | None = Depends(current_user)):
    return researcher.home(visible_to(user))


@app.get("/researcher/projects")
async def researcher_projects(user: str | None = Depends(current_user)):
    stored = await asyncio.to_thread(store.load_projects, user)
    return researcher.projects(stored, visible_to(user))


@app.post("/researcher/projects")
async def create_project(request: ProjectRequest, user: str | None = Depends(current_user)):
    name = request.name.strip()
    if not name:
        raise HTTPException(400, "a project needs a name")
    now = datetime.now(timezone.utc).isoformat()
    project = {"id": uuid.uuid4().hex[:12], "owner": user, "name": name,
               "description": request.description.strip(), "analyses": [], "created": now, "updated": now}
    await asyncio.to_thread(store.save_project, project)
    return researcher.projects([project], [])[0]


@app.get("/researcher/projects/{project_id}/library")
async def project_library(project_id: str, user: str | None = Depends(current_user)):
    stored = await asyncio.to_thread(store.load_projects, user)
    found = researcher.library(project_id, stored, visible_to(user))
    if found is None:
        raise HTTPException(404, "no such project")
    return found


@app.post("/researcher/projects/{project_id}/papers")
async def add_to_project(
    project_id: str, request: ProjectPaperRequest, user: str | None = Depends(current_user)
):
    """Put one of the caller's analysed papers in one of their projects."""
    _owned(request.analysis_id, user)
    stored = await asyncio.to_thread(store.load_projects, user)
    project = _project(project_id, stored)
    if request.analysis_id not in project["analyses"]:
        project["analyses"].append(request.analysis_id)
    project["updated"] = datetime.now(timezone.utc).isoformat()
    await asyncio.to_thread(store.save_project, project)
    return researcher.projects([project], visible_to(user))[0]


@app.post("/researcher/consensus")
async def field_consensus(request: ConsensusRequest, user: str | None = Depends(current_user)):
    """What the works cited in the caller's papers say about a question. Reuses the verdicts
    already found; it makes no LLM calls."""
    return researcher.consensus(request.question, visible_to(user))


@app.get("/researcher/graph")
async def knowledge_graph(user: str | None = Depends(current_user)):
    return researcher.graph(visible_to(user))


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
