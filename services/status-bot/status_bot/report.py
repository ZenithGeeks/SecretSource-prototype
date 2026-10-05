"""Turn parsed Grafana results into a Report and a Discord embed. No I/O.

Privacy: only the specific columns and refIds below are read. Analysis ids,
error messages, paper names and owners are never selected by the queries and
are never copied from a row.

Money is computed in USD (the rates are USD list prices) and shown as THB with
USD in brackets, using the configured USD_THB rate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import discord

from .grafana import Parsed, Series
from .rates import RATES, hourly_cost

UNAVAILABLE = "unavailable"
STEP_S = 300
MAX_ALERTS = 5
FOOTER = "Estimate from list prices. Not the bill; credit left is not visible."

DEFAULT_TZ = "Asia/Bangkok"
DEFAULT_USD_THB = 33.57

GREEN = 0x2ECC71
RED = 0xE74C3C


@dataclass
class Report:
    healthy: bool = False
    reasons: list[str] = field(default_factory=list)
    # display settings
    tz_name: str = DEFAULT_TZ
    usd_thb: float = DEFAULT_USD_THB
    updated: str | None = None  # "HH:MM" in the display zone
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
    # cloud run
    cloud_available: bool = False
    instances: dict[str, float] = field(default_factory=dict)
    unpriced: list[str] = field(default_factory=list)
    cost_now: float | None = None  # USD per hour
    cost_day: float | None = None
    spend_24h: float | None = None
    cost_times: list[int] = field(default_factory=list)
    cost_series: dict[str, list[float]] = field(default_factory=dict)  # USD/h per time
    # 30 days
    cost30_available: bool = False
    cost_days: list[date] = field(default_factory=list)  # calendar days in tz, sorted
    cost_days_series: dict[str, list[float]] = field(default_factory=dict)  # USD per day
    spend_30d: float | None = None
    avg_day_7d: float | None = None  # USD, last 7 full days in the display zone
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


def _series(parsed: Parsed | None, ref: str = "instances") -> list[Series] | None:
    if parsed is None or ref in parsed.errors:
        return None
    value = parsed.values.get(ref)
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

    # USD/h at every timestamp, priced services only
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


def _fill_cost30(r: Report, cost30: Parsed | None, tz: ZoneInfo, now: datetime | None) -> None:
    """Daily cost per service: each hourly point is worth one hour of its mean instance count."""
    series = _series(cost30, "instances_30d")
    if series is None:
        return
    r.cost30_available = True
    per_day: dict[str, dict[date, float]] = {}
    days: set[date] = set()
    for service, state, points in series:
        rate = RATES.get(service)
        if rate is None or state not in ("active", "idle"):
            continue
        price = rate[0] if state == "active" else rate[1]
        bucket = per_day.setdefault(service, {})
        for ts, value in points:  # None values are already dropped by the parser
            day = datetime.fromtimestamp(ts / 1000, tz).date()
            bucket[day] = bucket.get(day, 0.0) + value * price
            days.add(day)
    r.cost_days = sorted(days)
    for service in sorted(per_day):
        r.cost_days_series[service] = [per_day[service].get(d, 0.0) for d in r.cost_days]
    totals = [sum(col) for col in zip(*r.cost_days_series.values(), strict=True)]
    r.spend_30d = sum(totals)
    # The burn rate that matters for the credit is the recent one: a 30-day average also counts
    # days when billing was off or a leak was running. Today is left out because it is not over.
    today = (now or datetime.now(tz)).astimezone(tz).date()
    full_days = [total for day, total in zip(r.cost_days, totals, strict=True) if day < today][-7:]
    r.avg_day_7d = sum(full_days) / len(full_days) if full_days else None


def build_report(
    queue: Parsed | None,
    cloud: Parsed | None,
    jobs: Parsed | None,
    alerts: list[str] | None,
    cost30: Parsed | None = None,
    *,
    tz: ZoneInfo | None = None,
    usd_thb: float = DEFAULT_USD_THB,
    now: datetime | None = None,
) -> Report:
    """Any input may be None (query failed); its fields then read "unavailable"."""
    tz = tz or ZoneInfo(DEFAULT_TZ)
    r = Report(alerts=alerts, tz_name=tz.key, usd_thb=usd_thb)
    if now is not None:
        r.updated = now.astimezone(tz).strftime("%H:%M")
    r.queued = _prom_state(queue, "jobs", "queued")
    r.started = _prom_state(queue, "jobs", "started")
    r.failed = _prom_state(queue, "jobs", "failed")
    r.workers = _prom_scalar(queue, "workers")
    r.oldest_queued_s = _prom_scalar(queue, "oldest_queued_s")
    r.longest_running_s = _prom_scalar(queue, "longest_running_s")
    _fill_jobs(r, jobs)
    _fill_cloud(r, cloud)
    _fill_cost30(r, cost30, tz, now)

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


def fmt_thb(thb: float) -> str:
    """Thousands separators and no decimals from 100 up; two decimals below."""
    if abs(thb) < 100:
        return f"฿{thb:,.2f}"
    return f"฿{thb:,.0f}"


def fmt_money(usd: float | None, usd_thb: float, suffix: str = "") -> str:
    """THB first, USD in brackets: '฿24.84/h ($0.74/h)'."""
    if usd is None:
        return UNAVAILABLE
    return f"{fmt_thb(usd * usd_thb)}{suffix} (${usd:,.2f}{suffix})"


def tz_label(tz_name: str, at: datetime | None = None) -> str:
    """'Asia/Bangkok, UTC+07:00'."""
    tz = ZoneInfo(tz_name)
    offset = (at or datetime.now(tz)).astimezone(tz).utcoffset()
    minutes = int(offset.total_seconds() // 60) if offset else 0
    sign = "+" if minutes >= 0 else "-"
    hh, mm = divmod(abs(minutes), 60)
    return f"{tz_name}, UTC{sign}{hh:02d}:{mm:02d}"


def _count(value: float | int | None) -> str:
    return UNAVAILABLE if value is None else str(int(round(value)))


def _plain(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".") or "0"


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
    if not r.cloud_available and not r.cost30_available:
        return UNAVAILABLE
    k = r.usd_thb
    if r.cloud_available:
        lines = [
            f"Now: {fmt_money(r.cost_now, k, '/h')}",
            f"≈ {fmt_money(r.cost_day, k, '/day')} at this rate",
            f"Last 24 h: {fmt_money(r.spend_24h, k)}",
        ]
    else:
        lines = [f"Now: {UNAVAILABLE}", f"Last 24 h: {UNAVAILABLE}"]
    lines.append(f"Last 30 days: {fmt_money(r.spend_30d if r.cost30_available else None, k)}")
    avg_7d = r.avg_day_7d if r.cost30_available else None
    lines.append(f"Average per day (last 7 full days): {fmt_money(avg_7d, k)}")
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


def footer_text(r: Report) -> str:
    parts = []
    if r.updated:
        parts.append(f"Updated {r.updated} ({r.tz_name})")
    parts.append(f"1 USD = {r.usd_thb:.2f} THB (USD_THB)")
    return " · ".join(parts) + "\n" + FOOTER


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
    embed.set_footer(text=footer_text(r))
    return embed


def embed_text(embed: discord.Embed) -> str:
    """Plain-text rendering of an embed, for logs, previews and tests."""
    parts = [embed.title or "", embed.description or ""]
    for f in embed.fields:
        parts.append(f"[{f.name}]\n{f.value}")
    if embed.footer.text:
        parts.append(embed.footer.text)
    return "\n\n".join(p for p in parts if p)
