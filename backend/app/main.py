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
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel

from app import dependencies, researcher, store
from app.auth import current_user
from app.config import (
    AVATARS_DIR,
    PAPERS_DIR,
    PARALLEL_ANALYSES,
    PARALLEL_CHECKS,
    PARALLEL_CHECKS_TOTAL,
    PARALLEL_SOURCES,
    PARALLEL_SOURCES_TOTAL,
)
from app.metrics import (
    ANALYSES_FINISHED,
    ANALYSES_RUNNING,
    ANALYSES_STARTED,
    ANALYSIS_DURATION_SECONDS,
    ANALYSIS_QUEUE_WAIT_SECONDS,
    AUDIT_FINDINGS,
    CLAIM_CHECKS_FAILED,
    CLAIM_VERDICTS,
)
from app.pipeline.audit import audit
from app.pipeline.claims import extract_claims_with_citations, locate
from app.pipeline.figures import figures_dir, paper_figures
from app.pipeline.sources import index_paper, lookup_key
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
# Extraction (GROBID + EXTRACT_WORKERS LLM calls) has no limit of its own, unlike the two above,
# so a burst of starts used to send all of it at once. A run waits here before extraction, then
# an accepted run is unaffected by later starts still waiting.
all_analyses = asyncio.Semaphore(PARALLEL_ANALYSES)


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


_background: set[asyncio.Task] = set()


def _detach(coro) -> None:
    """Run a coroutine without waiting for it, keeping a reference so asyncio does not
    garbage-collect it mid-flight."""
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _index_self(analysis_id: str, title: str) -> None:
    """Best-effort, detached from the run: whether the paper itself (not what it cites) is
    known to a public index, checked the same way a citation is. A slow or refused lookup
    must never delay or fail the analysis, so this runs after the analysis is done and just
    leaves the badge unknown if it fails."""
    analysis = analyses.get(analysis_id)
    if analysis is None or not title:
        return
    analysis["indexed_in"] = await asyncio.to_thread(index_paper, title)
    _save_soon(analysis_id)


async def _run(analysis_id: str, paper: str, verify: bool):
    analysis = analyses[analysis_id]
    queued_at = time.monotonic()
    await _publish(analysis_id, "queued", message="waiting for a free analysis slot")
    async with all_analyses:
        ANALYSIS_QUEUE_WAIT_SECONDS.observe(time.monotonic() - queued_at)
        ANALYSES_RUNNING.inc()
        try:
            await _run_queued(analysis_id, analysis, paper, verify)
        finally:
            ANALYSES_RUNNING.dec()


async def _run_queued(analysis_id: str, analysis: dict, paper: str, verify: bool):
    started_at = time.monotonic()
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
                    CLAIM_VERDICTS.labels(verdict=verdict["verdict"]).inc()
                    await _publish(
                        analysis_id, "verified", claim=index, source=source, verdict=verdict["verdict"]
                    )
                else:
                    reason = unchecked_reason(verdict, citation)
                    CLAIM_CHECKS_FAILED.labels(reason=reason).inc()
                    await _publish(
                        analysis_id, "failed", claim=index, source=source,
                        reason=reason, message=verdict.get("message", ""),
                    )

            await asyncio.gather(*(check(*job) for job in jobs))

        analysis["figures"] = await figures
        await _publish(analysis_id, "figures", figures=len(analysis["figures"]))

        # We check the run itself before anyone reads it.
        # We only report the findings; we do not fix them.
        analysis["audit"] = audit(analysis)
        AUDIT_FINDINGS.inc(len(analysis["audit"]))
        await _publish(analysis_id, "audited", findings=len(analysis["audit"]))

        analysis["status"] = "done"
        analysis["completed"] = datetime.now(timezone.utc).isoformat()
        await _publish(analysis_id, "done")
        _detach(_index_self(analysis_id, analysis["title"]))
    except Exception as error:
        analysis["status"] = "error"
        analysis["message"] = str(error)
        await _publish(analysis_id, "error", message=str(error))
    finally:
        ANALYSIS_DURATION_SECONDS.observe(time.monotonic() - started_at)
        ANALYSES_FINISHED.labels(status=analysis["status"]).inc()
        await streams[analysis_id].put(None)  # closes any open stream
        await _saved(analysis_id)


def _start(paper: str, verify: bool, owner: str | None) -> dict:
    analysis_id = uuid.uuid4().hex[:12]
    analyses[analysis_id] = {"id": analysis_id, "paper": paper, "status": "running",
                             "started": datetime.now(timezone.utc).isoformat(),
                             "owner": owner, "stages": [], "claims": []}
    streams[analysis_id] = asyncio.Queue()
    ANALYSES_STARTED.inc()
    asyncio.create_task(_run(analysis_id, paper, verify))
    return {"id": analysis_id}


def team_visible(user: str | None) -> list[dict]:
    """The analyses a signed-in researcher may read, oldest first: every stored analysis, shared
    across the whole team, once someone is signed in — one teammate's checked paper is everyone's
    to search, graph, and open. Signed out (no Supabase configured), current_user() only ever
    returns None, so this still narrows to analyses without an owner."""
    if user is None:
        return [analysis for analysis in analyses.values() if analysis.get("owner") is None]
    return list(analyses.values())


def visible_to(user: str | None) -> list[dict]:
    """The analyses this exact user owns. Kept owner-scoped even in the shared team library, for
    the one place sharing must stop: deleting a user's own data must never touch a teammate's."""
    return [analysis for analysis in analyses.values() if analysis.get("owner") == user]


def _owned(analysis_id: str, user: str | None) -> dict:
    """The analysis, if this signed-in researcher may read it — shared across the team via
    team_visible(). Missing, or (signed out) owned by someone else, is a 404, not a 403, so an id
    does not tell anyone that it exists."""
    analysis = analyses.get(analysis_id)
    if analysis is None or analysis not in team_visible(user):
        raise HTTPException(404, "no such analysis")
    return analysis


def _mine(analysis_id: str, user: str | None) -> dict:
    """The analysis, only if this exact user created it. Used only for deleting one's own
    analysis, so that action stays owner-scoped even though reading is now shared."""
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
    return [{k: v for k, v in a.items() if k not in left_out} for a in reversed(team_visible(user))]


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
    _mine(analysis_id, user)
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
    """The file names of the papers this user may open: the analysed paper of each analysis they
    may read (team_visible), and each cited paper a check read for one of them."""
    names = set()
    for analysis in team_visible(user):
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
    return await asyncio.to_thread(researcher.home, team_visible(user))


@app.get("/researcher/projects")
async def researcher_projects(user: str | None = Depends(current_user)):
    stored = await asyncio.to_thread(store.load_projects, user)
    return await asyncio.to_thread(researcher.projects, stored, team_visible(user))


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
    found = await asyncio.to_thread(researcher.library, project_id, stored, team_visible(user))
    if found is None:
        raise HTTPException(404, "no such project")
    return found


@app.post("/researcher/projects/{project_id}/papers")
async def add_to_project(
    project_id: str, request: ProjectPaperRequest, user: str | None = Depends(current_user)
):
    """Put an analysed paper the caller may read (team_visible) into one of their own projects."""
    _owned(request.analysis_id, user)
    stored = await asyncio.to_thread(store.load_projects, user)
    project = _project(project_id, stored)
    if request.analysis_id not in project["analyses"]:
        project["analyses"].append(request.analysis_id)
    project["updated"] = datetime.now(timezone.utc).isoformat()
    await asyncio.to_thread(store.save_project, project)
    projected = await asyncio.to_thread(researcher.projects, [project], team_visible(user))
    return projected[0]


@app.post("/researcher/consensus")
async def field_consensus(request: ConsensusRequest, user: str | None = Depends(current_user)):
    """What the works cited across the team's analysed papers say about a question. Reuses the
    verdicts already found; it makes no LLM calls."""
    return await asyncio.to_thread(researcher.consensus, request.question, team_visible(user))


@app.get("/researcher/graph")
async def knowledge_graph(user: str | None = Depends(current_user)):
    return await asyncio.to_thread(researcher.graph, team_visible(user))


# --- account settings, shared by every role (Settings modal) ---


class PreferencesPatch(BaseModel):
    patch: dict[str, Any]


# patch_preferences is a read-modify-write of the whole blob. Two PATCHes for different keys
# in flight at once (two settings changed within one round trip) could both read the same
# `current`, and the later save would silently drop the earlier key. Serialising the
# load→merge→save keeps both. It runs on a worker thread (the store calls block), so this is
# a threading.Lock, held only for that section. This assumes a single gateway process
# (uvicorn.run(app) below); a multi-instance deploy would need the merge in SQL instead
# (SQLite json_patch, a Supabase RPC doing `data || excluded.data`).
_preferences_lock = threading.Lock()


def _merge_preferences(user: str | None, patch: dict[str, Any]) -> dict[str, Any]:
    with _preferences_lock:
        current = store.load_preferences(user) or {}
        merged = {**current, **patch}
        store.save_preferences(user, merged)
    return merged


@app.get("/user/preferences")
async def get_preferences(user: str | None = Depends(current_user)):
    """The signed-in user's stored settings patch — checking/notification/appearance
    prefs and the role-specific extras. `{}` until the first PATCH. The frontend layers
    this over its own defaults, same as it did over localStorage before this endpoint."""
    return await asyncio.to_thread(store.load_preferences, user) or {}


@app.patch("/user/preferences")
async def patch_preferences(request: PreferencesPatch, user: str | None = Depends(current_user)):
    return await asyncio.to_thread(_merge_preferences, user, request.patch)


@app.delete("/user/data")
async def delete_all_data(user: str | None = Depends(current_user)):
    """Every analysis (and researcher project) this user owns — Settings → Your data →
    Delete all. The confirm dialog is the UI's job; this call is unconditional.

    An analysis still running is skipped and counted in `skipped`: its `_run` task keeps
    indexing `analyses`/`streams`, so popping them here would make its next `_publish`
    raise inside the task after this call already answered 200."""
    mine = visible_to(user)
    ids = [analysis["id"] for analysis in mine if analysis.get("status") != "running"]
    for analysis_id in ids:
        await _delete_one(analysis_id)
    await asyncio.to_thread(store.delete_projects, user)
    return {"deleted": len(ids), "skipped": len(mine) - len(ids)}


def _avatar_path(user: str | None) -> Path | None:
    return next(iter(AVATARS_DIR.glob(f"{user or 'anon'}.*")), None)


# One avatar file per user is kept by glob-unlink-write, a read-modify-write like
# _merge_preferences: two uploads for the same user at once (double-click, two tabs) could
# both pass the glob and leave two files with different extensions, and _avatar_path would
# then serve whichever the filesystem lists first. The file work runs on a worker thread
# (disk I/O off the loop) under this lock. Lock order, should anything ever need both:
# _avatar_lock first, then _preferences_lock — never _avatar_lock while holding
# _preferences_lock. Today nothing holds both: the avatarUrl preference is a separate PATCH.
_avatar_lock = threading.Lock()


def _replace_avatar(key: str, ext: str, content: bytes) -> None:
    with _avatar_lock:
        AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        for old in AVATARS_DIR.glob(f"{key}.*"):
            old.unlink(missing_ok=True)
        (AVATARS_DIR / f"{key}{ext}").write_bytes(content)


def _remove_avatar(key: str) -> None:
    with _avatar_lock:
        for old in AVATARS_DIR.glob(f"{key}.*"):
            old.unlink(missing_ok=True)


@app.post("/user/avatar")
async def upload_avatar(file: UploadFile = AVATAR_UPLOAD, user: str | None = Depends(current_user)):
    ext = AVATAR_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "avatar must be a PNG, JPEG or WebP image")
    # The cap is checked before anything is buffered: on the declared size when the client
    # sent one, and otherwise by reading at most one byte past the cap, so an oversized body
    # is never read whole.
    if file.size is not None and file.size > MAX_AVATAR_BYTES:
        raise HTTPException(413, "avatar must be under 2MB")
    content = await file.read(MAX_AVATAR_BYTES + 1)
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "avatar must be under 2MB")
    await asyncio.to_thread(_replace_avatar, user or "anon", ext, content)
    # Cache-bust: the frontend keeps this url in its settings blob indefinitely, so a
    # same-name re-upload needs a new url or the browser (and its own blob-url cache) would
    # keep showing the old image.
    return {"url": f"/api/user/avatar/me?v={int(time.time())}"}


@app.delete("/user/avatar")
async def remove_avatar(user: str | None = Depends(current_user)):
    await asyncio.to_thread(_remove_avatar, user or "anon")
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


@app.get("/metrics")
async def metrics():
    """Prometheus text format: analysis success rate, duration, queueing, verdicts, audit
    findings, LLM token usage (app/metrics.py). Scraped by the `gateway` job in
    deploy/monitoring/prometheus.yml, behind the opt-in `monitoring` compose profile. Reads an
    in-memory registry only, so unlike /health this needs no thread hop.
    """
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
