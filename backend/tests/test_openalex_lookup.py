"""OpenAlex as the last title lookup, and as the list of other PDF copies of a DOI.

openalex_works is replaced, so nothing leaves the machine.
"""

import pytest
from app.pipeline import indexes, sources

ACM = "https://dl.acm.org/doi/pdf/10.1145/3581784.3607089"
OSTI = "https://www.osti.gov/servlets/purl/2224161"


def work(title="Frontier: Exploring Exascale", year=2023, author="Scott Atchley", pdfs=(ACM,), doi=True):
    return {
        "doi": "https://doi.org/10.1145/3581784.3607089" if doi else None,
        "title": title,
        "publication_year": year,
        "authorships": [{"author": {"display_name": author}}],
        "locations": [{"pdf_url": pdf} for pdf in pdfs],
    }


def answer(monkeypatch, *works):
    asked = []

    def openalex_works(params):
        asked.append(params)
        return list(works)

    monkeypatch.setattr(indexes, "openalex_works", openalex_works)
    return asked


def refuse(monkeypatch):
    def openalex_works(params):
        raise indexes._IndexError("https://api.openalex.org/works: HTTP 503")

    monkeypatch.setattr(indexes, "openalex_works", openalex_works)


def test_the_first_pdf_link_of_the_matching_work_is_used(monkeypatch):
    asked = answer(monkeypatch, work(title="Something else"), work(pdfs=(None, ACM, OSTI)))
    found = sources._openalex_by_title("Frontier: Exploring Exascale")
    assert (found.url, found.index, found.ids) == (ACM, "openalex", {"DOI": "10.1145/3581784.3607089"})
    assert (found.year, found.first_author) == (2023, "Scott Atchley")
    assert asked[0]["filter"] == "title.search:Frontier: Exploring Exascale"


def test_filter_separators_are_taken_out_of_the_title(monkeypatch):
    asked = answer(monkeypatch)
    with pytest.raises(sources.Unresolvable):
        sources._openalex_by_title("Why, or why not | a study?")
    assert asked[0]["filter"] == "title.search:Why  or why not   a study "


def test_a_work_without_a_doi_has_no_ids(monkeypatch):
    answer(monkeypatch, work(doi=False))
    assert sources._openalex_by_title("Frontier: Exploring Exascale").ids == {}


def test_a_matching_work_with_no_pdf_link_is_a_paywall(monkeypatch):
    answer(monkeypatch, work(pdfs=(None,)))
    with pytest.raises(sources.NoOpenAccessCopy):
        sources._openalex_by_title("Frontier: Exploring Exascale")


def test_a_same_titled_work_that_does_not_fit_is_named(monkeypatch):
    answer(monkeypatch, work(year=2019, author="Someone Else"))
    with pytest.raises(sources.OnlyOtherWorks, match=r"Frontier: Exploring Exascale \(2019, Someone Else\)"):
        sources._openalex_by_title("Frontier: Exploring Exascale", lambda year, author: year == 2023)


def test_a_paywalled_record_does_not_hide_an_open_one_with_the_same_title(monkeypatch):
    preprint = "https://arxiv.org/pdf/2312.00001"
    answer(monkeypatch, work(pdfs=(None,)), work(pdfs=(preprint,)))
    assert sources._openalex_by_title("Frontier: Exploring Exascale").url == preprint


def test_openalex_not_answering_is_unavailable_not_unknown(monkeypatch):
    refuse(monkeypatch)
    with pytest.raises(sources.LookupUnavailable):
        sources._openalex_by_title("Frontier: Exploring Exascale")


def test_every_pdf_link_of_a_doi_is_listed(monkeypatch):
    asked = answer(monkeypatch, work(pdfs=(None, ACM, OSTI)))
    assert sources._openalex_pdfs("10.1145/3581784.3607089") == [ACM, OSTI]
    assert asked[0]["filter"] == "doi:10.1145/3581784.3607089"


def test_no_pdf_links_when_openalex_does_not_answer_or_the_doi_cannot_be_asked(monkeypatch):
    asked = answer(monkeypatch, work())
    assert sources._openalex_pdfs("10.1000/a,b") == []
    assert asked == []
    refuse(monkeypatch)
    assert sources._openalex_pdfs("10.1145/3581784.3607089") == []


def test_openalex_not_answering_last_is_what_a_title_lookup_reports():
    skipped = sources.OnlyOtherWorks("arXiv has only other works titled 'X'")
    down = sources.LookupUnavailable("OpenAlex did not answer")
    assert sources._reported([skipped, sources.Unresolvable("no paper"), down]) is down


def test_a_rate_limit_in_the_middle_is_not_reported_as_not_found():
    limited = sources.LookupUnavailable("Semantic Scholar is rate limiting us")
    nowhere = sources.Unresolvable("no paper")
    assert sources._reported([nowhere, limited, sources.Unresolvable("OpenAlex: no paper")]) is limited


def test_a_paywall_wins_over_openalex_not_answering():
    paywall = sources.NoOpenAccessCopy("no open-access PDF known")
    assert sources._reported([paywall, sources.LookupUnavailable("OpenAlex did not answer")]) is paywall


def test_no_resolver_at_all_is_unavailable():
    with pytest.raises(sources.LookupUnavailable, match="no resolver was asked"):
        sources._first_answer((), "anything")
