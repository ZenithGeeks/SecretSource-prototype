"""Who labels which topic, and which analyses the team shares for labeling.

Both live in the `assignments` rows of the labeling table. A paper is
shared when its owner gives it a topic; only then can other signed-in people open it and its
cited papers. Reads are cached for a few seconds: the page-image route asks on every request.
"""

import logging
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime

from app.labeling import ledger
from app.labeling.schema import current

log = logging.getLogger(__name__)
TTL = 30.0

_lock = threading.Lock()
_cache: tuple[float, list[dict]] = (0.0, [])


def rows() -> list[dict]:
    """The current assignment rows. Empty when Supabase is not set up or cannot be read."""
    global _cache
    with _lock:
        if _cache[0] > time.monotonic():
            return _cache[1]
    try:
        found = current("assignments", ledger.get_store().read("assignments"))
    except ledger.NotConfigured:
        found = []
    except Exception:
        log.exception("could not read the labeling assignments")
        found = []
    with _lock:
        _cache = (time.monotonic() + TTL, found)
    return found


def pooled() -> dict[str, str]:
    """analysis id -> topic, for every analysis shared with the labeling team."""
    return {r["key"]: r["topic"] for r in rows() if r["kind"] == "paper" and r["topic"]}


def shared_by() -> dict[str, str]:
    """analysis id -> name of the person who shared it, for every shared analysis."""
    return {r["key"]: r.get("annotator", "") for r in rows() if r["kind"] == "paper" and r["topic"]}


def people() -> dict[str, str]:
    """person name -> topic, for everyone who has one."""
    return {r["key"]: r["topic"] for r in rows() if r["kind"] == "person" and r["topic"]}


def uploaded_dois() -> dict[str, str]:
    """analysis id -> DOI, for each shared paper whose PDF was uploaded by hand."""
    return {r["key"]: r["doi"] for r in rows() if r["kind"] == "paper" and r["topic"] and r.get("doi")}


def assign(who: str, kind: str, key: str, topic: str, owner: str = "", doi: str = "") -> None:
    """Record `who` giving a person or a paper a topic; "" takes it back.

    A later row replaces an earlier one for the same key, so a row without a DOI would lose the
    one the paper was uploaded with: when none is given, the earlier row's DOI is copied over.
    """
    global _cache
    if kind == "paper" and not doi:
        doi = next((r.get("doi", "") for r in rows() if r["kind"] == "paper" and r["key"] == key), "")
    row = {
        "ts": datetime.now(UTC).isoformat(timespec="seconds"),
        "annotator": who,
        "kind": kind,
        "key": key,
        "topic": topic,
        "owner": owner,
        "doi": doi,
    }
    ledger.get_store().append("assignments", [row])
    with _lock:
        _cache = (0.0, [])


def pdf_names(
    get: Callable[[str], dict | None], names_of: Callable[[list[dict]], frozenset[str]]
) -> frozenset[str]:
    """The PDFs of every shared analysis (the paper and the papers its claims cite), so the page
    viewer can open them for any signed-in person."""
    found = [row for row in (get(i) for i in pooled()) if row]
    return names_of(found) if found else frozenset()
