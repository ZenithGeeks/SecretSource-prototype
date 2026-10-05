"""One PNG with two subplots, sized to read on a phone."""

from __future__ import annotations

import io
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates  # noqa: E402
from matplotlib.backends.backend_agg import FigureCanvasAgg  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

from .report import Report, tz_label  # noqa: E402

COLORS = ["#4C78A8", "#F58518", "#54A24B", "#B279A2", "#9D755D", "#72B7B2"]


def _no_data(ax) -> None:
    ax.text(0.5, 0.5, "no data", ha="center", va="center", fontsize=16, color="#888", transform=ax.transAxes)
    ax.set_xticks([])
    ax.set_yticks([])


def _cost_plot(ax, r: Report) -> None:
    ax.set_title("Estimated THB/h by service, last 24 h", fontsize=15)
    if not r.cost_times or not r.cost_series:
        _no_data(ax)
        return
    tz = ZoneInfo(r.tz_name)
    x = [datetime.fromtimestamp(t / 1000, tz) for t in r.cost_times]
    names = list(r.cost_series)
    ax.stackplot(
        x,
        [[v * r.usd_thb for v in r.cost_series[n]] for n in names],
        labels=names,
        colors=COLORS[: len(names)] if len(names) <= len(COLORS) else None,
        alpha=0.85,
    )
    total = [sum(col) * r.usd_thb for col in zip(*r.cost_series.values(), strict=True)]
    ax.plot(x, total, color="black", linewidth=1.5, label="total")
    ax.set_ylim(0, max(total) * 1.4 or 1)  # headroom for the legend
    ax.set_ylabel("THB per hour", fontsize=12)
    ax.set_xlabel(tz_label(r.tz_name, x[-1]), fontsize=12)
    ax.xaxis.set_major_locator(mdates.AutoDateLocator(tz=tz))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M", tz=tz))
    ax.legend(loc="upper left", fontsize=11, ncol=3, frameon=False)
    ax.tick_params(labelsize=12)
    ax.grid(alpha=0.3)


def _daily_plot(ax, r: Report) -> None:
    ax.set_title("Estimated cost per day, last 30 days", fontsize=15)
    if not r.cost_days or not r.cost_days_series:
        _no_data(ax)
        return
    # contiguous calendar axis: days without data show as gaps, not as squeezed-out bars
    first, last = r.cost_days[0], r.cost_days[-1]
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    idx = list(range(len(days)))
    bottom = [0.0] * len(idx)
    for i, (name, values) in enumerate(r.cost_days_series.items()):
        by_day = dict(zip(r.cost_days, values, strict=True))
        thb = [by_day.get(d, 0.0) * r.usd_thb for d in days]
        ax.bar(idx, thb, 0.8, bottom=bottom, label=name, color=COLORS[i % len(COLORS)])
        bottom = [b + v for b, v in zip(bottom, thb, strict=True)]
    step = max(1, len(idx) // 6)
    ax.set_xticks(idx[::step])
    ax.set_xticklabels([days[i].strftime("%b %d") for i in idx[::step]])
    ax.set_ylim(0, max(bottom) * 1.4 or 1)
    ax.set_ylabel("THB per day", fontsize=12)
    ax.set_xlabel(tz_label(r.tz_name), fontsize=12)
    ax.legend(loc="upper left", fontsize=11, ncol=4, frameon=False)
    ax.tick_params(labelsize=12)
    ax.grid(axis="y", alpha=0.3)


def render_chart(r: Report) -> bytes:
    """Render the report to PNG bytes (900x700 px).

    Uses Figure directly rather than pyplot: no global figure registry, so
    nothing leaks, and it is safe to call from a worker thread.
    """
    fig = Figure(figsize=(9, 7), dpi=100)
    FigureCanvasAgg(fig)
    try:
        top, bottom = fig.subplots(2, 1)
        _cost_plot(top, r)
        _daily_plot(bottom, r)
        fig.tight_layout(pad=1.5, h_pad=2.5)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=100)
        return buf.getvalue()
    finally:
        fig.clear()
