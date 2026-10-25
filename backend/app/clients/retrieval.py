"""HTTP clients for the retrieval services.

Each service offers the same tools twice: plain HTTP under /api (used here) and MCP
under /mcp (used by the agents). The pipeline uses HTTP. It wants typed results and
no session handshake in a hot loop.

Files go with the request (/api/upload, /api/upload_figures), not as paths. A path
means the same thing on both sides only under the compose bind-mount. The service may
be on another machine or on Cloud Run.
"""

import hashlib
import json
import threading
import time
from collections.abc import Collection
from contextlib import ExitStack
from pathlib import Path

import requests
from openinference.semconv.trace import DocumentAttributes, OpenInferenceSpanKindValues, SpanAttributes
from opentelemetry import trace
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.clients.cloud_run import uploadable
from app.clients.service_auth import auth_headers
from app.config import COLBERT_URL, COLPALI_URL

# A no-op until app/tracing.py registers Phoenix in this process.
tracer = trace.get_tracer(__name__)

# A library search can ask for 100 hits. Copying every one onto the span would put
# other people's passages on the trace, and a Phoenix Cloud endpoint sends that span
# off the machine. Ten covers what an answer keeps.
MAX_TRACED_DOCUMENTS = 10

# One session for every call, so connections to Cloud Run are reused instead of a new TLS
# handshake each time. One retry for a refused connection or a 502/503/504, which is what a
# scaling or restarting instance returns. Never on a read timeout: an upload can take 900 s,
# and retrying it would double the wait. POST is listed because urllib3 skips it by default;
# requests builds the multipart body in memory, so a retry resends the whole file.
RETRY = Retry(
    total=1, connect=1, read=0, status=1, backoff_factor=1,
    status_forcelist=(502, 503, 504), allowed_methods=frozenset({"GET", "POST"}),
    raise_on_status=False,
)
_session = requests.Session()
_session.mount("https://", HTTPAdapter(max_retries=RETRY, pool_maxsize=16))
_session.mount("http://", HTTPAdapter(max_retries=RETRY, pool_maxsize=16))


def _detail(response: requests.Response) -> str:
    try:
        return response.json().get("detail", response.text)
    except ValueError:
        return response.text


def _pdf(path: str, handle) -> dict:
    return {"file": (Path(path).name, handle, "application/pdf")}


def _retriever_span(name: str, query: str, source: str | None):
    """A Phoenix RETRIEVER span for one search, so a trace shows the query and what came back."""
    attributes = {
        SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.RETRIEVER.value,
        SpanAttributes.INPUT_VALUE: query,
        "retrieval.source": source or "",
    }
    return tracer.start_as_current_span(name, attributes=attributes)


def _papers_we_may_trace(
    source: str | None,
    sources: Collection[str] | None,
    visible: Collection[str] | None,
) -> frozenset[str] | None:
    """Papers whose text and file names may be copied onto a span, or None when the caller
    named no scope.

    A search limited to `source` or `sources` may record those papers. `visible` is the same
    allowlist for a caller that still searches a wider index and filters afterwards. With
    none of them, the caller has not said which papers they may read.
    """
    if source is not None:
        return frozenset({source})
    if sources is not None:
        return frozenset(sources)
    if visible is not None:
        return frozenset(visible)
    return None


def _opaque_document_id(name: str, page) -> str:
    """An id that is not the file name. An unscoped span must not record someone else's."""
    digest = hashlib.sha256(name.encode()).hexdigest()[:16]
    return f"sha256:{digest} p{page}"


def _record_hits(span: trace.Span, hits: list[dict], allowed: frozenset[str] | None) -> None:
    """Put the hits the caller may read on the span, at most MAX_TRACED_DOCUMENTS of them.

    Phoenix lists retrieval documents in rank order. Passage text, figure captions and file
    names are copied only for `allowed` papers; any other hit stays off the span entirely.
    When `allowed` is None the caller named no scope, so the span gets a hash in place of
    the file name, and the score, and never the passage text.
    """
    if not span.is_recording():
        return
    recorded = 0
    for hit in hits:
        if recorded >= MAX_TRACED_DOCUMENTS:
            break
        name = str(hit.get("source") or "")
        if allowed is not None and name not in allowed:
            continue
        prefix = f"{SpanAttributes.RETRIEVAL_DOCUMENTS}.{recorded}."
        page = hit.get("page", "")
        if allowed is None:
            span.set_attribute(prefix + DocumentAttributes.DOCUMENT_ID, _opaque_document_id(name, page))
        else:
            span.set_attribute(prefix + DocumentAttributes.DOCUMENT_ID, f"{name} p{page}")
            # ColPali hits are figures and pages: their text is the caption, when there is one.
            text = hit.get("text") or hit.get("caption") or ""
            span.set_attribute(prefix + DocumentAttributes.DOCUMENT_CONTENT, text)
        if "score" in hit:
            span.set_attribute(prefix + DocumentAttributes.DOCUMENT_SCORE, float(hit["score"]))
        recorded += 1


def _kept(hits: list[dict], scope: frozenset[str] | None) -> list[dict]:
    """Hits whose paper is in `scope`. None leaves the list as the service returned it."""
    if scope is None:
        return hits
    return [hit for hit in hits if hit.get("source") in scope]


def colbert_search(
    query: str,
    k: int = 10,
    source: str | None = None,
    *,
    sources: Collection[str] | None = None,
    visible: Collection[str] | None = None,
) -> list[dict]:
    """Passages for `query`. `source` or `sources` limits the search to those papers.

    An empty `sources` returns nothing and does not search: that is a caller with no papers,
    and the alternative would be the whole index. `visible` does not change the request. It
    is the set of papers whose text a span may copy when the search itself is wider.
    """
    if sources is not None and len(sources) == 0:
        return []
    body = {"query": query, "k": k}
    if source is not None:
        body["source"] = source
    if sources is not None:
        body["sources"] = sorted(sources)
    if source is not None and sources is not None:
        scope = frozenset({source}) & frozenset(sources)
    elif source is not None:
        scope = frozenset({source})
    elif sources is not None:
        scope = frozenset(sources)
    else:
        scope = None
    allowed = scope if scope is not None else _papers_we_may_trace(source, sources, visible)
    with _retriever_span("colbert_search", query, source) as span:
        response = _session.post(
            f"{COLBERT_URL}/api/search",
            json=body,
            headers=auth_headers(COLBERT_URL),
            timeout=120,
        )
        response.raise_for_status()
        hits = _kept(response.json()["topk"], scope)
        _record_hits(span, hits, allowed)
    return hits


def colbert_add(path: str) -> dict:
    """Index one PDF. Safe to run again: re-adding replaces the paper's passages."""
    with uploadable(Path(path)) as upload, open(upload, "rb") as pdf:
        response = _session.post(
            f"{COLBERT_URL}/api/upload", files=_pdf(path, pdf), headers=auth_headers(COLBERT_URL), timeout=900
        )
    if not response.ok:
        # The service answered; only a timeout or a dropped connection is worth a retry.
        return {"status": "error", "message": _detail(response), "reason": "indexing-failed",
                "retryable": False}
    return {"status": "ok", **response.json()}


HEALTH_TTL = 30  # seconds
_health: dict = {"at": float("-inf"), "ok": False}
_health_lock = threading.Lock()


def colpali_available() -> bool:
    """Whether ColPali answers, remembered for HEALTH_TTL. It is asked before every index and
    search, and each ask was a round trip that also woke a scaled-to-zero GPU instance."""
    with _health_lock:
        if time.monotonic() - _health["at"] < HEALTH_TTL:
            return _health["ok"]
    try:
        _session.get(f"{COLPALI_URL}/health", headers=auth_headers(COLPALI_URL), timeout=5).raise_for_status()
        ok = True
    except Exception:
        ok = False
    with _health_lock:
        _health.update(at=time.monotonic(), ok=ok)
    return ok


def colpali_add_pdf(path: str) -> None:
    with open(path, "rb") as pdf:
        response = _session.post(
            f"{COLPALI_URL}/api/upload", files=_pdf(path, pdf), headers=auth_headers(COLPALI_URL), timeout=600
        )
    response.raise_for_status()


def colpali_add_figures(source: str, title: str, figures: list[dict]) -> None:
    """Send the crops with their metadata. The service matches them by file name."""
    with ExitStack() as open_files:
        images = []
        for figure in figures:
            handle = open_files.enter_context(open(figure["image"], "rb"))
            images.append(("images", (Path(figure["image"]).name, handle, "image/png")))
        response = _session.post(
            f"{COLPALI_URL}/api/upload_figures",
            data={"source": source, "title": title, "figures": json.dumps(figures)},
            files=images,
            headers=auth_headers(COLPALI_URL),
            timeout=600,
        )
    response.raise_for_status()


def colpali_search(
    query: str, k: int = 20, source: str | None = None, *, visible: Collection[str] | None = None
) -> dict:
    body = {"query": query, "k": k}
    if source is not None:
        body["source"] = source
    with _retriever_span("colpali_search", query, source) as span:
        response = _session.post(
            f"{COLPALI_URL}/api/search",
            json=body,
            headers=auth_headers(COLPALI_URL),
            timeout=60,
        )
        response.raise_for_status()
        result = response.json()
        _record_hits(span, result["topk"], _papers_we_may_trace(source, None, visible))
    return result
