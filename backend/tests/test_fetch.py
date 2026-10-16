"""_fetch downloads a work from where the lookup found it, or else from its arXiv copy (#408).

The lookup and the download are replaced, so these tests make no network calls.
"""

from pathlib import Path

import pytest
import requests
from app.pipeline import sources

LANDING = "https://doi.org/10.1162/tacl.a.729"
ARXIV = "https://arxiv.org/pdf/2507.11408"


def refused(url: str) -> requests.HTTPError:
    return requests.HTTPError(f"403 Client Error: Forbidden for url: {url}")


@pytest.fixture(autouse=True)
def local_store(monkeypatch, tmp_path):
    """A failed fetch drops its cached rows (#414). Keep that in a temp SQLite file: config.py
    loads the repo's .env, and with SUPABASE_URL set it would delete shared rows."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))


@pytest.fixture
def lookup(monkeypatch):
    """Make the lookup answer with `found`, and the download fail for the URLs in `refuses`."""
    tried: list[str] = []

    def install(found: sources.Resolution, refuses: dict[str, Exception]):
        monkeypatch.setattr(sources, "_resolve", lambda identifier: found)

        def download(url: str, name: str) -> Path:
            tried.append(url)
            if url in refuses:
                raise refuses[url]
            return Path(f"/papers/{name}.pdf")

        monkeypatch.setattr(sources, "_download", download)
        return tried

    return install


def test_a_refused_publisher_link_falls_back_to_the_arxiv_copy(lookup):
    found = sources.Resolution(LANDING, "KisMATH", "semantic-scholar", {"ArXiv": "2507.11408"})
    tried = lookup(found, {LANDING: refused(LANDING)})

    path, used = sources._fetch("10.1162/tacl.a.729")

    assert tried == [LANDING, ARXIV]
    assert path == Path("/papers/10.1162-tacl.a.729.pdf")
    assert used.url == ARXIV and used.ids == {"ArXiv": "2507.11408"}


def test_a_landing_page_that_is_html_also_falls_back(lookup):
    found = sources.Resolution(LANDING, ids={"ArXiv": "2507.11408"})
    tried = lookup(found, {LANDING: sources.WebSource(f"a web page, not a paper: {LANDING}")})

    assert sources._fetch("10.1162/tacl.a.729")[1].url == ARXIV
    assert tried == [LANDING, ARXIV]


def test_without_an_arxiv_copy_the_publisher_error_is_reported(lookup):
    tried = lookup(
        sources.Resolution(LANDING, ids={"DOI": "10.1162/tacl.a.729"}), {LANDING: refused(LANDING)}
    )

    with pytest.raises(sources.NotDownloadable, match="403 Client Error"):
        sources._fetch("10.1162/tacl.a.729")
    assert tried == [LANDING]


def test_when_both_copies_fail_the_first_error_is_reported(lookup):
    found = sources.Resolution(LANDING, ids={"ArXiv": "2507.11408"})
    lookup(found, {LANDING: refused(LANDING), ARXIV: sources.NotDownloadable(f"not a PDF: {ARXIV}")})

    with pytest.raises(sources.NotDownloadable, match="Forbidden for url: https://doi.org"):
        sources._fetch("10.1162/tacl.a.729")


def test_a_working_link_is_used_and_arxiv_is_not_asked(lookup):
    pdf = "https://aclanthology.org/2022.naacl-main.272.pdf"
    tried = lookup(sources.Resolution(pdf, ids={"ArXiv": "2112.01488"}), {})

    assert sources._fetch("10.18653/v1/2022.naacl-main.272")[1].url == pdf
    assert tried == [pdf]


# Unpaywall's answer for 10.1162/tacl.a.782 on 2026-10-16, cut to the fields used: the best
# location is the publisher's PDF link, which answers a script with 403, and the work is also on
# arXiv. Semantic Scholar does not know this DOI, so Unpaywall is the only lookup that answers.
UNPAYWALL_TACL_782 = {
    "title": "A TACL paper",
    "best_oa_location": {
        "host_type": "publisher",
        "url_for_pdf": "https://direct.mit.edu/tacl/article-pdf/doi/10.1162/TACL.a.782/2624576",
    },
    "oa_locations": [
        {
            "host_type": "publisher",
            "url_for_pdf": "https://direct.mit.edu/tacl/article-pdf/doi/10.1162/TACL.a.782/2624576",
        },
        {"host_type": "repository", "url_for_pdf": "https://arxiv.org/pdf/2509.22047"},
        {"host_type": "repository", "url": "https://doi.org/10.48550/arxiv.2509.22047"},
    ],
}


class UnpaywallAnswer:
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload

    def raise_for_status(self):
        pass


def test_unpaywall_keeps_the_arxiv_copy_it_lists(monkeypatch):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "team@example.org")
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: UnpaywallAnswer(UNPAYWALL_TACL_782))

    found = sources._unpaywall_pdf("10.1162/tacl.a.782")

    assert found.url == "https://direct.mit.edu/tacl/article-pdf/doi/10.1162/TACL.a.782/2624576"
    assert found.ids == {"DOI": "10.1162/tacl.a.782", "ArXiv": "2509.22047"}


def test_a_doi_only_unpaywall_knows_is_fetched_from_its_arxiv_copy(monkeypatch, lookup):
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "team@example.org")
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: UnpaywallAnswer(UNPAYWALL_TACL_782))
    found = sources._unpaywall_pdf("10.1162/tacl.a.782")
    publisher = found.url
    tried = lookup(found, {publisher: refused(publisher)})

    assert sources._fetch("10.1162/tacl.a.782")[1].url == "https://arxiv.org/pdf/2509.22047"
    assert tried == [publisher, "https://arxiv.org/pdf/2509.22047"]


def test_unpaywall_without_an_arxiv_copy_records_only_the_doi(monkeypatch):
    publisher_only = {
        "title": "An ACM paper",
        "best_oa_location": {"host_type": "publisher", "url": "https://doi.org/10.1145/3829641.3829780"},
        "oa_locations": [{"host_type": "publisher", "url": "https://doi.org/10.1145/3829641.3829780"}],
    }
    monkeypatch.setattr(sources, "UNPAYWALL_EMAIL", "team@example.org")
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: UnpaywallAnswer(publisher_only))

    assert sources._unpaywall_pdf("10.1145/3829641.3829780").ids == {"DOI": "10.1145/3829641.3829780"}
