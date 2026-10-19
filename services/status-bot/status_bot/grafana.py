"""Async client for the Grafana query API, plus parsing of data-frame JSON."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import aiohttp

TIMEOUT_S = 10
# The 30-day cost query asks Cloud Monitoring for 30 days of hourly points. It usually
# takes 0.5 to 5 s, but on 2026-10-16 it took over 10 s twice and the chart lost its
# daily panel. /status defers its reply, so waiting longer costs only the user's wait.
COST30_TIMEOUT_S = 30

# Request bodies for POST /api/ds/query, verified against the real Grafana on
# 2026-10-05. tests/fixtures/request_*.json hold the same bodies; a test keeps
# them equal.


def _prom(ref_id: str, expr: str) -> dict[str, Any]:
    return {
        "refId": ref_id,
        "datasource": {"type": "prometheus", "uid": "prometheus"},
        "expr": expr,
        "instant": True,
        "range": False,
        "intervalMs": 15000,
        "maxDataPoints": 1,
    }


def _pg(ref_id: str, sql: str) -> dict[str, Any]:
    return {
        "refId": ref_id,
        "datasource": {"type": "postgres", "uid": "analyses-db"},
        "format": "table",
        "rawQuery": True,
        "editorMode": "code",
        "rawSql": sql,
    }


QUEUE_REQUEST: dict[str, Any] = {
    "from": "now-5m",
    "to": "now",
    "queries": [
        _prom("worker_up", 'max(up{job="worker"})'),
        _prom("redis_up", "max(rq_up)"),
        _prom("jobs", "sum by (state) (rq_jobs)"),
        _prom("workers", "sum(rq_workers)"),
        _prom("oldest_queued_s", "max(rq_oldest_queued_job_age_seconds)"),
        _prom("longest_running_s", "max(rq_longest_running_job_seconds)"),
    ],
}

CLOUD_REQUEST: dict[str, Any] = {
    "from": "now-24h",
    "to": "now",
    "queries": [
        {
            "refId": "instances",
            "datasource": {"type": "stackdriver", "uid": "gcp-cloud-monitoring"},
            "queryType": "timeSeriesList",
            "intervalMs": 300000,
            "maxDataPoints": 300,
            "timeSeriesList": {
                "projectName": "gcp-edu-471706",
                "filters": [
                    "metric.type",
                    "=",
                    "run.googleapis.com/container/instance_count",
                ],
                "perSeriesAligner": "ALIGN_MEAN",
                "alignmentPeriod": "300s",
                "crossSeriesReducer": "REDUCE_SUM",
                "groupBys": [
                    "resource.label.service_name",
                    "metric.label.state",
                ],
            },
        }
    ],
}

COST30_REQUEST: dict[str, Any] = {
    "from": "now-30d",
    "to": "now",
    "queries": [
        {
            "refId": "instances_30d",
            "datasource": {"type": "stackdriver", "uid": "gcp-cloud-monitoring"},
            "queryType": "timeSeriesList",
            "intervalMs": 3600000,
            "maxDataPoints": 800,
            "timeSeriesList": {
                "projectName": "gcp-edu-471706",
                "filters": [
                    "metric.type",
                    "=",
                    "run.googleapis.com/container/instance_count",
                ],
                "perSeriesAligner": "ALIGN_MEAN",
                "alignmentPeriod": "3600s",
                "crossSeriesReducer": "REDUCE_SUM",
                "groupBys": [
                    "resource.label.service_name",
                    "metric.label.state",
                ],
            },
        }
    ],
}

_DONE_ERR = "  count(*) filter (where data->>'status' = '{s}' and started > now() - interval '{i}') as {n}"

JOBS_REQUEST: dict[str, Any] = {
    "from": "now-7d",
    "to": "now",
    "queries": [
        _pg(
            "counts",
            "select\n"
            + _DONE_ERR.format(s="done", i="24 hours", n="done_24h")
            + ",\n"
            + _DONE_ERR.format(s="error", i="24 hours", n="error_24h")
            + ",\n"
            + _DONE_ERR.format(s="done", i="7 days", n="done_7d")
            + ",\n"
            + _DONE_ERR.format(s="error", i="7 days", n="error_7d")
            + ",\n"
            "  count(*) filter (where data->>'status' = 'running') as running\n"
            "from public.analyses",
        ),
        _pg(
            "daily",
            "select date_trunc('day', started) as day,\n"
            "  count(*) filter (where data->>'status' = 'done') as done,\n"
            "  count(*) filter (where data->>'status' = 'error') as error\n"
            "from public.analyses\n"
            "where started > now() - interval '7 days'\n"
            "group by 1\n"
            "order by 1",
        ),
        _pg(
            "duration",
            "with s as (\n"
            "  select\n"
            "    (select min((elem->>'at')::double precision) from jsonb_array_elements(coalesce(data->'stages', '[]'::jsonb)) elem where elem ? 'at') as first_at,\n"  # noqa: E501
            "    (select max((elem->>'at')::double precision) from jsonb_array_elements(coalesce(data->'stages', '[]'::jsonb)) elem where elem ? 'at') as last_at\n"  # noqa: E501
            "  from public.analyses\n"
            "  where data->>'status' in ('done', 'error') and started > now() - interval '7 days'\n"
            ")\n"
            "select percentile_cont(0.5) within group (order by (last_at - first_at) / 60.0) as p50_min,\n"
            "  percentile_cont(0.95) within group (order by (last_at - first_at) / 60.0) as p95_min\n"
            "from s\n"
            "where first_at is not null and last_at is not null and last_at > first_at",
        ),
    ],
}

ALERTS_PATH = "/api/alertmanager/grafana/api/v2/alerts"


class GrafanaError(Exception):
    """Grafana was unreachable or answered with something unusable."""


# One cloud series: (service, state, [(epoch_ms, value), ...])
Series = tuple[str, str, list[tuple[int, float]]]


@dataclass
class Parsed:
    """Parsed /api/ds/query response.

    values: refId -> float | None | dict[state, float] (prometheus),
            list[Series] (stackdriver), list[dict] (postgres).
    errors: refId -> error text. Kept for logs; never shown to users.
    """

    values: dict[str, Any] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)


def _columns(frame: dict[str, Any]) -> list[list[Any]]:
    return (frame.get("data") or {}).get("values") or []


def _fields(frame: dict[str, Any]) -> list[dict[str, Any]]:
    return (frame.get("schema") or {}).get("fields") or []


def _parse_prometheus(frames: list[dict[str, Any]]) -> Any:
    labeled: dict[str, float | None] = {}
    scalar: float | None = None
    seen = False
    for frame in frames:
        fields, cols = _fields(frame), _columns(frame)
        if len(fields) < 2 or len(cols) < 2:
            continue
        value = cols[1][-1] if cols[1] else None
        labels = fields[1].get("labels") or {}
        if labels:
            key = labels.get("state") or next(iter(labels.values()))
            labeled[str(key)] = value
        elif not seen:
            scalar = value
        seen = True
    return labeled if labeled else scalar


def _parse_cloud(frames: list[dict[str, Any]]) -> list[Series]:
    out: list[Series] = []
    for frame in frames:
        fields, cols = _fields(frame), _columns(frame)
        if len(fields) < 2 or len(cols) < 2:
            continue
        labels = fields[1].get("labels") or {}
        service = labels.get("resource.label.service_name")
        state = labels.get("metric.label.state")
        if service is None or state is None:
            continue
        points = [(int(t), float(v)) for t, v in zip(cols[0], cols[1], strict=False) if v is not None]
        out.append((service, state, points))
    return out


def _parse_table(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for frame in frames:
        names = [f.get("name") for f in _fields(frame)]
        for row in zip(*_columns(frame), strict=False):
            rows.append(dict(zip(names, row, strict=False)))
    return rows


_PARSERS = {
    "prometheus": _parse_prometheus,
    "stackdriver": _parse_cloud,
    "postgres": _parse_table,
}


def parse_response(body: dict[str, Any], payload: dict[str, Any]) -> Parsed:
    """Parse a /api/ds/query response; `body` is the request that produced it."""
    kinds = {q["refId"]: q["datasource"]["type"] for q in body["queries"]}
    parsed = Parsed()
    results = payload.get("results") or {}
    for ref_id, kind in kinds.items():
        result = results.get(ref_id)
        if result is None:
            parsed.errors[ref_id] = "missing from response"
        elif result.get("error"):
            parsed.errors[ref_id] = str(result["error"])
        else:
            parsed.values[ref_id] = _PARSERS[kind](result.get("frames") or [])
    return parsed


def parse_alerts(payload: Any) -> list[str]:
    """Firing alert names (labels.alertname), deduplicated, sorted."""
    names = {
        a["labels"]["alertname"]
        for a in payload
        if isinstance(a, dict) and (a.get("labels") or {}).get("alertname")
    }
    return sorted(names)


class GrafanaClient:
    def __init__(self, base_url: str, token: str) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}
        self._session: aiohttp.ClientSession | None = None

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=TIMEOUT_S),
            )
        return self._session

    async def __aenter__(self) -> GrafanaClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()

    async def _request(self, method: str, path: str, **kwargs: Any) -> tuple[int, Any]:
        try:
            async with self._get_session().request(method, self._base + path, **kwargs) as resp:
                try:
                    return resp.status, await resp.json(content_type=None)
                except ValueError as exc:
                    raise GrafanaError(f"HTTP {resp.status}, not JSON") from exc
        except (TimeoutError, aiohttp.ClientError) as exc:
            raise GrafanaError(f"{type(exc).__name__} talking to Grafana") from exc

    async def query(self, body: dict[str, Any], timeout_s: float = TIMEOUT_S) -> Parsed:
        timeout = aiohttp.ClientTimeout(total=timeout_s)
        status, data = await self._request("POST", "/api/ds/query", json=body, timeout=timeout)
        # Grafana can answer 4xx/5xx and still carry per-refId errors.
        if not isinstance(data, dict) or "results" not in data:
            raise GrafanaError(f"HTTP {status} from /api/ds/query")
        return parse_response(body, data)

    async def alerts(self) -> list[str]:
        status, data = await self._request(
            "GET",
            ALERTS_PATH,
            params={"active": "true", "silenced": "false", "inhibited": "false"},
        )
        if status != 200 or not isinstance(data, list):
            raise GrafanaError(f"HTTP {status} from alerts")
        return parse_alerts(data)
