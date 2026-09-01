"""HTTP clients for the retrieval services.

Each service exposes the same contract twice: plain HTTP under /api (used here, and by
dspy.ColBERTv2) and MCP under /mcp (used by the agents). The pipeline calls HTTP because
it wants typed results and no session handshake in a hot loop.
"""

import requests

from app.config import COLBERT_URL, COLPALI_URL


def colbert_search(query: str, k: int = 10) -> list[dict]:
    response = requests.post(f"{COLBERT_URL}/api/search", json={"query": query, "k": k}, timeout=120)
    response.raise_for_status()
    return response.json()["topk"]


def colbert_add(path: str) -> dict:
    """Index one PDF. Idempotent: re-adding replaces the paper's passages."""
    response = requests.post(f"{COLBERT_URL}/api/add", json={"path": path}, timeout=600)
    if not response.ok:
        return {"status": "error", "message": response.json().get("detail", response.text)}
    return {"status": "ok", **response.json()}


def colpali_available() -> bool:
    try:
        requests.get(f"{COLPALI_URL}/health", timeout=5).raise_for_status()
        return True
    except Exception:
        return False


def colpali_add_pdf(path: str) -> None:
    requests.post(f"{COLPALI_URL}/api/add", json={"path": path}, timeout=600)


def colpali_add_figures(source: str, title: str, figures: list[dict]) -> None:
    requests.post(
        f"{COLPALI_URL}/api/add_figures",
        json={"source": source, "title": title, "figures": figures},
        timeout=600,
    )


def colpali_search(query: str, k: int = 20) -> dict:
    response = requests.post(f"{COLPALI_URL}/api/search", json={"query": query, "k": k}, timeout=60)
    response.raise_for_status()
    return response.json()
