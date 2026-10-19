"""The gateway's in-memory analyses, with each owner's ids kept beside them (#314).

Every request reads one user's analyses (visible_to, _owned, papers_of). A plain dict made
each of those scan every analysis of every user. This dict also records which ids belong to
which owner, so a request reads only the caller's own rows.

An analysis never changes owner, and every change to the dict goes through the methods
below, so the index cannot drift from the rows. Rows are listed oldest first, the same order
the dict itself keeps: replacing a row (a worker snapshot) keeps its place in both.

A request thread and the event loop both touch this dict. Every read and write takes the
same lock, and a lookup returns a copy of the id list, so one side cannot change the dict's
size while the other is iterating it.
"""

import threading


class AnalysisTable(dict):
    def __init__(self, lock=None):
        super().__init__()
        # The gateway passes its own lock so a merge that does several of these calls holds it
        # once. A table built on its own (tests) gets a lock that nothing else shares.
        self._lock = lock if lock is not None else threading.RLock()
        self._by_owner: dict[str | None, dict[str, None]] = {}
        # Owners whose stored rows have been merged in. clear() drops this with the rows, so a
        # test that empties the table also asks the store again next time.
        self._loaded: set[str | None] = set()

    def owned_by(self, owner: str | None) -> list[dict]:
        """This owner's analyses, oldest first. Rows with no owner (signed-out runs) are owner None.

        The list is a copy taken under the lock. The caller can walk it while another thread
        inserts or deletes; the dicts in it are the rows themselves."""
        with self._lock:
            ids = self._by_owner.get(owner)
            if not ids:
                return []
            return [super().__getitem__(analysis_id) for analysis_id in ids]

    def owner_loaded(self, owner: str | None) -> bool:
        with self._lock:
            return owner in self._loaded

    def mark_owner_loaded(self, owner: str | None) -> None:
        with self._lock:
            self._loaded.add(owner)

    def order_owner(self, owner: str | None, ordered_ids: list[str]) -> None:
        """Put this owner's ids in `ordered_ids` order. An id the table no longer has is skipped.
        An id that is indexed but missing from `ordered_ids` stays, at the end, so a reorder
        cannot drop a row."""
        with self._lock:
            current = self._by_owner.get(owner)
            if current is None:
                return
            ordered: dict[str, None] = {}
            for analysis_id in ordered_ids:
                if analysis_id in current:
                    ordered[analysis_id] = None
            for analysis_id in list(current):
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
        with self._lock:
            old = super().get(analysis_id)
            if old is not None and old.get("owner") != analysis.get("owner"):
                # Never happens in the gateway; if it did, the row is new to its owner, so it moves
                # to the end of the dict too and both orders still agree.
                self._unindex(analysis_id, old)
                super().__delitem__(analysis_id)
            super().__setitem__(analysis_id, analysis)
            self._by_owner.setdefault(analysis.get("owner"), {})[analysis_id] = None

    def __delitem__(self, analysis_id: str) -> None:
        with self._lock:
            self._unindex(analysis_id, super().__getitem__(analysis_id))
            super().__delitem__(analysis_id)

    def __getitem__(self, analysis_id: str):
        with self._lock:
            return super().__getitem__(analysis_id)

    def __contains__(self, analysis_id: object) -> bool:
        with self._lock:
            return super().__contains__(analysis_id)

    def __len__(self) -> int:
        with self._lock:
            return super().__len__()

    def __iter__(self):
        with self._lock:
            ids = list(super().__iter__())
        return iter(ids)

    def get(self, analysis_id: str, default=None):
        with self._lock:
            return super().get(analysis_id, default)

    def keys(self):
        with self._lock:
            return list(super().keys())

    def values(self):
        """A snapshot. Iterating the live view raises if another thread inserts or deletes."""
        with self._lock:
            return list(super().values())

    def items(self):
        with self._lock:
            return list(super().items())

    def pop(self, analysis_id: str, *default):
        with self._lock:
            if super().__contains__(analysis_id):
                self._unindex(analysis_id, super().__getitem__(analysis_id))
            return super().pop(analysis_id, *default)

    def popitem(self):
        with self._lock:
            analysis_id, analysis = super().popitem()
            self._unindex(analysis_id, analysis)
            return analysis_id, analysis

    def setdefault(self, analysis_id: str, default: dict) -> dict:
        with self._lock:
            if not super().__contains__(analysis_id):
                self[analysis_id] = default
            return super().__getitem__(analysis_id)

    def update(self, other=(), **kwargs) -> None:
        with self._lock:
            for analysis_id, analysis in dict(other, **kwargs).items():
                self[analysis_id] = analysis

    def __ior__(self, other):
        self.update(other)
        return self

    def clear(self) -> None:
        with self._lock:
            super().clear()
            self._by_owner.clear()
            self._loaded.clear()
