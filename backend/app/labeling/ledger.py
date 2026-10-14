"""Where the labeling rows are kept: the `labeling_rows` table in Supabase.

Rows are only appended; a later row for the same key replaces an earlier one when the tab is read
back (schema.current). The CSV export is made from these rows on request, so there is no file to
keep in step. Values are stored as strings, the way the page and the export read them.
"""

from typing import Protocol

from app import auth
from app.labeling.schema import ALL_TABS

TABLE = "labeling_rows"
PAGE = 1000  # the most rows Supabase returns for one request


class NotConfigured(Exception):
    """Supabase is not set up, so there is nowhere to save."""


class Store(Protocol):
    def read(self, tab: str, paper_id: str | None = None) -> list[dict]: ...

    def append(self, tab: str, rows: list[dict]) -> None: ...


class Ledger:
    def _table(self):
        from app import store

        return store._supabase().table(TABLE)

    def read(self, tab: str, paper_id: str | None = None) -> list[dict]:
        """Every row of a tab, or only those of one paper (an indexed filter on the JSON field)."""
        found: list[dict] = []
        while True:
            query = self._table().select("data").eq("tab", tab)
            if paper_id is not None:
                query = query.eq("data->>paper_id", paper_id)
            page = query.order("id").range(len(found), len(found) + PAGE - 1).execute().data
            found += [row["data"] for row in page]
            if len(page) < PAGE:
                return found

    def append(self, tab: str, rows: list[dict]) -> None:
        if not rows:
            return
        columns = ALL_TABS[tab]
        self._table().insert(
            [
                {"tab": tab, "data": {c: "" if row.get(c) is None else str(row[c]) for c in columns}}
                for row in rows
            ]
        ).execute()


_store: Store | None = None


def get_store() -> Store:
    """The Supabase ledger, or NotConfigured. Tests replace this with an in-memory store."""
    global _store
    if _store is None:
        if not auth._supabase_configured():
            raise NotConfigured("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        _store = Ledger()
    return _store
