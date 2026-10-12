from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from status_bot import bot
from status_bot.bot import StatusBot, load_config
from status_bot.grafana import COST30_REQUEST, GrafanaClient, Parsed, parse_response
from status_bot.report import (
    build_embed,
    build_report,
    embed_text,
    fmt_money,
    fmt_thb,
    tz_label,
)

BKK = ZoneInfo("Asia/Bangkok")
UTC = ZoneInfo("UTC")


def ms(y, mo, d, h, tz):
    return int(datetime(y, mo, d, h, tzinfo=tz).timestamp() * 1000)


def cost30(*series):
    return Parsed(values={"instances_30d": list(series)})


def test_fmt_thb_rules():
    assert fmt_thb(24.8418) == "฿24.84"
    assert fmt_thb(99.994) == "฿99.99"
    assert fmt_thb(100) == "฿100"
    assert fmt_thb(1830.2) == "฿1,830"
    assert fmt_thb(1234567.8) == "฿1,234,568"


def test_fmt_money_thb_first_usd_in_brackets():
    assert fmt_money(0.74, 33.57, "/h") == "฿24.84/h ($0.74/h)"
    assert fmt_money(54.52, 33.57) == "฿1,830 ($54.52)"
    assert fmt_money(None, 33.57) == "unavailable"


def test_tz_label():
    assert tz_label("Asia/Bangkok") == "Asia/Bangkok, UTC+07:00"
    assert tz_label("Asia/Kolkata") == "Asia/Kolkata, UTC+05:30"


def test_daily_bucketing_crosses_midnight_in_bangkok():
    # 23:00 and 00:00 Bangkok time are 16:00 and 17:00 UTC: one calendar day in
    # UTC, but two in Bangkok.
    p1 = ms(2026, 10, 3, 23, BKK)
    p2 = ms(2026, 10, 4, 0, BKK)
    p3 = ms(2026, 10, 4, 1, BKK)
    c = cost30(
        ("colbert", "active", [(p1, 2.0), (p2, 2.0), (p3, 1.0)]),
        ("colbert", "idle", [(p1, 1.0), (p2, 1.0), (p3, 0.0)]),
        ("mystery", "active", [(p1, 9.0)]),  # unpriced: costs nothing
    )
    # "now" on Oct 4 in Bangkok: Oct 4 is not over, so only Oct 3 counts toward the average.
    r = build_report(None, None, None, None, c, tz=BKK, now=datetime(2026, 10, 4, 12, tzinfo=BKK))
    assert r.cost_days == [date(2026, 10, 3), date(2026, 10, 4)]
    # each point: 2*0.29232 + 1*0.0756 = 0.66024 ; third point: 1*0.29232
    oct3 = 0.66024
    oct4 = 0.66024 + 0.29232
    assert r.cost_days_series == {"colbert": [pytest.approx(oct3), pytest.approx(oct4)]}
    assert r.spend_30d == pytest.approx(oct3 + oct4)
    assert r.avg_day_7d == pytest.approx(oct3)
    # a day later both days are full
    r2 = build_report(None, None, None, None, c, tz=BKK, now=datetime(2026, 10, 5, 12, tzinfo=BKK))
    assert r2.avg_day_7d == pytest.approx((oct3 + oct4) / 2)
    # the same points all fall on one UTC day
    ru = build_report(None, None, None, None, c, tz=UTC)
    assert ru.cost_days == [date(2026, 10, 3)]
    assert ru.cost_days_series["colbert"] == [pytest.approx(oct3 + oct4)]


def test_none_points_are_skipped():
    payload = {
        "results": {
            "instances_30d": {
                "status": 200,
                "frames": [
                    {
                        "schema": {
                            "fields": [
                                {"name": "Time"},
                                {
                                    "name": "v",
                                    "labels": {
                                        "resource.label.service_name": "gateway",
                                        "metric.label.state": "active",
                                    },
                                },
                            ]
                        },
                        "data": {
                            "values": [[ms(2026, 10, 4, 10, BKK), ms(2026, 10, 4, 11, BKK)], [1.0, None]]
                        },
                    }
                ],
            }
        }
    }
    r = build_report(None, None, None, None, parse_response(COST30_REQUEST, payload), tz=BKK)
    assert r.spend_30d == pytest.approx(0.38016)  # one hour of one active gateway


def test_cost30_real_fixture(real):
    now = datetime(2026, 10, 5, 22, 29, tzinfo=BKK)
    r = build_report(
        real["queue"], real["cloud"], real["jobs"], real["alerts"], real["cost30"], tz=BKK, now=now
    )
    assert r.cost30_available
    assert "vllm" not in r.cost_days_series  # unpriced
    assert set(r.cost_days_series) == {"colbert", "colpali", "gateway", "grobid"}
    assert date(2026, 10, 4) in r.cost_days
    i = r.cost_days.index(date(2026, 10, 4))
    day = sum(v[i] for v in r.cost_days_series.values())
    assert 55 < day < 65  # about 59.5 USD on the UTC day; Bangkok day is shifted by 7 h
    # the last 7 full Bangkok days before Oct 5: Sep 28 .. Oct 4
    last7 = [d for d in r.cost_days if date(2026, 9, 28) <= d <= date(2026, 10, 4)]
    expected = sum(sum(v[r.cost_days.index(d)] for v in r.cost_days_series.values()) for d in last7) / len(
        last7
    )
    assert len(last7) == 7
    assert r.avg_day_7d == pytest.approx(expected)
    assert r.avg_day_7d > r.spend_30d / len(r.cost_days)  # the 30-day average hides the recent burn
    text = embed_text(build_embed(r))
    assert "Last 30 days: ฿" in text
    assert "Average per day (last 7 full days): ฿" in text
    assert "Now: ฿" in text and "/h ($" in text
    assert "/day ($" in text and "/day) at this rate" in text


def test_updated_time_and_footer_use_display_zone():
    now = datetime(2026, 10, 5, 8, 42, tzinfo=UTC)  # 15:42 in Bangkok
    r = build_report(None, None, None, None, tz=BKK, usd_thb=33.57, now=now)
    text = embed_text(build_embed(r))
    assert "Updated 15:42 (Asia/Bangkok)" in text
    assert "1 USD = 33.57 THB (USD_THB)" in text
    assert "Estimate from list prices. Not the bill; credit left is not visible." in text
    r2 = build_report(None, None, None, None, tz=ZoneInfo("Asia/Tokyo"), now=now)
    assert "Updated 17:42 (Asia/Tokyo)" in embed_text(build_embed(r2))


def test_thb_rate_changes_output():
    c = cost30(("gateway", "active", [(ms(2026, 10, 4, 1, BKK), 1.0)]))
    r = build_report(None, None, None, None, c, tz=BKK, usd_thb=40.0)
    # 0.38016 USD * 40 = 15.2064 THB
    assert "Last 30 days: ฿15.21 ($0.38)" in embed_text(build_embed(r))


ENV = {"DISCORD_BOT_TOKEN": "a", "DISCORD_GUILD_ID": "1", "GRAFANA_TOKEN": "b"}


def test_config_defaults_and_overrides():
    cfg = load_config(ENV)
    assert cfg.usd_thb == 33.57 and cfg.display_tz == "Asia/Bangkok"
    cfg = load_config({**ENV, "USD_THB": "35.5", "DISPLAY_TZ": "UTC"})
    assert cfg.usd_thb == 35.5 and cfg.display_tz == "UTC"


@pytest.mark.parametrize("bad", ["abc", "0", "-3", "nan", "inf"])
def test_config_bad_usd_thb(bad):
    with pytest.raises(SystemExit, match="USD_THB"):
        load_config({**ENV, "USD_THB": bad})


def test_config_unknown_zone():
    with pytest.raises(SystemExit, match="DISPLAY_TZ"):
        load_config({**ENV, "DISPLAY_TZ": "Mars/Olympus"})


async def test_client_close_closes_session():
    client = GrafanaClient("http://x", "tok")
    session = client._get_session()
    assert not session.closed
    await client.close()
    assert session.closed
    await client.close()  # idempotent


async def test_bot_close_closes_grafana_session():
    cfg = bot.Config(discord_token="a", guild_id=1, grafana_token="b")
    client = StatusBot(cfg)
    session = client.grafana._get_session()
    await client.close()
    assert session.closed
