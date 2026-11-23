"""Service-to-service auth for colbert, colpali and grobid (`SERVICE_AUTH=api-key` or `none`)."""

import asyncio
import importlib

import pytest
from app import config
from app.clients import service_auth


def test_none_mode_sends_nothing(monkeypatch):
    monkeypatch.setattr(service_auth, "SERVICE_AUTH", "none")
    assert service_auth.auth_headers("http://colbert:8893/api/search") == {}


def test_config_rejects_unknown_auth_modes(monkeypatch):
    monkeypatch.setenv("SERVICE_AUTH", "bogus")
    with pytest.raises(ValueError, match="SERVICE_AUTH"):
        importlib.reload(config)
    monkeypatch.setenv("SERVICE_AUTH", "none")
    importlib.reload(config)
    assert config.SERVICE_AUTH == "none"


def _signed_headers(client, url):
    import httpx

    async def sign():
        flow = client.auth.async_auth_flow(httpx.Request("POST", url))
        request = await flow.__anext__()
        await client.aclose()
        return request.headers

    return asyncio.run(sign())


def test_mcp_client_for_other_hosts_adds_nothing(monkeypatch):
    pytest.importorskip("google.adk")
    monkeypatch.setattr(service_auth, "SERVICE_AUTH", "none")
    client = service_auth.mcp_http_client_factory("http://colbert:8893")()
    assert client.auth is None
    asyncio.run(client.aclose())


GATEWAY = "https://gateway.example.test:8443"


@pytest.fixture
def api_key_mode(monkeypatch):
    """SERVICE_AUTH=api-key with ColBERT behind the team gateway and GROBID local."""
    monkeypatch.setattr(service_auth, "SERVICE_AUTH", "api-key")
    monkeypatch.setattr(service_auth, "SERVICE_API_KEY", "sk-teammate")
    monkeypatch.setattr(service_auth, "_KEYED_ORIGINS", {GATEWAY, "http://grobid:8070"})


def test_api_key_goes_to_the_service_origins_only(api_key_mode):
    assert service_auth.auth_headers(f"{GATEWAY}/colbert/api/search") == {"apikey": "sk-teammate"}
    assert service_auth.auth_headers("http://grobid:8070/api/processFulltextDocument") == {
        "apikey": "sk-teammate"
    }
    assert service_auth.auth_headers("https://llm.example.com/v1/chat/completions") == {}


def test_config_needs_a_key_in_api_key_mode(monkeypatch):
    monkeypatch.setenv("SERVICE_AUTH", "api-key")
    monkeypatch.delenv("SERVICE_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SERVICE_API_KEY"):
        importlib.reload(config)
    monkeypatch.setenv("SERVICE_AUTH", "none")
    importlib.reload(config)


def test_mcp_client_sends_the_api_key(api_key_mode):
    pytest.importorskip("google.adk")
    client = service_auth.mcp_http_client_factory(f"{GATEWAY}/colbert")()
    assert _signed_headers(client, f"{GATEWAY}/colbert/mcp/")["apikey"] == "sk-teammate"
