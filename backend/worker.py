"""Runs analyses pulled off the queue (app/queue.py).

    python worker.py

Its own process/container (docker-compose.yml's `worker` service), scaled independently
of the gateway: `docker compose up -d --scale worker=3`.
"""

import logging
import os
import sys

import prometheus_client
from app.native import prepare_and_check
from app.queue import QUEUE_NAME, AnalysisWorker, redis_connection
from rq.serializers import JSONSerializer

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    try:
        prepare_and_check()
    except RuntimeError as error:
        # Exit rather than take jobs: on a CPU the libraries cannot use, analyses "finish" with
        # checks and figures missing. See app/native.py.
        logging.error("%s", error)
        sys.exit(1)
    # A SimpleWorker (AnalysisWorker) runs jobs in-process; the default Worker forks a child per
    # job, which would leave the pipeline's Prometheus metrics stuck in a short-lived child.
    prometheus_client.start_http_server(int(os.getenv("WORKER_METRICS_PORT", "9101")))
    AnalysisWorker([QUEUE_NAME], connection=redis_connection(), serializer=JSONSerializer).work()
