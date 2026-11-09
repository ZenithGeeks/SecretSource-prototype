"""sources.py paths the other source tests leave out: Unpaywall, downloads that are not PDFs,
title lookups that find only other works, the cache readers and fetch_source.

No network: requests.get answers from a fake, and the store is a SQLite file in tmp_path.
"""

from pathlib import Path

import pytest
import requests
from app.pipeline import sources

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


@pytest.fixture
def papers(monkeypatch, tmp_path):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path / "papers")
    return tmp_path / "papers"


def test_an_html_answer_is_a_web_source(papers, web):
    web[0].append(Reply(content=b"<html>", content_type="text/html; charset=utf-8"))

    with pytest.raises(sources.WebSource, match="a web page"):
        sources._download("https://blog.example/post", "post")


def test_an_answer_that_is_not_a_pdf_is_not_downloadable(papers, web):
    web[0].append(Reply(content=b"PK zip", content_type="application/zip"))

    with pytest.raises(sources.NotDownloadable, match="not a PDF"):
        sources._download("https://example.org/p.zip", "p")


def test_a_pdf_is_saved_with_the_link_beside_it(papers, web):
    web[0].append(Reply(content=PDF))

    path = sources._download("https://example.org/p.pdf", "p")

    assert path.read_bytes() == PDF
    assert sources._link_file(path).read_text() == "https://example.org/p.pdf"


def test_a_lookup_that_fails_on_the_network_is_not_downloadable(monkeypatch):
    def refuse(identifier):
        raise requests.ConnectionError("no route")

    monkeypatch.setattr(sources, "_resolve", refuse)

    with pytest.raises(sources.NotDownloadable, match="no route") as raised:
        sources._fetch("10.1/x")

    assert sources.is_retryable(raised.value)


@pytest.mark.parametrize("error", [sources.WebSource("a web page"), sources.NotDownloadable("not a PDF")])
def test_a_link_that_is_not_a_paper_reports_its_own_error(monkeypatch, store_in_tmp, error):
    monkeypatch.setattr(sources, "_resolve", lambda identifier: sources.Resolution("https://example.org/p"))

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
    def unexpected(identifier):
        raise AssertionError("nothing to look up")

    monkeypatch.setattr(sources, "_resolve", unexpected)

    assert sources.index_paper("") == {"index": "", "ids": {}}


def test_index_paper_that_no_resolver_can_place_is_empty_not_an_error(monkeypatch):
    def unplaced(identifier):
        raise sources.Unresolvable("no such paper")

    monkeypatch.setattr(sources, "_resolve", unplaced)

    assert sources.index_paper("A first upload") == {"index": "", "ids": {}}


def test_index_paper_gives_the_index_the_lookup_found(monkeypatch, store_in_tmp):
    found = sources.Resolution(
        "https://arxiv.org/pdf/2112.01488", "ColBERTv2", "arxiv", {"ArXiv": "2112.01488"}
    )
    monkeypatch.setattr(sources, "_lookup", lambda identifier: found)

    assert sources.index_paper("ColBERTv2", doi="2112.01488") == {
        "index": "arxiv",
        "ids": {"ArXiv": "2112.01488"},
    }


def test_known_title_reads_the_title_back_from_the_cache(monkeypatch, store_in_tmp):
    monkeypatch.setattr(
        sources, "_lookup", lambda identifier: sources.Resolution("https://x/p.pdf", "ColBERTv2")
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
    monkeypatch.setattr(sources, "_fetch", lambda paper: (Path("data/papers/2112.01488.pdf"), None))

    assert sources.local_pdf("2112.01488") == "data/papers/2112.01488.pdf"


def test_fetch_source_describes_the_download(monkeypatch):
    found = sources.Resolution(
        "https://arxiv.org/pdf/2112.01488", "ColBERTv2", "arxiv", {"ArXiv": "2112.01488"}
    )
    monkeypatch.setattr(sources, "_fetch", lambda identifier: (Path("data/papers/2112.01488.pdf"), found))

    assert sources.fetch_source("2112.01488") == {
        "status": "ok",
        "path": "data/papers/2112.01488.pdf",
        "url": "https://arxiv.org/pdf/2112.01488",
        "title": "ColBERTv2",
        "index": "arxiv",
        "ids": {"ArXiv": "2112.01488"},
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
    }
