"""Who labels which topic, and which analyses the team shares for labeling.

Both live in the Sheet's `assignments` tab, so the team sees and can fix them there. A paper is
shared when its owner gives it a topic; only then can other signed-in people open it and its
cited papers. Reads are cached for a few seconds: the page-image route asks on every request.
"""

import logging
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime

from app.labeling import sheet
from app.labeling.schema import current

log = logging.getLogger(__name__)
TTL = 30.0

_lock = threading.Lock()
_cache: tuple[float, list[dict]] = (0.0, [])


def rows() -> list[dict]:
    """The current assignment rows. Empty when the Sheet is not set up or cannot be read."""
    global _cache
    with _lock:
        if _cache[0] > time.monotonic():
            return _cache[1]
    try:
        found = current("assignments", sheet.get_store().read("assignments"))
    except sheet.NotConfigured:
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


def people() -> dict[str, str]:
    """person name -> topic, for everyone who has one."""
    return {r["key"]: r["topic"] for r in rows() if r["kind"] == "person" and r["topic"]}


def assign(who: str, kind: str, key: str, topic: str, owner: str = "") -> None:
    global _cache
    row = {
        "ts": datetime.now(UTC).isoformat(timespec="seconds"),
        "annotator": who,
        "kind": kind,
        "key": key,
        "topic": topic,
        "owner": owner,
    }
    sheet.get_store().append("assignments", [row])
    with _lock:
        _cache = (0.0, [])


def pdf_names(
    get: Callable[[str], dict | None], names_of: Callable[[list[dict]], frozenset[str]]
) -> frozenset[str]:
    """The PDFs of every shared analysis (the paper and the papers its claims cite), so the page
    viewer can open them for any signed-in person."""
    found = [row for row in (get(i) for i in pooled()) if row]
    return names_of(found) if found else frozenset()
