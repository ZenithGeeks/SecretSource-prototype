"""A cited arXiv paper whose authors withdrew it is reported as withdrawn, not as a 404 (#463).

A real SQLite store in a temp file. The lookup, the download and arXiv's abstract page are
replaced, so nothing leaves the machine.
"""

import types

import pytest
import requests
from app.pipeline import sources

ARXIV_ID = "2305.13664"
WITHDRAWN_PAGE = (
    '<div id="abs"><span class="error" style="border: 2px solid grey">'
    "This paper has been withdrawn by Achraf Bahamou</span>"
)


@pytest.fixture
def dead_link(monkeypatch, tmp_path):
    """An arXiv ID whose PDF link answers 404, as a withdrawn paper's does."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    found = sources.Resolution(f"https://arxiv.org/pdf/{ARXIV_ID}", "", "arxiv", {"ArXiv": ARXIV_ID})
    monkeypatch.setattr(sources, "_lookup", lambda identifier: found)

    def not_found(url: str, name: str):
        raise requests.HTTPError(f"404 Client Error: Not Found for url: {url}")

    monkeypatch.setattr(sources, "_download", not_found)


def abstract_page(monkeypatch, text: str, status: int = 200):
    asked = []

    def get(url, **kwargs):
        asked.append(url)
        return types.SimpleNamespace(ok=status < 400, text=text)

    monkeypatch.setattr(requests, "get", get)
    return asked


def test_a_withdrawn_paper_says_who_withdrew_it(dead_link, monkeypatch):
    asked = abstract_page(monkeypatch, WITHDRAWN_PAGE)

    with pytest.raises(sources.Withdrawn) as error:
        sources._fetch(ARXIV_ID)

    assert str(error.value).startswith("arXiv 2305.13664 was withdrawn by Achraf Bahamou")
    assert sources.tool_error(error.value)["reason"] == "withdrawn"
    assert sources.tool_error(error.value)["retryable"] is False
    assert asked == [f"https://arxiv.org/abs/{ARXIV_ID}"]


def test_a_paper_that_is_not_withdrawn_keeps_the_download_error(dead_link, monkeypatch):
    abstract_page(monkeypatch, '<div id="abs"><h1 class="title">ColBERTv2</h1>')

    with pytest.raises(sources.NotDownloadable, match="404 Client Error"):
        sources._fetch(ARXIV_ID)


def test_an_unreadable_abstract_page_keeps_the_download_error(dead_link, monkeypatch):
    abstract_page(monkeypatch, "Service Unavailable", status=503)

    with pytest.raises(sources.NotDownloadable, match="404 Client Error"):
        sources._fetch(ARXIV_ID)
