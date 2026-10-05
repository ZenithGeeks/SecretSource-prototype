"""The per-owner index on the gateway's analyses, and the per-owner caches built on it (#314)."""

import random

import pytest
from app import main
from app.analysis_table import AnalysisTable


def _row(analysis_id, owner, status="done", stages=1):
    return {"id": analysis_id, "owner": owner, "status": status, "stages": [{}] * stages}


def _scan(table, owner):
    """What visible_to returned before the index: a scan of every row."""
    return [row for row in table.values() if row.get("owner") == owner]


def test_owned_by_matches_a_full_scan_through_any_sequence_of_changes():
    rng = random.Random(314)
    table = AnalysisTable()
    owners = ["a", "b", "c", None]
    for _ in range(3000):
        analysis_id = f"id{rng.randrange(40)}"
        op = rng.randrange(8)
        if op <= 2:
            table[analysis_id] = _row(analysis_id, rng.choice(owners))
        elif op == 3:
            table.pop(analysis_id, None)
        elif op == 4 and analysis_id in table:
            del table[analysis_id]
        elif op == 5:
            table.update({analysis_id: _row(analysis_id, rng.choice(owners))})
        elif op == 6:
            table |= {analysis_id: _row(analysis_id, rng.choice(owners))}
        elif table and rng.random() < 0.05:
            table.popitem()
        for owner in owners:
            assert table.owned_by(owner) == _scan(table, owner)
    table.clear()
    assert all(table.owned_by(owner) == [] for owner in owners)


def test_a_replaced_row_keeps_its_place_and_rows_stay_oldest_first():
    table = AnalysisTable()
    for analysis_id in ("x", "y", "z"):
        table[analysis_id] = _row(analysis_id, "a")
    table["x"] = _row("x", "a", stages=5)  # a worker snapshot of the oldest run
    assert [row["id"] for row in table.owned_by("a")] == ["x", "y", "z"]
    assert table.owned_by("a")[0]["stages"] == [{}] * 5


def test_setdefault_indexes_the_row_it_inserts():
    table = AnalysisTable()
    table.setdefault("x", _row("x", "a"))
    table.setdefault("x", _row("x", "b"))
    assert [row["id"] for row in table.owned_by("a")] == ["x"]
    assert table.owned_by("b") == []


@pytest.fixture
def gateway(monkeypatch):
    main.analyses.clear()
    main._derived.clear()
    # papers_of also reads the Author role's rows from the store; none here unless a test adds them.
    monkeypatch.setattr(main, "author_pdfs", lambda user: set())
    yield main
    main.analyses.clear()
    main._derived.clear()


def _paper(analysis_id, owner, file, sources=()):
    claims = [{"claim": "c", "verdicts": [{"source": source} for source in sources]}]
    return {**_row(analysis_id, owner), "file": file, "claims": claims}


def test_papers_of_is_built_once_until_one_of_the_owners_rows_changes(gateway, monkeypatch):
    builds = []
    real = gateway._paper_names
    monkeypatch.setattr(gateway, "_paper_names", lambda rows: builds.append(1) or real(rows))
    gateway.analyses["p1"] = _paper("p1", "a", "papers/one.pdf", ["papers/cited.pdf"])
    gateway.analyses["q1"] = _paper("q1", "b", "papers/theirs.pdf")

    assert gateway.papers_of("a") == {"one.pdf", "cited.pdf"}
    assert gateway.papers_of("a") == {"one.pdf", "cited.pdf"}
    assert len(builds) == 1

    # Another owner's change leaves this owner's cache alone.
    gateway.analyses["q2"] = _paper("q2", "b", "papers/more.pdf")
    gateway.papers_of("a")
    assert len(builds) == 1

    gateway.analyses["p2"] = _paper("p2", "a", "papers/two.pdf")
    assert gateway.papers_of("a") == {"one.pdf", "cited.pdf", "two.pdf"}
    gateway.analyses.pop("p1")
    assert gateway.papers_of("a") == {"two.pdf"}
    assert len(builds) == 3


def test_papers_of_sees_a_row_that_changed_in_place(gateway):
    row = {**_paper("p1", "a", "papers/one.pdf"), "status": "running"}
    gateway.analyses["p1"] = row
    assert gateway.papers_of("a") == {"one.pdf"}
    # A check finishing in this process folds a verdict in, then publishes its stage.
    row["claims"][0]["verdicts"].append({"source": "papers/cited.pdf"})
    row["stages"].append({"stage": "verified"})
    assert gateway.papers_of("a") == {"one.pdf", "cited.pdf"}


def test_papers_of_sees_an_author_pdf_added_after_it_was_cached(gateway, monkeypatch):
    """Author PDFs are stored outside `analyses`, so the per-owner cache cannot see them change."""
    author = set()
    monkeypatch.setattr(gateway, "author_pdfs", lambda user: set(author))
    gateway.analyses["p1"] = _paper("p1", "a", "papers/one.pdf")
    assert gateway.papers_of("a") == {"one.pdf"}
    author.add("draft-source.pdf")
    assert gateway.papers_of("a") == {"one.pdf", "draft-source.pdf"}


def test_the_graph_is_rebuilt_when_a_paper_is_indexed_after_it_finished(gateway, monkeypatch):
    builds = []
    monkeypatch.setattr(
        gateway.researcher, "graph", lambda rows: builds.append(len(rows)) or {"n": len(builds)}
    )
    row = _paper("p1", "a", "papers/one.pdf")
    gateway.analyses["p1"] = row

    first = gateway._per_owner("graph", "a", gateway.researcher.graph)
    assert gateway._per_owner("graph", "a", gateway.researcher.graph) is first
    row["indexed_in"] = {"index": "openalex"}  # _index_self, after "done", no new stage
    assert gateway._per_owner("graph", "a", gateway.researcher.graph) is not first
    assert builds == [1, 1]
