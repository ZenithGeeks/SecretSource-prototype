"""HTTP clients for the retrieval services.

Each service offers the same tools twice: plain HTTP under /api (used here) and MCP
under /mcp (used by the agents). The pipeline uses HTTP. It wants typed results and
no session handshake in a hot loop.

Files go with the request (/api/upload, /api/upload_figures), not as paths. A path
means the same thing on both sides only under the compose bind-mount. The service may
be on another machine or on Cloud Run.
"""

import json
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.clients.service_auth import auth_headers
from app.config import COLBERT_URL, COLPALI_URL

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
# Cloud Run refuses a request body over 32 MiB with HTTP 413. The ColBERT service reads only
# the text of an upload (pypdf, page by page), so a copy without the images indexes the same
# passages: DiffiT's 43.4 MiB arXiv PDF becomes 0.7 MiB with the same text on all 31 pages.
UPLOAD_LIMIT_BYTES = 32 * 2**20
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


def colbert_search(query: str, k: int = 10, source: str | None = None) -> list[dict]:
    body = {"query": query, "k": k}
    if source is not None:
        body["source"] = source
    response = _session.post(
        f"{COLBERT_URL}/api/search",
        json=body,
        headers=auth_headers(COLBERT_URL),
        timeout=120,
    )
    response.raise_for_status()
    return response.json()["topk"]


def colbert_add(path: str) -> dict:
    """Index one PDF. Safe to run again: re-adding replaces the paper's passages."""
    with _uploadable(Path(path)) as upload, open(upload, "rb") as pdf:
        response = _session.post(
            f"{COLBERT_URL}/api/upload", files=_pdf(path, pdf), headers=auth_headers(COLBERT_URL), timeout=900
        )
    if not response.ok:
        # The service answered; only a timeout or a dropped connection is worth a retry.
        return {"status": "error", "message": _detail(response), "reason": "indexing-failed",
                "retryable": False}
    return {"status": "ok", **response.json()}


@contextmanager
def _uploadable(pdf: Path) -> Iterator[Path]:
    """The PDF itself, or a copy without its images when it is over UPLOAD_LIMIT_BYTES. The
    upload keeps the original file name, so the passages are filed under the same source."""
    if pdf.stat().st_size <= UPLOAD_LIMIT_BYTES:
        yield pdf
        return
    import pymupdf

    with tempfile.TemporaryDirectory() as folder, pymupdf.open(pdf) as document:
        for page in document:
            for image in page.get_images(full=True):
                page.delete_image(image[0])
        copy = Path(folder) / pdf.name
        document.save(copy, garbage=4, deflate=True)
        yield copy


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


def colpali_search(query: str, k: int = 20, source: str | None = None) -> dict:
    body = {"query": query, "k": k}
    if source is not None:
        body["source"] = source
    response = _session.post(
        f"{COLPALI_URL}/api/search",
        json=body,
        headers=auth_headers(COLPALI_URL),
        timeout=60,
    )
    response.raise_for_status()
    return response.json()
