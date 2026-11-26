"""Credentials for calls to the shared colbert, colpali and grobid services.

With SERVICE_AUTH=api-key, `auth_headers(url)` returns `apikey: <SERVICE_API_KEY>` for a
URL on the same origin as COLBERT_URL, COLPALI_URL or GROBID_URL. That is the team gateway
(APISIX key-auth) in front of the host's GPU services. The LLM does not use this module: its
key goes in VLLM_API_KEY.

For any other host it returns nothing, so credentials never go to a third-party LLM endpoint.
"""

from urllib.parse import urlsplit

from app.config import COLBERT_URL, COLPALI_URL, GROBID_URL, SERVICE_API_KEY, SERVICE_AUTH


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


# The only origins that get SERVICE_API_KEY.
_KEYED_ORIGINS = {_origin(url) for url in (COLBERT_URL, COLPALI_URL, GROBID_URL)}


def sends_key(url: str) -> bool:
    """Whether calls to this URL carry SERVICE_API_KEY."""
    return SERVICE_AUTH == "api-key" and _origin(url) in _KEYED_ORIGINS


def auth_headers(url: str) -> dict[str, str]:
    if sends_key(url):
        return {"apikey": SERVICE_API_KEY}
    return {}


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
            request.headers.update(await asyncio.to_thread(auth_headers, url))
            yield request

    signing = ServiceAuth() if sends_key(url) else None

    def factory(headers=None, timeout=None, auth=None):
        return create_mcp_http_client(headers=headers, timeout=timeout, auth=auth or signing)

    return factory
