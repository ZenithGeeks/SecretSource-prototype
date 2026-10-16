"""find_doi: whether a cited DOI names a real work, from Crossref and then OpenAlex (#421).

requests.get is replaced by a table of answers, so nothing leaves the machine. The store is a
temp SQLite file, because config.py loads the repo's .env and a found record is cached.
"""

import pytest
import requests
from app.pipeline import indexes

DOI = "10.1162/tacl.a.729"
CROSSREF_WORK = {
    "message": {
        "title": ["KisMATH: Do LLMs Have Knowledge of Implicit Structures"],
        "issued": {"date-parts": [[2026, 2]]},
        "author": [{"family": "Saha", "given": "Soumadeep"}],
    }
}
OPENALEX_WORK = {
    "title": "KisMATH: Do LLMs Have Knowledge of Implicit Structures",
    "publication_year": 2026,
    "authorships": [{"author": {"display_name": "Soumadeep Saha"}}],
}


class Answer:
    def __init__(self, status: int, payload: dict | None = None):
        self.status_code = status
        self.ok = status < 400
        self.payload = payload or {}

    def json(self):
        return self.payload


@pytest.fixture
def answers(monkeypatch, tmp_path):
    """Make requests.get answer from `table`: index name -> Answer, or an exception to raise."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    table: dict[str, object] = {}
    asked: list[str] = []

    def get(url, **kwargs):
        name = "crossref" if "crossref" in url else "openalex"
        asked.append(name)
        answer = table[name]
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(requests, "get", get)
    return table, asked


def test_a_doi_crossref_knows_is_found_with_one_call(answers):
    table, asked = answers
    table["crossref"] = Answer(200, CROSSREF_WORK)

    record = indexes.find_doi(DOI)

    assert record == indexes.IndexRecord(
        title="KisMATH: Do LLMs Have Knowledge of Implicit Structures",
        year=2026,
        first_author="Saha",
        index="crossref",
    )
    assert asked == ["crossref"]


def test_openalex_is_asked_when_crossref_has_no_record(answers):
    table, asked = answers
    table["crossref"] = Answer(404)
    table["openalex"] = Answer(200, OPENALEX_WORK)

    record = indexes.find_doi(DOI)

    assert (record.index, record.year, record.first_author) == ("openalex", 2026, "Saha")
    assert asked == ["crossref", "openalex"]


def test_a_doi_neither_index_knows_is_none(answers):
    table, _ = answers
    table["crossref"] = Answer(404)
    table["openalex"] = Answer(404)

    assert indexes.find_doi("10.9999/this.does.not.exist") is None


def test_an_unreachable_index_is_not_taken_for_not_found(answers):
    table, _ = answers
    table["crossref"] = requests.ConnectionError("no route to host")
    table["openalex"] = Answer(404)

    with pytest.raises(indexes.IndexUnavailable, match="no route to host"):
        indexes.find_doi(DOI)


def test_one_index_failing_does_not_hide_the_other_finding_it(answers):
    table, _ = answers
    table["crossref"] = Answer(503)
    table["openalex"] = Answer(200, OPENALEX_WORK)

    assert indexes.find_doi(DOI).index == "openalex"


def test_a_found_record_is_cached(answers):
    table, asked = answers
    table["crossref"] = Answer(200, CROSSREF_WORK)

    first = indexes.find_doi(DOI)
    second = indexes.find_doi(DOI.upper())

    assert first == second
    assert asked == ["crossref"]
