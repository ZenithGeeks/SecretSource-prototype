import discord
import pytest
from status_bot import bot
from status_bot.bot import StatusService, handle_status, load_config
from status_bot.grafana import (
    CLOUD_REQUEST,
    JOBS_REQUEST,
    QUEUE_REQUEST,
    GrafanaError,
    parse_response,
)

from .conftest import load


class FakeGrafana:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail
        self.responses = {
            id(QUEUE_REQUEST): (QUEUE_REQUEST, "response_queue.json"),
            id(CLOUD_REQUEST): (CLOUD_REQUEST, "response_cloud.json"),
            id(JOBS_REQUEST): (JOBS_REQUEST, "response_jobs.json"),
        }

    async def query(self, body):
        self.calls.append("query")
        if self.fail:
            raise GrafanaError("down")
        req, name = self.responses[id(body)]
        return parse_response(req, load(name))

    async def alerts(self):
        self.calls.append("alerts")
        if self.fail:
            raise GrafanaError("down")
        return []


class FakeInteraction:
    def __init__(self, events):
        self.events = events
        self.sent = []
        self.user = type("U", (), {"id": 42})()
        outer = self

        class Response:
            async def defer(self, **kw):
                outer.events.append(("defer", kw))

        class Followup:
            async def send(self, *a, **kw):
                outer.events.append("send")
                outer.sent.append((a, kw))

        self.response = Response()
        self.followup = Followup()


async def test_defer_before_send_and_payload():
    events = []
    ix = FakeInteraction(events)
    await handle_status(ix, StatusService(FakeGrafana()))
    assert events[0] == ("defer", {"thinking": True})
    assert events[1] == "send"
    ((_, kw),) = ix.sent
    assert kw["embed"].image.url == "attachment://status.png"
    assert kw["file"].filename == "status.png"
    assert kw["file"].fp.read(4) == b"\x89PNG"
    assert "All good" in kw["embed"].description


async def test_second_call_within_30s_uses_cache():
    now = [100.0]
    g = FakeGrafana()
    svc = StatusService(g, clock=lambda: now[0])
    await handle_status(FakeInteraction([]), svc)
    assert len(g.calls) == 4  # three queries + alerts
    now[0] += 29
    ix = FakeInteraction([])
    await handle_status(ix, svc)
    assert len(g.calls) == 4
    assert ix.sent[0][1]["file"].fp.read(4) == b"\x89PNG"  # fresh File each time
    now[0] += 2  # 31 s after the first fetch
    await handle_status(FakeInteraction([]), svc)
    assert len(g.calls) == 8


async def test_grafana_unreachable_sends_short_message():
    events = []
    ix = FakeInteraction(events)
    await handle_status(ix, StatusService(FakeGrafana(fail=True)))
    assert events[0][0] == "defer"
    ((args, kw),) = ix.sent
    assert "unreachable" in args[0]
    assert kw == {}


def test_config_missing_required_fails_fast():
    with pytest.raises(SystemExit) as exc:
        load_config({})
    msg = str(exc.value)
    assert "DISCORD_BOT_TOKEN" in msg
    assert "DISCORD_GUILD_ID" in msg
    assert "GRAFANA_TOKEN" in msg


def test_config_ok_and_never_shows_tokens():
    cfg = load_config(
        {
            "DISCORD_BOT_TOKEN": "sekrit-d",
            "DISCORD_GUILD_ID": "123",
            "GRAFANA_TOKEN": "sekrit-g",
        }
    )
    assert cfg.guild_id == 123
    assert cfg.grafana_url == "http://grafana:3000"
    assert "sekrit" not in repr(cfg)


def test_config_guild_must_be_int():
    env = {"DISCORD_BOT_TOKEN": "a", "DISCORD_GUILD_ID": "x", "GRAFANA_TOKEN": "b"}
    with pytest.raises(SystemExit, match="integer"):
        load_config(env)


async def test_status_command_registered_on_guild():
    cfg = bot.Config(discord_token="a", guild_id=555, grafana_token="b")
    client = bot.StatusBot(cfg)
    try:
        cmds = client.tree.get_commands(guild=discord.Object(id=555))
        assert [c.name for c in cmds] == ["status"]
        assert cmds[0].description == "System status: services, queue, jobs, estimated cost"
        assert not client.intents.members
        assert not client.intents.message_content
    finally:
        await client.grafana.close()
