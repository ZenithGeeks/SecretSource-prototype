"""Runs analyses pulled off the queue (app/queue.py).

    python worker.py

Its own process/container (docker-compose.yml's `worker` service), scaled independently
of the gateway: `docker compose up -d --scale worker=3`.
"""

import os

import prometheus_client
from app.queue import QUEUE_NAME, redis_connection
from rq import SimpleWorker

if __name__ == "__main__":
    # SimpleWorker runs jobs in-process; the default Worker forks a child per job, which would
    # leave the pipeline's Prometheus metrics stuck in a short-lived child, never scraped here.
    prometheus_client.start_http_server(int(os.getenv("WORKER_METRICS_PORT", "9101")))
    SimpleWorker([QUEUE_NAME], connection=redis_connection()).work()
