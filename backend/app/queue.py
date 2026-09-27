"""The analysis queue. `POST /analyses` enqueues here (app/main.py); a separate `worker.py`
process pulls jobs off it and runs the pipeline. Redis also carries cross-process progress —
see app/main.py's `_publish` (publishes each snapshot) and its Pub/Sub subscriber (applies them).

RQ needs a synchronous redis-py connection; this module's client is that one, not an
asyncio one. `run_analysis_job` is the thing a worker actually runs.
"""

import asyncio
import json
import logging
import time

import redis
import redis.asyncio
from rq import Queue, SimpleWorker
from rq.job import Callback, Job, JobStatus
from rq.serializers import JSONSerializer

from app.config import REDIS_URL
from app.metrics import ANALYSES_RUNNING, ANALYSIS_QUEUE_WAIT_SECONDS

QUEUE_NAME = "analyses"
JOB_TIMEOUT = 60 * 30  # RQ's own default (180s) suits quick jobs; an analysis can run minutes.

logger = logging.getLogger(__name__)

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
    analysis_id: str, paper: str, verify: bool, owner: str | None, stages: list[dict] | None = None
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
            main.analyses[analysis_id] = analysis
            main.streams[analysis_id] = asyncio.Queue()

            # The gateway stamped stages[0]["at"] in its own process, so this is wall-clock,
            # not a monotonic delta across processes.
            if stages and "at" in stages[0]:
                ANALYSIS_QUEUE_WAIT_SECONDS.observe(max(0.0, time.time() - stages[0]["at"]))

            ANALYSES_RUNNING.inc()
            try:
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
    stored = store.load_all().get(analysis_id)
    if stored is not None:
        analysis = stored
    else:
        paper, owner = job.args[1], job.args[3]
        analysis = main._new_analysis(analysis_id, paper, owner)
        analysis["stages"] = list(job.args[4] if len(job.args) > 4 else job.kwargs.get("stages") or [])

    if analysis["status"] == "running":
        _, exc_value, _ = exc_info
        message = str(exc_value) if exc_value else "the worker stopped before this analysis finished"
        analysis["status"] = "error"
        analysis["message"] = message
        analysis["stages"].append({"stage": "error", "message": message, "at": round(time.time(), 1)})
        store.save(analysis)
        try:
            redis_connection().publish(f"analysis:{analysis_id}", json.dumps(analysis, default=str))
        except Exception as error:
            logger.warning("publishing failed-job snapshot for %s failed: %s", analysis_id, error)


def enqueue_analysis(analysis_id: str, paper: str, verify: bool, owner: str | None, stages: list[dict]):
    return analysis_queue().enqueue(
        run_analysis_job, analysis_id, paper, verify, owner, stages,
        job_id=analysis_id, job_timeout=JOB_TIMEOUT, on_failure=Callback(_on_analysis_job_failure),
    )


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


def cancel_if_queued(analysis_id: str) -> bool:
    """True only if the job was still queued (never started) and is now cancelled."""
    try:
        job = Job.fetch(analysis_id, connection=redis_connection(), serializer=JSONSerializer)
    except Exception:
        return False
    if job.get_status(refresh=True) != JobStatus.QUEUED:
        return False
    job.cancel()
    return True


ANALYSIS_JOB = f"{__name__}.run_analysis_job"
FAILURE_CALLBACK = f"{__name__}._on_analysis_job_failure"


class AnalysisWorker(SimpleWorker):
    """Runs analysis jobs and nothing else.

    Anyone who can write to Redis can queue a job that names any importable function, and RQ
    would call it. JSON (not pickle) keeps reading a job from running code; this check keeps the
    worker from calling anything but the analysis job and its own failure callback.
    """

    def perform_job(self, job: Job, queue: Queue) -> bool:
        if (
            job.func_name != ANALYSIS_JOB
            or job._success_callback_name
            or job._stopped_callback_name
            or job._failure_callback_name not in (None, FAILURE_CALLBACK)
        ):
            self.log.warning("refusing job %s: %s is not an analysis job", job.id, job.func_name)
            self.handle_job_failure(job, queue, exc_string="refused: not an analysis job")
            return False
        return super().perform_job(job, queue)
