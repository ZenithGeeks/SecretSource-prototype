"""The job queue. `POST /analyses` and `POST /author/drafts/{id}/check` enqueue here
(app/main.py, app/author/router.py); a separate `worker.py` process pulls jobs off it and
runs them. Redis also carries cross-process progress — see app/main.py's `_publish`
(publishes each snapshot) and its Pub/Sub subscriber (applies them).

RQ needs a synchronous redis-py connection; this module's client is that one, not an
asyncio one. `run_analysis_job` and `run_draft_check_job` are what a worker actually runs.
"""

import asyncio
import enum
import json
import logging
import time

import redis
import redis.asyncio
from openinference.semconv.trace import OpenInferenceSpanKindValues, SpanAttributes
from opentelemetry import trace
from rq import Queue, SimpleWorker, Worker
from rq.exceptions import InvalidJobOperation, NoSuchJobError
from rq.job import Callback, Job, JobStatus
from rq.serializers import JSONSerializer

from app.config import REDIS_URL
from app.metrics import ANALYSES_RUNNING, ANALYSIS_QUEUE_WAIT_SECONDS

QUEUE_NAME = "analyses"
JOB_TIMEOUT = 60 * 30  # RQ's own default (180s) suits quick jobs; an analysis can run minutes.

logger = logging.getLogger(__name__)
# A no-op until app/tracing.py registers Phoenix in this process.
tracer = trace.get_tracer(__name__)

_connection: redis.Redis | None = None
_queue: Queue | None = None

_ALIVE_STATUSES = {JobStatus.QUEUED, JobStatus.STARTED, JobStatus.DEFERRED, JobStatus.SCHEDULED}


def redis_connection() -> redis.Redis:
    global _connection
    if _connection is None:
        # Connect timeout only: POST /analyses enqueues on the event loop, so an unreachable
        # Redis must fail fast. No read timeout: the worker's dequeue is a long blocking read.
        _connection = redis.Redis.from_url(REDIS_URL, socket_connect_timeout=5)
    return _connection


def analysis_queue() -> Queue:
    global _queue
    if _queue is None:
        _queue = Queue(QUEUE_NAME, connection=redis_connection(), serializer=JSONSerializer)
    return _queue


def pubsub_client() -> redis.asyncio.Redis:
    # Never cached: an async client binds to the event loop it was created on, and tests
    # (and the subscriber's own reconnect loop) create fresh loops with asyncio.run.
    return redis.asyncio.Redis.from_url(REDIS_URL)


def run_analysis_job(
    analysis_id: str,
    paper: str,
    verify: bool,
    owner: str | None,
    stages: list[dict] | None = None,
    started: str | None = None,
) -> dict:
    """What a worker process actually runs for one analysis (RQ jobs are sync, so this
    wraps the async pipeline in its own event loop via asyncio.run)."""
    # Imported here, not at module level: main imports app.queue, so a top-level
    # `from app import main` here would be a circular import.
    from app import main

    async def run():
        try:
            # A semaphore binds to the first loop that waits on it, and every job has its own
            # loop. So the *_TOTAL limits are per worker process now (known limitation).
            main.all_sources = asyncio.Semaphore(main.PARALLEL_SOURCES_TOTAL)
            main.all_checks = asyncio.Semaphore(main.PARALLEL_CHECKS_TOTAL)

            analysis = main._new_analysis(analysis_id, paper, owner)
            analysis["stages"] = list(stages or [])
            if started:
                analysis["started"] = started
            main.analyses[analysis_id] = analysis
            main.streams[analysis_id] = asyncio.Queue()

            # The gateway stamped stages[0]["at"] in its own process, so this is wall-clock,
            # not a monotonic delta across processes.
            if stages and "at" in stages[0]:
                ANALYSIS_QUEUE_WAIT_SECONDS.observe(max(0.0, time.time() - stages[0]["at"]))

            ANALYSES_RUNNING.inc()
            try:
                # One trace per analysis: asyncio.to_thread copies this span's context into the
                # pipeline's threads, so its DSPy calls show up under it in Phoenix.
                attributes = {
                    SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                    SpanAttributes.INPUT_VALUE: paper,
                    "analysis.id": analysis_id,
                }
                with tracer.start_as_current_span("analysis", attributes=attributes):
                    # _run_queued directly: RQ already did the queueing.
                    await main._run_queued(analysis_id, analysis, paper, verify)
            finally:
                ANALYSES_RUNNING.dec()

            # asyncio.run cancels pending tasks on exit, which would drop the detached _index_self.
            # Only await tasks that are both still pending and on this loop: a task that is
            # already done but hasn't been discarded yet (its done-callback hasn't run), or
            # that belongs to some other loop entirely, would otherwise make this spin forever.
            loop = asyncio.get_running_loop()
            while pending := [t for t in main._background if not t.done() and t.get_loop() is loop]:
                await asyncio.gather(*pending, return_exceptions=True)
            await main._saved(analysis_id)

            # Small on purpose: RQ stores this in Redis, and the full analysis can be large.
            return {"id": analysis_id, "status": analysis["status"]}
        finally:
            # A long-lived worker process must not accumulate every analysis it ever ran.
            main.analyses.pop(analysis_id, None)
            main.streams.pop(analysis_id, None)

    return asyncio.run(run())


def _on_analysis_job_failure(job: Job, connection, *exc_info) -> None:
    """Runs in the worker when a job raises something run_analysis_job's own except never sees
    (a timeout, a crash in the job wrapper), so an analysis never gets stuck at "running"."""
    from app import main, store

    analysis_id = job.args[0]
    # One row by id. load_all would read every analysis anyone has stored (#314).
    stored = store.load(analysis_id)
    if stored is not None:
        analysis = stored
    else:
        paper, owner = job.args[1], job.args[3]
        analysis = main._new_analysis(analysis_id, paper, owner)
        analysis["stages"] = list(job.args[4] if len(job.args) > 4 else job.kwargs.get("stages") or [])
        if len(job.args) > 5 and job.args[5]:
            analysis["started"] = job.args[5]

    if analysis["status"] == "running":
        _, exc_value, _ = exc_info
        # RQ's AbandonedJobError (its worker died) has no text, so `or` and not `if exc_value`.
        message = str(exc_value or "") or "the worker stopped before this analysis finished"
        analysis["status"] = "error"
        analysis["message"] = message
        analysis["stages"].append({"stage": "error", "message": message, "at": round(time.time(), 1)})
        store.save(analysis)
        try:
            redis_connection().publish(f"analysis:{analysis_id}", json.dumps(analysis, default=str))
        except Exception as error:
            logger.warning("publishing failed-job snapshot for %s failed: %s", analysis_id, error)


def enqueue_analysis(
    analysis_id: str,
    paper: str,
    verify: bool,
    owner: str | None,
    stages: list[dict],
    started: str | None = None,
):
    return analysis_queue().enqueue(
        run_analysis_job,
        analysis_id,
        paper,
        verify,
        owner,
        stages,
        started,
        job_id=analysis_id,
        job_timeout=JOB_TIMEOUT,
        on_failure=Callback(_on_analysis_job_failure),
    )


def _short_timeout_client() -> redis.Redis:
    # Unlike redis_connection(), a read timeout is fine (even wanted) here: /health must not
    # hang if Redis is up but not answering.
    return redis.Redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=2)


def ping() -> tuple[bool, str]:
    """Whether Redis answers a PING right now, for /health."""
    try:
        _short_timeout_client().ping()
        return True, "PONG"
    except Exception as error:
        return False, f"{type(error).__name__}: {str(error)[:200]}"


def worker_status() -> tuple[bool, str]:
    """(at least one worker is listening on the analyses queue, "N worker(s), M waiting"),
    for /health. Redis unreachable counts as no worker, not an exception."""
    ok, detail = ping()
    if not ok:
        return False, f"redis unreachable: {detail}"
    try:
        connection = _short_timeout_client()
        queue = Queue(QUEUE_NAME, connection=connection, serializer=JSONSerializer)
        count = len(Worker.all(connection=connection, queue=queue))
        waiting = queue.count
        plural = "" if count == 1 else "s"
        return count > 0, f"{count} worker{plural}, {waiting} waiting"
    except Exception as error:
        return False, f"{type(error).__name__}: {str(error)[:200]}"


def job_is_alive(analysis_id: str) -> bool | None:
    """True if the RQ job still exists and has not reached a final state, False if it is
    missing or finished/failed/stopped/canceled, None if Redis could not be reached (a short
    timeout so a restart never hangs on this)."""
    try:
        connection = redis.Redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        job = Job.fetch(analysis_id, connection=connection, serializer=JSONSerializer)
        return job.get_status(refresh=True) in _ALIVE_STATUSES
    except redis.exceptions.RedisError:
        return None
    except Exception:
        return False


class DraftJobState(enum.Enum):
    """What deleting a draft check should do with its RQ job.

    CANCELLED and MISSING may delete the row. STARTED must not: a live worker would save
    the row back. FINISHED means read the store, which has the final row when a snapshot
    was dropped. UNAVAILABLE is Redis, not a running job.
    """

    CANCELLED = "cancelled"
    MISSING = "missing"
    STARTED = "started"
    FINISHED = "finished"
    UNAVAILABLE = "unavailable"


_FINISHED_JOBS = {JobStatus.FINISHED, JobStatus.FAILED, JobStatus.STOPPED}
_NOT_STARTED = {JobStatus.QUEUED, JobStatus.DEFERRED, JobStatus.SCHEDULED, JobStatus.CREATED}


class _DraftCheckDropped(BaseException):
    """The gateway cancelled this job or deleted its row.

    A BaseException so `_run_draft_check`'s `except Exception` does not record it as a
    failed check and save the row back.
    """


def cancel_if_queued(analysis_id: str) -> bool:
    """True only if the job was still queued (never started) and is now cancelled.

    Analysis delete uses this. A missing job or a Redis outage stays False, so that
    delete still answers 409. Draft-check delete uses `draft_check_disposition`, which
    separates those cases. `cancel()` raising because the job was just cancelled is a
    successful cancel, not an error.
    """
    try:
        job = Job.fetch(analysis_id, connection=redis_connection(), serializer=JSONSerializer)
    except Exception:
        return False
    try:
        if job.get_status(refresh=True) != JobStatus.QUEUED:
            return False
    except Exception:
        return False
    try:
        job.cancel()
    except InvalidJobOperation:
        return True
    except Exception:
        return False
    return True


def _cancel(job: Job) -> DraftJobState:
    """Cancel `job`. Already-cancelled and already-gone are success, not errors."""
    try:
        job.cancel()
    except InvalidJobOperation:
        return DraftJobState.CANCELLED
    except NoSuchJobError:
        return DraftJobState.MISSING
    except redis.exceptions.RedisError:
        return DraftJobState.UNAVAILABLE
    except Exception as error:
        logger.warning("cancelling job %s failed: %s", job.id, error)
        return DraftJobState.UNAVAILABLE
    return DraftJobState.CANCELLED


def _worker_still_registered(job: Job) -> bool | None:
    """True when the worker that took `job` still has a Redis key, False when that key is
    gone, None when the job names no worker. Redis errors propagate."""
    try:
        job.refresh()
    except NoSuchJobError:
        return False
    name = job.worker_name
    if not name:
        return None
    return bool(job.connection.exists(Worker.redis_worker_namespace_prefix + name))


def draft_check_disposition(check_id: str) -> DraftJobState:
    """Classify this draft check's job for delete.

    409 is only for a job a worker is actually running. A missing job can be deleted.
    Redis being down is UNAVAILABLE. A queued job is cancelled here; a started job whose
    worker record has expired is cancelled too, so RQ's abandoned-job cleanup does not
    save an error row after the delete. `cancel()` is caught: a second delete must not 500.
    """
    try:
        job = Job.fetch(check_id, connection=redis_connection(), serializer=JSONSerializer)
    except NoSuchJobError:
        return DraftJobState.MISSING
    except redis.exceptions.RedisError:
        return DraftJobState.UNAVAILABLE
    except Exception as error:
        logger.warning("looking up draft check job %s failed: %s", check_id, error)
        return DraftJobState.UNAVAILABLE
    try:
        status = job.get_status(refresh=True)
    except NoSuchJobError:
        return DraftJobState.MISSING
    except InvalidJobOperation:
        # The hash has no status: the job record is gone.
        return DraftJobState.MISSING
    except redis.exceptions.RedisError:
        return DraftJobState.UNAVAILABLE
    except Exception as error:
        logger.warning("reading draft check job %s failed: %s", check_id, error)
        return DraftJobState.UNAVAILABLE

    if status in _FINISHED_JOBS:
        return DraftJobState.FINISHED
    if status == JobStatus.CANCELED:
        return DraftJobState.CANCELLED
    if status == JobStatus.STARTED:
        try:
            alive = _worker_still_registered(job)
        except redis.exceptions.RedisError:
            return DraftJobState.UNAVAILABLE
        except Exception as error:
            logger.warning("checking the worker for draft check %s failed: %s", check_id, error)
            return DraftJobState.UNAVAILABLE
        if alive is False:
            return _cancel(job)
        return DraftJobState.STARTED
    if status in _NOT_STARTED:
        return _cancel(job)
    return DraftJobState.STARTED


def _job_record_canceled(check_id: str) -> bool:
    """True when this job was cancelled or its record is gone. Any other error (Redis down,
    the test double) is False: a check keeps going when we cannot tell."""
    try:
        job = Job.fetch(check_id, connection=redis_connection(), serializer=JSONSerializer)
        return job.get_status(refresh=True) == JobStatus.CANCELED
    except NoSuchJobError:
        return True
    except Exception:
        return False


def _draft_check_should_stop(check_id: str, seen_stored: list[bool]) -> bool:
    """True when the worker must exit without saving.

    A missing row is not enough on its own: the gateway's first save can still be in
    flight when the worker starts. It counts only after this job has seen the row stored,
    which is how a delete that won the race is told apart from a save that has not landed.
    """
    from app import store

    if _job_record_canceled(check_id):
        return True
    try:
        stored = store.load(check_id)
    except Exception as error:
        logger.warning("reading draft check %s before save failed: %s", check_id, error)
        return False
    if stored is not None:
        seen_stored[0] = True
        return False
    return bool(seen_stored[0])


def run_draft_check_job(
    check_id: str,
    owner: str | None,
    draft_id: str,
    draft_title: str,
    version: int,
    content_hash: str | None,
    stages: list[dict] | None = None,
    started_at: str | None = None,
) -> dict:
    """What a worker process runs for one Author draft check.

    The gateway has already recorded the row and the queued stage. This rebuilds that row in
    the worker (RQ jobs are sync, so the async check runs in its own event loop) and loads the
    draft's earlier checks from the store: the worker does not share the gateway's memory, and
    an override on the previous check is carried forward from those rows.     Stages go out through
    the same `_publish` path as an analysis, so the gateway's subscriber keeps the SSE stream.

    Before it starts, and again before every save, it stops when the job was cancelled or
    the row was deleted after it had been stored. Otherwise a cancel that loses the race
    with the worker writes the check back after the gateway deleted it.
    """
    from app import main
    from app.author.router import _run_draft_check, new_draft_check

    async def run():
        seen_stored = [False]
        if _draft_check_should_stop(check_id, seen_stored):
            return {"id": check_id, "status": "cancelled"}

        # Only this draft's other checks. Loading every analysis would pin the worker's
        # memory to the whole history, and a paper analysis is not an override source.
        loaded: list[str] = []
        original_save = main.store.save
        original_publish = main._publish
        stopped = {"value": False}

        def guarded_save(analysis):
            if isinstance(analysis, dict) and analysis.get("id") == check_id:
                if stopped["value"] or _draft_check_should_stop(check_id, seen_stored):
                    stopped["value"] = True
                    return
            original_save(analysis)
            if isinstance(analysis, dict) and analysis.get("id") == check_id:
                seen_stored[0] = True

        async def guarded_publish(analysis_id, stage, **fields):
            if analysis_id == check_id and (
                stopped["value"] or _draft_check_should_stop(check_id, seen_stored)
            ):
                stopped["value"] = True
                raise _DraftCheckDropped()
            return await original_publish(analysis_id, stage, **fields)

        main.store.save = guarded_save
        main._publish = guarded_publish
        try:
            try:
                for row in main.store.load_draft_checks(draft_id, owner):
                    if row.get("id") == check_id:
                        continue
                    main.analyses[row["id"]] = row
                    loaded.append(row["id"])

                check = new_draft_check(
                    check_id,
                    owner,
                    draft_id,
                    draft_title,
                    version,
                    content_hash,
                    started_at or "",
                    list(stages or []),
                )
                main.analyses[check_id] = check
                main.streams[check_id] = asyncio.Queue()

                attributes = {
                    SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                    SpanAttributes.INPUT_VALUE: draft_title,
                    "draft_check.id": check_id,
                    "draft.id": draft_id,
                }
                with tracer.start_as_current_span("draft-check", attributes=attributes):
                    await _run_draft_check(check_id, owner)
                return {"id": check_id, "status": main.analyses[check_id]["status"]}
            except _DraftCheckDropped:
                return {"id": check_id, "status": "cancelled"}
        finally:
            main.store.save = original_save
            main._publish = original_publish
            main.analyses.pop(check_id, None)
            main.streams.pop(check_id, None)
            for sibling_id in loaded:
                main.analyses.pop(sibling_id, None)

    return asyncio.run(run())


def _on_draft_check_job_failure(job: Job, connection, *exc_info) -> None:
    """Runs in the worker when a draft check raises something `_run_draft_check` never sees
    (a timeout, a crash in the job wrapper), so the check never stays "running"."""
    from app import store
    from app.author.logic import now_iso
    from app.author.router import new_draft_check

    check_id = job.args[0]
    stored = store.load(check_id)
    if stored is not None:
        check = stored
    else:
        stages = job.args[6] if len(job.args) > 6 else job.kwargs.get("stages") or []
        started_at = job.args[7] if len(job.args) > 7 else job.kwargs.get("started_at")
        check = new_draft_check(
            check_id,
            job.args[1],
            job.args[2],
            job.args[3],
            job.args[4],
            job.args[5],
            started_at or "",
            list(stages or []),
        )

    if check["status"] == "running":
        _, exc_value, _ = exc_info
        # RQ's AbandonedJobError (its worker died) has no text, so `or` and not `if exc_value`.
        message = str(exc_value or "") or "the worker stopped before this check finished"
        check["status"] = "error"
        check["message"] = message
        check["finishedAt"] = now_iso()
        check["stages"].append({"stage": "error", "message": message, "at": round(time.time(), 1)})
        store.save(check)
        # The gateway process is not this one. Publishing is how its open SSE stream ends.
        try:
            redis_connection().publish(f"analysis:{check_id}", json.dumps(check, default=str))
        except Exception as error:
            logger.warning("publishing failed-job snapshot for %s failed: %s", check_id, error)


def enqueue_draft_check(
    check_id: str,
    owner: str | None,
    draft_id: str,
    draft_title: str,
    version: int,
    content_hash: str | None,
    stages: list[dict],
    started_at: str | None = None,
):
    return analysis_queue().enqueue(
        run_draft_check_job,
        check_id,
        owner,
        draft_id,
        draft_title,
        version,
        content_hash,
        stages,
        started_at,
        job_id=check_id,
        job_timeout=JOB_TIMEOUT,
        on_failure=Callback(_on_draft_check_job_failure),
    )


DISTILL_JOB = "app.distill.run_distill_job"
DISTILL_TIMEOUT = 5 * 60  # one LLM call; a stuck one should not hold the worker for long


def enqueue_distill(owner: str, chat_id: str):
    """Queue the distilling of one chat into facts (app/distill.py). The job id is per chat, so
    a chat queued twice before the worker reaches it runs once."""
    return analysis_queue().enqueue(
        DISTILL_JOB, owner, chat_id, job_id=f"distill-{chat_id}", job_timeout=DISTILL_TIMEOUT
    )


ANALYSIS_JOB = f"{__name__}.run_analysis_job"
FAILURE_CALLBACK = f"{__name__}._on_analysis_job_failure"
DRAFT_CHECK_JOB = f"{__name__}.run_draft_check_job"
DRAFT_FAILURE_CALLBACK = f"{__name__}._on_draft_check_job_failure"

# An analysis job may only name the analysis failure callback, and a draft check only its own.
# A callback is itself a function RQ imports and calls.
_ALLOWED_FAILURE = {
    ANALYSIS_JOB: {None, FAILURE_CALLBACK},
    DRAFT_CHECK_JOB: {None, DRAFT_FAILURE_CALLBACK},
    DISTILL_JOB: {None},
}


class AnalysisWorker(SimpleWorker):
    """Runs this queue's jobs and nothing else.

    Anyone who can write to Redis can queue a job that names any importable function, and RQ
    would call it. JSON (not pickle) keeps reading a job from running code; this check keeps the
    worker from calling anything but an analysis, a draft check, a chat distill, and the first two
    jobs' own failure callbacks.
    """

    def perform_job(self, job: Job, queue: Queue) -> bool:
        allowed = _ALLOWED_FAILURE.get(job.func_name)
        if (
            allowed is None
            or job._success_callback_name
            or job._stopped_callback_name
            or job._failure_callback_name not in allowed
        ):
            self.log.warning("refusing job %s: %s is not an allowed job", job.id, job.func_name)
            self.handle_job_failure(job, queue, exc_string="refused: not an allowed job")
            return False
        return super().perform_job(job, queue)
