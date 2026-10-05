"""The one rule for "may this caller have this row": the row exists, this exact user owns it,
and it is the kind of row the route is for.

A row that is missing, someone else's, or of another kind is the same 404 (never a 403), so
an id tells nobody that it exists or what it is. app/main.py's analyses and checks and
app/author/router.py's drafts, projects, sources and draft checks all go through here, so a
fix to the rule lands once.
"""

from fastapi import HTTPException

# A row that predates the `kind` field is a paper analysis: nothing else existed then.
DEFAULT_KIND = "paper"


def require_owner(row: dict | None, user: str | None, what: str, kind: str | None = None) -> dict:
    """`row` if `user` owns it (and, when `kind` is given, it is that kind); else a 404 that
    reads "no such {what}"."""
    if row is None or row.get("owner") != user:
        raise HTTPException(404, f"no such {what}")
    if kind is not None and row.get("kind", DEFAULT_KIND) != kind:
        raise HTTPException(404, f"no such {what}")
    return row
