"""Turn parsed Grafana results into a Report and a Discord embed. No I/O.

Privacy: only the specific columns and refIds below are read. Analysis ids,
error messages, paper names and owners are never selected by the queries and
are never copied from a row.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import discord

from .grafana import Parsed, Series
from .rates import RATES, hourly_cost

UNAVAILABLE = "unavailable"
STEP_S = 300
MAX_ALERTS = 5
FOOTER = "Estimate from list prices. Not the bill; credit left is not visible."

GREEN = 0x2ECC71
RED = 0xE74C3C


@dataclass
class Report:
    healthy: bool = False
    reasons: list[str] = field(default_factory=list)
    # queue
    queued: float | None = None
    started: float | None = None
    failed: float | None = None
    workers: float | None = None
    oldest_queued_s: float | None = None
    longest_running_s: float | None = None
    # jobs
    done_24h: int | None = None
    error_24h: int | None = None
    done_7d: int | None = None
    error_7d: int | None = None
    success_rate: float | None = None  # None when unavailable or nothing finished
    jobs_available: bool = False
    duration_available: bool = False
    p50_min: float | None = None
    p95_min: float | None = None
    daily: list[tuple[int, int, int]] = field(default_factory=list)  # (day_ms, done, error)
    # cloud run
    cloud_available: bool = False
    instances: dict[str, float] = field(default_factory=dict)
    unpriced: list[str] = field(default_factory=list)
    cost_now: float | None = None
    cost_day: float | None = None
    spend_24h: float | None = None
    cost_times: list[int] = field(default_factory=list)
    cost_series: dict[str, list[float]] = field(default_factory=dict)  # $/h per time
    # alerts
    alerts: list[str] | None = None


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _prom_scalar(parsed: Parsed | None, ref: str) -> float | None:
    if parsed is None or ref in parsed.errors:
        return None
    return _number(parsed.values.get(ref))


def _prom_state(parsed: Parsed | None, ref: str, state: str) -> float | None:
    if parsed is None or ref in parsed.errors:
        return None
    value = parsed.values.get(ref)
    if not isinstance(value, dict):
        return None
    return _number(value.get(state))


def _rows(parsed: Parsed | None, ref: str) -> list[dict[str, Any]] | None:
    if parsed is None or ref in parsed.errors:
        return None
    rows = parsed.values.get(ref)
    return rows if isinstance(rows, list) else None


def _series(parsed: Parsed | None) -> list[Series] | None:
    if parsed is None or "instances" in parsed.errors:
        return None
    value = parsed.values.get("instances")
    return value if isinstance(value, list) else None


def _value_at(points: list[tuple[int, float]], ts: int) -> float:
    for t, v in points:
        if t == ts:
            return v
    return 0.0


def _int(value: Any) -> int | None:
    n = _number(value)
    return None if n is None else int(n)


def _fill_jobs(r: Report, jobs: Parsed | None) -> None:
    counts = _rows(jobs, "counts")
    if counts:
        row = counts[0]
        r.done_24h = _int(row.get("done_24h"))
        r.error_24h = _int(row.get("error_24h"))
        r.done_7d = _int(row.get("done_7d"))
        r.error_7d = _int(row.get("error_7d"))
        if r.done_7d is not None and r.error_7d is not None:
            finished = r.done_7d + r.error_7d
            r.success_rate = r.done_7d / finished if finished else None
        r.jobs_available = r.done_7d is not None and r.error_7d is not None
    daily = _rows(jobs, "daily")
    if daily is not None:
        for row in daily:
            day, done, error = _int(row.get("day")), _int(row.get("done")), _int(row.get("error"))
            if day is not None:
                r.daily.append((day, done or 0, error or 0))
    duration = _rows(jobs, "duration")
    if duration is not None:
        r.duration_available = True
        row = duration[0] if duration else {}
        r.p50_min = _number(row.get("p50_min"))
        r.p95_min = _number(row.get("p95_min"))


def _fill_cloud(r: Report, cloud: Parsed | None) -> None:
    series = _series(cloud)
    if series is None:
        return
    r.cloud_available = True
    by_service: dict[str, dict[str, list[tuple[int, float]]]] = {}
    for service, state, points in series:
        by_service.setdefault(service, {})[state] = points
    r.unpriced = sorted(s for s in by_service if s not in RATES)

    # instances now: per service, at that service's own latest timestamp
    for service, states in sorted(by_service.items()):
        stamps = [p[-1][0] for p in states.values() if p]
        if not stamps:
            r.instances[service] = 0.0
            continue
        ts = max(stamps)
        r.instances[service] = sum(_value_at(states.get(st, []), ts) for st in ("active", "idle"))

    # $/h at every timestamp, priced services only
    times = sorted({t for _, _, pts in series for t, _ in pts})
    r.cost_times = times
    for service in sorted(by_service):
        if service not in RATES:
            continue
        states = by_service[service]
        r.cost_series[service] = [
            hourly_cost(
                service,
                _value_at(states.get("active", []), t),
                _value_at(states.get("idle", []), t),
            )
            for t in times
        ]
    if times:
        totals = [sum(col) for col in zip(*r.cost_series.values(), strict=True)] or [0.0] * len(times)
        r.cost_now = totals[-1]
        r.cost_day = r.cost_now * 24
        r.spend_24h = sum(t * STEP_S / 3600 for t in totals)
    else:
        r.cost_now = r.cost_day = r.spend_24h = 0.0


def build_report(
    queue: Parsed | None,
    cloud: Parsed | None,
    jobs: Parsed | None,
    alerts: list[str] | None,
) -> Report:
    """Any input may be None (query failed); its fields then read "unavailable"."""
    r = Report(alerts=alerts)
    r.queued = _prom_state(queue, "jobs", "queued")
    r.started = _prom_state(queue, "jobs", "started")
    r.failed = _prom_state(queue, "jobs", "failed")
    r.workers = _prom_scalar(queue, "workers")
    r.oldest_queued_s = _prom_scalar(queue, "oldest_queued_s")
    r.longest_running_s = _prom_scalar(queue, "longest_running_s")
    _fill_jobs(r, jobs)
    _fill_cloud(r, cloud)

    worker_up = _prom_scalar(queue, "worker_up")
    redis_up = _prom_scalar(queue, "redis_up")
    if worker_up is None:
        r.reasons.append("worker status unavailable")
    elif worker_up != 1:
        r.reasons.append("worker is down")
    if redis_up is None:
        r.reasons.append("Redis status unavailable")
    elif redis_up != 1:
        r.reasons.append("Redis is down")
    if alerts is None:
        r.reasons.append("alert status unavailable")
    elif alerts:
        r.reasons.append(f"{len(alerts)} alert{'s' if len(alerts) != 1 else ''} firing")
    r.healthy = not r.reasons
    return r


# ---- formatting -----------------------------------------------------------


def fmt_duration(seconds: float | None) -> str:
    if seconds is None:
        return UNAVAILABLE
    m, s = divmod(int(round(seconds)), 60)
    return f"{m}m {s}s"


def _count(value: float | int | None) -> str:
    return UNAVAILABLE if value is None else str(int(round(value)))


def _plain(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".") or "0"


def _usd(value: float | None, digits: int = 2) -> str:
    return UNAVAILABLE if value is None else f"${value:.{digits}f}"


def _minutes(available: bool, value: float | None) -> str:
    if not available:
        return UNAVAILABLE
    return "n/a" if value is None else f"{value:.1f}"


def overall_line(r: Report) -> str:
    if r.healthy:
        return "All good"
    return "Needs attention: " + "; ".join(r.reasons)


def _queue_text(r: Report) -> str:
    return "\n".join(
        [
            f"Queued: {_count(r.queued)}",
            f"Started: {_count(r.started)}",
            f"Failed: {_count(r.failed)}",
            f"Workers: {_count(r.workers)}",
            f"Oldest queued wait: {fmt_duration(r.oldest_queued_s)}",
            f"Longest running job: {fmt_duration(r.longest_running_s)}",
        ]
    )


def _jobs_text(r: Report) -> str:
    if not r.jobs_available:
        rate = UNAVAILABLE
        lines = [
            f"Last 24 h: {UNAVAILABLE}",
            f"Last 7 days: {UNAVAILABLE}",
        ]
    else:
        rate = "n/a" if r.success_rate is None else f"{r.success_rate * 100:.0f}%"
        lines = [
            f"Last 24 h: {_count(r.done_24h)} done, {_count(r.error_24h)} failed",
            f"Last 7 days: {_count(r.done_7d)} done, {_count(r.error_7d)} failed",
        ]
    lines.append(f"7-day success rate: {rate}")
    lines.append(
        f"Run time p50 / p95: {_minutes(r.duration_available, r.p50_min)} / "
        f"{_minutes(r.duration_available, r.p95_min)} min"
    )
    return "\n".join(lines)


def _cloud_text(r: Report) -> str:
    if not r.cloud_available:
        return UNAVAILABLE
    if not r.instances:
        return "no services reported"
    return "\n".join(f"{s}: {_plain(n)}" for s, n in r.instances.items())


def _cost_text(r: Report) -> str:
    if not r.cloud_available:
        return UNAVAILABLE
    lines = [
        f"Now: {_usd(r.cost_now)}/h",
        f"≈ {_usd(r.cost_day)}/day at this rate",
        f"Last 24 h: {_usd(r.spend_24h)}",
    ]
    if r.unpriced:
        lines.append("Unpriced: " + ", ".join(r.unpriced))
    return "\n".join(lines)


def _alerts_text(r: Report) -> str:
    if r.alerts is None:
        return UNAVAILABLE
    if not r.alerts:
        return "None"
    text = "\n".join(r.alerts[:MAX_ALERTS])
    if len(r.alerts) > MAX_ALERTS:
        text += f"\n+{len(r.alerts) - MAX_ALERTS} more"
    return text


def build_embed(r: Report) -> discord.Embed:
    embed = discord.Embed(
        title="SecretSource status",
        description=overall_line(r),
        colour=GREEN if r.healthy else RED,
    )
    embed.add_field(name="Queue", value=_queue_text(r), inline=True)
    embed.add_field(name="Jobs", value=_jobs_text(r), inline=True)
    embed.add_field(name="Cloud Run instances", value=_cloud_text(r), inline=False)
    embed.add_field(name="Cost (estimate)", value=_cost_text(r), inline=False)
    embed.add_field(name="Firing alerts", value=_alerts_text(r), inline=False)
    embed.set_footer(text=FOOTER)
    return embed


def embed_text(embed: discord.Embed) -> str:
    """Plain-text rendering of an embed, for logs, previews and tests."""
    parts = [embed.title or "", embed.description or ""]
    for f in embed.fields:
        parts.append(f"[{f.name}]\n{f.value}")
    if embed.footer.text:
        parts.append(embed.footer.text)
    return "\n\n".join(p for p in parts if p)
