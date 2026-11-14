"""reference_check: what a draft check adds to a citation from the indexes (#421).

find_doi is replaced, so nothing leaves the machine.
"""

import pytest
from app.author import verify
from app.pipeline import sources
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


def test_an_entry_with_a_link_and_no_doi_is_not_looked_up(monkeypatch):
    def not_called(*args):
        raise AssertionError("an entry with only a link was looked up")

    monkeypatch.setattr(verify, "find_doi", not_called)
    monkeypatch.setattr(verify, "find_title", not_called)
    assert verify.reference_check({"title": "The Illustrated Transformer", "url": "https://x.y"}) == {}
    assert verify.reference_check({"title": "PyTorch", "howpublished": r"\url{https://pytorch.org}"}) == {}


def test_an_entry_without_a_doi_is_looked_up_by_its_title_and_first_author(monkeypatch):
    record = IndexRecord(title="MS MARCO", year=2016, first_author="Nguyen", index="openalex")
    asked = []

    def find_title(title, author, fits):
        asked.append((title, author))
        return record if fits(record.year, record.first_author) else None

    monkeypatch.setattr(verify, "find_title", find_title)

    entry = {"title": "{MS} {MARCO}", "year": "2016", "author": "Nguyen, Tri and Rosenberg, Mir"}
    assert verify.reference_check(entry) == {"exists": "yes", "index": "OpenAlex", "lookedUpBy": "title"}
    assert asked == [("MS MARCO", "Nguyen")]


def test_an_entry_without_an_author_is_not_looked_up_by_title(monkeypatch):
    def not_called(*args):
        raise AssertionError("a title with no author was looked up")

    monkeypatch.setattr(verify, "find_title", not_called)
    assert verify.reference_check({"title": "MS MARCO", "year": "2016"}) == {}


def nowhere(title, fits):
    raise sources.Unresolvable(f"no paper found matching the title: {title}")


def test_a_title_no_index_lists_may_be_made_up(monkeypatch):
    monkeypatch.setattr(verify, "find_title", lambda title, author, fits: None)
    monkeypatch.setattr(verify, "find_by_title", nowhere)
    entry = {"title": "Quantum sourdough for transformer pastry", "author": "Baker, Ann", "year": "2024"}
    assert verify.reference_check(entry) == {"exists": "no", "lookedUpBy": "title"}


def test_a_same_titled_work_by_another_first_author_is_not_taken(monkeypatch):
    other = IndexRecord(title="Deep Learning", year=2018, first_author="Polson", index="openalex")
    monkeypatch.setattr(
        verify,
        "find_title",
        lambda title, author, fits: other if fits(other.year, other.first_author) else None,
    )
    monkeypatch.setattr(verify, "find_by_title", nowhere)
    goodfellow = {"title": "Deep learning", "year": "2016", "author": "Goodfellow, Ian"}
    assert verify.reference_check(goodfellow) == {"exists": "no", "lookedUpBy": "title"}


def test_an_index_year_far_from_the_bib_still_matches_by_title(monkeypatch):
    """Crossref and OpenAlex both date "Attention Is All You Need" 2025."""
    redeposit = IndexRecord(
        title="Attention Is All You Need", year=2025, first_author="Vaswani", index="crossref"
    )
    monkeypatch.setattr(
        verify,
        "find_title",
        lambda title, author, fits: redeposit if fits(redeposit.year, redeposit.first_author) else None,
    )
    vaswani = {"title": "Attention is all you need", "year": "2017", "author": "Vaswani, Ashish"}
    assert verify.reference_check(vaswani) == {"exists": "yes", "index": "Crossref", "lookedUpBy": "title"}


LORA = {
    "title": "LoRA: Low-Rank Adaptation of Large Language Models",
    "author": "Hu, Edward J",
    "year": "2021",
}


def test_an_arxiv_only_paper_the_indexes_miss_is_found_on_arxiv(monkeypatch):
    monkeypatch.setattr(verify, "find_title", lambda title, author, fits: None)
    on_arxiv = sources.Resolution(
        "https://arxiv.org/pdf/2106.09685", LORA["title"], "arxiv", {}, 2021, "Edward J. Hu"
    )
    monkeypatch.setattr(verify, "find_by_title", lambda title, fits: on_arxiv)

    assert verify.reference_check(LORA) == {"exists": "yes", "index": "arXiv", "lookedUpBy": "title"}


def test_a_paper_only_openalex_finds_by_title_exists(monkeypatch):
    monkeypatch.setattr(verify, "find_title", lambda title, author, fits: None)
    frontier = sources.Resolution(
        "https://dl.acm.org/doi/pdf/10.1145/3581784.3607089", "Frontier: Exploring Exascale", "openalex"
    )
    monkeypatch.setattr(verify, "find_by_title", lambda title, fits: frontier)

    assert verify.reference_check(LORA) == {"exists": "yes", "index": "OpenAlex", "lookedUpBy": "title"}


@pytest.mark.parametrize(
    ("index", "named"), [("semantic-scholar", "Semantic Scholar"), ("openalex", "OpenAlex"), ("", None)]
)
def test_a_work_a_lookup_knows_without_a_free_pdf_exists_and_names_that_lookup(monkeypatch, index, named):
    def paywalled(title, fits):
        raise sources.NoOpenAccessCopy(f"no open-access PDF known for '{title}'", index)

    monkeypatch.setattr(verify, "find_title", lambda title, author, fits: None)
    monkeypatch.setattr(verify, "find_by_title", paywalled)

    expected = {"exists": "yes", "lookedUpBy": "title"} | ({"index": named} if named else {})
    assert verify.reference_check(LORA) == expected


def test_a_rate_limit_after_the_indexes_missed_is_unknown(monkeypatch):
    def rate_limited(title, fits):
        raise sources.LookupUnavailable("Semantic Scholar is rate limiting us")

    monkeypatch.setattr(verify, "find_title", lambda title, author, fits: None)
    monkeypatch.setattr(verify, "find_by_title", rate_limited)

    assert verify.reference_check(LORA) == {"exists": "unknown", "lookedUpBy": "title"}


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
    monkeypatch.setattr(verify, "find_title", down)
    entries = {
        "a": {"doi": "10.1/a"},
        "b": {"title": "no DOI", "author": "Baker, Ann"},
        "c": {"doi": "10.1/c"},
        "d": {"title": "a blog post", "url": "https://x.y"},
    }

    assert verify.reference_checks(entries) == {
        "a": {"exists": "unknown"},
        "b": {"exists": "unknown", "lookedUpBy": "title"},
        "c": {"exists": "unknown"},
    }
    assert asked == ["10.1/a"]


def test_an_index_outage_still_lets_arxiv_answer(monkeypatch):
    def down(title, author, fits):
        raise IndexUnavailable("openalex: HTTP 429")

    on_arxiv = sources.Resolution(
        "https://arxiv.org/pdf/2106.09685", LORA["title"], "arxiv", {}, 2021, "Edward J. Hu"
    )
    monkeypatch.setattr(verify, "find_title", down)
    monkeypatch.setattr(verify, "find_by_title", lambda title, fits: on_arxiv)
    assert verify.reference_check(LORA) == {"exists": "yes", "index": "arXiv", "lookedUpBy": "title"}

    monkeypatch.setattr(verify, "find_by_title", nowhere)
    assert verify.reference_check(LORA) == {"exists": "unknown", "lookedUpBy": "title"}
