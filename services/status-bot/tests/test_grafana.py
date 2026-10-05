import pytest
from status_bot.grafana import (
    CLOUD_REQUEST,
    JOBS_REQUEST,
    QUEUE_REQUEST,
    GrafanaClient,
    GrafanaError,
    parse_alerts,
    parse_response,
)

from .conftest import load


@pytest.mark.parametrize(
    "body, name",
    [
        (QUEUE_REQUEST, "request_queue.json"),
        (CLOUD_REQUEST, "request_cloud.json"),
        (JOBS_REQUEST, "request_jobs.json"),
    ],
)
def test_request_bodies_equal_verified_fixtures(body, name):
    assert body == load(name)


def test_parse_queue(real):
    v = real["queue"].values
    assert real["queue"].errors == {}
    assert v["worker_up"] == 1
    assert v["redis_up"] == 1
    assert v["workers"] == 1
    assert v["oldest_queued_s"] == 0
    assert v["longest_running_s"] == 0
    assert v["jobs"] == {
        "queued": 0,
        "started": 0,
        "deferred": 0,
        "scheduled": 0,
        "failed": 0,
        "finished": 0,
        "canceled": 0,
    }


def test_parse_cloud(real):
    series = real["cloud"].values["instances"]
    assert len(series) == 8
    keys = {(s, st) for s, st, _ in series}
    assert keys == {(s, st) for s in ("colbert", "colpali", "gateway", "grobid") for st in ("active", "idle")}
    by_key = {(s, st): pts for s, st, pts in series}
    assert len(by_key[("colbert", "active")]) == 288
    assert len(by_key[("colpali", "active")]) == 261
    assert by_key[("colbert", "active")][0] == (1791128094000, 0.8)
    assert by_key[("gateway", "active")][-1][1] == 1


def test_parse_jobs(real):
    v = real["jobs"].values
    assert v["counts"] == [{"done_24h": 0, "error_24h": 0, "done_7d": 1, "error_7d": 0, "running": 0}]
    assert v["daily"] == [{"day": 1790553600000, "done": 1, "error": 0}]
    assert v["duration"][0]["p50_min"] == pytest.approx(24.0116666674614)


def test_parse_alerts(real):
    assert real["alerts"] == []
    assert parse_alerts(load("response_alerts_firing.json")) == [
        "QueueBacklog",
        "WorkerDown",
    ]


def test_refid_error_is_recorded_not_raised():
    payload = load("response_queue.json")
    payload["results"]["redis_up"] = {"status": 500, "error": "boom"}
    parsed = parse_response(QUEUE_REQUEST, payload)
    assert parsed.errors == {"redis_up": "boom"}
    assert "redis_up" not in parsed.values
    assert parsed.values["workers"] == 1


def test_missing_refid_is_an_error():
    payload = load("response_queue.json")
    del payload["results"]["workers"]
    assert "workers" in parse_response(QUEUE_REQUEST, payload).errors


async def test_client_unreachable_raises_grafana_error():
    client = GrafanaClient("http://127.0.0.1:9", "tok")
    try:
        with pytest.raises(GrafanaError) as err:
            await client.query(QUEUE_REQUEST)
        assert "tok" not in str(err.value)
    finally:
        await client.close()
