"""One PNG with two subplots, sized to read on a phone."""

from __future__ import annotations

import io
from datetime import datetime, timezone

import matplotlib

matplotlib.use("Agg")

import matplotlib.dates as mdates  # noqa: E402
from matplotlib.backends.backend_agg import FigureCanvasAgg  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402
from matplotlib.ticker import MaxNLocator  # noqa: E402

from .report import Report  # noqa: E402

COLORS = ["#4C78A8", "#F58518", "#54A24B", "#B279A2", "#9D755D", "#72B7B2"]
DONE = "#54A24B"
FAILED = "#E45756"


def _no_data(ax) -> None:
    ax.text(0.5, 0.5, "no data", ha="center", va="center", fontsize=16, color="#888", transform=ax.transAxes)
    ax.set_xticks([])
    ax.set_yticks([])


def _dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _cost_plot(ax, r: Report) -> None:
    ax.set_title("Estimated $/h by service, last 24 h", fontsize=15)
    if not r.cost_times or not r.cost_series:
        _no_data(ax)
        return
    x = [_dt(t) for t in r.cost_times]
    names = list(r.cost_series)
    ax.stackplot(
        x,
        [r.cost_series[n] for n in names],
        labels=names,
        colors=COLORS[: len(names)] if len(names) <= len(COLORS) else None,
        alpha=0.85,
    )
    total = [sum(col) for col in zip(*r.cost_series.values(), strict=True)]
    ax.plot(x, total, color="black", linewidth=1.5, label="total")
    ax.set_ylim(0, max(total) * 1.4 or 1)  # headroom for the legend
    ax.set_ylabel("USD per hour", fontsize=12)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    ax.legend(loc="upper left", fontsize=11, ncol=3, frameon=False)
    ax.tick_params(labelsize=12)
    ax.grid(alpha=0.3)


def _jobs_plot(ax, r: Report) -> None:
    ax.set_title("Jobs per day, last 7 days", fontsize=15)
    if not r.daily:
        _no_data(ax)
        return
    labels = [_dt(d).strftime("%b %d") for d, _, _ in r.daily]
    idx = list(range(len(r.daily)))
    width = 0.4
    ax.bar([i - width / 2 for i in idx], [d for _, d, _ in r.daily], width, label="done", color=DONE)
    ax.bar([i + width / 2 for i in idx], [e for _, _, e in r.daily], width, label="failed", color=FAILED)
    ax.set_xlim(-1, max(len(idx), 3))
    ax.set_xticks(idx)
    ax.set_xticklabels(labels)
    ax.yaxis.set_major_locator(MaxNLocator(integer=True))
    ax.set_ylabel("jobs", fontsize=12)
    ax.legend(fontsize=11, frameon=False)
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
        _jobs_plot(bottom, r)
        fig.tight_layout(pad=1.5, h_pad=2.5)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=100)
        return buf.getvalue()
    finally:
        fig.clear()
