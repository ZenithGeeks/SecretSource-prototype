"""The analysis queue. `POST /analyses` enqueues here (app/main.py); a separate `worker.py`
process pulls jobs off it and runs the pipeline. Redis also carries cross-process progress —
see app/main.py's `_publish` (publishes each snapshot) and its Pub/Sub subscriber (applies them).

RQ needs a synchronous redis-py connection; this module's client is that one, not an
asyncio one. `run_analysis_job`, the thing a worker actually runs, lands in a later task.
"""

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
