"""/health detail and /metrics are for LAN and tailnet callers, not the internet."""

import pytest
from app import main
from fastapi.testclient import TestClient

REPORT = {
    "degraded": True,
    "features": {"analyses": False, "ask": True},
    "service_auth": "key",
    "checked_at": 0.0,
    "dependencies": [{"name": "redis"}],
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.dependencies, "report", lambda: REPORT)
    return TestClient(main.app)


def test_a_local_caller_gets_the_full_report(client):
    body = client.get("/health").json()
    assert body["dependencies"] == [{"name": "redis"}]
    assert body["degraded"] is True


def test_a_caller_through_cloudflare_gets_only_ok_degraded_and_features(client):
    body = client.get("/health", headers={"CF-Connecting-IP": "203.0.113.7"}).json()
    assert body == {"ok": True, "degraded": True, "features": {"analyses": False, "ask": True}}


def test_metrics_are_served_locally_but_not_through_cloudflare(client):
    assert client.get("/metrics").status_code == 200
    assert client.get("/metrics", headers={"CF-Connecting-IP": "203.0.113.7"}).status_code == 404
