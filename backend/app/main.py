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
POST /analyses/{id}/disputes                -> the owner disagrees with one verdict
GET  /user/preferences                      -> the signed-in user's stored settings patch
PATCH /user/preferences  {"patch": {...}}   -> merges and returns the settings patch
DELETE /user/data?scope=all|researcher|author -> deletes what the user owns in that role (default: both)
POST /user/avatar        multipart image -> {"url"}
DELETE /user/avatar
GET  /user/avatar/me     -> the avatar image
POST /verify            {"claim", "source"} -> one verdict, outside any analysis
POST /assistant/chats                 {"context"} -> a new chat of the caller's
GET  /assistant/chats                 -> the caller's chats, newest first
GET  /assistant/chats/{id}            -> one chat with its questions and checked replies
POST /assistant/chats/{id}/messages   {"question", "context"} -> SSE: statements, then verdicts
/memories               what the assistant remembers about the caller: list, delete (app/memories.py)
/author/...             the Author role: drafts, projects, sources, checks, search (app/author/router.py)
GET  /health

Analyses live in memory while they run. They are also written to SQLite or Supabase
(app/store.py) as they progress. A restart keeps the history, but only running analyses and
the newest rows are loaded then. Older rows are read when their owner asks, so memory at
startup does not grow with every analysis ever stored.
"""

import asyncio
import copy
import gc
import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from openinference.semconv.trace import OpenInferenceSpanKindValues, SpanAttributes
from opentelemetry import trace
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field
from redis.exceptions import RedisError

from app import chats, dependencies, mcp_server, researcher, store, uploads
from app.agent_runs import get_runner
from app.agent_runs import router as agent_router
from app.analysis_table import AnalysisTable
from app.auth import current_user
from app.author.router import DRAFT_CHECK, author_pdfs
from app.author.router import router as author_router
from app.config import (
    AVATARS_DIR,
    PAPERS_BUCKET,
    PAPERS_DIR,
    PARALLEL_CHECKS,
    PARALLEL_CHECKS_TOTAL,
    PARALLEL_SOURCES,
    PARALLEL_SOURCES_TOTAL,
)
from app.labeling import pool as labeling_pool
from app.labeling.router import router as labeling_router
from app.memories import router as memories_router
from app.metrics import (
    ANALYSES_FINISHED,
    ANALYSES_STARTED,
    ANALYSIS_DURATION_SECONDS,
    AUDIT_FINDINGS,
    CLAIM_CHECKS_FAILED,
    CLAIM_VERDICTS,
    current_analysis_tokens,
)
from app.ownership import require_owner
from app.pipeline.audit import audit
from app.pipeline.claims import extract_claims_with_citations, locate
from app.pipeline.figures import figures_dir, paper_figures
from app.pipeline.rag import add_paper
from app.pipeline.sources import index_paper
from app.pipeline.verify import (
    check_prepared,
    checked_citations,
    cites_others,
    fold_check,
    judged_text,
    prepare_source,
    unchecked_reason,
    verify_claim,
)
from app.queue import (
    STOPPED_MESSAGE,
    cancel_if_queued,
    enqueue_analysis,
    enqueue_distill,
    job_is_alive,
    pubsub_client,
    redis_connection,
    request_stop,
)
from app.screen_bridge import router as bridge_router
from app.teacher.router import router as teacher_router
from app.tracing import setup_tracing

PORT = int(os.getenv("GATEWAY_PORT", "8080"))
PDF_UPLOAD = File(...)
AVATAR_UPLOAD = File(...)
MAX_AVATAR_BYTES = 2 * 1024 * 1024  # 2MB — a square 128px+ photo, not a print-res upload
AVATAR_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
PAGE_CACHE = Path(os.getenv("PAGE_CACHE", "/tmp/pages"))
DEFAULT_DPI, MAX_DPI = 110, 300
# Crops are saved as figure-1.png, table-1.png ... by pipeline/figures.py.
# We match the whole name. This stops the route from serving any path.
# The request only sends a number, never a directory.
FIGURE_NAME = re.compile(r"(figure|table)-\d+")
# How many of the newest analyses to hold after a restart, on top of every running one.
# The rest stay in the store until their owner asks. Read at call time so a test can lower it.
_STARTUP_RECENT_DEFAULT = 50

# The event loop inserts, replaces and deletes rows (a new run, a snapshot, a delete) while a
# request thread reads and merges them. One lock covers the table, the owner index, the
# negative cache and the stream map, so a read cannot iterate a dict the loop is changing.
_load_lock = threading.RLock()
analyses = AnalysisTable(_load_lock)
streams: dict[str, asyncio.Queue] = {}
_deleted: set[str] = set()
# Ids the store has already said are absent, and when. A repeat of the same id must not ask
# again at once, but the mark expires: another instance may save that row later, and a client
# trying random ids must not grow this without bound. A snapshot or a save of the id drops it
# immediately. Touched only while holding _load_lock.
_MISSING_TTL_SECONDS = 60.0
_MISSING_MAX = 1024
_missing: OrderedDict[str, float] = OrderedDict()
# The loop a request thread schedules SSE queues onto. Set when the process starts serving.
# A test that calls lookup with no loop opens the queue on the calling thread instead.
_loop: asyncio.AbstractEventLoop | None = None


def startup_recent() -> int:
    raw = os.getenv("ANALYSES_STARTUP_RECENT", str(_STARTUP_RECENT_DEFAULT))
    try:
        return max(0, int(raw))
    except ValueError:
        return _STARTUP_RECENT_DEFAULT

# Shared by every run, so N analyses at once are not N times the load on the retrieval
# services and the LLM (#170). _run_queued takes its own limit first, then one of these.
all_sources = asyncio.Semaphore(PARALLEL_SOURCES_TOTAL)
all_checks = asyncio.Semaphore(PARALLEL_CHECKS_TOTAL)


def _forget_missing(analysis_id: str) -> None:
    """Drop a negative lookup. Caller holds _load_lock."""
    _missing.pop(analysis_id, None)


def _missing_hit(analysis_id: str) -> bool:
    """Whether this id was confirmed absent recently enough to skip the store. Caller holds _load_lock."""
    seen = _missing.get(analysis_id)
    if seen is None:
        return False
    if time.monotonic() - seen >= _MISSING_TTL_SECONDS:
        _missing.pop(analysis_id, None)
        return False
    return True


def _remember_missing(analysis_id: str) -> None:
    """Record one absent id, dropping expired marks and the oldest past the cap. Caller holds _load_lock."""
    now = time.monotonic()
    _missing[analysis_id] = now
    _missing.move_to_end(analysis_id)
    expired = [
        marked
        for marked, at in _missing.items()
        if now - at >= _MISSING_TTL_SECONDS and marked != analysis_id
    ]
    for marked in expired:
        _missing.pop(marked, None)
    while len(_missing) > _MISSING_MAX:
        _missing.popitem(last=False)


def _hold(row: dict) -> bool:
    """Keep one analysis in memory. Caller holds _load_lock.

    Returns whether a stream still has to be opened. That queue is an asyncio.Queue, which the
    event loop reads, so the caller opens it on the loop rather than here: this runs on a
    request thread."""
    analysis_id = row["id"]
    if analysis_id in _deleted:
        return False
    _forget_missing(analysis_id)
    analyses[analysis_id] = row
    return row.get("status") == "running" and analysis_id not in streams


def _open_stream(analysis_id: str) -> None:
    """Give a running analysis the queue a reconnecting client replays. On the event-loop thread
    when a loop is running; the queue then already holds every stage recorded so far."""
    with _load_lock:
        if analysis_id in streams or analysis_id in _deleted:
            return
        row = analyses.get(analysis_id)
        if row is None or row.get("status") != "running":
            return
        queue: asyncio.Queue = asyncio.Queue()
        streams[analysis_id] = queue
        for stage in row.get("stages") or ():
            queue.put_nowait(stage)


def _schedule_stream(analysis_id: str) -> None:
    """Open `analysis_id`'s stream on the event loop. A caller that is already on the loop opens
    it directly. With no loop running (a unit test), the calling thread is the one that will
    read the queue, so it opens it here."""
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is not None:
        _open_stream(analysis_id)
        return
    loop = _loop
    if loop is not None and loop.is_running():
        loop.call_soon_threadsafe(_open_stream, analysis_id)
        return
    _open_stream(analysis_id)


def restore():
    """Load running analyses and the newest stored rows. A "running" row may belong to a job an RQ
    worker is still executing (or was, before this gateway process last exited); only mark it
    interrupted when the job itself is confirmed gone, and otherwise let the snapshot subscriber
    catch it up. Older finished rows stay in the store until ensure_owner reads that owner."""
    loaded = store.load_startup(startup_recent())
    with _load_lock:
        _missing.clear()
        analyses.clear()
        analyses.update(loaded)
        pending = [analysis for analysis in analyses.values() if analysis["status"] == "running"]
    for analysis in pending:
        alive = job_is_alive(analysis["id"])
        if alive is False:
            analysis.update(status="error", message="interrupted by a restart")
            # Add a final stage. A client that reconnects then sees the run is over.
            analysis["stages"].append(
                {"stage": "error", "message": "interrupted by a restart"}
            )
            store.save(analysis)
            with _load_lock:
                _forget_missing(analysis["id"])
        else:
            if alive is None:
                logger.warning(
                    "could not reach Redis to check job %s on restart; leaving it running",
                    analysis["id"],
                )
            # SSE replay invariant: a stream must hold every stage already recorded.
            _open_stream(analysis["id"])


def _apply_snapshot(snapshot: dict) -> None:
    """Turn a Redis analysis snapshot into the gateway's in-memory state and live SSE events.

    While runs still execute in-process, _publish appends a stage locally before publishing,
    so the local stage count is always >= the snapshot's for those runs, making this a no-op
    for them automatically. Once a stage count truly is newer, this is the only writer that
    replaces analyses[id], so it never mutates a dict another part of the process still holds.
    """
    analysis_id = snapshot["id"]
    with _load_lock:
        # The publisher has this row, so a previous "not in the store" answer is stale.
        _forget_missing(analysis_id)
        if snapshot.get("deleted"):
            # Another instance deleted it: drop our copy and end any stream still open on it.
            _deleted.add(analysis_id)
            analyses.pop(analysis_id, None)
            queue = streams.pop(analysis_id, None)
            if queue is not None:
                queue.put_nowait(None)
            return
        if analysis_id in _deleted:
            return
        local = analyses.get(analysis_id)
        seen = len(local["stages"]) if local else 0
        stages = snapshot["stages"]
        new = stages[seen:]
        if not new:
            return
        analyses[analysis_id] = snapshot
        queue = streams.get(analysis_id)
        if queue is None:
            # The queue is new, so it has to hold the whole history. A client replays `stages`
            # and then skips that many items off the queue; a queue that only had `new` would
            # swallow the live events that follow.
            queue = asyncio.Queue()
            streams[analysis_id] = queue
            pending = stages
        else:
            pending = new
        for stage in pending:
            queue.put_nowait(stage)
        if snapshot["status"] in ("done", "error"):
            queue.put_nowait(None)


async def _resync_running() -> None:
    """Snapshots published while the subscriber was disconnected are gone: pub/sub keeps
    nothing. The worker also saves each stage to the store, so read running analyses back
    from there. _apply_snapshot skips whatever this gateway already has."""
    with _load_lock:
        running_ids = [a["id"] for a in analyses.values() if a["status"] == "running"]
    for analysis_id in running_ids:
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


def _warm_agents() -> None:
    """Import the agent modules and build what they need, before the first request. They pull in
    DSPy and LiteLLM, and importing those on the first /agent call while another request logged
    an error hung the gateway: LiteLLM's logging filter imported a part of a half-loaded package."""
    mcp_server._tools()
    get_runner()
    # DSPy and ADK load LiteLLM only on the first LLM call. A chat answer made that call in a
    # thread while the event loop logged, the two imports deadlocked, and the gateway hung.
    import litellm  # noqa: F401  about 3 s


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _loop
    _loop = asyncio.get_running_loop()
    setup_tracing()
    restore()
    await asyncio.to_thread(_warm_agents)  # about a second; the app takes no request until it is done
    # What exists now (imports, the restored rows) lives as long as the process. Freezing it
    # stops each full GC pass from walking it again. Without this, the first owner load after
    # start-up set off a full pass of about 41 ms (#551).
    gc.collect()
    gc.freeze()
    # Log where each dependency is and whether it answers, without holding up startup.
    app.state.dependency_check = asyncio.create_task(asyncio.to_thread(dependencies.log_report))
    app.state.snapshot_subscriber = asyncio.create_task(_subscribe_forever())
    async with mcp_server.running():
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
app.include_router(labeling_router)
app.include_router(agent_router)
app.include_router(bridge_router)
app.include_router(memories_router)
app.mount("/mcp", mcp_server.handle_mcp)  # MCP clients use /mcp/: Starlette redirects /mcp


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
            else:
                # This id is in the store now. A lookup that missed it before the save must try again.
                with _load_lock:
                    _forget_missing(analysis_id)
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


# A no-op until app/tracing.py registers Phoenix in this process.
tracer = trace.get_tracer(__name__)


def _step_span(name: str, value: str, attributes: dict | None = None):
    """A Phoenix AGENT span for one step of a run, named after the step, so a
    trace shows which step made each search and LLM call."""
    return tracer.start_as_current_span(
        name,
        attributes={
            SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.AGENT.value,
            SpanAttributes.AGENT_NAME: name,
            SpanAttributes.INPUT_VALUE: value,
            **(attributes or {}),
        },
    )


async def _in_step(name: str, value: str, fn, *args):
    """Run fn(*args) in a thread inside its step's span."""
    with _step_span(name, value):
        return await asyncio.to_thread(fn, *args)


async def _run_queued(analysis_id: str, analysis: dict, paper: str, verify: bool):
    started_at = time.monotonic()
    # Filled by every LLM call this run makes, so the saved record says what it cost.
    analysis["llm_tokens"] = {}
    current_analysis_tokens.set(analysis["llm_tokens"])
    try:
        await _publish(analysis_id, "extracting", message=f"reading {paper}")
        extracted = await _in_step("read_paper", paper, extract_claims_with_citations, paper)
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
        file = analysis["file"]
        figures = asyncio.create_task(_in_step("read_figures", file, paper_figures, file))
        # The paper itself goes into ColBERT too. Checks only index the works it cites, so a
        # search of the person's papers could never find the papers they analysed.
        indexed = asyncio.create_task(_in_step("add_paper", file, add_paper, file))

        if verify:
            # One job per claim and cited work.
            jobs = [
                (index, claim, citation, source)
                for index, claim in enumerate(claims)
                for citation, source in checked_citations(claim)
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
                    return await _in_step("prepare_source", source, prepare_source, source)

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
                    # Claims are numbered from 1 in the app and in get_analysis.
                    numbered = {"claim.number": index + 1, "claim.source": source}
                    with _step_span("check_source", claim["claim"], numbered) as span:
                        if ready["status"] == "error":
                            verdict = {**ready, "claim": claim["claim"], "source": source}
                        else:
                            verdict = await asyncio.to_thread(
                                check_prepared, claim["claim"], source, Path(ready["path"]),
                                judged_text(claim, citation), cites_others(claim, citation),
                            )
                        outcome = verdict.get("verdict") or verdict.get("message", "")
                        span.set_attribute(SpanAttributes.OUTPUT_VALUE, outcome)
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
        # Search is not part of the verdicts, so a paper that failed to index still finishes.
        if (result := await indexed)["status"] == "error":
            logger.warning("could not index %s for search: %s", analysis["file"], result.get("message"))

        # We check the run itself before anyone reads it.
        # We only report the findings; we do not fix them.
        with _step_span("audit_analysis", analysis_id):
            analysis["audit"] = audit(analysis)
        AUDIT_FINDINGS.inc(len(analysis["audit"]))
        await _publish(analysis_id, "audited", findings=len(analysis["audit"]))

        analysis["status"] = "done"
        analysis["completed"] = datetime.now(UTC).isoformat()
        await _publish(analysis_id, "done")
        _detach(_index_self(analysis_id, analysis["title"]))
    except Exception as error:
        analysis["status"] = "error"
        analysis["message"] = str(error)
        await _publish(analysis_id, "error", message=str(error))
    except asyncio.CancelledError:
        # Its owner pressed Stop (queue._cancel_when_stopped); the run ends like a failed one.
        analysis["status"] = "error"
        analysis["message"] = STOPPED_MESSAGE
        await _publish(analysis_id, "error", message=STOPPED_MESSAGE)
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
    analysis["started"] = datetime.now(UTC).isoformat()
    queued = {"stage": "queued", "message": "waiting for a free worker", "at": round(time.time(), 1)}
    analysis["stages"].append(queued)
    with _load_lock:
        _forget_missing(analysis_id)
        analyses[analysis_id] = analysis
        # On the event loop, like the rest of _start: the queue is what the loop waits on.
        queue: asyncio.Queue = asyncio.Queue()
        streams[analysis_id] = queue
        queue.put_nowait(queued)
    try:
        enqueue_analysis(analysis_id, paper, verify, owner, [queued], analysis["started"])
    except Exception:
        with _load_lock:
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


def ensure_owner(user: str | None) -> None:
    """Load this owner's analyses from the store, once. A row already in memory is kept: it may
    be a newer snapshot, or a run that has not been saved yet. Other owners are not read."""
    if analyses.owner_loaded(user):
        return
    stored = store.load_owned(user)
    to_open: list[str] = []
    with _load_lock:
        if analyses.owner_loaded(user):
            return
        stored_ids: list[str] = []
        seen: set[str] = set()
        for row in stored:
            analysis_id = row["id"]
            if analysis_id in _deleted or analysis_id in seen:
                continue
            seen.add(analysis_id)
            stored_ids.append(analysis_id)
            if analysis_id not in analyses and _hold(row):
                to_open.append(analysis_id)
        memory_only = [
            row["id"]
            for row in analyses.owned_by(user)
            if row["id"] not in seen and row["id"] not in _deleted
        ]
        analyses.order_owner(user, stored_ids + memory_only)
        analyses.mark_owner_loaded(user)
    for analysis_id in to_open:
        _schedule_stream(analysis_id)


def lookup(analysis_id: str) -> dict | None:
    """The analysis in memory, or that one row from the store. A loaded row is kept, so the next
    read of it does not ask again. Nothing is loaded for an id this process has deleted, or for
    one the store recently said was absent."""
    # A test may swap in a plain dict. It has no owner index; don't try to build one.
    if not hasattr(analyses, "owner_loaded"):
        if analysis_id in _deleted:
            return None
        row = analyses.get(analysis_id)
        return row if row is not None else store.load(analysis_id)
    with _load_lock:
        if analysis_id in _deleted:
            return None
        row = analyses.get(analysis_id)
        if row is not None:
            return row
        if _missing_hit(analysis_id):
            return None
    loaded = store.load(analysis_id)
    to_open = False
    with _load_lock:
        if analysis_id in _deleted:
            return None
        current = analyses.get(analysis_id)
        if current is not None:
            return current
        if not loaded or loaded.get("id", analysis_id) in _deleted:
            if not loaded:
                _remember_missing(analysis_id)
            return None
        to_open = _hold(loaded)
        owner = loaded.get("owner")
        if analyses.owner_loaded(owner):
            ordered = sorted(
                analyses.owned_by(owner),
                key=lambda item: (item.get("started") or "", item["id"]),
            )
            analyses.order_owner(owner, [item["id"] for item in ordered])
        held = analyses.get(analysis_id)
    if to_open:
        _schedule_stream(analysis_id)
    return held


def visible_to(user: str | None) -> list[dict]:
    """The analyses this exact user may read, oldest first: their own when signed in, or the
    ones with no owner when signed out (current_user() only ever returns None then). Every
    analysis is private to its owner; nothing here is shared across users. The first call for
    an owner reads that owner's rows from the store; later calls use the copy in memory."""
    ensure_owner(user)
    return analyses.owned_by(user)


# What papers_of and the knowledge graph built for each owner, and the state of that owner's
# analyses they were built from. A page image request runs papers_of each time, and the graph
# rebuilds from every claim, so both are reused until one of the owner's rows changes. One
# entry per owner per name. Consensus is not kept here: its key is the question text.
_derived: dict[tuple[str, str | None], tuple[tuple, object]] = {}
# The last few consensus answers per owner. A question is free text, so an unbounded map of
# them would grow with every distinct question a user asked. Older questions are dropped.
_CONSENSUS_CACHE_PER_OWNER = 8
_consensus_cache: OrderedDict[tuple[str | None, str], tuple[tuple, dict]] = OrderedDict()
_consensus_lock = threading.Lock()


def _rows_state(rows: list[dict]) -> tuple:
    """Changes whenever a row does. A worker snapshot replaces the row (a new object); in place,
    the gateway only adds stages, ends a run (status), or records where the paper is indexed
    after it is done (_index_self), and the graph reads that last one."""
    return tuple(
        (row["id"], id(row), row.get("status"), len(row.get("stages") or ()), "indexed_in" in row)
        for row in rows
    )


def _per_owner(name: str, user: str | None, build):
    rows = visible_to(user)
    state = _rows_state(rows)
    cached = _derived.get((name, user))
    if cached is not None and cached[0] == state:
        return cached[1]
    value = build(rows)
    _derived[(name, user)] = (state, value)
    return value


def _owned(analysis_id: str, user: str | None, kind: str = "paper") -> dict:
    """The analysis, if this exact user owns it (visible_to) and it is a `kind` row. Missing,
    owned by someone else, or another kind (a check's id on an analysis route) is a 404, not
    a 403, so an id does not tell anyone that it exists. The rule itself lives in
    app/ownership.py, shared with the Author role's rows."""
    return require_owner(lookup(analysis_id), user, "analysis", kind)


def _mine(analysis_id: str, user: str | None, kind: str = "paper") -> dict:
    """The analysis, only if this exact user created it. Same test as _owned(); kept as its
    own function since deleting one's own analysis is a distinct action from reading it."""
    return require_owner(lookup(analysis_id), user, "analysis", kind)


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
    path = PAPERS_DIR / f"{stem}-{digest}.pdf"
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
    # Read one byte past the limit to tell a full-size file from an oversized one.
    content = await file.read(uploads.MAX_UPLOAD_BYTES + 1)
    if len(content) > uploads.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "the PDF must be 100 MB or smaller")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(422, "the file is not a PDF")
    path = save_upload(content, file.filename)
    return _start(path.as_posix(), verify, user)


@app.post("/analyses/{analysis_id}/references/{ref}/pdf", status_code=202)
async def upload_reference_pdf(
    analysis_id: str, ref: str, file: UploadFile = PDF_UPLOAD, user: str | None = Depends(current_user)
):
    """Attach the PDF of one cited work that has no open-access copy, and check again the claims
    that cite it (#983). Only the owner may, and only the owner can open the PDF afterwards:
    it is often a paywalled copy from the owner's library."""
    analysis = await asyncio.to_thread(_owned, analysis_id, user)
    if analysis.get("status") != "done":
        raise HTTPException(409, "wait for the analysis to finish")
    if ref not in (analysis.get("references") or {}):
        raise HTTPException(404, f"the paper has no reference {ref}")
    content = await file.read(uploads.MAX_UPLOAD_BYTES + 1)
    if len(content) > uploads.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "the PDF must be 100 MB or smaller")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(422, "the file is not a PDF")
    path = await asyncio.to_thread(save_upload, content, file.filename)
    analysis.setdefault("pdfs", {})[ref] = path.name
    _save_soon(analysis_id)
    _detach(_recheck_reference(analysis_id, ref, path))
    return {"ref": ref, "pdf": path.name}


async def _recheck_reference(analysis_id: str, ref: str, pdf: Path) -> None:
    """Check each claim that cites `ref` against `pdf`, replacing that citation's earlier result.

    The result keeps the citation's lookup key as `cited`, so the claim card and the labeler
    still match it to the citation. Claims are checked one at a time: a reference is cited by
    a few claims, and the gateway serves everyone else meanwhile.
    """
    analysis = analyses[analysis_id]
    try:
        ready = await asyncio.to_thread(prepare_source, pdf.as_posix())
        for claim in analysis["claims"]:
            for citation, source in checked_citations(claim):
                if citation.get("ref") != ref:
                    continue
                if ready["status"] == "error":
                    verdict = {**ready, "claim": claim["claim"], "source": source}
                else:
                    verdict = await asyncio.to_thread(
                        check_prepared, claim["claim"], pdf.as_posix(), Path(ready["path"]),
                        judged_text(claim, citation), cites_others(claim, citation),
                    )
                claim["verdicts"] = [v for v in claim.get("verdicts", []) if v.get("cited") != source]
                claim["unchecked"] = [u for u in claim.get("unchecked", []) if u.get("source") != source]
                fold_check(claim, source, citation, verdict)
    except Exception:
        # Detached from the request, so nothing else would report it.
        logger.exception("checking analysis %s again against an uploaded %s failed", analysis_id, ref)
    finally:
        _save_soon(analysis_id)


class UploadRequest(BaseModel):
    filename: str
    size: int = Field(gt=0, le=uploads.MAX_UPLOAD_BYTES)


@app.post("/uploads")
async def new_upload(body: UploadRequest, request: Request, user: str | None = Depends(current_user)):
    """A URL to PUT one PDF straight to the papers bucket (#266), or {"url": null} where direct
    uploads are not set up (no bucket, or no page allowed to use it), and the PDF goes through
    POST /analyses/upload instead."""
    if not (PAPERS_BUCKET and uploads.UPLOAD_ORIGINS):
        return {"url": None}
    origin = request.headers.get("origin", "")
    try:
        return await asyncio.to_thread(uploads.start_upload, body.filename, body.size, origin, user)
    except PermissionError as error:
        raise HTTPException(403, str(error)) from None
    except uploads.UploadRefused as error:
        logger.warning("upload refused: %s", error)
        raise HTTPException(503, "storage would not take the upload, try again shortly") from None


class UploadedPaper(BaseModel):
    object_name: str
    verify: bool = True


@app.post("/analyses/from-upload")
async def analyse_uploaded_paper(body: UploadedPaper, user: str | None = Depends(current_user)):
    """Start an analysis of a PDF the caller uploaded with a URL from POST /uploads, once."""
    try:
        path = await asyncio.to_thread(uploads.claim, body.object_name, user, PAPERS_DIR)
    except LookupError as error:
        raise HTTPException(404, str(error)) from None
    except ValueError as error:
        raise HTTPException(400, str(error)) from None
    return _start(path.as_posix(), body.verify, user)


def _listed(user: str | None) -> list[dict]:
    # The list leaves out what only one analysis's own view needs. Rows with no "kind" are
    # older paper analyses; rows of kind "check" are single-claim checks saved before their
    # routes were removed (#333), and stay out of the list.
    left_out = ("stages", "references", "markers", "outline")
    return [
        {k: v for k, v in a.items() if k not in left_out}
        for a in reversed(visible_to(user))
        if a.get("kind", "paper") == "paper"
    ]


@app.get("/analyses")
async def list_analyses(user: str | None = Depends(current_user)):
    # The first call for this owner reads their rows from the store. That must not run on the
    # event loop: a Supabase read is the same kind of wait _save_soon moved off it (#169).
    return await asyncio.to_thread(_listed, user)


@app.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    return await asyncio.to_thread(_owned, analysis_id, user)


async def _delete_one(analysis_id: str) -> None:
    # A worker may still publish a snapshot after this delete; it must not come back.
    # Out of memory first, so no new save starts. A save already running would store the row
    # again after the delete, so wait for it. The wait is outside the lock.
    with _load_lock:
        _deleted.add(analysis_id)
        _forget_missing(analysis_id)
        analyses.pop(analysis_id, None)
        streams.pop(analysis_id, None)
    await _saved(analysis_id)
    await asyncio.to_thread(store.delete, analysis_id)
    # Tell the other instances, which may hold this row from the queued snapshot (#331). The
    # tombstone carries only the id. Best-effort, like _publish.
    try:
        tombstone = json.dumps({"id": analysis_id, "deleted": True})
        await asyncio.to_thread(redis_connection().publish, f"analysis:{analysis_id}", tombstone)
    except Exception as error:
        logger.warning("publishing the delete of analysis %s to Redis failed: %s", analysis_id, error)


# A stage can take minutes with nothing to send. A comment line keeps proxies from closing
# the idle stream; the web app skips events that carry no data.
HEARTBEAT_SECONDS = 15


async def _event_stream(item_id: str):
    """Server-sent events: the stages already recorded, then each new one as it happens.
    Shared by analyses and Author draft checks — both keep their stages on the same `analyses`
    dict and publish to the same `streams` queue, so both get the keep-alive."""
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
    analysis = await asyncio.to_thread(_mine, analysis_id, user)
    if analysis["status"] == "running":
        # A started job keeps saving to the store, so a deleted row would come back on restart.
        if not await asyncio.to_thread(cancel_if_queued, analysis_id):
            raise HTTPException(409, "this analysis is still running; delete it once it finishes")
    await _delete_one(analysis_id)
    return {"deleted": analysis_id}


@app.post("/analyses/{analysis_id}/stop")
async def stop_analysis(analysis_id: str, user: str | None = Depends(current_user)):
    """Stop a queued or running analysis; the row stays, as "error". A queued job is cancelled
    and a job no worker holds (lost in a restart) is ended here. A running one is asked to
    stop and ends itself within a few seconds of its current step."""
    analysis = await asyncio.to_thread(_mine, analysis_id, user)
    if analysis["status"] != "running":
        raise HTTPException(409, "this analysis has already finished")
    if await asyncio.to_thread(cancel_if_queued, analysis_id):
        await _end_stopped(analysis)
        return {"id": analysis_id, "status": "error"}
    alive = await asyncio.to_thread(job_is_alive, analysis_id)
    if alive is None:
        raise HTTPException(503, "could not reach the queue; try again")
    if alive is False:
        # The job may have just finished; its own saved row wins over this stale one.
        stored = await asyncio.to_thread(store.load, analysis_id)
        if stored is not None and stored.get("status") != "running":
            raise HTTPException(409, "this analysis has already finished")
        await _end_stopped(analysis)
        return {"id": analysis_id, "status": "error"}
    await asyncio.to_thread(request_stop, analysis_id)
    return {"id": analysis_id, "status": "stopping"}


async def _end_stopped(analysis: dict) -> None:
    """Mark an analysis no worker runs as stopped: save it, close its stream, tell the others."""
    analysis["status"] = "error"
    analysis["message"] = STOPPED_MESSAGE
    analysis["stages"].append({"stage": "error", "message": STOPPED_MESSAGE, "at": round(time.time(), 1)})
    await asyncio.to_thread(store.save, analysis)
    with _load_lock:
        queue = streams.pop(analysis["id"], None)
    if queue is not None:
        queue.put_nowait(None)
    try:
        snapshot = json.dumps(analysis, default=str)
        await asyncio.to_thread(redis_connection().publish, f"analysis:{analysis['id']}", snapshot)
    except Exception as error:
        logger.warning("publishing the stop of analysis %s to Redis failed: %s", analysis["id"], error)


class DisputeRequest(BaseModel):
    claim: int  # index into the analysis's claims
    source: str  # the verdict's `source`, the cited work's file name
    note: str = Field(default="", max_length=2000)


@app.post("/analyses/{analysis_id}/disputes")
async def dispute_verdict(
    analysis_id: str, request: DisputeRequest, user: str | None = Depends(current_user)
):
    """Record that the owner disagrees with one verdict, and why. One dispute per verdict: a
    second one replaces the first. The verdict itself stays as the judge gave it; disputes are
    kept beside it so a reader sees both and they can feed the judge's eval set."""
    analysis = await asyncio.to_thread(_mine, analysis_id, user)
    # A running job saves its own copy of the analysis, which would drop a dispute added here.
    if analysis["status"] == "running":
        raise HTTPException(409, "this analysis is still running; dispute it once it has finished")
    claims = analysis.get("claims", [])
    if not 0 <= request.claim < len(claims):
        raise HTTPException(422, f"claim {request.claim} is not in this analysis")
    sources = {verdict.get("source") for verdict in claims[request.claim].get("verdicts", [])}
    if request.source not in sources:
        raise HTTPException(422, f"claim {request.claim} has no verdict from {request.source!r}")
    dispute = {
        "claim": request.claim,
        "source": request.source,
        "note": request.note.strip(),
        "at": round(time.time()),
    }
    analysis["disputes"] = [
        kept
        for kept in analysis.get("disputes", [])
        if (kept["claim"], kept["source"]) != (request.claim, request.source)
    ] + [dispute]
    await asyncio.to_thread(store.save, analysis)
    return dispute


@app.get("/analyses/{analysis_id}/events")
async def analysis_events(analysis_id: str, user: str | None = Depends(current_user)):
    """The web app reads this with fetch(), so its token travels in the Authorization header."""
    await asyncio.to_thread(_owned, analysis_id, user)
    return StreamingResponse(_event_stream(analysis_id), media_type="text/event-stream")


# The statuses an analysis or an Author draft check ends in; anything else means its task is
# still writing.
FINISHED = ("done", "error")


# --- the paper itself, so the UI can show the page a claim or a passage came from ---


def papers_of(user: str | None) -> frozenset[str]:
    """The file names of the papers this user may open: the analysed paper of each analysis they
    may read (visible_to), each cited paper a check read for one of them, their Author
    PDFs, and the papers shared with the labeling team. The Author PDFs live outside `analyses`, so
    they are read each call, not cached."""
    shared = labeling_pool.pdf_names(lookup, _paper_names)
    return _per_owner("papers", user, _paper_names) | author_pdfs(user) | shared


def _paper_names(rows: list[dict]) -> frozenset[str]:
    names = set()
    for analysis in rows:
        if analysis.get("file"):
            names.add(Path(analysis["file"]).name)
        for claim in analysis.get("claims", []):
            names.update(Path(v["source"]).name for v in claim.get("verdicts", []) if v.get("source"))
    return frozenset(names)


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
    path = await asyncio.to_thread(_paper, name, user)
    return FileResponse(
        path, media_type="application/pdf", filename=name, headers={"Cache-Control": "private"}
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
    path = await asyncio.to_thread(_paper, name, user)
    image = await asyncio.to_thread(_render, path, page_number, min(dpi, MAX_DPI))
    return FileResponse(image, media_type="image/png", headers=PRIVATE_CACHE)


@app.get("/papers/{name}/figures/{figure}.png")
async def figure_image(name: str, figure: str, user: str | None = Depends(current_user)):
    """One cropped figure or table of a paper, the image a verdict's `pages` entry points at."""
    owned = await asyncio.to_thread(_paper, name, user)
    if not FIGURE_NAME.fullmatch(figure):
        raise HTTPException(400, "a crop is named figure-<n> or table-<n>")
    path = figures_dir(owned) / f"{figure}.png"
    if not path.is_file():
        raise HTTPException(404, f"no such figure: {figure}")
    # A crop never changes once written, so it is cached like a rendered page.
    return FileResponse(path, media_type="image/png", headers=PRIVATE_CACHE)


@app.get("/papers/{name}/find")
async def find(name: str, q: str, page: int | None = None, user: str | None = Depends(current_user)):
    """Where a piece of text sits in the paper: page, boxes, and the page size to scale by.
    Boxes are PDF points, top-left origin. The browser scales them by dpi / 72."""
    path = await asyncio.to_thread(_paper, name, user)
    found = await asyncio.to_thread(locate, path.as_posix(), q, page)
    return found or {"page": None, "boxes": []}


# --- the researcher screens, built from the caller's own analyses (app/researcher.py) ---


class ProjectRequest(BaseModel):
    name: str
    description: str = ""


class ProjectPaperRequest(BaseModel):
    analysis_id: str


class ProjectRenameRequest(BaseModel):
    name: str


class ConsensusRequest(BaseModel):
    question: str


def _project(project_id: str, stored: list[dict]) -> dict:
    project = next((project for project in stored if project["id"] == project_id), None)
    if project is None:
        raise HTTPException(404, "no such project")
    return project


def _with_visible(user: str | None, build):
    """Run `build` on this user's analyses. Off the event loop: the first call reads the store."""
    return build(visible_to(user))


@app.get("/researcher/home")
async def researcher_home(user: str | None = Depends(current_user)):
    return await asyncio.to_thread(_with_visible, user, researcher.home)


@app.get("/researcher/projects")
async def researcher_projects(user: str | None = Depends(current_user)):
    def build(rows: list[dict]) -> list[dict]:
        return researcher.projects(store.load_projects(user), rows)

    return await asyncio.to_thread(_with_visible, user, build)


@app.post("/researcher/projects")
async def create_project(request: ProjectRequest, user: str | None = Depends(current_user)):
    name = request.name.strip()
    if not name:
        raise HTTPException(400, "a project needs a name")
    now = datetime.now(UTC).isoformat()
    project = {"id": uuid.uuid4().hex[:12], "owner": user, "name": name,
               "description": request.description.strip(), "analyses": [], "created": now, "updated": now}
    await asyncio.to_thread(store.save_project, project)
    return researcher.projects([project], [])[0]


@app.patch("/researcher/projects/{project_id}")
async def rename_project(
    project_id: str, request: ProjectRenameRequest, user: str | None = Depends(current_user)
):
    name = request.name.strip()
    if not name:
        raise HTTPException(400, "a project needs a name")
    stored = await asyncio.to_thread(store.load_projects, user)
    project = _project(project_id, stored)
    project["name"] = name
    project["updated"] = datetime.now(UTC).isoformat()
    await asyncio.to_thread(store.save_project, project)

    def projected(rows: list[dict]) -> dict:
        return researcher.projects([project], rows)[0]

    return await asyncio.to_thread(_with_visible, user, projected)


# How long a deleted project can still be restored. The row stays until the next delete by the
# same owner after that, which removes it for good.
PROJECT_RESTORE_DAYS = 7


@app.delete("/researcher/projects/{project_id}")
async def delete_project(project_id: str, user: str | None = Depends(current_user)):
    """Deletes the project only — its papers are not touched. A paper with no project left is
    Unsorted again, the same way it was before anyone filed it (researcher.py's _unsorted()).

    The project is hidden, not removed: it can be restored for PROJECT_RESTORE_DAYS days."""
    stored = await asyncio.to_thread(store.load_projects, user)
    project = _project(project_id, stored)
    now = datetime.now(UTC)
    project["deleted"] = now.isoformat()
    await asyncio.to_thread(store.save_project, project)
    expired = (now - timedelta(days=PROJECT_RESTORE_DAYS)).isoformat()
    await asyncio.to_thread(store.purge_deleted_projects, user, expired)
    return {"deleted": project_id}


@app.post("/researcher/projects/{project_id}/restore")
async def restore_project(project_id: str, user: str | None = Depends(current_user)):
    """Brings a deleted project back with its name, description and paper list. Restoring a
    project that is not deleted changes nothing, so a retry is safe."""
    stored = await asyncio.to_thread(store.load_projects, user, True)
    project = _project(project_id, stored)
    if project.pop("deleted", None):
        project["updated"] = datetime.now(UTC).isoformat()
        await asyncio.to_thread(store.save_project, project)

    def projected(rows: list[dict]) -> dict:
        return researcher.projects([project], rows)[0]

    return await asyncio.to_thread(_with_visible, user, projected)


@app.get("/researcher/projects/{project_id}/library")
async def project_library(project_id: str, user: str | None = Depends(current_user)):
    def build(rows: list[dict]) -> dict | None:
        return researcher.library(project_id, store.load_projects(user), rows)

    found = await asyncio.to_thread(_with_visible, user, build)
    if found is None:
        raise HTTPException(404, "no such project")
    return found


@app.post("/researcher/projects/{project_id}/papers")
async def add_to_project(
    project_id: str, request: ProjectPaperRequest, user: str | None = Depends(current_user)
):
    """Put an analysed paper the caller may read (visible_to) into one of their own projects."""
    await asyncio.to_thread(_owned, request.analysis_id, user)
    stored = await asyncio.to_thread(store.load_projects, user)
    project = _project(project_id, stored)
    if request.analysis_id not in project["analyses"]:
        project["analyses"].append(request.analysis_id)
    project["updated"] = datetime.now(UTC).isoformat()
    await asyncio.to_thread(store.save_project, project)

    def projected(rows: list[dict]) -> dict:
        return researcher.projects([project], rows)[0]

    return await asyncio.to_thread(_with_visible, user, projected)


def _trim_consensus(user: str | None) -> None:
    """Keep the newest questions for this owner. Caller holds _consensus_lock."""
    keys = [key for key in _consensus_cache if key[0] == user]
    extra = len(keys) - _CONSENSUS_CACHE_PER_OWNER
    for key in keys[: max(extra, 0)]:
        _consensus_cache.pop(key, None)


def _consensus(user: str | None, question: str) -> dict:
    """consensus() walks every claim. Reuse the answer until one of this owner's rows changes,
    the same way the graph is reused. Only the last few questions per owner are kept."""
    rows = visible_to(user)
    state = _rows_state(rows)
    key = (user, question)
    with _consensus_lock:
        cached = _consensus_cache.get(key)
        if cached is not None and cached[0] == state:
            _consensus_cache.move_to_end(key)
            return cached[1]
    value = researcher.consensus(question, rows)
    with _consensus_lock:
        _consensus_cache[key] = (state, value)
        _consensus_cache.move_to_end(key)
        _trim_consensus(user)
    return value


@app.post("/researcher/consensus")
async def field_consensus(request: ConsensusRequest, user: str | None = Depends(current_user)):
    """What the works cited across the caller's own analysed papers say about a question. Reuses the
    verdicts already found; it makes no LLM calls."""
    return await asyncio.to_thread(_consensus, user, request.question)


@app.get("/researcher/graph")
async def knowledge_graph(user: str | None = Depends(current_user)):
    return await asyncio.to_thread(_per_owner, "graph", user, researcher.graph)


@app.get("/researcher/gaps")
async def library_gaps(user: str | None = Depends(current_user)):
    """What the caller's own library leaves open (researcher.gaps). Reads stored verdicts only."""
    return await asyncio.to_thread(_per_owner, "gaps", user, researcher.gaps)


# --- the assistant: questions answered as checked statements (app/assistant.py) ---


class ScreenContext(BaseModel):
    """What the user was looking at when they asked. `node` is a graph node id from
    /researcher/graph: "a:<analysis id>" for an analysed paper, "c:<analysis id>:<n>" for a claim."""

    screen: str = ""
    analysis: str | None = None
    node: str | None = None


class ChatStart(BaseModel):
    context: ScreenContext = ScreenContext()


class ChatQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    context: ScreenContext = ScreenContext()


def _analysis_on_screen(context: ScreenContext) -> str | None:
    """The analysis the question is about: the open one, or the one a graph node belongs to."""
    if context.analysis:
        return context.analysis
    kind, _, rest = (context.node or "").partition(":")
    if kind in ("a", "c") and rest:
        return rest.split(":")[0]
    return None


def _paper_on_screen(context: ScreenContext, user: str | None) -> str | None:
    """The PDF the question is about, or None to answer from the user's whole library. An
    analysis that is not the user's is a 404, like on every other analysis route."""
    analysis_id = _analysis_on_screen(context)
    if analysis_id is None:
        return None
    return _owned(analysis_id, user).get("file")


async def _keep_alive(events):
    """The events, with a comment line whenever nothing has come for HEARTBEAT_SECONDS. Getting
    a paper ready can take minutes, and proxies close a stream that stays quiet."""
    queue: asyncio.Queue = asyncio.Queue()

    async def pump():
        try:
            async for event in events:
                await queue.put(event)
        finally:
            await queue.put(None)

    task = asyncio.create_task(pump())
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), HEARTBEAT_SECONDS)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                return
            yield event
    finally:
        task.cancel()  # the reader left: stop answering


async def _reply(
    user: str | None, chat_id: str, turn: str, question: str, earlier: list[str], paper: str | None
):
    """Server-sent events for one answer (assistant.answer), then the reply is saved to the chat.
    `earlier` is the chat before this question (chats.distill_lines): a library follow-up is
    rewritten against it, and the rewrite is what is searched and answered. The chat keeps what
    was typed.
    Only a finished answer is saved. After an error, or a reader who left, the question stays in
    the chat with no reply."""
    from app import assistant, memory  # import dspy and ADK, seconds, so not at start-up

    statements: list[dict] = []
    try:
        if paper is None:
            # A question about the paper on screen is not rewritten: the screen already says
            # what "it" is, and the chat before it may be about another paper.
            question = await asyncio.to_thread(assistant.standalone_question, question, earlier)
        remembered = await asyncio.to_thread(memory.remembered_for, question, user)
        if paper is None:
            events = assistant.answer(question, papers=papers_of(user), remembered=remembered)
        else:
            prepared = await asyncio.to_thread(prepare_source, paper)
            if prepared["status"] != "ok":
                yield f"data: {json.dumps({'type': 'error', 'message': 'this paper could not be read'})}\n\n"
                return
            events = assistant.answer(question, paper=Path(prepared["path"]), remembered=remembered)
        async for event in events:
            if event["type"] == "statement":
                statements.append({"text": event["text"], "source": event["source"], "page": event["page"]})
            elif event["type"] == "verdict":
                statements[event["index"]].update(
                    verdict=event["verdict"], quote=event["quote"], reasoning=event["reasoning"]
                )
            yield f"data: {json.dumps(event)}\n\n"
    except Exception:
        logger.exception("answering a question in chat %s failed", chat_id)
        yield f"data: {json.dumps({'type': 'error', 'message': 'the answer failed, ask again'})}\n\n"
        return
    await chats.add_reply(user, chat_id, turn, statements)


@app.post("/assistant/chats")
async def start_chat(body: ChatStart | None = None, user: str | None = Depends(current_user)):
    context = (body or ChatStart()).context.model_dump()
    if user is not None:
        sessions = await chats.mine(user)
        # A new chat means the user left their newest one, so it is distilled now (SPEC.md).
        await _queue_distills(user, sessions, leaving=sessions[0].id if sessions else None)
    return chats.summary(await chats.start(user, context))


@app.get("/assistant/chats")
async def list_chats(user: str | None = Depends(current_user)):
    sessions = await chats.mine(user)
    if user is not None:
        await _queue_distills(user, sessions)
    return [chats.summary(chat) for chat in sessions]


async def _queue_distills(user: str, sessions: list, leaving: str | None = None) -> None:
    """Queue the user's chats that are due for distilling into facts (app/distill.py).

    A due chat is marked even when it has no lines to send, such as a chat with no questions,
    so it is not looked at again until it changes. Best-effort: with Redis down the chat still
    opens, and the chat that could not be queued, and those after it, stay due for next time.
    """
    now = time.time()
    try:
        for chat_id in chats.due_for_distill(sessions, now, leaving):
            chat = await chats.find(user, chat_id)  # mine() has no events
            lines = chats.distill_lines(chats.messages(chat)) if chat else []
            if lines:
                await asyncio.to_thread(enqueue_distill, user, chat_id, lines)
            await chats.mark_distilled(user, chat_id, now)
    except RedisError as error:
        logger.warning("queueing chat distills for %s failed: %s", user, error)


@app.get("/assistant/chats/{chat_id}")
async def get_chat(chat_id: str, user: str | None = Depends(current_user)):
    chat = await chats.find(user, chat_id)
    if chat is None:
        raise HTTPException(404, "no such chat")
    return {**chats.summary(chat), "context": chat.state, "messages": chats.messages(chat)}


@app.post("/assistant/chats/{chat_id}/messages")
async def ask(chat_id: str, body: ChatQuestion, user: str | None = Depends(current_user)):
    """Answer a question as server-sent events: each statement with its citation, then each
    verdict as its check ends, then "done" (assistant.answer). The web app reads them with
    fetch(), so the token travels in the Authorization header."""
    paper = _paper_on_screen(body.context, user)  # before streaming, so a 404 is still a 404
    asked = await chats.add_question(user, chat_id, body.question, body.context.model_dump())
    if asked is None:
        raise HTTPException(404, "no such chat")
    return StreamingResponse(
        _keep_alive(_reply(user, chat_id, asked.turn, body.question, asked.earlier, paper)),
        media_type="text/event-stream",
    )


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
    analyses, researcher projects and what the assistant remembers, `author` the draft checks
    and the Author role's projects, drafts and saved sources, `all` (the default) both. Each
    role's Settings tab sends its own scope, so a Researcher clearing papers keeps their Author
    drafts and the other way round (PR #291 review). The confirm dialog is the UI's job; this
    call is unconditional.

    An analysis or draft check still running is skipped and counted in `skipped`: its worker
    keeps saving it, so a deleted row would come back on the next restart (same reason as
    delete_analysis)."""
    if scope not in DELETE_SCOPES:
        raise HTTPException(400, f"scope must be one of {', '.join(DELETE_SCOPES)}")
    researcher = scope in ("all", "researcher")
    author = scope in ("all", "author")
    def owned_in_scope() -> list[dict]:
        return [
            analysis for analysis in visible_to(user)
            if (author if analysis.get("kind") == DRAFT_CHECK else researcher)
        ]

    mine = await asyncio.to_thread(owned_in_scope)
    ids = [analysis["id"] for analysis in mine if analysis.get("status") != "running"]
    for analysis_id in ids:
        await _delete_one(analysis_id)
    if researcher:
        await asyncio.to_thread(store.delete_projects, user)
        if user is not None:  # with login off there is no user, so there are no facts
            await asyncio.to_thread(store.delete_facts, user)
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
async def health(request: Request):
    """The gateway is up (`ok`), and each dependency's URL, auth and whether it answered, from a
    check at most 30 s old. `degraded` is true when a required one did not answer. `analyses` is
    how many this process is holding (running, the newest at startup, and owners loaded since),
    not how many the store has. `features` says which features work now; the web app reads it to
    turn off what would fail. A request from the internet gets only `ok`, `degraded` and `features`."""
    report = await asyncio.to_thread(dependencies.report)
    # Cloudflare adds this header to every request through the tunnel; LAN and tailnet callers have none.
    if "cf-connecting-ip" in request.headers:
        return {"ok": True, "degraded": report["degraded"], "features": report["features"]}
    return {"ok": True, "analyses": len(analyses), **report}


@app.get("/metrics")
async def metrics(request: Request):
    """Prometheus text format: analysis success rate, duration, queueing, verdicts, audit
    findings, LLM token usage (app/metrics.py). Scraped by the `gateway` job in
    deploy/monitoring/prometheus.yml, behind the opt-in `monitoring` compose profile. Reads an
    in-memory registry only, so unlike /health this needs no thread hop. Not served to the
    internet (see /health).
    """
    if "cf-connecting-ip" in request.headers:
        raise HTTPException(404)
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":  # pragma: no cover - starts the server, never runs under pytest
    uvicorn.run(app, host="0.0.0.0", port=PORT)
