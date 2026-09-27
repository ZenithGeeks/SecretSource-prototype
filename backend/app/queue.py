"""The analysis queue. `POST /analyses` enqueues here (app/main.py); a separate `worker.py`
process pulls jobs off it and runs the pipeline. Redis also carries cross-process progress —
see app/main.py's `_publish` (publishes each snapshot) and its Pub/Sub subscriber (applies them).

RQ needs a synchronous redis-py connection; this module's client is that one, not an
asyncio one. `run_analysis_job` is the thing a worker actually runs.
"""

import asyncio

import redis
import redis.asyncio
from rq import Queue

from app.config import REDIS_URL

QUEUE_NAME = "analyses"
JOB_TIMEOUT = 60 * 30  # RQ's own default (180s) suits quick jobs; an analysis can run minutes.

_connection: redis.Redis | None = None
_queue: Queue | None = None


def redis_connection() -> redis.Redis:
    global _connection
    if _connection is None:
        _connection = redis.Redis.from_url(REDIS_URL)
    return _connection


def analysis_queue() -> Queue:
    global _queue
    if _queue is None:
        _queue = Queue(QUEUE_NAME, connection=redis_connection())
    return _queue


def pubsub_client() -> redis.asyncio.Redis:
    # Never cached: an async client binds to the event loop it was created on, and tests
    # (and the subscriber's own reconnect loop) create fresh loops with asyncio.run.
    return redis.asyncio.Redis.from_url(REDIS_URL)


def run_analysis_job(analysis_id: str, paper: str, verify: bool, owner: str | None) -> dict:
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
            main.analyses[analysis_id] = analysis
            main.streams[analysis_id] = asyncio.Queue()

            # Not _run: RQ already did the queueing its semaphore approximated.
            await main._run_queued(analysis_id, analysis, paper, verify)

            # asyncio.run cancels pending tasks on exit, which would drop the detached _index_self.
            while main._background:
                await asyncio.gather(*list(main._background), return_exceptions=True)
            await main._saved(analysis_id)

            # Small on purpose: RQ stores this in Redis, and the full analysis can be large.
            return {"id": analysis_id, "status": analysis["status"]}
        finally:
            # A long-lived worker process must not accumulate every analysis it ever ran.
            main.analyses.pop(analysis_id, None)
            main.streams.pop(analysis_id, None)

    return asyncio.run(run())


def enqueue_analysis(analysis_id: str, paper: str, verify: bool, owner: str | None):
    return analysis_queue().enqueue(
        run_analysis_job, analysis_id, paper, verify, owner,
        job_id=analysis_id, job_timeout=JOB_TIMEOUT,
    )
