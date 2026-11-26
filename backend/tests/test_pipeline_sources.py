"""sources.py paths the other source tests leave out: Unpaywall, downloads that are not PDFs,
title lookups that find only other works, the cache readers and fetch_source.

No network: requests.get answers from a fake, and the store is a SQLite file in tmp_path.
"""

from pathlib import Path

import pytest
import requests
from app import store
from app.pipeline import indexes, sources

DOI = "10.1162/tacl.a.782"
PDF = b"%PDF-1.7 a paper"


class Reply:
    def __init__(self, status_code=200, payload=None, content=b"", content_type="", text=""):
        self.status_code = status_code
        self.ok = status_code < 400
        self._payload = payload or {}
        self.content = content
        self.headers = {"Content-Type": content_type}
        self.text = text

    def json(self):
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise requests.HTTPError(f"{self.status_code} Error")


@pytest.fixture
def web(monkeypatch):
    """requests.get answers the next entry of `replies` (or raises it) and records each URL."""
    replies: list = []
    asked: list[str] = []

    def get(url, **kwargs):
        asked.append(url)
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(requests, "get", get)
    return replies, asked


@pytest.fixture
def store_in_tmp(monkeypatch, tmp_path):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))


def test_semantic_scholar_title_search_names_the_works_that_did_not_fit(monkeypatch):
    found = {"data": [{"title": "Deep learning", "year": 2016, "authors": [{"name": "Ian Goodfellow"}]}]}
    monkeypatch.setattr(sources, "_semantic_scholar", lambda path, params: found)

    with pytest.raises(sources.OnlyOtherWorks, match=r"Deep learning \(2016, Ian Goodfellow\)"):
        sources._semantic_scholar_by_title("Deep learning", lambda year, author: year == 2018)


def test_semantic_scholar_title_search_takes_the_work_that_fits(monkeypatch):
    found = {
        "data": [
            {"title": "Deep learning", "year": 2016, "authors": [{"name": "Ian Goodfellow"}]},
            {
                "title": "Deep learning",
                "year": 2018,
                "authors": [{"name": "Nicholas Polson"}],
                "openAccessPdf": {"url": "https://example.org/dl.pdf"},
            },
        ]
    }
    monkeypatch.setattr(sources, "_semantic_scholar", lambda path, params: found)

    work = sources._semantic_scholar_by_title("Deep learning", lambda year, author: year == 2018)

    assert (work.url, work.year, work.first_author) == ("https://example.org/dl.pdf", 2018, "Nicholas Polson")


def test_unpaywall_needs_a_contact_address(monkeypatch):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "")

    with pytest.raises(sources.LookupUnavailable, match="UNPAYWALL_EMAIL"):
        sources._unpaywall_pdf(DOI)


def test_unpaywall_not_knowing_a_doi_is_unresolvable(monkeypatch, web):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "me@example.org")
    web[0].append(Reply(404))

    with pytest.raises(sources.Unresolvable, match=DOI):
        sources._unpaywall_pdf(DOI)


def test_unpaywall_knowing_a_work_without_a_pdf_has_no_open_access_copy(monkeypatch, web):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "me@example.org")
    web[0].append(Reply(payload={"best_oa_location": {}}))

    with pytest.raises(sources.NoOpenAccessCopy):
        sources._unpaywall_pdf(DOI)


def test_unpaywall_no_locations_with_a_conflicting_title_is_not_matched(monkeypatch, web):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "me@example.org")
    web[0].append(Reply(payload={"title": "An unrelated paper", "best_oa_location": {}}))

    with pytest.raises(sources.NoOpenAccessCopy) as failure:
        sources._unpaywall_resolutions(DOI, {"title": "Expected paper"})
    assert not getattr(failure.value, "source_attempts", None)


def test_unpaywall_unusable_locations_with_a_conflicting_title_is_not_matched(monkeypatch, web):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "me@example.org")
    web[0].append(Reply(payload={
        "title": "An unrelated paper",
        "best_oa_location": {"host_type": "repository"},
    }))

    with pytest.raises(sources.NoOpenAccessCopy) as failure:
        sources._unpaywall_resolutions(DOI, {"title": "Expected paper"})
    assert not getattr(failure.value, "source_attempts", None)


def test_unpaywall_gives_the_best_pdf_and_an_arxiv_copy_among_the_other_locations(monkeypatch, web):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "me@example.org")
    web[0].append(
        Reply(
            payload={
                "title": "A paper",
                "best_oa_location": {"url_for_pdf": "https://publisher.example/p.pdf"},
                "oa_locations": [
                    {"url": "https://example.org/landing"},
                    {"url_for_pdf": "https://arxiv.org/pdf/2112.01488"},
                ],
            }
        )
    )

    work = sources._unpaywall_pdf(DOI)

    assert (work.url, work.index, work.ids) == (
        "https://publisher.example/p.pdf",
        "unpaywall",
        {"DOI": DOI, "ArXiv": "2112.01488"},
    )


def test_unpaywall_keeps_each_open_location_for_fetch_fallback(monkeypatch, web):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "me@example.org")
    web[0].append(Reply(payload={
        "title": "A paper",
        "best_oa_location": {"url_for_pdf": "https://publisher.example/p.pdf"},
        "oa_locations": [
            {"url_for_pdf": "https://publisher.example/p.pdf"},
            {"url_for_pdf": "https://repository.example/p.pdf"},
        ],
    }))

    candidates = sources._unpaywall_resolutions(DOI)

    assert [candidate.url for candidate in candidates] == [
        "https://publisher.example/p.pdf", "https://repository.example/p.pdf",
    ]


def test_openalex_doi_lookup_returns_validated_open_pdf_locations(monkeypatch):
    doi = "10.1162/tacl_a_00594"
    title = (
        "Introduction to Mathematical Language Processing: Informal Proofs, Word Problems, and "
        "Supporting Tasks"
    )
    work = {
        "doi": f"https://doi.org/{doi}",
        "title": title,
        "publication_year": 2023,
        "authorships": [{"author": {"display_name": "Jordan Meadows"}}],
        "locations": [
            {"is_oa": True, "pdf_url": "https://direct.mit.edu/tacl/paper.pdf"},
            {"is_oa": True, "pdf_url": "https://arxiv.org/pdf/2205.15231"},
            {"is_oa": False, "pdf_url": "https://closed.example/paper.pdf"},
        ],
    }
    monkeypatch.setattr(indexes, "openalex_work_by_doi", lambda requested: work)

    candidates = sources._openalex_candidates(doi, {"doi": doi, "title": title, "year": 2023})

    assert [candidate.url for candidate in candidates] == [
        "https://arxiv.org/pdf/2205.15231", "https://direct.mit.edu/tacl/paper.pdf",
    ]
    assert all(candidate.index == "openalex" for candidate in candidates)
    assert candidates[0].ids == {"DOI": doi, "ArXiv": "2205.15231"}


def test_openalex_rejects_a_title_that_conflicts_with_the_citation(monkeypatch):
    doi = "10.1162/tacl_a_00594"
    monkeypatch.setattr(indexes, "openalex_work_by_doi", lambda requested: {
        "doi": f"https://doi.org/{doi}",
        "title": "An unrelated paper",
        "locations": [{"is_oa": True, "pdf_url": "https://example.org/paper.pdf"}],
    })

    with pytest.raises(sources.IdentityMismatch):
        sources._openalex_candidates(doi, {"doi": doi, "title": "Expected paper"})


def test_openalex_title_search_respects_cited_year_and_author(monkeypatch):
    title = "A Shared Title: A Method Study"
    wrong = {
        "doi": "https://doi.org/10.1000/wrong",
        "title": title,
        "publication_year": 2019,
        "authorships": [{"author": {"display_name": "Someone Else"}}],
        "locations": [{"is_oa": True, "pdf_url": "https://wrong.example/paper.pdf"}],
    }
    correct = {
        **wrong,
        "doi": "https://doi.org/10.1000/correct",
        "publication_year": 2020,
        "authorships": [{"author": {"display_name": "Alex Smith"}}],
        "locations": [{"is_oa": True, "pdf_url": "https://right.example/paper.pdf"}],
    }
    monkeypatch.setattr(indexes, "openalex_search_works", lambda requested: [wrong, correct])

    candidates = sources._openalex_candidates(
        title, {"title": title, "year": 2020, "authors": ["Alex Smith"]},
    )

    assert [candidate.url for candidate in candidates] == ["https://right.example/paper.pdf"]
    assert candidates[0].ids["DOI"] == "10.1000/correct"


def test_openalex_title_search_skips_mismatched_titles(monkeypatch):
    title = "A Shared Title: A Method Study"
    unrelated = {
        "doi": "https://doi.org/10.1000/unrelated",
        "title": "A Completely Different Paper",
        "publication_year": 2020,
        "authorships": [{"author": {"display_name": "Alex Smith"}}],
        "locations": [{"is_oa": True, "pdf_url": "https://unrelated.example/paper.pdf"}],
    }
    monkeypatch.setattr(indexes, "openalex_search_works", lambda requested: [unrelated])

    with pytest.raises(sources.Unresolvable):
        sources._openalex_candidates(
            title, {"title": title, "year": 2020, "authors": ["Alex Smith"]},
        )


@pytest.mark.parametrize(
    ("doi", "anthology_id"),
    [
        ("10.18653/v1/2022.naacl-main.272", "2022.naacl-main.272"),
        ("10.18653/2026.acl-main.1", "2026.acl-main.1"),
        ("10.3115/C15-1234", "C15-1234"),
        ("10.3115/1073083.1073135", ""),
    ],
)
def test_acl_doi_fallback_only_derives_canonical_anthology_ids(doi, anthology_id):
    candidate = sources._acl_anthology_candidate(doi)

    if anthology_id:
        assert candidate is not None
        assert candidate.url == f"https://aclanthology.org/{anthology_id}.pdf"
        assert candidate.index == "acl_anthology"
    else:
        assert candidate is None


def test_acl_anthology_url_is_derived_from_a_canonical_acl_doi():
    doi = "10.18653/v1/2022.naacl-main.272"

    candidate = sources._acl_anthology_candidate(doi)

    assert candidate is not None
    assert candidate.url == "https://aclanthology.org/2022.naacl-main.272.pdf"


def test_acl_anthology_doi_mapping_rejects_conflicting_citation_doi():
    with pytest.raises(sources.IdentityMismatch):
        sources._acl_anthology_candidate(
            "10.18653/v1/2022.naacl-main.272",
            {"doi": "10.18653/v1/2022.acl-long.1"},
        )


ACL_TACL_XML = """<?xml version='1.0' encoding='UTF-8'?>
<collection id="Q19">
  <volume id="1">
    <paper id="26">
      <title>Natural Questions: A Benchmark for Question Answering Research</title>
      <author><first>Tom</first><last>Kwiatkowski</last></author>
      <doi>10.1162/tacl_a_00276</doi>
      <pdf hash="b99b51da" />
    </paper>
  </volume>
</collection>"""


def acl_metadata_fixture(monkeypatch, web):
    monkeypatch.setattr(store, "recall_cache", lambda key: None)
    monkeypatch.setattr(store, "remember_cache", lambda *args: None)
    web[0].extend([
        Reply(payload={
            "tacl": {
                "name": "Transactions of the Association for Computational Linguistics",
                "acronym": "TACL",
                "oldstyle_letter": "Q",
            },
        }),
        Reply(text=ACL_TACL_XML),
    ])


def test_acl_metadata_finds_paper_by_doi_title_and_venue(monkeypatch, web):
    acl_metadata_fixture(monkeypatch, web)
    doi = "10.1162/tacl_a_00276"
    expected = {
        "doi": doi,
        "title": "Natural Questions: A Benchmark for Question Answering Research",
        "year": "2019",
        "venue": "Transactions of the Association for Computational Linguistics, Volume 7",
        "authors": ["Tom Kwiatkowski"],
    }

    candidates = sources._acl_anthology_candidates(doi, expected)

    assert [candidate.url for candidate in candidates] == [
        "https://aclanthology.org/Q19-1026.pdf",
    ]
    assert candidates[0].ids == {"ACL": "Q19-1026", "DOI": doi}
    assert [url.rsplit("/", 1)[-1] for url in web[1]] == [
        "venues.json", "Q19.xml",
    ]


def test_acl_metadata_does_not_accept_a_doi_with_a_conflicting_title(monkeypatch, web):
    acl_metadata_fixture(monkeypatch, web)
    doi = "10.1162/tacl_a_00276"
    expected = {
        "doi": doi,
        "title": "A different cited paper",
        "year": "2019",
        "venue": "TACL",
    }

    with pytest.raises(sources.IdentityMismatch):
        sources._acl_anthology_candidates(doi, expected)


def test_acl_metadata_resolves_an_older_acm_prefixed_acl_doi(monkeypatch, web):
    monkeypatch.setattr(store, "recall_cache", lambda key: None)
    monkeypatch.setattr(store, "remember_cache", lambda *args: None)
    web[0].extend([
        Reply(payload={
            "acl": {
                "name": "Annual Meeting of the Association for Computational Linguistics",
                "acronym": "ACL",
                "oldstyle_letter": "P",
            },
            "acl-long": {
                "name": "Annual Meeting of the Association for Computational Linguistics",
                "acronym": "ACL Long Papers",
            },
            "cl": {
                "name": "Computational Linguistics",
                "acronym": "CL",
                "oldstyle_letter": "J",
            },
        }),
        Reply(text="""<collection id="P02"><volume id="1"><paper id="40">
          <title>BLEU: a method for automatic evaluation of machine translation</title>
          <author><first>Kishore</first><last>Papineni</last></author>
          <doi>10.3115/1073083.1073135</doi><pdf hash="fixture" />
        </paper></volume></collection>"""),
    ])
    doi = "10.3115/1073083.1073135"
    expected = {
        "doi": doi,
        "title": "BLEU: a method for automatic evaluation of machine translation",
        "year": "2002",
        "venue": "Proceedings of the 40th Annual Meeting on Association for Computational Linguistics",
        "authors": ["Kishore Papineni"],
    }

    candidates = sources._acl_anthology_candidates(doi, expected)

    assert [candidate.url for candidate in candidates] == [
        "https://aclanthology.org/P02-1040.pdf",
    ]


def test_fetch_uses_acl_metadata_when_other_pdf_host_is_blocked(monkeypatch, store_in_tmp, web, papers):
    acl_metadata_fixture(monkeypatch, web)
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "")
    monkeypatch.setattr(sources, "_openalex_candidates", lambda *args: [])
    doi = "10.1162/tacl_a_00276"
    title = "Natural Questions: A Benchmark for Question Answering Research"
    expected = {
        "doi": doi,
        "title": title,
        "year": "2019",
        "venue": "Transactions of the Association for Computational Linguistics, Volume 7",
        "authors": ["Tom Kwiatkowski"],
    }
    publisher = "https://publisher.example/blocked.pdf"
    monkeypatch.setattr(
        sources, "_resolve",
        lambda identifier, metadata=None: sources.Resolution(
            publisher, title, "semantic-scholar", {"DOI": doi}
        ),
    )
    response = requests.Response()
    response.status_code = 403
    response.url = publisher

    def download(url, name):
        if url == publisher:
            raise requests.HTTPError("publisher denied download", response=response)
        assert url == "https://aclanthology.org/Q19-1026.pdf"
        return papers / f"{name}.pdf"

    monkeypatch.setattr(sources, "_download", download)

    path, found = sources._fetch(doi, expected)

    assert path.name == "10.1162-tacl_a_00276.pdf"
    assert found.index == "acl_anthology"
    assert found.url == "https://aclanthology.org/Q19-1026.pdf"
    assert any(
        attempt["provider"] == "acl_anthology" and attempt["result"] == "readable_pdf"
        for attempt in found.attempts
    )


def test_fetch_uses_acl_when_scholarly_indexes_report_no_copy(monkeypatch, store_in_tmp, web, papers):
    acl_metadata_fixture(monkeypatch, web)
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "")
    monkeypatch.setattr(sources, "_openalex_candidates", lambda *args: [])
    doi = "10.1162/tacl_a_00276"
    title = "Natural Questions: A Benchmark for Question Answering Research"
    expected = {
        "doi": doi,
        "title": title,
        "year": "2019",
        "venue": "Transactions of the Association for Computational Linguistics, Volume 7",
        "authors": ["Tom Kwiatkowski"],
    }

    def no_index_copy(identifier, metadata=None):
        error = sources.NoOpenAccessCopy("the first indexes have no downloadable copy")
        error.source_attempts = [
            sources._attempt("semantic_scholar", "no-accessible-copy", error),
            sources._attempt("unpaywall", "no-accessible-copy", error),
        ]
        raise error

    monkeypatch.setattr(sources, "_resolve", no_index_copy)
    monkeypatch.setattr(
        sources, "_download",
        lambda url, name: papers / f"{name}.pdf"
        if url == "https://aclanthology.org/Q19-1026.pdf"
        else pytest.fail(f"unexpected download URL: {url}"),
    )

    _path, found = sources._fetch(doi, expected)

    assert found.index == "acl_anthology"
    assert found.url == "https://aclanthology.org/Q19-1026.pdf"


@pytest.fixture
def papers(monkeypatch, tmp_path):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path / "papers")
    return tmp_path / "papers"


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b"<html><body>page</body></html>", "text/html; charset=utf-8"),
        (b"  <!doctype html><html><body>page</body></html>", ""),
    ],
)
def test_an_html_answer_is_a_web_source_only_after_fetch(papers, web, content, content_type):
    web[0].append(Reply(content=content, content_type=content_type))

    with pytest.raises(sources.WebSource, match="a web page"):
        sources._download("https://blog.example/post", "post")


def test_direct_url_is_classified_as_a_web_page_only_after_html_is_read(
    monkeypatch, store_in_tmp, papers, web,
):
    url = "https://blog.example/post"
    monkeypatch.setattr(sources, "_resolve", lambda identifier, expected=None: sources.Resolution(url))
    web[0].append(Reply(content=b"<html><body>article</body></html>", content_type="text/html"))

    with pytest.raises(sources.WebSource) as failure:
        sources._fetch(url)

    outcome = sources.tool_error(failure.value)["source_outcome"]
    assert outcome["source_kind"] == "web-page"
    assert outcome["outcome"] == "web-page"
    assert outcome["attempts"][-1]["result"] == "web-page"


def test_an_answer_that_is_not_a_pdf_is_not_downloadable(papers, web):
    web[0].append(Reply(content=b"PK zip", content_type="application/zip"))

    with pytest.raises(sources.NotDownloadable, match="not a PDF"):
        sources._download("https://example.org/p.zip", "p")


def test_a_pdf_is_saved_with_the_link_beside_it(papers, web):
    web[0].append(Reply(content=PDF))

    path = sources._download("https://example.org/p.pdf?token=private#page", "p")

    assert path.read_bytes() == PDF
    assert sources._link_file(path).read_text() == "https://example.org/p.pdf"


def test_a_lookup_that_fails_on_the_network_is_temporary_unavailable(monkeypatch, store_in_tmp):
    def refuse(identifier, expected=None):
        raise requests.ConnectionError("no route")

    monkeypatch.setattr(sources, "_resolve", refuse)

    with pytest.raises(sources.LookupUnavailable, match="did not respond") as raised:
        sources._fetch("10.1/x")

    assert sources.is_retryable(raised.value)


@pytest.mark.parametrize("error", [sources.WebSource("a web page"), sources.NotDownloadable("not a PDF")])
def test_a_link_that_is_not_a_paper_reports_its_own_error(monkeypatch, store_in_tmp, error):
    monkeypatch.setattr(
        sources, "_resolve", lambda identifier, expected=None: sources.Resolution("https://example.org/p")
    )

    def refuse(url, name):
        raise error

    monkeypatch.setattr(sources, "_download", refuse)

    with pytest.raises(type(error)) as raised:
        sources._fetch("https://example.org/p")

    assert raised.value is error


def test_withdrawn_by_is_empty_when_the_abstract_page_cannot_be_read(web):
    web[0].append(requests.ConnectionError("down"))

    assert sources._withdrawn_by("2305.13664") == ""


def test_withdrawn_by_names_who_withdrew_the_paper(web):
    web[0].append(Reply(text="<p>This paper has been withdrawn by the authors<"))

    assert sources._withdrawn_by("2305.13664") == "the authors"


def test_withdrawn_by_is_empty_for_a_page_arxiv_refused(web):
    web[0].append(Reply(500))

    assert sources._withdrawn_by("2305.13664") == ""


def test_index_paper_without_a_title_or_doi_asks_nothing(monkeypatch):
    def unexpected(identifier, expected=None):
        raise AssertionError("nothing to look up")

    monkeypatch.setattr(sources, "_resolve", unexpected)

    assert sources.index_paper("") == {"index": "", "ids": {}}


def test_index_paper_that_no_resolver_can_place_is_empty_not_an_error(monkeypatch):
    def unplaced(identifier, expected=None):
        raise sources.Unresolvable("no such paper")

    monkeypatch.setattr(sources, "_resolve", unplaced)

    assert sources.index_paper("A first upload") == {"index": "", "ids": {}}


def test_index_paper_gives_the_index_the_lookup_found(monkeypatch, store_in_tmp):
    found = sources.Resolution(
        "https://arxiv.org/pdf/2112.01488", "ColBERTv2", "arxiv", {"ArXiv": "2112.01488"}
    )
    monkeypatch.setattr(sources, "_lookup", lambda identifier, expected=None: found)

    assert sources.index_paper("ColBERTv2", doi="2112.01488") == {
        "index": "arxiv",
        "ids": {"ArXiv": "2112.01488"},
    }


def test_known_title_reads_the_title_back_from_the_cache(monkeypatch, store_in_tmp):
    monkeypatch.setattr(
        sources, "_lookup",
        lambda identifier, expected=None: sources.Resolution("https://x/p.pdf", "ColBERTv2"),
    )
    sources._resolve(DOI)

    assert sources.known_title(f"  {DOI} ") == "ColBERTv2"
    assert sources.known_title("never looked up") == ""


def test_a_pdf_without_a_saved_link_has_no_version(tmp_path):
    assert sources.version_of(tmp_path / "upload.pdf") == {}


def test_a_local_file_is_its_own_path(tmp_path):
    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(PDF)

    assert sources.local_pdf(str(pdf)) == str(pdf)


def test_anything_else_is_downloaded_first(monkeypatch):
    monkeypatch.setattr(
        sources,
        "_fetch",
        lambda paper, expected=None: (
            Path("data/papers/2112.01488.pdf"), sources.Resolution("https://arxiv.org/pdf/2112.01488")
        ),
    )

    assert sources.local_pdf("2112.01488") == "data/papers/2112.01488.pdf"


def test_fetch_source_describes_the_download(monkeypatch):
    found = sources.Resolution(
        "https://arxiv.org/pdf/2112.01488", "ColBERTv2", "arxiv", {"ArXiv": "2112.01488"},
        attempts=({"provider": "arxiv", "result": "readable_pdf"},),
    )
    monkeypatch.setattr(sources, "_fetch", lambda identifier: (Path("data/papers/2112.01488.pdf"), found))

    assert sources.fetch_source("2112.01488") == {
        "status": "ok",
        "path": "data/papers/2112.01488.pdf",
        "url": "https://arxiv.org/pdf/2112.01488",
        "title": "ColBERTv2",
        "index": "arxiv",
        "ids": {"ArXiv": "2112.01488"},
        "source_outcome": {
            "source_kind": "paper", "outcome": "readable", "retryable": False,
            "attempts": [{"provider": "arxiv", "result": "readable_pdf"}],
        },
    }


def test_fetch_source_reports_a_failure_with_its_reason(monkeypatch):
    def refuse(identifier):
        raise sources.NoOpenAccessCopy("paywalled")

    monkeypatch.setattr(sources, "_fetch", refuse)

    assert sources.fetch_source("10.1/x") == {
        "status": "error",
        "message": "paywalled",
        "reason": "no-open-access",
        "retryable": False,
        "source_outcome": {
            "source_kind": "paper", "outcome": "no-accessible-copy", "retryable": False, "attempts": [],
        },
    }


@pytest.mark.parametrize(
    ("identifier", "arxiv_id"),
    [
        ("hep-th/9901001", "hep-th/9901001"),
        ("arXiv:math.GT/0309136v2", "math.GT/0309136"),
        ("2303.12712v3", "2303.12712"),
    ],
)
def test_arxiv_ids_from_before_2007_resolve_to_arxiv(identifier, arxiv_id):
    resolution = sources._lookup(identifier)
    assert (resolution.url, resolution.ids) == (f"https://arxiv.org/pdf/{arxiv_id}", {"ArXiv": arxiv_id})


def test_a_doi_is_quoted_in_the_lookup_paths(monkeypatch):
    asked = []
    monkeypatch.setattr(
        sources, "_semantic_scholar_pdf", lambda paper_id: asked.append(paper_id) or sources.Resolution("x")
    )
    sources._lookup("https://doi.org/10.1000/a#b?c")  # "#" and "?" end a DOI inside a link
    sources._lookup("10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0")
    assert asked == [
        "DOI:10.1000/a",
        "DOI:10.1002/%28SICI%291097-4571%28199806%2949%3A8%3C693%3A%3AAID-ASI4%3E3.0.CO%3B2-0",
    ]


ARXIV_FEED = """<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/2112.11446v2</id>
<title>Scaling Language Models: Methods, Analysis
  &amp; Insights from Training Gopher</title></entry>
<entry><id>http://arxiv.org/abs/2204.02311v5</id>
<title>PaLM: Scaling Language Modeling with Pathways</title></entry>
</feed>"""


def test_arxiv_titles_asks_once_for_all_the_ids(web):
    replies, asked = web
    replies.append(Reply(text=ARXIV_FEED))

    titles = sources.arxiv_titles(["2112.11446", "2204.02311", "2204.02311v3"])

    palm = "PaLM: Scaling Language Modeling with Pathways"
    assert titles == {
        "2112.11446": "Scaling Language Models: Methods, Analysis & Insights from Training Gopher",
        "2204.02311": palm,
        "2204.02311v3": palm,
    }
    assert asked == [sources.ARXIV_API]


def test_arxiv_titles_is_empty_when_arxiv_does_not_answer(web):
    replies, asked = web
    replies.append(requests.ConnectionError("down"))

    assert sources.arxiv_titles(["2112.11446"]) == {}
    assert sources.arxiv_titles([]) == {}
    assert len(asked) == 1


def test_safe_locator_keeps_the_candidate_path_but_removes_credentials_and_secrets():
    locator = sources._safe_locator("https://user:password@example.org/paper.pdf?token=private#page=2")

    assert locator == "https://example.org/paper.pdf"
    assert "password" not in locator and "private" not in locator


@pytest.mark.parametrize(
    ("error", "outcome", "retryable", "source_kind"),
    [
        (sources.Unresolvable("no work"), "no-match", False, "unknown"),
        (sources.AmbiguousMatch("two works"), "ambiguous-match", False, "paper"),
        (sources.IdentityMismatch("wrong DOI"), "identity-mismatch", False, "paper"),
        (sources.NoOpenAccessCopy("paywalled"), "no-accessible-copy", False, "paper"),
        (sources.WebSource("HTML page"), "web-page", False, "web-page"),
        (sources.NotDownloadable("not a PDF"), "invalid-content", False, "unknown"),
        (sources.LookupUnavailable("provider timed out"), "temporary-failure", True, "unknown"),
    ],
)
def test_errors_have_distinct_structured_outcomes(error, outcome, retryable, source_kind):
    result = sources.tool_error(error)

    assert result["source_outcome"] == {
        "source_kind": source_kind,
        "outcome": outcome,
        "retryable": retryable,
        "attempts": [],
    }


@pytest.mark.parametrize(
    ("status", "outcome", "retryable"),
    [
        (403, "blocked", False), (404, "not-found", False),
        (429, "temporary-failure", True), (503, "temporary-failure", True),
    ],
)
def test_http_failures_keep_the_status_and_retryability(status, outcome, retryable):
    response = requests.Response()
    response.status_code = status
    error = sources.NotDownloadable(f"HTTP {status}")
    error.response = response
    error.source_kind = "paper"

    result = sources.tool_error(error)

    assert result["source_outcome"]["outcome"] == outcome
    assert result["source_outcome"]["retryable"] is retryable


def test_download_attempts_record_safe_locator_provider_status_and_retryability(monkeypatch, store_in_tmp):
    expected_url = "https://user:password@publisher.example/paper.pdf?token=private"
    found = sources.Resolution(expected_url, "A paper", "unpaywall", {"DOI": DOI})
    monkeypatch.setattr(sources, "_resolve", lambda identifier, expected=None: found)
    monkeypatch.setattr(sources, "_fallback_resolutions", lambda *args: ([], [], []))
    response = requests.Response()
    response.status_code = 403

    def blocked(url, name):
        raise requests.HTTPError("blocked", response=response)

    monkeypatch.setattr(sources, "_download", blocked)
    with pytest.raises(sources.NotDownloadable) as failure:
        sources._fetch(DOI)

    outcome = sources.tool_error(failure.value)["source_outcome"]
    assert outcome["outcome"] == "blocked"
    assert outcome["retryable"] is False
    assert outcome["attempts"][-1] == {
        "provider": "unpaywall",
        "result": "blocked",
        "host": "publisher.example",
        "locator": "https://publisher.example/paper.pdf",
        "outcome": "blocked",
        "retryable": False,
        "status_code": 403,
    }
    assert "password" not in str(outcome) and "private" not in str(outcome)


def test_same_author_and_year_title_candidates_are_ambiguous_not_selected(monkeypatch):
    candidates = {
        "data": [
            {
                "title": "A Shared Title: A Method Study",
                "year": 2020,
                "authors": [{"name": "Alex Smith"}],
                "openAccessPdf": {"url": "https://wrong.example/one.pdf"},
            },
            {
                "title": "A Shared Title: A Method Study",
                "year": 2020,
                "authors": [{"name": "Alex Smith"}],
                "openAccessPdf": {"url": "https://wrong.example/two.pdf"},
            },
        ]
    }
    monkeypatch.setattr(sources, "_semantic_scholar", lambda path, params: candidates)
    monkeypatch.setattr(sources, "_pdf_of", lambda *args: pytest.fail("an ambiguous candidate was selected"))

    with pytest.raises(sources.AmbiguousMatch):
        sources._semantic_scholar_by_title(
            "A Shared Title: A Method Study", lambda year, author: year == 2020
        )


def test_conflicting_doi_candidate_is_rejected_before_download(monkeypatch, store_in_tmp):
    wrong_doi = "10.1000/wrong"
    candidate = sources.Resolution(
        "https://wrong.example/paper.pdf",
        "A Shared Title",
        "semantic-scholar",
        {"DOI": wrong_doi},
        2020,
        "Alex Smith",
    )
    downloaded = []
    monkeypatch.setattr(sources, "_semantic_scholar_pdf", lambda paper_id: candidate)
    monkeypatch.setattr(sources, "_unpaywall_pdf", lambda doi, expected=None: candidate)
    monkeypatch.setattr(sources, "_download", lambda *args: downloaded.append(args))

    with pytest.raises(sources.IdentityMismatch) as failure:
        sources._fetch(DOI, {"doi": DOI, "title": "A Shared Title", "authors": ["Alex Smith"], "year": 2020})

    assert downloaded == []
    assert sources.tool_error(failure.value)["source_outcome"]["outcome"] == "identity-mismatch"


def test_safe_locator_and_retry_helpers_cover_malformed_inputs():
    assert sources._safe_locator("https://example.org:8443/paper.pdf") == (
        "https://example.org:8443/paper.pdf"
    )
    assert sources._safe_locator("https://[2001:db8::1]:8443/paper.pdf?token=secret") == (
        "https://[2001:db8::1]:8443/paper.pdf"
    )
    assert sources._safe_locator("https://example.org:bad/paper.pdf") == ""
    assert sources._safe_message("HTTP error at https://example.org:8443/paper.pdf?token=x") == (
        "HTTP error at https://example.org:8443/paper.pdf"
    )
    unsafe = "https://user:secret@example.org:bad/paper.pdf?token=private"
    assert sources._safe_message(unsafe) == unsafe
    transient = RuntimeError("network")
    transient.retryable = True
    assert sources.is_retryable(transient)
    assert sources._outcome_code(sources.LookupUnavailable("down")) == "temporary-failure"
    unavailable = sources.LookupUnavailable("not retryable")
    unavailable.retryable = False
    assert sources._outcome_code(unavailable) == "lookup-failed"


def test_reported_failure_does_not_hide_a_retryable_outage_behind_no_copy():
    outage = sources.LookupUnavailable("provider timed out")
    no_copy = sources.NoOpenAccessCopy("another index has no free PDF")

    assert sources._reported([no_copy, outage]) is outage


def test_a_string_author_can_filter_title_results_and_arxiv_ids_are_validated():
    fits = sources._expected_fits({"year": "2020", "authors": "Alex Smith"})
    assert fits(2020, "Alex Smith")
    assert not fits(2019, "Alex Smith")
    bibtex_fits = sources._expected_fits({"year": "2020", "authors": "Smith, Alex"})
    assert bibtex_fits(2020, "Alex Smith")
    assert not bibtex_fits(2020, "Alex Smythe")
    found = sources.Resolution("", "Paper", ids={"ArXiv": "2101.00001v2"})
    with pytest.raises(sources.IdentityMismatch, match="arXiv ID"):
        sources._validate_resolution(found, {"arxiv": "2101.00002v1"})
    sources._validate_resolution(found, {"arxiv": "2101.00001v1"})


def test_arxiv_title_search_rejects_multiple_exact_matches(monkeypatch, web):
    web[0].append(Reply(text='''<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><id>https://arxiv.org/abs/2101.00001</id><title>Same title</title></entry>
      <entry><id>https://arxiv.org/abs/2101.00002</id><title>Same title</title></entry>
    </feed>'''))
    with pytest.raises(sources.AmbiguousMatch):
        sources._arxiv_by_title("Same title", sources._any_work)


def test_openalex_candidate_helpers_cover_empty_and_ambiguous_results(monkeypatch):
    assert sources._openalex_pdfs("not a DOI") == []
    with pytest.raises(sources.NoOpenAccessCopy):
        sources._openalex_resolutions({"title": "Closed work", "locations": []})

    monkeypatch.setattr(indexes, "openalex_search_works", lambda title: [])
    for identifier in ("", "https://example.org/paper", "2112.01488"):
        assert sources._openalex_candidates(identifier) == []
    with pytest.raises(sources.Unresolvable):
        sources._openalex_candidates("Missing work")

    title = "Shared title"
    same = {"title": title, "doi": "https://doi.org/10.1000/a", "locations": [
        {"is_oa": True, "pdf_url": "https://repo.example/a.pdf"},
    ]}
    other = {**same, "doi": "https://doi.org/10.1000/b", "locations": [
        {"is_oa": True, "pdf_url": "https://repo.example/b.pdf"},
    ]}
    monkeypatch.setattr(indexes, "openalex_search_works", lambda requested: [same, other])
    with pytest.raises(sources.AmbiguousMatch):
        sources._openalex_candidates(title)


def test_openalex_reports_other_titles_and_mismatched_dois(monkeypatch):
    title = "Shared title"
    other = {"title": title, "publication_year": 2019, "authorships": [], "locations": []}
    monkeypatch.setattr(indexes, "openalex_search_works", lambda requested: [other])
    with pytest.raises(sources.OnlyOtherWorks):
        sources._openalex_candidates(title, {"title": title, "year": 2020})

    monkeypatch.setattr(indexes, "openalex_work_by_doi", lambda doi: {
        "doi": "https://doi.org/10.1000/other", "title": "A work",
    })
    with pytest.raises(sources.IdentityMismatch):
        sources._openalex_candidates("10.1000/wanted")


def test_openalex_locations_deduplicate_and_keep_identifier_free_candidates():
    work = {
        "title": "A paper",
        "locations": [
            {"is_oa": True, "pdf_url": "https://repo.example/a.pdf"},
            {"is_oa": True, "pdf_url": "https://repo.example/a.pdf"},
        ],
    }
    candidates = sources._openalex_resolutions(work)
    assert [candidate.url for candidate in candidates] == ["https://repo.example/a.pdf"]


def test_unpaywall_skips_locations_without_urls(monkeypatch, web):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "me@example.org")
    web[0].append(Reply(payload={
        "best_oa_location": {"url_for_pdf": ""},
        "oa_locations": [{}, {"url_for_pdf": ""}],
    }))
    with pytest.raises(sources.NoOpenAccessCopy):
        sources._unpaywall_resolutions(DOI)


def test_acl_resource_cache_and_provider_errors(monkeypatch, web):
    monkeypatch.setattr(store, "cache_key", lambda *parts: "acl-cache")
    monkeypatch.setattr(store, "recall_cache", lambda key: {"data": "cached", "fetched_at": 10**12})
    assert sources._acl_resource("data/test.json", json_response=True) == "cached"

    monkeypatch.setattr(store, "recall_cache", lambda key: None)
    web[0].append(Reply(404))
    with pytest.raises(sources.Unresolvable):
        sources._acl_resource("missing.json")
    web[0].append(Reply(payload={}))
    with pytest.raises(sources.LookupUnavailable, match="empty"):
        sources._acl_resource("empty.json", json_response=True)
    class BadJson(Reply):
        def json(self):
            raise ValueError("malformed JSON")

    web[0].append(BadJson())
    with pytest.raises(sources.LookupUnavailable, match="not readable"):
        sources._acl_resource("bad.json", json_response=True)


def test_acl_venue_and_paper_metadata_failure_shapes(monkeypatch):
    with pytest.raises(sources.Unresolvable, match="does not name"):
        sources._acl_venue(" ")
    monkeypatch.setattr(sources, "_acl_resource", lambda *args, **kwargs: {"x": {"name": "Other"}})
    with pytest.raises(sources.Unresolvable, match="no venue"):
        sources._acl_venue("Unknown Venue")
    with pytest.raises(sources.Unresolvable, match="needs a cited venue"):
        sources._acl_anthology_candidates("title only")
    with pytest.raises(sources.LookupUnavailable, match="unknown identifier"):
        sources._acl_paper_id(type("Root", (), {"get": lambda self, key, default="": "bad"})(),
                              type("Node", (), {"get": lambda self, key, default="": "x"})(),
                              type("Node", (), {"get": lambda self, key, default="": "y"})())


def test_acl_venue_partial_acronym_and_modern_paper_id(monkeypatch):
    monkeypatch.setattr(sources, "_acl_resource", lambda *args, **kwargs: {
        "acl": {"name": "Annual Meeting of Computational Linguistics", "acronym": "ACL"},
    })
    assert sources._acl_venue("Proceedings of ACL 2022") == (
        "acl", {"name": "Annual Meeting of Computational Linguistics", "acronym": "ACL"}
    )

    import xml.etree.ElementTree as ET

    root = ET.fromstring('<collection id="2022.acl"><volume id="1"><paper id="2"/></volume></collection>')
    assert sources._acl_paper_id(root, root.find("volume"), root.find("./volume/paper")) == "2022.acl-1.2"


def test_old_acl_venue_without_legacy_id_keeps_its_current_key(monkeypatch):
    monkeypatch.setattr(sources, "_acl_resource", lambda *args, **kwargs: {
        "acl": {"name": "Annual Meeting", "acronym": "ACL"},
    })
    assert sources._acl_venue("ACL", 2019)[0] == "acl"


def test_acl_paper_id_accepts_legacy_ids_and_rejects_malformed_ids():
    import xml.etree.ElementTree as ET

    root = ET.fromstring('<collection id="P02"><volume id="1"><paper id="40"/></volume></collection>')
    assert sources._acl_paper_id(root, root.find("volume"), root.find("./volume/paper")) == "P02-1040"
    malformed = ET.fromstring('<collection id="P02"><volume id="one"><paper id="x"/></volume></collection>')
    with pytest.raises(sources.LookupUnavailable, match="unknown identifier format"):
        sources._acl_paper_id(malformed, malformed.find("volume"), malformed.find("./volume/paper"))


def test_acl_candidate_can_use_direct_doi_without_metadata(monkeypatch):
    candidate = sources._acl_anthology_candidate("10.18653/v1/2022.acl-main.1")
    monkeypatch.setattr(sources, "_acl_venue", lambda *args: pytest.fail("looked up a venue"))
    assert sources._acl_anthology_candidates(
        "10.18653/v1/2022.acl-main.1", {"title": "A paper"}
    ) == [candidate]


def test_acl_candidate_uses_non_legacy_filename_for_an_older_venue(monkeypatch):
    asked = []
    monkeypatch.setattr(sources, "_acl_venue", lambda *args: ("acl", {"name": "ACL"}))
    monkeypatch.setattr(sources, "_acl_resource", lambda path: (
        asked.append(path) or '<collection id="2019.acl"><volume id="1"><paper id="2">'
        '<title>A paper</title><pdf/></paper></volume></collection>'
    ))
    candidate = sources._acl_anthology_candidates("A paper", {
        "title": "A paper", "year": 2019, "venue": "ACL",
    })
    assert asked == ["data/xml/2019.acl.xml"]
    assert candidate[0].url == "https://aclanthology.org/2019.acl-1.2.pdf"


def test_acl_ambiguous_venues_and_malformed_xml_are_not_silently_selected(monkeypatch):
    monkeypatch.setattr(sources, "_acl_resource", lambda *args, **kwargs: {
        "acl": {"name": "Annual Meeting", "acronym": "ACL"},
        "acl-long": {"name": "Annual Meeting", "acronym": "ACL"},
    })
    with pytest.raises(sources.AmbiguousMatch):
        sources._acl_venue("ACL")

    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    monkeypatch.setattr(sources, "_acl_resource", lambda *args, **kwargs: "<collection>")
    with pytest.raises(sources.LookupUnavailable, match="malformed"):
        sources._acl_anthology_candidates("A title", {
            "venue": "ACL", "year": "2022", "title": "A title",
        })


def test_acl_metadata_reports_missing_pdf_and_missing_title_match(monkeypatch):
    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    monkeypatch.setattr(sources, "_acl_resource", lambda *args, **kwargs: (
        '<collection id="2022.acl"><volume id="1"><paper id="2">'
        '<title>Expected paper</title></paper></volume></collection>'
    ))
    with pytest.raises(sources.NoOpenAccessCopy):
        sources._acl_anthology_candidates("Expected paper", {
            "venue": "ACL", "year": 2022, "title": "Expected paper",
        })
    with pytest.raises(sources.Unresolvable):
        sources._acl_anthology_candidates("Missing paper", {
            "venue": "ACL", "year": 2022, "title": "Missing paper",
        })


def test_acl_two_matching_papers_with_no_pdf_are_ambiguous_not_matched(monkeypatch):
    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    monkeypatch.setattr(sources, "_acl_resource", lambda *args, **kwargs: (
        '<collection id="2022.acl"><volume id="1">'
        '<paper id="2"><title>Expected paper</title></paper>'
        '<paper id="3"><title>Expected paper</title></paper>'
        '</volume></collection>'
    ))
    with pytest.raises(sources.NoOpenAccessCopy) as failure:
        sources._acl_anthology_candidates("Expected paper", {
            "venue": "ACL", "year": 2022, "title": "Expected paper",
        })
    assert not getattr(failure.value, "source_attempts", None)


def test_acl_metadata_skips_wrong_dois_and_author_mismatches(monkeypatch):
    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    monkeypatch.setattr(sources, "_acl_resource", lambda *args: (
        '<collection id="2022.acl"><volume id="1">'
        '<paper id="1"><title>Expected paper</title><doi>10.1000/other</doi><pdf/></paper>'
        '<paper id="2"><title>Expected paper</title><doi>10.1000/wanted</doi>'
        '<author><first>Other</first><last>Writer</last></author><pdf/></paper>'
        '</volume></collection>'
    ))
    expected = {
        "doi": "10.1000/wanted", "title": "Expected paper", "venue": "ACL",
        "year": 2022, "authors": ["Alex Smith"],
    }
    with pytest.raises(sources.Unresolvable):
        sources._acl_anthology_candidates("10.1000/wanted", expected)


def test_acl_metadata_rejects_duplicate_matching_papers(monkeypatch):
    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    monkeypatch.setattr(sources, "_acl_resource", lambda *args: (
        '<collection id="2022.acl"><volume id="1">'
        '<paper id="1"><title>Expected paper</title><pdf/></paper>'
        '<paper id="2"><title>Expected paper</title><pdf/></paper>'
        '</volume></collection>'
    ))
    with pytest.raises(sources.AmbiguousMatch):
        sources._acl_anthology_candidates("Expected paper", {
            "title": "Expected paper", "venue": "ACL", "year": 2022,
        })


@pytest.mark.parametrize("pdf_first", [False, True])
@pytest.mark.parametrize("same_id", [False, True])
def test_acl_mixed_pdf_records_keep_no_open_copy_outcome(monkeypatch, pdf_first, same_id):
    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    no_pdf = '<paper id="1"><title>Expected paper</title></paper>'
    pdf = f'<paper id="{1 if same_id else 2}"><title>Expected paper</title><pdf/></paper>'
    records = pdf + no_pdf if pdf_first else no_pdf + pdf
    monkeypatch.setattr(sources, "_acl_resource", lambda *args: (
        f'<collection id="2022.acl"><volume id="1">{records}</volume></collection>'
    ))
    expected = {"title": "Expected paper", "venue": "ACL", "year": 2022}
    with pytest.raises(sources.NoOpenAccessCopy) as failure:
        sources._acl_anthology_candidates("Expected paper", expected)
    assert getattr(failure.value, "source_attempts", []) == (
        [{"provider": "acl_anthology", "result": "matched"}] if same_id else []
    )


@pytest.mark.parametrize("conflict_first", [False, True])
def test_acl_doi_title_conflict_with_a_no_pdf_match_preserves_no_copy(monkeypatch, conflict_first):
    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    no_pdf = '<paper id="1"><title>Expected paper</title><doi>10.1000/wanted</doi></paper>'
    conflict = '<paper id="2"><title>Other paper</title><doi>10.1000/wanted</doi><pdf/></paper>'
    records = conflict + no_pdf if conflict_first else no_pdf + conflict
    monkeypatch.setattr(sources, "_acl_resource", lambda *args: (
        f'<collection id="2022.acl"><volume id="1">{records}</volume></collection>'
    ))
    with pytest.raises(sources.NoOpenAccessCopy) as failure:
        sources._acl_anthology_candidates("10.1000/wanted", {
            "title": "Expected paper", "venue": "ACL", "year": 2022,
        })
    assert not getattr(failure.value, "source_attempts", None)


@pytest.mark.parametrize("bad_pdf_first", [False, True])
def test_acl_no_copy_preserves_legacy_precedence_with_a_malformed_id(monkeypatch, bad_pdf_first):
    monkeypatch.setattr(sources, "_acl_venue", lambda venue, year: ("acl", {}))
    no_pdf = '<paper id="1"><title>Expected paper</title></paper>'
    bad_pdf = '<paper id="?"><title>Expected paper</title><pdf/></paper>'
    records = bad_pdf + no_pdf if bad_pdf_first else no_pdf + bad_pdf
    monkeypatch.setattr(sources, "_acl_resource", lambda *args: (
        f'<collection id="P19"><volume id="1">{records}</volume></collection>'
    ))
    expected_error = sources.LookupUnavailable if bad_pdf_first else sources.NoOpenAccessCopy
    with pytest.raises(expected_error) as failure:
        sources._acl_anthology_candidates("Expected paper", {
            "title": "Expected paper", "venue": "ACL", "year": 2019,
        })
    assert not getattr(failure.value, "source_attempts", None)


def test_source_cache_rejects_a_cached_title_identity_conflict(monkeypatch, store_in_tmp):
    key = sources._normalised("Shared title")
    store.remember_source(key, {
        "url": "https://repo.example/paper.pdf", "title": "Shared title",
        "index": "openalex", "year": 2019, "first_author": "Other Author",
        "fetched_at": __import__("time").time(),
    })
    looked_up = []
    monkeypatch.setattr(sources, "_lookup", lambda identifier, expected=None: (
        looked_up.append(identifier) or sources.Resolution(
            "https://repo.example/new.pdf", "Shared title", "openalex", {}, 2020, "Alex Smith",
        )
    ))
    resolved = sources._resolve(
        "Shared title", {"title": "Shared title", "year": 2020, "author": "Alex Smith"}
    )
    assert resolved.url == "https://repo.example/new.pdf"
    assert looked_up == ["Shared title"]


def test_source_cache_accepts_a_matching_identifier_without_title_filters(monkeypatch, store_in_tmp):
    key = sources._normalised(DOI)
    store.remember_source(key, {
        "url": "https://repo.example/paper.pdf", "title": "A paper", "index": "openalex",
        "ids": {"DOI": DOI}, "fetched_at": __import__("time").time(),
    })
    monkeypatch.setattr(sources, "_lookup", lambda *args: pytest.fail("ignored matching cache"))
    assert sources._resolve(DOI, {"doi": DOI}).url == "https://repo.example/paper.pdf"


def test_source_cache_returns_a_matching_title_and_author(monkeypatch, store_in_tmp):
    key = sources._normalised("Shared title")
    store.remember_source(key, {
        "url": "https://repo.example/paper.pdf", "title": "Shared title", "index": "openalex",
        "year": 2020, "first_author": "Alex Smith", "fetched_at": __import__("time").time(),
    })
    monkeypatch.setattr(sources, "_lookup", lambda *args: pytest.fail("ignored matching cache"))
    assert sources._resolve(
        "Shared title", {"title": "Shared title", "year": 2020, "authors": ["Alex Smith"]}
    ).url == "https://repo.example/paper.pdf"


def test_download_uses_a_valid_cached_pdf_before_making_a_request(monkeypatch, tmp_path):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    cached = tmp_path / "cached.pdf"
    cached.write_bytes(PDF)
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: pytest.fail("downloaded a cached PDF"))
    assert sources._download("https://repo.example/paper.pdf", "cached") == cached


def test_download_replaces_an_invalid_cached_file(monkeypatch, tmp_path, web):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    cached = tmp_path / "cached.pdf"
    cached.write_bytes(b"stale data")
    web[0].append(Reply(content=PDF, content_type="application/pdf"))
    assert sources._download("https://repo.example/paper.pdf", "cached") == cached
    assert cached.read_bytes() == PDF


def test_download_recovers_if_reading_a_cached_file_raises_oserror(monkeypatch, tmp_path, web):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    cached = tmp_path / "cached.pdf"
    cached.write_bytes(b"stale")
    original_open = Path.open

    def open_file(path, *args, **kwargs):
        if path == cached:
            raise OSError("unreadable cache")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", open_file)
    web[0].append(Reply(content=PDF, content_type="application/pdf"))
    assert sources._download("https://repo.example/paper.pdf", "cached") == cached


def test_lookup_outage_keeps_identifier_metadata_in_the_failure(monkeypatch, store_in_tmp):
    monkeypatch.setattr(
        sources, "_resolve", lambda identifier, expected=None: (_ for _ in ()).throw(requests.Timeout("down"))
    )
    monkeypatch.setattr(sources, "_fallback_resolutions", lambda *args: ([], [], []))
    monkeypatch.setattr(
        sources, "_download",
        lambda *args: (_ for _ in ()).throw(sources.NotDownloadable("unavailable")),
    )
    monkeypatch.setattr(sources, "_withdrawn_by", lambda arxiv_id: "")
    with pytest.raises(sources.LookupUnavailable) as failure:
        sources._fetch("https://arxiv.org/abs/2112.01488", {"doi": DOI, "arxiv": "2112.01488"})
    assert failure.value.source_kind == "unknown"
    assert failure.value.source_attempts[0]["provider"] == "source_lookup"


def test_failed_title_lookup_keeps_expected_arxiv_metadata(monkeypatch, store_in_tmp):
    monkeypatch.setattr(
        sources, "_resolve", lambda *args: (_ for _ in ()).throw(sources.Unresolvable("missing"))
    )
    monkeypatch.setattr(sources, "_fallback_resolutions", lambda *args: ([], [], []))
    monkeypatch.setattr(
        sources, "_download", lambda *args: (_ for _ in ()).throw(sources.NotDownloadable("no pdf"))
    )
    monkeypatch.setattr(sources, "_withdrawn_by", lambda arxiv_id: "")
    with pytest.raises(sources.Unresolvable) as failure:
        sources._fetch("A cited title", {"arxiv": "2112.01488"})
    assert failure.value.source_attempts[0]["provider"] == "source_lookup"


def test_a_provider_html_landing_page_is_reported_as_a_paper_download_failure(
    monkeypatch, store_in_tmp, web,
):
    monkeypatch.setattr(
        sources, "_resolve", lambda identifier, expected=None: sources.Resolution(
            "https://publisher.example/paper", "A paper", "semantic-scholar", {"DOI": DOI},
        ),
    )
    monkeypatch.setattr(sources, "_fallback_resolutions", lambda *args: ([], [], []))
    web[0].append(Reply(content=b"<html>Sign in</html>", content_type="text/html"))
    with pytest.raises(sources.NotDownloadable, match="landing page"):
        sources._fetch(DOI)


def test_fallbacks_skip_prior_providers_and_accept_other_index_results(monkeypatch):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "contact@example.org")
    unpaywall = sources.Resolution("https://repo.example/u.pdf", "A paper", "unpaywall", {"DOI": DOI})
    openalex = sources.Resolution(
        "https://repo.example/o.pdf", "A paper", "openalex", {"DOI": "10.18653/v1/2022.acl-main.1"}
    )
    asked = []
    monkeypatch.setattr(
        sources, "_unpaywall_resolutions",
        lambda doi, expected=None: asked.append("unpaywall") or [unpaywall],
    )
    monkeypatch.setattr(sources, "_openalex_candidates", lambda *args: asked.append("openalex") or [openalex])
    acl_doi = "10.18653/v1/2022.acl-main.1"
    found = sources.Resolution(
        "https://publisher.example/p.pdf", "A paper", "semantic_scholar", {"DOI": acl_doi},
        attempts=({"provider": "unpaywall"},),
    )

    resolutions, attempts, failures = sources._fallback_resolutions(acl_doi, {"doi": acl_doi}, found)

    assert asked == ["openalex"]
    assert [item.index for item in resolutions] == ["acl_anthology", "openalex"]
    assert [item["result"] for item in attempts] == ["matched", "matched"]
    assert failures == []


def test_fallbacks_record_provider_request_and_index_errors(monkeypatch):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "contact@example.org")
    monkeypatch.setattr(
        sources, "_unpaywall_resolutions",
        lambda doi, expected=None: (_ for _ in ()).throw(requests.Timeout("down")),
    )
    monkeypatch.setattr(sources, "_acl_anthology_candidate", lambda *args: None)
    monkeypatch.setattr(
        sources, "_openalex_candidates",
        lambda *args: (_ for _ in ()).throw(indexes._IndexError("down")),
    )
    found = sources.Resolution("https://publisher.example/p.pdf", "A paper", "semantic_scholar", {"DOI": DOI})

    resolutions, attempts, failures = sources._fallback_resolutions(DOI, None, found)

    assert resolutions == []
    assert [attempt["provider"] for attempt in attempts] == ["unpaywall", "openalex"]
    assert [attempt["result"] for attempt in attempts] == ["temporary-failure", "temporary-failure"]
    assert len(failures) == 2


def test_fallbacks_reraise_unexpected_adapter_errors(monkeypatch):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "")
    monkeypatch.setattr(sources, "_acl_anthology_candidate", lambda *args: None)
    monkeypatch.setattr(
        sources, "_openalex_candidates",
        lambda *args: (_ for _ in ()).throw(RuntimeError("adapter bug")),
    )
    with pytest.raises(RuntimeError, match="adapter bug"):
        sources._fallback_resolutions(DOI, None, sources.Resolution("", ids={"DOI": DOI}))


def test_fallbacks_allow_an_index_result_when_citation_metadata_is_absent(monkeypatch):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "")
    candidate = sources.Resolution("https://repo.example/p.pdf", "A paper", "openalex", {})
    monkeypatch.setattr(sources, "_openalex_candidates", lambda *args: [candidate])
    resolutions, attempts, failures = sources._fallback_resolutions(
        "A paper", None, sources.Resolution("https://publisher.example/p.pdf", "A paper")
    )
    assert resolutions == [candidate]
    assert attempts == [{"provider": "openalex", "result": "matched", "locator": candidate.url}]
    assert failures == []


def test_lookup_validates_arxiv_pmid_and_url_metadata(monkeypatch):
    with pytest.raises(sources.IdentityMismatch):
        sources._lookup("arxiv:2112.01488", {"arxiv": "2201.00001"})

    wrong = sources.Resolution("https://repo.example/p.pdf", "A paper", ids={"DOI": "10.1000/other"})
    monkeypatch.setattr(sources, "_semantic_scholar_pdf", lambda paper_id: wrong)
    with pytest.raises(sources.IdentityMismatch):
        sources._lookup("12345", {"doi": "10.1000/wanted"})

    assert sources._lookup("https://example.org/paper", {"title": "Expected"}).url == (
        "https://example.org/paper"
    )
