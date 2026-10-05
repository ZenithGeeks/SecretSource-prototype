import pytest
from status_bot.grafana import Parsed, parse_alerts
from status_bot.report import (
    FOOTER,
    build_embed,
    build_report,
    embed_text,
    fmt_duration,
)

from .conftest import load

T0 = 1_000_000
STEP = 300_000


def cloud(*series):
    return Parsed(values={"instances": list(series)})


def test_fmt_duration():
    assert fmt_duration(0) == "0m 0s"
    assert fmt_duration(754.4) == "12m 34s"
    assert fmt_duration(None) == "unavailable"


def test_cost_math_by_hand():
    # colbert: 1 active + 0.5 idle -> 1*0.29232 + 0.5*0.0756 = 0.33012 $/h
    # grobid: 2 active + 0 idle -> 2*0.17136 = 0.34272 $/h
    c = cloud(
        ("colbert", "active", [(T0, 1.0), (T0 + STEP, 1.0)]),
        ("colbert", "idle", [(T0, 0.5), (T0 + STEP, 0.5)]),
        ("grobid", "active", [(T0, 2.0), (T0 + STEP, 2.0)]),
        ("grobid", "idle", [(T0, 0.0), (T0 + STEP, 0.0)]),
    )
    r = build_report(None, c, None, [])
    assert r.cost_now == pytest.approx(0.33012 + 0.34272)
    assert r.cost_day == pytest.approx(0.67284 * 24)
    # two 300 s points, each 0.67284 $/h -> 2 * 0.67284 * 300/3600
    assert r.spend_24h == pytest.approx(2 * 0.67284 / 12)
    assert r.instances == {"colbert": 1.5, "grobid": 2.0}


def test_idle_term_counts():
    c = cloud(("colbert", "active", [(T0, 0.0)]), ("colbert", "idle", [(T0, 2.0)]))
    assert build_report(None, c, None, []).cost_now == pytest.approx(2 * 0.0756)


def test_service_missing_at_latest_timestamp_costs_zero():
    c = cloud(
        ("gateway", "active", [(T0, 1.0)]),  # ends one step early
        ("gateway", "idle", [(T0, 0.0)]),
        ("colbert", "active", [(T0, 1.0), (T0 + STEP, 1.0)]),
        ("colbert", "idle", [(T0, 0.0), (T0 + STEP, 0.0)]),
    )
    r = build_report(None, c, None, [])
    assert r.cost_now == pytest.approx(0.29232)  # no gateway at the latest point
    # instances still use each service's own latest point
    assert r.instances["gateway"] == 1.0
    # spend: first point has both, second only colbert
    assert r.spend_24h == pytest.approx(((0.38016 + 0.29232) + 0.29232) / 12)


def test_unpriced_service_listed_but_free():
    c = cloud(
        ("mystery", "active", [(T0, 3.0)]),
        ("mystery", "idle", [(T0, 0.0)]),
        ("gateway", "active", [(T0, 1.0)]),
        ("gateway", "idle", [(T0, 0.0)]),
    )
    r = build_report(None, c, None, [])
    assert r.unpriced == ["mystery"]
    assert r.instances["mystery"] == 3.0
    assert r.cost_now == pytest.approx(0.38016)
    assert "Unpriced: mystery" in embed_text(build_embed(r))


def test_real_fixtures_report(real):
    r = build_report(real["queue"], real["cloud"], real["jobs"], real["alerts"], real["cost30"])
    assert r.healthy
    assert r.workers == 1
    assert (r.queued, r.started, r.failed) == (0, 0, 0)
    assert (r.done_24h, r.error_24h, r.done_7d, r.error_7d) == (0, 0, 1, 0)
    assert r.success_rate == 1.0
    assert r.p50_min == pytest.approx(24.0116666674614)
    assert set(r.instances) == {"colbert", "colpali", "gateway", "grobid"}
    assert r.instances["colpali"] == 0
    assert r.cost_now > 0
    assert r.spend_24h > 0
    text = embed_text(build_embed(r))
    assert text.splitlines()[2] == "All good"
    assert "Workers: 1" in text
    assert "Last 7 days: 1 done, 0 failed" in text
    assert "7-day success rate: 100%" in text
    assert "Run time p50 / p95: 24.0 / 24.0 min" in text
    assert "Oldest queued wait: 0m 0s" in text
    assert "[Firing alerts]\nNone" in text
    assert FOOTER in text


def test_zero_finished_jobs_rate_is_na(real):
    real["jobs"].values["counts"] = [
        {"done_24h": 0, "error_24h": 0, "done_7d": 0, "error_7d": 0, "running": 0}
    ]
    r = build_report(real["queue"], real["cloud"], real["jobs"], [])
    assert "7-day success rate: n/a" in embed_text(build_embed(r))


def test_firing_alert_needs_attention(real):
    alerts = parse_alerts(load("response_alerts_firing.json"))
    r = build_report(real["queue"], real["cloud"], real["jobs"], alerts)
    assert not r.healthy
    text = embed_text(build_embed(r))
    assert "Needs attention" in text
    assert "2 alerts firing" in text
    assert "WorkerDown" in text and "QueueBacklog" in text


def test_alert_list_truncated_to_five():
    names = [f"A{i}" for i in range(8)]
    text = embed_text(build_embed(build_report(None, None, None, names)))
    assert "A4" in text and "A5" not in text
    assert "+3 more" in text


def test_redis_down_needs_attention(real):
    real["queue"].values["redis_up"] = 0.0
    r = build_report(real["queue"], real["cloud"], real["jobs"], [])
    assert not r.healthy
    assert "Redis is down" in embed_text(build_embed(r))


def test_worker_down_needs_attention(real):
    real["queue"].values["worker_up"] = 0.0
    r = build_report(real["queue"], real["cloud"], real["jobs"], [])
    assert "worker is down" in embed_text(build_embed(r))


def test_datasource_error_shows_unavailable_and_rest_renders(real):
    real["jobs"].errors["counts"] = "relation does not exist"
    real["jobs"].values.pop("counts")
    real["queue"].errors["workers"] = "prometheus down"
    real["queue"].values.pop("workers")
    r = build_report(real["queue"], real["cloud"], real["jobs"], real["alerts"])
    text = embed_text(build_embed(r))
    assert "Workers: unavailable" in text
    assert "Last 7 days: unavailable" in text
    assert "7-day success rate: unavailable" in text
    # untouched parts still render
    assert "Queued: 0" in text
    assert "colbert:" in text
    assert "Run time p50 / p95: 24.0 / 24.0 min" in text
    # the error text itself is never shown
    assert "relation does not exist" not in text
    assert "prometheus down" not in text


def test_all_sources_missing_is_all_unavailable():
    text = embed_text(build_embed(build_report(None, None, None, None)))
    assert "Needs attention" in text
    assert "alert status unavailable" in text
    assert "Queued: unavailable" in text
    assert "[Cloud Run instances]\nunavailable" in text
    assert "[Cost (estimate)]\nunavailable" in text
    assert "[Firing alerts]\nunavailable" in text


def test_privacy_no_ids_errors_papers_owners(real):
    secrets = {
        "analysis_id": "an-7f3c9e1d",
        "error": "Traceback: KeyError in pipeline",
        "paper_name": "Secret Paper On Dragons",
        "owner": "alice@example.com",
    }
    for ref in ("counts", "daily", "duration"):
        for row in real["jobs"].values[ref]:
            row.update(secrets)
    r = build_report(real["queue"], real["cloud"], real["jobs"], real["alerts"])
    text = embed_text(build_embed(r))
    for key, value in secrets.items():
        assert key not in text
        assert value not in text
