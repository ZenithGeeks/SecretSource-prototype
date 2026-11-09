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


# --- by title (#439) ----------------------------------------------------------------------

TITLE = "Deep learning"
GOODFELLOW_BOOK = {
    "title": ["Deep Learning"],
    "issued": {"date-parts": [[2016]]},
    "author": [{"family": "Goodfellow"}],
}
POLSON_PAPER = {
    "title": "Deep Learning",
    "publication_year": 2018,
    "authorships": [{"author": {"display_name": "Nicholas G. Polson"}}],
}
LECUN_REVIEW = {
    "title": "Deep learning",
    "publication_year": 2015,
    "authorships": [{"author": {"display_name": "Yann LeCun"}}],
}


def by(surname: str):
    """A `fits` that accepts one first author, whatever the year."""
    return lambda year, author: author.endswith(surname)


def test_a_title_crossref_lists_is_found_with_one_call(answers):
    table, asked = answers
    table["crossref"] = Answer(200, {"message": {"items": [GOODFELLOW_BOOK]}})

    record = indexes.find_title(TITLE, "Goodfellow", by("Goodfellow"))

    assert (record.index, record.year, record.first_author) == ("crossref", 2016, "Goodfellow")
    assert asked == ["crossref"]


def test_a_same_titled_work_by_others_is_not_a_match(answers):
    table, asked = answers
    table["crossref"] = Answer(200, {"message": {"items": [GOODFELLOW_BOOK]}})
    table["openalex"] = Answer(200, {"results": [POLSON_PAPER, LECUN_REVIEW]})

    record = indexes.find_title(TITLE, "LeCun", by("LeCun"))

    assert (record.index, record.year, record.first_author) == ("openalex", 2015, "LeCun")
    assert asked == ["crossref", "openalex"]


def test_a_hit_with_another_title_is_not_a_match(answers):
    table, _ = answers
    table["crossref"] = Answer(200, {"message": {"items": [GOODFELLOW_BOOK]}})
    table["openalex"] = Answer(200, {"results": [POLSON_PAPER]})

    assert (
        indexes.find_title("Quantum sourdough for transformer pastry", "Goodfellow", by("Goodfellow")) is None
    )


def test_an_unreachable_index_is_not_taken_for_an_unknown_title(answers):
    table, _ = answers
    table["crossref"] = requests.ConnectionError("no route to host")
    table["openalex"] = Answer(200, {"results": []})

    with pytest.raises(indexes.IndexUnavailable, match="no route to host"):
        indexes.find_title(TITLE, "Goodfellow", by("Goodfellow"))


def test_title_hits_are_cached_and_an_empty_answer_is_not(answers):
    table, asked = answers
    table["crossref"] = Answer(200, {"message": {"items": [GOODFELLOW_BOOK]}})
    table["openalex"] = Answer(200, {"results": []})

    indexes.find_title(TITLE, "Goodfellow", by("Goodfellow"))
    indexes.find_title(TITLE, "Goodfellow", by("Goodfellow"))
    assert asked == ["crossref"]

    indexes.find_title("A title nobody lists", "Goodfellow", by("Goodfellow"))
    indexes.find_title("A title nobody lists", "Goodfellow", by("Goodfellow"))
    assert asked == ["crossref", "crossref", "openalex", "crossref", "openalex"]


def test_the_search_names_the_first_author_and_keeps_filter_syntax_out(monkeypatch, answers):
    sent = []
    monkeypatch.setattr(indexes, "_get", lambda url, params=None: sent.append(params) or {})

    indexes.find_title("Adam: A method, for stochastic optimization?", "Kingma", by("Kingma"))

    crossref, openalex = sent
    assert crossref["query.author"] == "Kingma"
    assert openalex["filter"] == (
        "title.search:Adam: A method  for stochastic optimization ,raw_author_name.search:Kingma"
    )


def test_an_openalex_key_is_sent_to_openalex_only(monkeypatch, answers):
    table, _ = answers
    table["crossref"] = Answer(404)
    table["openalex"] = Answer(404)
    sent = {}
    get = requests.get

    def spy(url, **kwargs):
        sent["openalex" if "openalex" in url else "crossref"] = kwargs["headers"]
        return get(url, **kwargs)

    monkeypatch.setattr(indexes, "OPENALEX_API_KEY", "key-123")
    monkeypatch.setattr(requests, "get", spy)
    indexes.find_doi(DOI)

    assert sent["openalex"]["Authorization"] == "Bearer key-123"
    assert "Authorization" not in sent["crossref"]


def test_an_answer_that_is_not_json_is_an_unreachable_index(answers):
    table, _ = answers

    class NotJson(Answer):
        def json(self):
            raise ValueError("Expecting value")

    table["crossref"] = NotJson(200)
    table["openalex"] = Answer(404)

    with pytest.raises(indexes.IndexUnavailable, match="not JSON"):
        indexes.find_doi(DOI)


def test_openalex_works_returns_the_results_of_the_filter(answers):
    table, _ = answers
    table["openalex"] = Answer(200, {"results": [OPENALEX_WORK]})

    assert indexes.openalex_works({"filter": "doi:" + DOI}) == [OPENALEX_WORK]
