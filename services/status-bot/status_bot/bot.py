"""Discord client and the /status command."""

from __future__ import annotations

import asyncio
import io
import logging
import math
import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import discord
from discord import app_commands

from .chart import render_chart
from .grafana import (
    CLOUD_REQUEST,
    COST30_REQUEST,
    JOBS_REQUEST,
    QUEUE_REQUEST,
    GrafanaClient,
    GrafanaError,
)
from .report import DEFAULT_TZ, DEFAULT_USD_THB, build_embed, build_report

log = logging.getLogger("status_bot")

CACHE_TTL_S = 30
IMAGE_NAME = "status.png"
UNREACHABLE = "Grafana is unreachable right now, so I can't report status. Try again in a minute."


@dataclass(frozen=True)
class Config:
    discord_token: str = ""
    guild_id: int = 0
    grafana_url: str = "http://grafana:3000"
    grafana_token: str = ""
    usd_thb: float = DEFAULT_USD_THB
    display_tz: str = DEFAULT_TZ

    def __repr__(self) -> str:  # never leak the tokens
        return (
            f"Config(guild_id={self.guild_id}, grafana_url={self.grafana_url!r}, "
            f"usd_thb={self.usd_thb}, display_tz={self.display_tz!r})"
        )


def load_config(env: Mapping[str, str] | None = None) -> Config:
    """Read all settings from the environment; exit with a clear message if any required one is missing."""
    env = os.environ if env is None else env
    problems = [
        f"{name} is required"
        for name in ("DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "GRAFANA_TOKEN")
        if not env.get(name, "").strip()
    ]
    guild_id = 0
    raw_guild = env.get("DISCORD_GUILD_ID", "").strip()
    if raw_guild:
        try:
            guild_id = int(raw_guild)
        except ValueError:
            problems.append("DISCORD_GUILD_ID must be an integer")
    usd_thb = DEFAULT_USD_THB
    raw_rate = env.get("USD_THB", "").strip()
    if raw_rate:
        try:
            usd_thb = float(raw_rate)
            if not math.isfinite(usd_thb) or usd_thb <= 0:
                raise ValueError(raw_rate)
        except ValueError:
            problems.append("USD_THB must be a positive number")
    display_tz = env.get("DISPLAY_TZ", "").strip() or DEFAULT_TZ
    try:
        ZoneInfo(display_tz)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        problems.append(f"DISPLAY_TZ {display_tz!r} is not a known time zone")
    if problems:
        raise SystemExit("status-bot configuration error: " + "; ".join(problems))
    return Config(
        discord_token=env["DISCORD_BOT_TOKEN"].strip(),
        guild_id=guild_id,
        grafana_url=env.get("GRAFANA_URL", "").strip() or "http://grafana:3000",
        grafana_token=env["GRAFANA_TOKEN"].strip(),
        usd_thb=usd_thb,
        display_tz=display_tz,
    )


class StatusService:
    """Queries Grafana, builds the embed and chart, and caches the result."""

    def __init__(
        self,
        grafana: Any,
        clock: Callable[[], float] = time.monotonic,
        tz_name: str = DEFAULT_TZ,
        usd_thb: float = DEFAULT_USD_THB,
    ) -> None:
        self._grafana = grafana
        self._tz = ZoneInfo(tz_name)
        self._usd_thb = usd_thb
        self._clock = clock
        self._cached: tuple[float, discord.Embed, bytes] | None = None
        self._lock = asyncio.Lock()

    async def get(self) -> tuple[discord.Embed, bytes]:
        """Return (embed, png). Raises GrafanaError if Grafana is unreachable."""
        async with self._lock:  # concurrent callers share one fetch
            now = self._clock()
            if self._cached and now - self._cached[0] < CACHE_TTL_S:
                return self._cached[1], self._cached[2]
            embed, png = await self._build()
            self._cached = (self._clock(), embed, png)
            return embed, png

    async def _build(self) -> tuple[discord.Embed, bytes]:
        g = self._grafana
        raw = await asyncio.gather(
            g.query(QUEUE_REQUEST),
            g.query(CLOUD_REQUEST),
            g.query(JOBS_REQUEST),
            g.alerts(),
            g.query(COST30_REQUEST),
            return_exceptions=True,
        )
        results = [None if isinstance(x, BaseException) else x for x in raw]
        for x in raw:
            if isinstance(x, BaseException) and not isinstance(x, GrafanaError):
                raise x
        if all(x is None for x in results[:3]):
            raise GrafanaError("Grafana unreachable")
        report = build_report(
            *results,
            tz=self._tz,
            usd_thb=self._usd_thb,
            now=datetime.now(self._tz),
        )
        png = await asyncio.to_thread(render_chart, report)
        embed = build_embed(report)
        embed.set_image(url=f"attachment://{IMAGE_NAME}")
        return embed, png


async def handle_status(interaction: Any, service: StatusService) -> None:
    """The /status handler: defer at once, then follow up with embed + chart."""
    started = time.monotonic()
    await interaction.response.defer(thinking=True)
    outcome = "ok"
    try:
        embed, png = await service.get()
    except GrafanaError:
        outcome = "grafana unreachable"
        await interaction.followup.send(UNREACHABLE)
    else:
        await interaction.followup.send(embed=embed, file=discord.File(io.BytesIO(png), IMAGE_NAME))
    log.info("/status user=%s %s in %.2fs", interaction.user.id, outcome, time.monotonic() - started)


class StatusBot(discord.Client):
    def __init__(self, config: Config, grafana: GrafanaClient | None = None) -> None:
        super().__init__(intents=discord.Intents.default())
        self.config = config
        self.grafana = grafana or GrafanaClient(config.grafana_url, config.grafana_token)
        self.service = StatusService(self.grafana, tz_name=config.display_tz, usd_thb=config.usd_thb)
        self.tree = app_commands.CommandTree(self)
        self._guild = discord.Object(id=config.guild_id)

        @self.tree.command(
            name="status",
            description="System status: services, queue, jobs, estimated cost",
            guild=self._guild,
        )
        async def status(interaction: discord.Interaction) -> None:
            await handle_status(interaction, self.service)

    async def setup_hook(self) -> None:
        await self.tree.sync(guild=self._guild)

    async def close(self) -> None:
        try:
            await self.grafana.close()
        finally:
            await super().close()

    async def on_ready(self) -> None:
        log.info("logged in as %s", self.user)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config()
    bot = StatusBot(config)
    bot.run(config.discord_token, log_handler=None)
