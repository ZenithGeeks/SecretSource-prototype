import json
from pathlib import Path

import pytest
from status_bot.grafana import (
    CLOUD_REQUEST,
    JOBS_REQUEST,
    QUEUE_REQUEST,
    parse_alerts,
    parse_response,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def real():
    """Parsed real responses captured from Grafana on 2026-10-05."""
    return {
        "queue": parse_response(QUEUE_REQUEST, load("response_queue.json")),
        "cloud": parse_response(CLOUD_REQUEST, load("response_cloud.json")),
        "jobs": parse_response(JOBS_REQUEST, load("response_jobs.json")),
        "alerts": parse_alerts(load("response_alerts.json")),
    }
