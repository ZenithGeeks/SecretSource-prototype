"""Prometheus view of the RQ analysis queue, for the worker's /metrics (worker.py registers it).

The gateway never registers this: only the worker process exposes queue state, so Prometheus
sees one series set per queue instead of one per gateway instance.

A custom collector, not Gauges: every value is read from Redis at scrape time, so nothing goes
stale between scrapes and nothing needs a background thread.
"""

import datetime
import logging

from prometheus_client.core import GaugeMetricFamily
from rq import Queue, Worker
from rq.exceptions import NoSuchJobError
from rq.job import Job
from rq.serializers import JSONSerializer

from app import queue as analysis_queue_module

logger = logging.getLogger(__name__)

# rq_jobs{state=...} -> the Queue property holding that registry. "queued" is the list itself.
_REGISTRIES = {
    "started": "started_job_registry",
    "deferred": "deferred_job_registry",
    "scheduled": "scheduled_job_registry",
    "failed": "failed_job_registry",
    "finished": "finished_job_registry",
    "canceled": "canceled_job_registry",
}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _age_seconds(moment: datetime.datetime | None, now: datetime.datetime) -> float:
    return max(0.0, (now - moment).total_seconds()) if moment else 0.0


class RQCollector:
    """Reports the queue named app.queue.QUEUE_NAME, read through app.queue.redis_connection()."""

    def describe(self):
        # Empty so REGISTRY.register() does not call collect() (a Redis round trip) at import time.
        return []

    def collect(self):
        up = GaugeMetricFamily("rq_up", "1 if the RQ queue could be read from Redis, else 0")
        try:
            families = self._read()
        except Exception as error:
            # Never the Redis URL: it carries the password, and some errors echo it.
            logger.warning("RQ metrics scrape failed: %s: %s", type(error).__name__, error)
            up.add_metric([], 0)
            yield up
            return
        up.add_metric([], 1)
        yield up
        yield from families

    def _read(self) -> list[GaugeMetricFamily]:
        connection = analysis_queue_module.redis_connection()
        queue = Queue(analysis_queue_module.QUEUE_NAME, connection=connection, serializer=JSONSerializer)
        now = _now()

        # cleanup=False: the default count runs the registry's cleanup (it can move expired jobs
        # to the failed registry), and a scrape every 15 s must only read.
        counts = {"queued": queue.count}
        for state, attribute in _REGISTRIES.items():
            counts[state] = getattr(queue, attribute).get_job_count(cleanup=False)
        workers = Worker.count(connection=connection, queue=queue)

        # Only the head of the list: RQ pushes to the tail and pops from the head.
        oldest_queued = 0.0
        for job_id in queue.get_job_ids(offset=0, length=1):
            try:
                job = Job.fetch(job_id, connection=connection, serializer=JSONSerializer)
            except NoSuchJobError:
                break  # a worker took it between the two reads
            oldest_queued = _age_seconds(job.enqueued_at, now)

        longest_running = 0.0
        for job_id in queue.started_job_registry.get_job_ids(cleanup=False):
            try:
                job = Job.fetch(job_id, connection=connection, serializer=JSONSerializer)
            except NoSuchJobError:
                continue  # finished between the two reads
            longest_running = max(longest_running, _age_seconds(job.started_at, now))

        jobs = GaugeMetricFamily("rq_jobs", "RQ jobs by state", labels=["state"])
        for state, count in counts.items():
            jobs.add_metric([state], count)
        workers_family = GaugeMetricFamily("rq_workers", "RQ workers registered for the queue")
        workers_family.add_metric([], workers)
        oldest = GaugeMetricFamily(
            "rq_oldest_queued_job_age_seconds",
            "Seconds since the oldest job still waiting in the queue was enqueued (0 if empty)",
        )
        oldest.add_metric([], oldest_queued)
        longest = GaugeMetricFamily(
            "rq_longest_running_job_seconds",
            "Longest time any currently running job has been running (0 if none)",
        )
        longest.add_metric([], longest_running)
        return [jobs, workers_family, oldest, longest]
