"""Google identity tokens for calls to the private Cloud Run services.

The shared colbert, colpali and grobid services only accept callers holding an identity
token for them. With SERVICE_AUTH=google-id-token, `auth_headers(url)` returns
`Authorization: Bearer <token>` for a *.run.app URL and nothing for any other host, so a
Google token never goes to the compose containers or to a third-party LLM endpoint.

Where the token comes from is google-auth's choice, in this order:
- The file GOOGLE_APPLICATION_CREDENTIALS names: a service-account key, or the impersonated
  credentials `gcloud auth application-default login --impersonate-service-account=<invoker>`
  writes. google-auth only reads that file through the variable, and a plain user login
  cannot mint identity tokens at all.
- The metadata server, i.e. the service's own service account when running on Cloud Run.

The audience is the service origin, which is what Cloud Run checks.
"""

import threading
from urllib.parse import urlsplit

from app.config import SERVICE_AUTH

# audience -> google-auth IDTokenCredentials; each refreshes itself once its token expires.
_credentials = {}
_lock = threading.Lock()


def _audience(url: str) -> str | None:
    parts = urlsplit(url)
    if SERVICE_AUTH != "google-id-token" or not (parts.hostname or "").endswith(".run.app"):
        return None
    return f"{parts.scheme}://{parts.netloc}"


def auth_headers(url: str) -> dict[str, str]:
    audience = _audience(url)
    if audience is None:
        return {}

    import google.auth.transport.requests
    from google.oauth2 import id_token

    request = google.auth.transport.requests.Request()
    # One lock for fetch and refresh: pipeline threads share credentials, and a refresh is a
    # network call at most once an hour per service.
    with _lock:
        credentials = _credentials.get(audience)
        if credentials is None:
            credentials = id_token.fetch_id_token_credentials(audience, request=request)
            _credentials[audience] = credentials
        if not credentials.valid:
            credentials.refresh(request)
        return {"Authorization": f"Bearer {credentials.token}"}


def mcp_http_client_factory(url: str):
    """An `httpx_client_factory` for an McpToolset whose server is `url`: every MCP request
    gets auth_headers(url) as it is sent.

    ADK's `header_provider` is not enough. McpToolset only calls it when it has a context, and
    the A2A agent card and `adk web` list tools without one, so those requests went out with no
    token and the card silently lost the toolset's skills."""
    import asyncio

    import httpx
    from google.adk.tools.mcp_tool.mcp_session_manager import create_mcp_http_client

    class IdTokenAuth(httpx.Auth):
        async def async_auth_flow(self, request):
            # A token refresh is blocking I/O; keep it off the event loop.
            request.headers.update(await asyncio.to_thread(auth_headers, url))
            yield request

    signing = IdTokenAuth() if _audience(url) else None

    def factory(headers=None, timeout=None, auth=None):
        return create_mcp_http_client(headers=headers, timeout=timeout, auth=auth or signing)

    return factory
