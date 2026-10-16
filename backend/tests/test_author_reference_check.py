"""reference_check: what a draft check adds to a citation from the indexes (#421).

find_doi is replaced, so nothing leaves the machine.
"""

from app.author import verify
from app.pipeline.indexes import IndexRecord, IndexUnavailable

FIELDS = {"doi": "10.1162/tacl.a.729", "year": "2026", "author": "Saha, Soumadeep"}


def test_a_doi_no_index_knows_may_be_made_up(monkeypatch):
    monkeypatch.setattr(verify, "find_doi", lambda doi: None)
    assert verify.reference_check(FIELDS) == {"exists": "no"}


def test_a_known_doi_reports_the_index_and_any_mismatch(monkeypatch):
    record = IndexRecord(title="KisMATH", year=2024, first_author="Saha", index="crossref")
    monkeypatch.setattr(verify, "find_doi", lambda doi: record)

    assert verify.reference_check(FIELDS) == {
        "exists": "yes",
        "index": "Crossref",
        "mismatches": ["year: the .bib says 2026, Crossref says 2024"],
    }


def test_an_index_outage_is_unknown_not_made_up(monkeypatch):
    def down(doi):
        raise IndexUnavailable("crossref: HTTP 503")

    monkeypatch.setattr(verify, "find_doi", down)
    assert verify.reference_check(FIELDS) == {"exists": "unknown"}


def test_an_entry_without_a_doi_is_not_looked_up(monkeypatch):
    def not_called(doi):
        raise AssertionError("an entry without a DOI was looked up")

    monkeypatch.setattr(verify, "find_doi", not_called)
    assert verify.reference_check({"title": "MS MARCO", "year": "2016"}) == {}


def test_any_lookup_error_is_unknown_and_does_not_fail_the_check(monkeypatch):
    def broken(doi):
        raise RuntimeError("the store is down")

    monkeypatch.setattr(verify, "find_doi", broken)
    assert verify.reference_check(FIELDS) == {"exists": "unknown"}


def test_after_an_outage_the_other_entries_are_not_asked(monkeypatch):
    asked = []

    def down(doi):
        asked.append(doi)
        raise IndexUnavailable("crossref: timed out")

    monkeypatch.setattr(verify, "find_doi", down)
    entries = {"a": {"doi": "10.1/a"}, "b": {"title": "no DOI"}, "c": {"doi": "10.1/c"}}

    assert verify.reference_checks(entries) == {"a": {"exists": "unknown"}, "c": {"exists": "unknown"}}
    assert asked == ["10.1/a"]
