import datetime
import logging

import pytest
from app import rq_metrics
from prometheus_client import CollectorRegistry, generate_latest
from redis.exceptions import ConnectionError as RedisConnectionError
from rq.exceptions import NoSuchJobError

NOW = datetime.datetime(2026, 1, 1, 12, 0, 0, tzinfo=datetime.UTC)


def ago(seconds):
    return NOW - datetime.timedelta(seconds=seconds)


class FakeRegistry:
    def __init__(self, count, ids=()):
        self._count = count
        self._ids = list(ids)

    def get_job_count(self, cleanup=True):
        assert cleanup is False, "a scrape must not run registry cleanup"
        return self._count

    def get_job_ids(self, cleanup=True):
        assert cleanup is False, "a scrape must not run registry cleanup"
        return self._ids


class FakeQueue:
    queued = 0
    head = []
    registries = {}
    error = None

    def __init__(self, name, connection=None, serializer=None):
        self.name = name

    @property
    def count(self):
        if FakeQueue.error:
            raise FakeQueue.error
        return FakeQueue.queued

    def get_job_ids(self, offset=0, length=-1):
        assert (offset, length) == (0, 1)
        return FakeQueue.head

    def __getattr__(self, attribute):
        state = attribute.removesuffix("_job_registry")
        return FakeQueue.registries.get(state, FakeRegistry(0))


class FakeJob:
    jobs = {}

    @classmethod
    def fetch(cls, job_id, connection=None, serializer=None):
        if job_id not in cls.jobs:
            raise NoSuchJobError(job_id)
        return cls.jobs[job_id]


class _Job:
    def __init__(self, enqueued_at=None, started_at=None):
        self.enqueued_at = enqueued_at
        self.started_at = started_at


@pytest.fixture
def fake_rq(monkeypatch):
    FakeQueue.queued = 0
    FakeQueue.head = []
    FakeQueue.registries = {}
    FakeQueue.error = None
    FakeJob.jobs = {}
    workers = {"count": 0}
    monkeypatch.setattr(rq_metrics, "Queue", FakeQueue)
    monkeypatch.setattr(rq_metrics, "Job", FakeJob)
    monkeypatch.setattr(
        rq_metrics, "Worker", type("W", (), {"count": staticmethod(lambda **kw: workers["count"])})
    )
    monkeypatch.setattr(rq_metrics.analysis_queue_module, "redis_connection", lambda: object())
    monkeypatch.setattr(rq_metrics, "_now", lambda: NOW)
    return workers


def scrape():
    """{(name, state-or-None): value} for one collect()."""
    values = {}
    for family in rq_metrics.RQCollector().collect():
        for sample in family.samples:
            values[(sample.name, sample.labels.get("state"))] = sample.value
    return values


def test_normal_case_reports_every_series(fake_rq):
    FakeQueue.queued = 4
    FakeQueue.head = ["old"]
    FakeQueue.registries = {
        "started": FakeRegistry(2, ["a", "b"]),
        "deferred": FakeRegistry(1),
        "scheduled": FakeRegistry(3),
        "failed": FakeRegistry(5),
        "finished": FakeRegistry(7),
        "canceled": FakeRegistry(6),
    }
    FakeJob.jobs = {
        "old": _Job(enqueued_at=ago(90)),
        "a": _Job(started_at=ago(30)),
        "b": _Job(started_at=ago(200)),
    }
    fake_rq["count"] = 1

    assert scrape() == {
        ("rq_up", None): 1,
        ("rq_jobs", "queued"): 4,
        ("rq_jobs", "started"): 2,
        ("rq_jobs", "deferred"): 1,
        ("rq_jobs", "scheduled"): 3,
        ("rq_jobs", "failed"): 5,
        ("rq_jobs", "finished"): 7,
        ("rq_jobs", "canceled"): 6,
        ("rq_workers", None): 1,
        ("rq_oldest_queued_job_age_seconds", None): 90,
        ("rq_longest_running_job_seconds", None): 200,
    }


def test_empty_queue_and_nothing_running_gives_zero_ages(fake_rq):
    values = scrape()

    assert values[("rq_up", None)] == 1
    assert values[("rq_jobs", "queued")] == 0
    assert values[("rq_oldest_queued_job_age_seconds", None)] == 0
    assert values[("rq_longest_running_job_seconds", None)] == 0


def test_job_that_vanishes_between_reads_counts_as_zero(fake_rq):
    FakeQueue.head = ["gone"]
    FakeQueue.registries = {"started": FakeRegistry(1, ["gone"])}

    values = scrape()

    assert values[("rq_up", None)] == 1
    assert values[("rq_oldest_queued_job_age_seconds", None)] == 0
    assert values[("rq_longest_running_job_seconds", None)] == 0


def test_redis_error_reports_only_rq_up_zero(fake_rq, caplog):
    FakeQueue.error = RedisConnectionError("Error connecting to redis://:hunter2@host:6379")

    with caplog.at_level(logging.WARNING, logger="app.rq_metrics"):
        values = scrape()

    assert values == {("rq_up", None): 0}
    assert [r.levelno for r in caplog.records] == [logging.WARNING]
    assert "ConnectionError" in caplog.records[0].getMessage()


def test_redis_connection_failure_is_also_caught(fake_rq, monkeypatch):
    def boom():
        raise RedisConnectionError("refused")

    monkeypatch.setattr(rq_metrics.analysis_queue_module, "redis_connection", boom)

    assert scrape() == {("rq_up", None): 0}


def test_registers_on_a_fresh_registry_and_renders(fake_rq):
    FakeQueue.queued = 2
    registry = CollectorRegistry()
    registry.register(rq_metrics.RQCollector())

    text = generate_latest(registry).decode()

    assert "rq_up 1.0" in text
    assert 'rq_jobs{state="queued"} 2.0' in text
    assert "rq_workers 0.0" in text


def test_describe_is_empty_so_registering_does_not_scrape(fake_rq):
    FakeQueue.error = RuntimeError("collect() must not run at registration")
    collector = rq_metrics.RQCollector()

    assert collector.describe() == []
    CollectorRegistry().register(collector)
