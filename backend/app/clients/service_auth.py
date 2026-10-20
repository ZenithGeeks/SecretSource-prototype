"""Credentials for calls to the shared colbert, colpali and grobid services.

With SERVICE_AUTH=api-key, `auth_headers(url)` returns `apikey: <SERVICE_API_KEY>` for a
URL on the same origin as COLBERT_URL, COLPALI_URL or GROBID_URL. That is the team gateway
(APISIX key-auth) in front of the host's GPU services. The LLM does not use this module: its
key goes in VLLM_API_KEY.

With SERVICE_AUTH=google-id-token, it returns `Authorization: Bearer <token>` for a
*.run.app URL, the private Cloud Run services.

For any other host it returns nothing. So neither credential goes to a third-party LLM
endpoint, and a Google token never goes to the compose containers.

google-auth picks where the token comes from, in this order:
- The file GOOGLE_APPLICATION_CREDENTIALS names: a service-account key, or the
  impersonated credentials `gcloud auth application-default login
  --impersonate-service-account=<invoker>` writes. google-auth only reads that file
  through the variable. A plain user login cannot make identity tokens at all.
- The metadata server. That is the service's own service account on Cloud Run.

The audience is the service origin. Cloud Run checks it.
"""

import threading
from urllib.parse import urlsplit

from app.config import COLBERT_URL, COLPALI_URL, GROBID_URL, SERVICE_API_KEY, SERVICE_AUTH

# audience -> google-auth IDTokenCredentials. Each one refreshes itself once its token
# expires.
_credentials = {}
_lock = threading.Lock()


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


# The only origins that get SERVICE_API_KEY.
_KEYED_ORIGINS = {_origin(url) for url in (COLBERT_URL, COLPALI_URL, GROBID_URL)}


def sends_key(url: str) -> bool:
    """Whether calls to this URL carry SERVICE_API_KEY."""
    return SERVICE_AUTH == "api-key" and _origin(url) in _KEYED_ORIGINS


def _audience(url: str) -> str | None:
    parts = urlsplit(url)
    if SERVICE_AUTH != "google-id-token" or not (parts.hostname or "").endswith(".run.app"):
        return None
    return _origin(url)


def signs(url: str) -> bool:
    """Whether calls to this URL carry a Google identity token."""
    return _audience(url) is not None


def auth_headers(url: str) -> dict[str, str]:
    if sends_key(url):
        return {"apikey": SERVICE_API_KEY}
    audience = _audience(url)
    if audience is None:
        return {}

    import google.auth.transport.requests
    from google.oauth2 import id_token

    request = google.auth.transport.requests.Request()
    # One lock for fetch and refresh. Pipeline threads share the credentials. A refresh
    # is a network call, at most once an hour per service.
    with _lock:
        credentials = _credentials.get(audience)
        if credentials is None:
            credentials = id_token.fetch_id_token_credentials(audience, request=request)
            _credentials[audience] = credentials
        if not credentials.valid:
            credentials.refresh(request)
        return {"Authorization": f"Bearer {credentials.token}"}


def mcp_http_client_factory(url: str):
    """An `httpx_client_factory` for an McpToolset whose server is `url`. Every MCP
    request gets auth_headers(url) as it is sent.

    ADK's `header_provider` is not enough. McpToolset only calls it when it has a
    context. The A2A agent card and `adk web` list tools without one. So those requests
    went out with no token, and the card silently lost the toolset's skills."""
    import asyncio

    from google.adk.tools.mcp_tool.mcp_session_manager import create_mcp_http_client

    # The client comes from httpx under MCP SDK 1.x and httpx2 under 2.x, and each
    # rejects the other's Auth class. ADK makes that choice in this module, so take
    # Auth from the same place. ADK releases without it only support MCP 1.x.
    try:
        from google.adk.dependencies._httpx import Auth
    except ImportError:
        from httpx import Auth

    class ServiceAuth(Auth):
        async def async_auth_flow(self, request):
            # A token refresh is blocking I/O. Keep it off the event loop.
            request.headers.update(await asyncio.to_thread(auth_headers, url))
            yield request

    signing = ServiceAuth() if _audience(url) or sends_key(url) else None

    def factory(headers=None, timeout=None, auth=None):
        return create_mcp_http_client(headers=headers, timeout=timeout, auth=auth or signing)

    return factory
