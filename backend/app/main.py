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
GET  /user/preferences                      -> the signed-in user's stored settings patch
PATCH /user/preferences  {"patch": {...}}   -> merges and returns the settings patch
DELETE /user/data        -> deletes every analysis (and researcher project) the user owns
POST /user/avatar        multipart image -> {"url"}
DELETE /user/avatar
GET  /user/avatar/me     -> the avatar image
POST /verify            {"claim", "source"} -> one verdict, outside any analysis
GET  /health

Analyses live in memory while they run. They are also written to SQLite (app/store.py)
as they progress. A restart keeps the history.
"""

import asyncio
import copy
import hashlib
import json
import logging
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app import dependencies, researcher, store
from app.auth import current_user
from app.config import (
    AVATARS_DIR,
    PAPERS_DIR,
    PARALLEL_CHECKS,
    PARALLEL_CHECKS_TOTAL,
    PARALLEL_SOURCES,
    PARALLEL_SOURCES_TOTAL,
)
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
from app.teacher.router import router as teacher_router

PORT = int(os.getenv("GATEWAY_PORT", "8080"))
PDF_UPLOAD = File(...)
AVATAR_UPLOAD = File(...)
MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2MB — a square 128px+ photo, not a print-res upload
AVATAR_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
PAGE_CACHE = Path(os.getenv("PAGE_CACHE", "/tmp/pages"))
DEFAULT_DPI, MAX_DPI = 110, 300
# Crops are saved as figure-1.png, figure-2.png ... by pipeline/figures.py.
# We match the whole name. This stops the route from serving any path.
# The request only sends a number, never a directory.
FIGURE_NAME = re.compile(r"figure-\d+")

analyses: dict[str, dict] = {}
streams: dict[str, asyncio.Queue] = {}

# Shared by every run, so N analyses at once are not N times the load on the retrieval
# services and the LLM (#170). _run takes its own limit first, then one of these.
all_sources = asyncio.Semaphore(PARALLEL_SOURCES_TOTAL)
all_checks = asyncio.Semaphore(PARALLEL_CHECKS_TOTAL)


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
    # Log where each dependency is and whether it answers, without holding up startup.
    app.state.dependency_check = asyncio.create_task(asyncio.to_thread(dependencies.log_report))
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
logger = logging.getLogger(__name__)

app = FastAPI(title="SecretSource gateway", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
app.include_router(teacher_router)


class AnalysisRequest(BaseModel):
    paper: str
    verify: bool = True


_unsaved: set[str] = set()  # analyses changed since their last save started
_savers: dict[str, asyncio.Task] = {}  # the task saving each analysis, while one runs


def _save_soon(analysis_id: str) -> None:
    """Save the analysis from a thread, not on the event loop.

    A Supabase upsert takes 200-300 ms, and while the loop waits for it every request from
    every user waits too (#169). One task per analysis does the saving. Changes made while it
    is saving are written together by its next save, so an older state is never stored after
    a newer one.
    """
    _unsaved.add(analysis_id)
    if analysis_id not in _savers:
        _savers[analysis_id] = asyncio.create_task(_save_while_unsaved(analysis_id))


async def _save_while_unsaved(analysis_id: str) -> None:
    try:
        while analysis_id in _unsaved:
            _unsaved.discard(analysis_id)
            analysis = analyses.get(analysis_id)
            if analysis is None:  # deleted meanwhile
                return
            # Copied on the loop: the run keeps changing the dict while the thread writes it.
            snapshot = copy.deepcopy(analysis)
            try:
                await asyncio.to_thread(store.save, snapshot)
            except Exception:
                logger.exception("saving analysis %s failed", analysis_id)
    finally:
        _savers.pop(analysis_id, None)


async def _saved(analysis_id: str) -> None:
    """Wait until the analysis's latest state is stored."""
    while (saver := _savers.get(analysis_id)) is not None:
        await saver


async def _publish(analysis_id: str, stage: str, **fields):
    """Record a stage on the analysis and send it to the open event stream. `at` is the Unix
    time, so the web app can show how long a run has taken."""
    event = {"stage": stage, **fields, "at": round(time.time(), 1)}
    analyses[analysis_id]["stages"].append(event)
    _save_soon(analysis_id)
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
        analysis["outline"] = extracted.get("outline", [])
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
                # This run's limit first: a run then has at most PARALLEL_SOURCES jobs waiting
                # on the shared limit, so a second run's first paper goes before this run's tenth.
                async with source_limit, all_sources:
                    return await asyncio.to_thread(prepare_source, source)

            ready_sources = {}
            for _, _, _, source in jobs:
                if source not in ready_sources:
                    ready_sources[source] = asyncio.create_task(prepare(source))

            # Step 2: judge each claim against its paper as soon as that paper is ready.
            check_limit = asyncio.Semaphore(PARALLEL_CHECKS)

            async def check(index: int, claim: dict, citation: dict, source: str):
                ready = await ready_sources[source]
                async with check_limit, all_checks:  # in this order, as in prepare
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
        await _saved(analysis_id)


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


def save_upload(content: bytes, filename: str | None) -> Path:
    """Store an uploaded PDF under a name made from its bytes: <stem>-<12 hex of sha256>.pdf.

    Everything after the upload goes by the file name: who may open the paper (papers_of), its
    page renders and its figure crops. Under the name the browser sent, two users' paper.pdf
    would be one file, the second upload replacing the first (#168). The same bytes uploaded
    twice still share one file, which is right: their pages and figures are the same too.
    """
    original = Path(Path(filename or "").name)
    stem = original.stem.lstrip(".") or "paper"
    digest = hashlib.sha256(content).hexdigest()[:12]
    path = PAPERS_DIR / f"{stem}-{digest}{original.suffix or '.pdf'}"
    if not path.is_file():
        PAPERS_DIR.mkdir(parents=True, exist_ok=True)
        # Written aside, then renamed: a run that opens this name never reads half a file.
        partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
        partial.write_bytes(content)
        os.replace(partial, path)
    return path


@app.post("/analyses/upload")
async def upload_analysis(
    file: UploadFile = PDF_UPLOAD, verify: bool = True, user: str | None = Depends(current_user)
):
    path = save_upload(await file.read(), file.filename)
    return _start(path.as_posix(), verify, user)


@app.get("/analyses")
async def list_analyses(user: str | None = Depends(current_user)):
    # The list leaves out what only one analysis's own view needs.
    left_out = ("stages", "references", "markers", "outline")
    return [{k: v for k, v in a.items() if k not in left_out} for a in reversed(visible_to(user))]


@app.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    return _owned(analysis_id, user)


async def _delete_one(analysis_id: str) -> None:
    # Out of memory first, so no new save starts. A save already running would store the row
    # again after the delete, so wait for it.
    analyses.pop(analysis_id, None)
    streams.pop(analysis_id, None)
    await _saved(analysis_id)
    await asyncio.to_thread(store.delete, analysis_id)


@app.delete("/analyses/{analysis_id}")
async def delete_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    _owned(analysis_id, user)
    await _delete_one(analysis_id)
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


def papers_of(user: str | None) -> set[str]:
    """The file names of the papers this user may open: the analysed paper of each of their
    analyses, and each cited paper a check read for one of them."""
    names = set()
    for analysis in visible_to(user):
        if analysis.get("file"):
            names.add(Path(analysis["file"]).name)
        for claim in analysis.get("claims", []):
            names.update(Path(v["source"]).name for v in claim.get("verdicts", []) if v.get("source"))
    return names


def _paper(name: str, user: str | None) -> Path:
    """The PDF named `name`, if it belongs to one of this user's analyses; 404 otherwise.

    Papers are stored once, by file name, for every user, so without this check anyone could
    download a paper someone else uploaded (#135). A paper that exists but is not the caller's
    is a 404 like a missing one, so a name does not tell anyone that it exists. The name comes
    from an HTTP request, so it is not a path.
    """
    if name != Path(name).name or name.startswith("."):
        raise HTTPException(400, "a paper name is a file name, not a path")
    path = PAPERS_DIR / name
    if not path.is_file() or name not in papers_of(user):
        raise HTTPException(404, f"no such paper: {name}")
    return path


# Only the browser that asked may keep a copy: these are one user's papers.
PRIVATE_CACHE = {"Cache-Control": "private, max-age=31536000"}


@app.get("/papers/{name}")
async def paper(name: str, user: str | None = Depends(current_user)):
    return FileResponse(
        _paper(name, user), media_type="application/pdf", filename=name, headers={"Cache-Control": "private"}
    )


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
async def page_image(
    name: str, page_number: int, dpi: int = DEFAULT_DPI, user: str | None = Depends(current_user)
):
    path = _paper(name, user)
    image = await asyncio.to_thread(_render, path, page_number, min(dpi, MAX_DPI))
    return FileResponse(image, media_type="image/png", headers=PRIVATE_CACHE)


@app.get("/papers/{name}/figures/{figure}.png")
async def figure_image(name: str, figure: str, user: str | None = Depends(current_user)):
    """One cropped figure of a paper, the image a verdict's `pages` entry points at."""
    paper = _paper(name, user)
    if not FIGURE_NAME.fullmatch(figure):
        raise HTTPException(400, "a figure is named figure-<n>")
    path = figures_dir(paper) / f"{figure}.png"
    if not path.is_file():
        raise HTTPException(404, f"no such figure: {figure}")
    # A crop never changes once written, so it is cached like a rendered page.
    return FileResponse(path, media_type="image/png", headers=PRIVATE_CACHE)


@app.get("/papers/{name}/find")
async def find(name: str, q: str, page: int | None = None, user: str | None = Depends(current_user)):
    """Where a piece of text sits in the paper: page, boxes, and the page size to scale by.
    Boxes are PDF points, top-left origin. The browser scales them by dpi / 72."""
    path = _paper(name, user)
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


# --- account settings, shared by every role (Settings modal) ---


class PreferencesPatch(BaseModel):
    patch: dict[str, Any]


@app.get("/user/preferences")
async def get_preferences(user: str | None = Depends(current_user)):
    """The signed-in user's stored settings patch — checking/notification/appearance
    prefs and the role-specific extras. `{}` until the first PATCH. The frontend layers
    this over its own defaults, same as it did over localStorage before this endpoint."""
    return await asyncio.to_thread(store.load_preferences, user) or {}


@app.patch("/user/preferences")
async def patch_preferences(request: PreferencesPatch, user: str | None = Depends(current_user)):
    current = await asyncio.to_thread(store.load_preferences, user) or {}
    merged = {**current, **request.patch}
    await asyncio.to_thread(store.save_preferences, user, merged)
    return merged


@app.delete("/user/data")
async def delete_all_data(user: str | None = Depends(current_user)):
    """Every analysis (and researcher project) this user owns — Settings → Your data →
    Delete all. The confirm dialog is the UI's job; this call is unconditional."""
    ids = [analysis["id"] for analysis in visible_to(user)]
    for analysis_id in ids:
        await _delete_one(analysis_id)
    await asyncio.to_thread(store.delete_projects, user)
    return {"deleted": len(ids)}


def _avatar_path(user: str | None) -> Path | None:
    return next(iter(AVATARS_DIR.glob(f"{user or 'anon'}.*")), None)


@app.post("/user/avatar")
async def upload_avatar(file: UploadFile = AVATAR_UPLOAD, user: str | None = Depends(current_user)):
    ext = AVATAR_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "avatar must be a PNG, JPEG or WebP image")
    content = await file.read()
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "avatar must be under 2MB")
    key = user or "anon"
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    for old in AVATARS_DIR.glob(f"{key}.*"):
        old.unlink(missing_ok=True)
    (AVATARS_DIR / f"{key}{ext}").write_bytes(content)
    # Cache-bust: the frontend keeps this url in its settings blob indefinitely, so a
    # same-name re-upload needs a new url or the browser (and its own blob-url cache) would
    # keep showing the old image.
    return {"url": f"/api/user/avatar/me?v={int(time.time())}"}


@app.delete("/user/avatar")
async def remove_avatar(user: str | None = Depends(current_user)):
    key = user or "anon"
    for old in AVATARS_DIR.glob(f"{key}.*"):
        old.unlink(missing_ok=True)
    return {"deleted": True}


@app.get("/user/avatar/me")
async def get_avatar(user: str | None = Depends(current_user)):
    path = _avatar_path(user)
    if path is None:
        raise HTTPException(404, "no avatar")
    return FileResponse(path)


class VerifyRequest(BaseModel):
    claim: str
    source: str


@app.post("/verify")
async def verify(request: VerifyRequest, user: str | None = Depends(current_user)):
    """Check one claim against one source, without running a whole analysis."""
    return await asyncio.to_thread(verify_claim, request.claim, request.source)


@app.get("/health")
async def health():
    """The gateway is up (`ok`), and each dependency's URL, auth and whether it answered, from a
    check at most 30 s old. `degraded` is true when a required one did not answer."""
    return {"ok": True, "analyses": len(analyses), **await asyncio.to_thread(dependencies.report)}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
