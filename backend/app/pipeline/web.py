"""Read bounded, public static HTML pages as citable web evidence.

This is intentionally a page reader rather than a crawler or browser. It follows a small
number of HTTP redirects, rejects non-public destinations, and returns paragraph text with
stable URL/anchor locations so callers never mistake a web page for a paper PDF.
"""

import ipaddress
import socket
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests

from app.pipeline.sources import USER_AGENT

MAX_REDIRECTS = 5
MAX_BYTES = 2_000_000
MAX_PDF_BYTES = 50_000_000
TIMEOUT = (5, 15)
MAX_PARAGRAPHS = 500


class WebReadError(ValueError):
    """A stable, user-safe reason a web page could not be read."""

    def __init__(self, outcome: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.outcome = outcome
        self.retryable = retryable


@dataclass(frozen=True)
class WebPassage:
    text: str
    locator: str
    paragraph: int


@dataclass(frozen=True)
class WebPage:
    title: str
    url: str
    retrieved_at: str
    passages: tuple[WebPassage, ...]


@dataclass(frozen=True)
class WebResource:
    url: str
    content_type: str
    encoding: str
    body: bytes


class _PageParser(HTMLParser):
    BLOCKS = {"blockquote", "li", "p", "pre", "td", "th", "h1", "h2", "h3", "h4"}
    SKIP = {"script", "style", "noscript", "svg", "template", "nav", "footer", "header"}

    def __init__(self, page_url: str):
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.title = ""
        self.canonical = ""
        self.passages: list[WebPassage] = []
        self._title = False
        self._skip = 0
        self.has_interaction = False
        self._stack: list[tuple[str, str, list[str]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs)
        if tag == "title":
            self._title = True
        if tag in {"form", "input", "button", "select", "textarea"}:
            self.has_interaction = True
        if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split():
            self.canonical = attrs.get("href") or ""
        if tag in self.SKIP:
            self._skip += 1
        if tag in self.BLOCKS:
            self._stack.append((tag, attrs.get("id") or attrs.get("name") or "", []))
        if self._skip and tag in self.BLOCKS and self._stack:
            self._stack[-1][2].clear()

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._title = False
        if tag in self.SKIP and self._skip:
            self._skip -= 1
        if tag in self.BLOCKS:
            for index in range(len(self._stack) - 1, -1, -1):
                if self._stack[index][0] == tag:
                    _, anchor, chunks = self._stack.pop(index)
                    text = " ".join(" ".join(chunks).split())
                    if len(text) >= 40 and len(self.passages) < MAX_PARAGRAPHS:
                        base = self.page_url
                        if anchor and all(ch.isalnum() or ch in "-_:." for ch in anchor):
                            base += f"#{anchor}"
                        normalized = unicodedata.normalize("NFKC", text)[:4000]
                        self.passages.append(WebPassage(normalized, base, len(self.passages) + 1))
                    break

    def handle_data(self, data: str) -> None:
        if self._title:
            self.title += data
        if not self._skip:
            for _, _, chunks in self._stack:
                chunks.append(data)


def _public_http_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        raise WebReadError("unsupported-url", "only HTTP and HTTPS web pages are supported")
    if parts.username or parts.password:
        raise WebReadError("unsupported-url", "URLs containing credentials are not supported")
    host = parts.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise WebReadError("blocked", "the page resolves to a non-public destination")
    try:
        addresses = {
            ipaddress.ip_address(item[4][0].split("%", 1)[0])
            for item in socket.getaddrinfo(
                host, parts.port or (443 if parts.scheme == "https" else 80), type=socket.SOCK_STREAM
            )
        }
    except (OSError, ValueError) as error:
        raise WebReadError(
            "temporary-failure", "the page host could not be resolved", retryable=True
        ) from error
    if not addresses or any(not address.is_global for address in addresses):
        raise WebReadError("blocked", "the page resolves to a non-public destination")
    clean = parts._replace(fragment="")
    return urlunsplit(clean)


def fetch_resource(url: str) -> WebResource:
    """Fetch one public HTTP resource, bounding redirects and the downloaded response body."""
    current = _public_http_url(url)
    for redirect in range(MAX_REDIRECTS + 1):
        try:
            response = requests.get(
                current, headers=USER_AGENT, timeout=TIMEOUT, stream=True, allow_redirects=False
            )
        except requests.Timeout as error:
            raise WebReadError(
                "temporary-failure", "the web page request timed out", retryable=True
            ) from error
        except requests.RequestException as error:
            raise WebReadError("fetch-failed", "the web page could not be fetched", retryable=True) from error
        try:
            if response.is_redirect or response.is_permanent_redirect:
                if redirect == MAX_REDIRECTS:
                    raise WebReadError("redirect-limit", "the page redirected too many times")
                target = response.headers.get("Location")
                if not target:
                    raise WebReadError("http-error", "the page returned an invalid redirect")
                current = _public_http_url(urljoin(current, target))
                continue
            if response.status_code in {401, 403}:
                raise WebReadError("blocked", "the page requires access that is not available")
            if response.status_code >= 500 or response.status_code == 429:
                raise WebReadError(
                    "temporary-failure",
                    f"the page server returned HTTP {response.status_code}",
                    retryable=True,
                )
            if not response.ok:
                raise WebReadError("http-error", f"the page returned HTTP {response.status_code}")
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            limit = MAX_BYTES if content_type in {"text/html", "application/xhtml+xml"} else MAX_PDF_BYTES
            declared_size = response.headers.get("Content-Length")
            if declared_size and declared_size.isdigit() and int(declared_size) > limit:
                raise WebReadError(
                    "too-large", f"the response exceeded the {limit // 1_000_000} MB read limit"
                )
            size = 0
            chunks = []
            for chunk in response.iter_content(64 * 1024):
                size += len(chunk)
                if size > limit:
                    raise WebReadError(
                        "too-large", f"the response exceeded the {limit // 1_000_000} MB read limit"
                    )
                chunks.append(chunk)
            return WebResource(current, content_type, response.encoding or "utf-8", b"".join(chunks))
        finally:
            response.close()
    raise WebReadError("redirect-limit", "the page redirected too many times")


def page_from_resource(resource: WebResource) -> WebPage:
    """Extract a static HTML/XHTML document already fetched by `fetch_resource`."""
    if resource.content_type not in {"text/html", "application/xhtml+xml"}:
        raise WebReadError("not-html", "the URL did not return HTML or XHTML")
    from app.pipeline.sources import _safe_locator

    safe_page_url = _safe_locator(resource.url)
    parser = _PageParser(safe_page_url)
    parser.feed(resource.body.decode(resource.encoding, errors="replace"))
    passages = tuple(parser.passages)
    if not passages:
        outcome = "dynamic" if parser.has_interaction else "empty"
        message = (
            "the page requires scripts or interaction to reveal its text"
            if parser.has_interaction
            else "the page did not contain readable static text"
        )
        raise WebReadError(outcome, message)
    canonical = (
        _safe_locator(_public_http_url(urljoin(resource.url, parser.canonical)))
        if parser.canonical
        else safe_page_url
    )
    return WebPage(
        " ".join(parser.title.split())[:300],
        canonical,
        datetime.now(UTC).isoformat(timespec="seconds"),
        passages,
    )


def read_page(url: str) -> WebPage:
    """Fetch and extract a static HTML page, refusing unsafe redirects and unbounded bodies."""
    return page_from_resource(fetch_resource(url))
