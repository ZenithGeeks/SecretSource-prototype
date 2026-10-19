"""The gateway's in-memory analyses, with each owner's ids kept beside them (#314).

Every request reads one user's analyses (visible_to, _owned, papers_of). A plain dict made
each of those scan every analysis of every user. This dict also records which ids belong to
which owner, so a request reads only the caller's own rows.

An analysis never changes owner, and every change to the dict goes through the methods
below, so the index cannot drift from the rows. Rows are listed oldest first, the same order
the dict itself keeps: replacing a row (a worker snapshot) keeps its place in both.
"""


class AnalysisTable(dict):
    def __init__(self):
        super().__init__()
        self._by_owner: dict[str | None, dict[str, None]] = {}
        # Owners whose stored rows have been merged in. clear() drops this with the rows, so a
        # test that empties the table also asks the store again next time.
        self._loaded: set[str | None] = set()

    def owned_by(self, owner: str | None) -> list[dict]:
        """This owner's analyses, oldest first. Rows with no owner (signed-out runs) are owner None."""
        return [self[analysis_id] for analysis_id in self._by_owner.get(owner, ())]

    def owner_loaded(self, owner: str | None) -> bool:
        return owner in self._loaded

    def mark_owner_loaded(self, owner: str | None) -> None:
        self._loaded.add(owner)

    def order_owner(self, owner: str | None, ordered_ids: list[str]) -> None:
        """Put this owner's ids in `ordered_ids` order. An id the table no longer has is skipped.
        An id that is indexed but missing from `ordered_ids` stays, at the end, so a reorder
        cannot drop a row."""
        current = self._by_owner.get(owner)
        if current is None:
            return
        ordered: dict[str, None] = {}
        for analysis_id in ordered_ids:
            if analysis_id in current:
                ordered[analysis_id] = None
        for analysis_id in current:
            if analysis_id not in ordered:
                ordered[analysis_id] = None
        self._by_owner[owner] = ordered

    def _unindex(self, analysis_id: str, analysis: dict) -> None:
        ids = self._by_owner.get(analysis.get("owner"))
        if ids is not None:
            ids.pop(analysis_id, None)
            if not ids:
                del self._by_owner[analysis.get("owner")]

    def __setitem__(self, analysis_id: str, analysis: dict) -> None:
        old = self.get(analysis_id)
        if old is not None and old.get("owner") != analysis.get("owner"):
            # Never happens in the gateway; if it did, the row is new to its owner, so it moves
            # to the end of the dict too and both orders still agree.
            del self[analysis_id]
        super().__setitem__(analysis_id, analysis)
        self._by_owner.setdefault(analysis.get("owner"), {})[analysis_id] = None

    def __delitem__(self, analysis_id: str) -> None:
        self._unindex(analysis_id, self[analysis_id])
        super().__delitem__(analysis_id)

    def pop(self, analysis_id: str, *default):
        if analysis_id in self:
            self._unindex(analysis_id, self[analysis_id])
        return super().pop(analysis_id, *default)

    def popitem(self):
        analysis_id, analysis = super().popitem()
        self._unindex(analysis_id, analysis)
        return analysis_id, analysis

    def setdefault(self, analysis_id: str, default: dict) -> dict:
        if analysis_id not in self:
            self[analysis_id] = default
        return self[analysis_id]

    def update(self, other=(), **kwargs) -> None:
        for analysis_id, analysis in dict(other, **kwargs).items():
            self[analysis_id] = analysis

    def __ior__(self, other):
        self.update(other)
        return self

    def clear(self) -> None:
        super().clear()
        self._by_owner.clear()
        self._loaded.clear()
