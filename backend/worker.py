"""Runs analyses pulled off the queue (app/queue.py).

    python worker.py

Its own process/container (docker-compose.yml's `worker` service), scaled independently
of the gateway: `docker compose up -d --scale worker=3`.
"""

from app.queue import QUEUE_NAME, redis_connection
from rq import Worker

if __name__ == "__main__":
    Worker([QUEUE_NAME], connection=redis_connection()).work()
