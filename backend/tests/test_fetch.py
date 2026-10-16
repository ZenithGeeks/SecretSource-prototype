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
