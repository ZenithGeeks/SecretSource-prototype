"""HTTP clients for the retrieval services.

Each service offers the same tools twice: plain HTTP under /api (used here) and MCP
under /mcp (used by the agents). The pipeline uses HTTP because it wants typed results
and no session handshake in a hot loop.

Files travel with the request (/api/upload, /api/upload_figures), not as paths. A path
only means the same thing on both sides under the compose bind-mount; the service may
be on another machine or on Cloud Run.
"""

import json
from contextlib import ExitStack
from pathlib import Path

import requests

from app.clients.service_auth import auth_headers
from app.config import COLBERT_URL, COLPALI_URL


def _detail(response: requests.Response) -> str:
    try:
        return response.json().get("detail", response.text)
    except ValueError:
        return response.text


def _pdf(path: str, handle) -> dict:
    return {"file": (Path(path).name, handle, "application/pdf")}


def colbert_search(query: str, k: int = 10) -> list[dict]:
    response = requests.post(
        f"{COLBERT_URL}/api/search",
        json={"query": query, "k": k},
        headers=auth_headers(COLBERT_URL),
        timeout=120,
    )
    response.raise_for_status()
    return response.json()["topk"]


def colbert_add(path: str) -> dict:
    """Index one PDF. Safe to run twice: re-adding replaces the paper's passages."""
    with open(path, "rb") as pdf:
        response = requests.post(
            f"{COLBERT_URL}/api/upload", files=_pdf(path, pdf), headers=auth_headers(COLBERT_URL), timeout=600
        )
    if not response.ok:
        return {"status": "error", "message": _detail(response), "reason": "indexing-failed"}
    return {"status": "ok", **response.json()}


def colpali_available() -> bool:
    try:
        requests.get(f"{COLPALI_URL}/health", headers=auth_headers(COLPALI_URL), timeout=5).raise_for_status()
        return True
    except Exception:
        return False


def colpali_add_pdf(path: str) -> None:
    with open(path, "rb") as pdf:
        requests.post(
            f"{COLPALI_URL}/api/upload", files=_pdf(path, pdf), headers=auth_headers(COLPALI_URL), timeout=600
        )


def colpali_add_figures(source: str, title: str, figures: list[dict]) -> None:
    """Send the crops along with their metadata; the service matches them by file name."""
    with ExitStack() as open_files:
        images = []
        for figure in figures:
            handle = open_files.enter_context(open(figure["image"], "rb"))
            images.append(("images", (Path(figure["image"]).name, handle, "image/png")))
        requests.post(
            f"{COLPALI_URL}/api/upload_figures",
            data={"source": source, "title": title, "figures": json.dumps(figures)},
            files=images,
            headers=auth_headers(COLPALI_URL),
            timeout=600,
        )


def colpali_search(query: str, k: int = 20) -> dict:
    response = requests.post(
        f"{COLPALI_URL}/api/search",
        json={"query": query, "k": k},
        headers=auth_headers(COLPALI_URL),
        timeout=60,
    )
    response.raise_for_status()
    return response.json()
