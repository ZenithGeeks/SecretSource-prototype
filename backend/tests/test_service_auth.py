"""Identity tokens for the private Cloud Run services: a Bearer header goes to a *.run.app
URL only, is fetched once per origin, and refreshes itself when it expires. No network:
fetch_id_token_credentials is a fake, since service_auth.py imports it lazily inside
auth_headers rather than at module level."""

import asyncio
import importlib

import pytest
from app import config
from app.clients import service_auth
from google.oauth2 import id_token

COLBERT = "https://colbert-540627595710.asia-southeast1.run.app"
COLPALI = "https://colpali-540627595710.asia-southeast1.run.app"


class FakeCredentials:
    """A token that ages out: refresh mints the next one and makes it valid again."""

    def __init__(self):
        self.n = 0
        self.token = None
        self.valid = False

    def refresh(self, request):
        self.n += 1
        self.token = f"token-{self.n}"
        self.valid = True


@pytest.fixture
def fake_fetch(monkeypatch):
    """Replace the fetch the module will import; every call mints fresh credentials."""
    calls = []

    def fetch(audience, request):
        calls.append(audience)
        return FakeCredentials()

    monkeypatch.setattr(id_token, "fetch_id_token_credentials", fetch)
    return calls


@pytest.fixture(autouse=True)
def reset_credentials(monkeypatch):
    """Each test starts with an empty cache and a known auth mode."""
    monkeypatch.setattr(service_auth, "_credentials", {})
    monkeypatch.setattr(service_auth, "SERVICE_AUTH", "google-id-token")


def test_none_mode_sends_nothing(monkeypatch, fake_fetch):
    monkeypatch.setattr(service_auth, "SERVICE_AUTH", "none")
    assert service_auth.auth_headers(f"{COLBERT}/api/search") == {}
    assert not fake_fetch


def test_non_cloud_run_hosts_get_no_token(fake_fetch):
    for url in (
        "http://colbert:8893/api/search",
        "http://localhost:8070/api/processFulltextDocument",
        "https://llm.example.com/v1",
    ):
        assert service_auth.auth_headers(url) == {}
    assert not fake_fetch


def test_run_app_url_gets_a_token_for_its_origin(fake_fetch):
    headers = service_auth.auth_headers(f"{COLBERT}/api/search")
    assert fake_fetch == [COLBERT]
    assert headers == {"Authorization": "Bearer token-1"}


def test_credentials_are_cached_per_origin(fake_fetch):
    first = service_auth.auth_headers(f"{COLBERT}/api/search")
    second = service_auth.auth_headers(f"{COLBERT}/api/upload")
    assert fake_fetch == [COLBERT]  # fetched once, then served from the cache
    assert first == second == {"Authorization": "Bearer token-1"}
    assert list(service_auth._credentials) == [COLBERT]


def test_expired_credentials_refresh_without_refetching(fake_fetch):
    service_auth.auth_headers(f"{COLBERT}/api/search")
    service_auth._credentials[COLBERT].valid = False  # the token aged out
    assert service_auth.auth_headers(f"{COLBERT}/api/search") == {"Authorization": "Bearer token-2"}
    assert fake_fetch == [COLBERT]


def test_each_origin_gets_its_own_credentials(fake_fetch):
    colbert = service_auth.auth_headers(f"{COLBERT}/api/search")
    colpali = service_auth.auth_headers(f"{COLPALI}/api/search")
    assert fake_fetch == [COLBERT, COLPALI]
    assert set(service_auth._credentials) == {COLBERT, COLPALI}
    assert colbert == colpali == {"Authorization": "Bearer token-1"}  # separate fakes, same first token


def test_config_rejects_unknown_auth_modes(monkeypatch):
    monkeypatch.setenv("SERVICE_AUTH", "bogus")
    with pytest.raises(ValueError, match="SERVICE_AUTH"):
        importlib.reload(config)
    # Leave the module importable for the tests that follow.
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


def test_mcp_client_signs_every_request(fake_fetch):
    pytest.importorskip("google.adk")
    client = service_auth.mcp_http_client_factory(COLBERT)()
    assert _signed_headers(client, f"{COLBERT}/mcp/")["Authorization"] == "Bearer token-1"


def test_mcp_client_for_other_hosts_adds_nothing(fake_fetch):
    pytest.importorskip("google.adk")
    client = service_auth.mcp_http_client_factory("http://colbert:8893")()
    assert client.auth is None  # no signing hook at all, so nothing can add a token
    asyncio.run(client.aclose())
    assert not fake_fetch


GATEWAY = "https://gateway.example.ts.net:8443"


@pytest.fixture
def api_key_mode(monkeypatch):
    """SERVICE_AUTH=api-key with ColBERT behind the team gateway and GROBID local."""
    monkeypatch.setattr(service_auth, "SERVICE_AUTH", "api-key")
    monkeypatch.setattr(service_auth, "SERVICE_API_KEY", "sk-teammate")
    monkeypatch.setattr(service_auth, "_KEYED_ORIGINS", {GATEWAY, "http://grobid:8070"})


def test_api_key_goes_to_the_service_origins_only(api_key_mode, fake_fetch):
    assert service_auth.auth_headers(f"{GATEWAY}/colbert/api/search") == {"apikey": "sk-teammate"}
    assert service_auth.auth_headers("http://grobid:8070/api/processFulltextDocument") == {
        "apikey": "sk-teammate"
    }
    assert service_auth.auth_headers("https://llm.example.com/v1/chat/completions") == {}
    assert service_auth.auth_headers(f"{COLBERT}/api/search") == {}
    assert not fake_fetch


def test_config_needs_a_key_in_api_key_mode(monkeypatch):
    monkeypatch.setenv("SERVICE_AUTH", "api-key")
    monkeypatch.delenv("SERVICE_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SERVICE_API_KEY"):
        importlib.reload(config)
    monkeypatch.setenv("SERVICE_AUTH", "none")
    importlib.reload(config)


def test_mcp_client_sends_the_api_key(api_key_mode, fake_fetch):
    pytest.importorskip("google.adk")
    client = service_auth.mcp_http_client_factory(f"{GATEWAY}/colbert")()
    assert _signed_headers(client, f"{GATEWAY}/colbert/mcp/")["apikey"] == "sk-teammate"
