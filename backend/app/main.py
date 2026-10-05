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
DELETE /user/data?scope=all|researcher|author -> deletes what the user owns in that role (default: both)
POST /user/avatar        multipart image -> {"url"}
DELETE /user/avatar
GET  /user/avatar/me     -> the avatar image
POST /verify            {"claim", "source"} -> one verdict, outside any analysis
/author/...             the Author role: drafts, projects, sources, checks, search (app/author/router.py)
POST /checks            {"claim", "source"} -> {"id"}, same async shape as /analyses
GET  /checks/{id}               -> one check with its verdict, once done
GET  /checks/{id}/events        -> SSE: resolving, then done/error (no stage in between)
DELETE /checks/{id}
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
from contextlib import asynccontextmanager, suppress
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
from app.author.router import DRAFT_CHECK, author_pdfs
from app.author.router import router as author_router
from app.author.verify import verify_cached
from app.config import (
    AVATARS_DIR,
    PAPERS_DIR,
    PARALLEL_CHECKS,
    PARALLEL_CHECKS_TOTAL,
    PARALLEL_SOURCES,
    PARALLEL_SOURCES_TOTAL,
)
from app.metrics import (
    ANALYSES_FINISHED,
    ANALYSES_STARTED,
    ANALYSIS_DURATION_SECONDS,
    AUDIT_FINDINGS,
    CLAIM_CHECKS_FAILED,
    CLAIM_VERDICTS,
)
from app.ownership import require_owner
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
from app.queue import cancel_if_queued, enqueue_analysis, job_is_alive, pubsub_client, redis_connection
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
_deleted: set[str] = set()

# Shared by every run, so N analyses at once are not N times the load on the retrieval
# services and the LLM (#170). _run_queued takes its own limit first, then one of these.
all_sources = asyncio.Semaphore(PARALLEL_SOURCES_TOTAL)
all_checks = asyncio.Semaphore(PARALLEL_CHECKS_TOTAL)


def restore():
    """Load stored analyses on startup. A "running" row may belong to a job an RQ worker is
    still executing (or was, before this gateway process last exited); only mark it interrupted
    when the job itself is confirmed gone, and otherwise let the snapshot subscriber catch it up."""
    analyses.clear()
    analyses.update(store.load_all())
    for analysis in analyses.values():
        if analysis["status"] != "running":
            continue
        alive = job_is_alive(analysis["id"])
        if alive is False:
            analysis.update(status="error", message="interrupted by a restart")
            # Add a final stage. A client that reconnects then sees the run is over.
            analysis["stages"].append(
                {"stage": "error", "message": "interrupted by a restart"}
            )
            store.save(analysis)
        else:
            if alive is None:
                logger.warning(
                    "could not reach Redis to check job %s on restart; leaving it running",
                    analysis["id"],
                )
            # SSE replay invariant: a stream must hold every stage already recorded.
            queue = streams.setdefault(analysis["id"], asyncio.Queue())
            for stage in analysis["stages"]:
                queue.put_nowait(stage)


def _apply_snapshot(snapshot: dict) -> None:
    """Turn a Redis analysis snapshot into the gateway's in-memory state and live SSE events.

    While runs still execute in-process, _publish appends a stage locally before publishing,
    so the local stage count is always >= the snapshot's for those runs, making this a no-op
    for them automatically. Once a stage count truly is newer, this is the only writer that
    replaces analyses[id], so it never mutates a dict another part of the process still holds.
    """
    analysis_id = snapshot["id"]
    if analysis_id in _deleted:
        return
    local = analyses.get(analysis_id)
    seen = len(local["stages"]) if local else 0
    new = snapshot["stages"][seen:]
    if not new:
        return
    analyses[analysis_id] = snapshot
    queue = streams.setdefault(analysis_id, asyncio.Queue())
    for stage in new:
        queue.put_nowait(stage)
    if snapshot["status"] in ("done", "error"):
        queue.put_nowait(None)


async def _resync_running() -> None:
    """Snapshots published while the subscriber was disconnected are gone: pub/sub keeps
    nothing. The worker also saves each stage to the store, so read running analyses back
    from there. _apply_snapshot skips whatever this gateway already has."""
    for analysis_id in [a["id"] for a in analyses.values() if a["status"] == "running"]:
        stored = await asyncio.to_thread(store.load, analysis_id)
        if stored:
            _apply_snapshot(stored)


_SUBSCRIBE_BACKOFF_START = 1.0
_SUBSCRIBE_BACKOFF_MAX = 30.0


async def _subscribe_forever() -> None:
    """Background task: apply every analysis snapshot published by a worker process. Retries
    quietly on any Redis outage so a gateway with no Redis (e.g. under TestClient) still
    starts and shuts down cleanly."""
    backoff = _SUBSCRIBE_BACKOFF_START
    while True:
        client = None
        try:
            client = pubsub_client()
            pubsub = client.pubsub()
            await pubsub.psubscribe("analysis:*")
            backoff = _SUBSCRIBE_BACKOFF_START
            try:
                await _resync_running()
            except Exception:
                logger.exception("reading running analyses back from the store failed")
            async for message in pubsub.listen():
                if message["type"] != "pmessage":
                    continue
                try:
                    _apply_snapshot(json.loads(message["data"]))
                except Exception:
                    logger.exception("applying a Redis analysis snapshot failed")
        except Exception as error:
            logger.warning("analysis snapshot subscriber lost Redis (%s); retrying", error)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _SUBSCRIBE_BACKOFF_MAX)
        finally:
            if client is not None:
                with suppress(Exception):
                    await client.aclose()


@asynccontextmanager
async def lifespan(app: FastAPI):
    restore()
    # Log where each dependency is and whether it answers, without holding up startup.
    app.state.dependency_check = asyncio.create_task(asyncio.to_thread(dependencies.log_report))
    app.state.snapshot_subscriber = asyncio.create_task(_subscribe_forever())
    yield
    app.state.snapshot_subscriber.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.snapshot_subscriber


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
app.include_router(author_router)


class AnalysisRequest(BaseModel):
    paper: str
    verify: bool = True


class CheckRequest(BaseModel):
    claim: str
    source: str  # a DOI, arXiv id, or title — not the author-year label the UI shows (#204)


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
    time, so the web app can show how long a run has taken.

    Also publishes the whole current analysis (not just this event) to Redis, so a gateway
    process running in a separate process from whatever runs the pipeline can pick it up
    (its own subscriber turns this into the same streams[]/analyses[] updates below). A sync
    publish call would block the loop while other claims' checks are running concurrently
    (asyncio.gather in _run_queued), so it runs in a thread, same reasoning as _save_soon.

    Best-effort: a Redis blip must not fail an analysis that is otherwise going fine. The gateway
    catches up from the next snapshot that gets through.
    """
    event = {"stage": stage, **fields, "at": round(time.time(), 1)}
    analyses[analysis_id]["stages"].append(event)
    _save_soon(analysis_id)
    await streams[analysis_id].put(event)
    snapshot = json.dumps(analyses[analysis_id], default=str)
    try:
        await asyncio.to_thread(redis_connection().publish, f"analysis:{analysis_id}", snapshot)
    except Exception as error:
        logger.warning("publishing analysis %s to Redis failed: %s", analysis_id, error)


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


def _new_analysis(analysis_id: str, paper: str, owner: str | None) -> dict:
    """The skeleton dict an analysis starts as, shared by the gateway's in-process `_start`
    and the worker's job (app/queue.py), so the two can never drift apart."""
    return {"id": analysis_id, "paper": paper, "status": "running",
            "owner": owner, "stages": [], "claims": []}


def _start(paper: str, verify: bool, owner: str | None) -> dict:
    """Records a "queued" stage locally (so the caller sees it immediately) and hands the run to
    an RQ worker."""
    analysis_id = uuid.uuid4().hex[:12]
    analysis = _new_analysis(analysis_id, paper, owner)
    analysis["started"] = datetime.now(timezone.utc).isoformat()
    queued = {"stage": "queued", "message": "waiting for a free worker", "at": round(time.time(), 1)}
    analysis["stages"].append(queued)
    analyses[analysis_id] = analysis
    streams[analysis_id] = asyncio.Queue()
    streams[analysis_id].put_nowait(queued)
    try:
        enqueue_analysis(analysis_id, paper, verify, owner, [queued], analysis["started"])
    except Exception:
        analyses.pop(analysis_id, None)
        streams.pop(analysis_id, None)
        logger.warning("enqueuing analysis %s failed", analysis_id)
        raise HTTPException(503, "the analysis queue is unavailable, try again shortly") from None
    ANALYSES_STARTED.inc()
    # Stored now so a gateway restart before a worker picks the job up still finds it (else it
    # 404s, and the web app's event stream stops retrying). The worker's saves supersede this.
    _save_soon(analysis_id)
    # Cloud Run can run several gateway instances, each with its own `analyses`. The others only
    # learn of a run from a snapshot on Redis, and the worker sends its first one when it starts
    # the job. Until then (minutes, while a worker is busy with another run) they answered 404 for
    # this analysis (#259). Best-effort, like _publish: a later snapshot catches them up.
    try:
        redis_connection().publish(f"analysis:{analysis_id}", json.dumps(analysis, default=str))
    except Exception as error:
        logger.warning("publishing queued analysis %s to Redis failed: %s", analysis_id, error)
    return {"id": analysis_id}


async def _run_check(check_id: str, claim: str, source: str):
    """One claim against one citation, outside any paper analysis (SCRUM-236).

    A single verify_claim call, not the prepare/check split _run uses for a paper's many
    claims — that split parallelizes across claims and cited works, which one claim has
    none of. Coarser progress than a paper analysis: verify_claim is one call we do not
    instrument further, so the stream has only a start (`resolving`) and an end
    (`done`/`error`), no stage in between while it runs.
    """
    check = analyses[check_id]
    try:
        await _publish(check_id, "resolving", message=f"resolving {source}")
        result = await asyncio.to_thread(verify_cached, claim, source, verify_claim)
        if result["status"] == "ok":
            check["verdict"] = result["verdict"]
            check["quote"] = result["quote"]
            check["reasoning"] = result["reasoning"]
            check["evidence"] = result.get("evidence", [])
            check["indexed_in"] = result.get("indexed_in", {})
            check["status"] = "done"
            await _publish(check_id, "done", verdict=result["verdict"])
        else:
            check["status"] = "error"
            check["reason"] = result.get("reason", "failed")
            check["message"] = result.get("message", "")
            await _publish(check_id, "error", reason=check["reason"], message=check["message"])
    except Exception as error:
        check["status"] = "error"
        check["message"] = str(error)
        await _publish(check_id, "error", message=str(error))
    finally:
        await streams[check_id].put(None)
        await _saved(check_id)


def _start_check(claim: str, source: str, owner: str | None) -> dict:
    check_id = uuid.uuid4().hex[:12]
    analyses[check_id] = {"id": check_id, "kind": "check", "claim": claim, "source": source,
                          "status": "running", "owner": owner, "stages": []}
    streams[check_id] = asyncio.Queue()
    asyncio.create_task(_run_check(check_id, claim, source))
    return {"id": check_id}


def visible_to(user: str | None) -> list[dict]:
    """The analyses this exact user may read, oldest first: their own when signed in, or the
    ones with no owner when signed out (current_user() only ever returns None then). Every
    analysis is private to its owner; nothing here is shared across users."""
    return [analysis for analysis in analyses.values() if analysis.get("owner") == user]


def _owned(analysis_id: str, user: str | None, kind: str = "paper") -> dict:
    """The analysis, if this exact user owns it (visible_to) and it is a `kind` row. Missing,
    owned by someone else, or another kind (a check's id on an analysis route) is a 404, not
    a 403, so an id does not tell anyone that it exists. The rule itself lives in
    app/ownership.py, shared with the Author role's rows."""
    return require_owner(analyses.get(analysis_id), user, "analysis", kind)


def _mine(analysis_id: str, user: str | None, kind: str = "paper") -> dict:
    """The analysis, only if this exact user created it. Same test as _owned(); kept as its
    own function since deleting one's own analysis is a distinct action from reading it."""
    return require_owner(analyses.get(analysis_id), user, "analysis", kind)


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
    # The list leaves out what only one analysis's own view needs. Rows with no "kind" are
    # older paper analyses, from before checks (SCRUM-236) existed alongside them.
    left_out = ("stages", "references", "markers", "outline")
    return [
        {k: v for k, v in a.items() if k not in left_out}
        for a in reversed(visible_to(user))
        if a.get("kind", "paper") == "paper"
    ]


@app.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    return _owned(analysis_id, user)


async def _delete_one(analysis_id: str) -> None:
    # A worker may still publish a snapshot after this delete; it must not come back.
    _deleted.add(analysis_id)
    # Out of memory first, so no new save starts. A save already running would store the row
    # again after the delete, so wait for it.
    analyses.pop(analysis_id, None)
    streams.pop(analysis_id, None)
    await _saved(analysis_id)
    await asyncio.to_thread(store.delete, analysis_id)


# A stage can take minutes with nothing to send. A comment line keeps proxies from closing
# the idle stream; the web app skips events that carry no data.
HEARTBEAT_SECONDS = 15


async def _event_stream(item_id: str):
    """Server-sent events: the stages already recorded, then each new one as it happens.
    Shared by analyses and checks — both keep their stages on the same `analyses` dict and
    publish to the same `streams` queue, so both get the keep-alive."""
    replayed = list(analyses[item_id]["stages"])
    for event in replayed:
        yield f"data: {json.dumps(event)}\n\n"
    if analyses[item_id]["status"] != "running":
        return
    # the queue still holds everything replayed above, in the same order
    while True:
        try:
            event = await asyncio.wait_for(streams[item_id].get(), HEARTBEAT_SECONDS)
        except TimeoutError:
            yield ": keep-alive\n\n"
            continue
        if event is None:
            return
        if replayed:
            replayed.pop(0)
            continue
        yield f"data: {json.dumps(event)}\n\n"


@app.delete("/analyses/{analysis_id}")
async def delete_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    analysis = _mine(analysis_id, user)
    if analysis["status"] == "running":
        # A started job keeps saving to the store, so a deleted row would come back on restart.
        if not await asyncio.to_thread(cancel_if_queued, analysis_id):
            raise HTTPException(409, "this analysis is still running; delete it once it finishes")
    await _delete_one(analysis_id)
    return {"deleted": analysis_id}


@app.get("/analyses/{analysis_id}/events")
async def analysis_events(analysis_id: str, user: str | None = Depends(current_user)):
    """The web app reads this with fetch(), so its token travels in the Authorization header."""
    _owned(analysis_id, user)
    return StreamingResponse(_event_stream(analysis_id), media_type="text/event-stream")


# --- checks: one claim against one citation, outside any paper analysis (SCRUM-236) ---


@app.post("/checks")
async def start_check(request: CheckRequest, user: str | None = Depends(current_user)):
    return _start_check(request.claim, request.source, user)


# A check is one author's own work: like an analysis it is private to its owner (visible_to),
# and every check route is owner-scoped, so `_mine` rather than `_owned`. Checks share the
# `analyses` dict with paper analyses, so each route also asks for its own kind: a paper's id
# here, or a check's id on an /analyses route, is a 404.
@app.get("/checks/{check_id}")
async def get_check(check_id: str, user: str | None = Depends(current_user)):
    return _mine(check_id, user, kind="check")


# The statuses a check or analysis ends in; anything else means its task is still writing.
FINISHED = ("done", "error")


@app.delete("/checks/{check_id}")
async def delete_check(check_id: str, user: str | None = Depends(current_user)):
    check = _mine(check_id, user, kind="check")
    if check.get("status") not in FINISHED:
        # _run_check is still writing to analyses[check_id] and streams[check_id], and its
        # finally block saves the row: deleting now would either crash that task or bring the
        # row back. Same rule as delete_analysis, minus the queue (checks run in-process).
        raise HTTPException(409, "this check is still running; delete it once it finishes")
    await _delete_one(check_id)
    return {"deleted": check_id}


@app.get("/checks/{check_id}/events")
async def check_events(check_id: str, user: str | None = Depends(current_user)):
    _mine(check_id, user, kind="check")
    return StreamingResponse(_event_stream(check_id), media_type="text/event-stream")


# --- the paper itself, so the UI can show the page a claim or a passage came from ---


def papers_of(user: str | None) -> set[str]:
    """The file names of the papers this user may open: the analysed paper of each analysis they
    may read (visible_to), and each cited paper a check read for one of them."""
    names = set()
    for analysis in visible_to(user):
        if analysis.get("file"):
            names.add(Path(analysis["file"]).name)
        for claim in analysis.get("claims", []):
            names.update(Path(v["source"]).name for v in claim.get("verdicts", []) if v.get("source"))
    names.update(author_pdfs(user))
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
    return await asyncio.to_thread(researcher.home, visible_to(user))


@app.get("/researcher/projects")
async def researcher_projects(user: str | None = Depends(current_user)):
    stored = await asyncio.to_thread(store.load_projects, user)
    return await asyncio.to_thread(researcher.projects, stored, visible_to(user))


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
    found = await asyncio.to_thread(researcher.library, project_id, stored, visible_to(user))
    if found is None:
        raise HTTPException(404, "no such project")
    return found


@app.post("/researcher/projects/{project_id}/papers")
async def add_to_project(
    project_id: str, request: ProjectPaperRequest, user: str | None = Depends(current_user)
):
    """Put an analysed paper the caller may read (visible_to) into one of their own projects."""
    _owned(request.analysis_id, user)
    stored = await asyncio.to_thread(store.load_projects, user)
    project = _project(project_id, stored)
    if request.analysis_id not in project["analyses"]:
        project["analyses"].append(request.analysis_id)
    project["updated"] = datetime.now(timezone.utc).isoformat()
    await asyncio.to_thread(store.save_project, project)
    projected = await asyncio.to_thread(researcher.projects, [project], visible_to(user))
    return projected[0]


@app.post("/researcher/consensus")
async def field_consensus(request: ConsensusRequest, user: str | None = Depends(current_user)):
    """What the works cited across the caller's own analysed papers say about a question. Reuses the
    verdicts already found; it makes no LLM calls."""
    return await asyncio.to_thread(researcher.consensus, request.question, visible_to(user))


@app.get("/researcher/graph")
async def knowledge_graph(user: str | None = Depends(current_user)):
    return await asyncio.to_thread(researcher.graph, visible_to(user))


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


DELETE_SCOPES = ("all", "researcher", "author")


@app.delete("/user/data")
async def delete_all_data(scope: str = "all", user: str | None = Depends(current_user)):
    """Settings → Your data → Delete all. `scope` says whose data: `researcher` is the paper
    analyses and researcher projects, `author` the draft checks and the Author role's projects,
    drafts and saved sources, `all` (the default) both. Each role's Settings tab sends its own
    scope, so a Researcher clearing papers keeps their Author drafts and the other way round
    (PR #291 review). The confirm dialog is the UI's job; this call is unconditional.

    An analysis still running is skipped and counted in `skipped`: a paper analysis's worker
    keeps saving it, so a deleted row would come back on the next restart (same reason as
    delete_analysis), and a draft check's in-process task keeps indexing `analyses`/`streams`,
    so popping them here would make its next `_publish` raise after this call answered 200."""
    if scope not in DELETE_SCOPES:
        raise HTTPException(400, f"scope must be one of {', '.join(DELETE_SCOPES)}")
    researcher = scope in ("all", "researcher")
    author = scope in ("all", "author")
    mine = [
        analysis for analysis in visible_to(user)
        if (author if analysis.get("kind") == DRAFT_CHECK else researcher)
    ]
    ids = [analysis["id"] for analysis in mine if analysis.get("status") != "running"]
    for analysis_id in ids:
        await _delete_one(analysis_id)
    if researcher:
        await asyncio.to_thread(store.delete_projects, user)
    if author:
        await asyncio.to_thread(store.delete_author_rows, user)
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
