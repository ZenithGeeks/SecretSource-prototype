"""The cache of where a cited work's PDF is: how long a row is trusted, and what a failed
download does to it (#414).

A real SQLite store in a temp file; only the lookup and the download are replaced, so these
tests make no network calls.
"""

import time

import pytest
import requests
from app import store
from app.pipeline import sources

DOI = "10.1162/tacl.a.782"
PUBLISHER = "https://direct.mit.edu/tacl/article-pdf/doi/10.1162/TACL.a.782/2624576"


@pytest.fixture
def lookups(monkeypatch, tmp_path):
    """A fresh SQLite store, and a lookup that answers PUBLISHER and counts its calls."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    monkeypatch.setattr(sources, "_fallback_resolutions", lambda *args: ([], [], []))
    calls: list[str] = []

    def lookup(identifier: str, expected: dict | None = None) -> sources.Resolution:
        calls.append(identifier)
        return sources.Resolution(PUBLISHER, "A TACL paper", "unpaywall", {"DOI": DOI})

    monkeypatch.setattr(sources, "_lookup", lookup)
    return calls


def test_a_fresh_row_is_used_without_a_lookup(lookups):
    sources._resolve(DOI)
    assert sources._resolve(DOI).url == PUBLISHER
    assert lookups == [DOI]


def test_a_row_older_than_the_limit_is_looked_up_again(lookups):
    store.remember_source(
        sources._normalised(DOI),
        {
            "url": "https://old.example/paper.pdf",
            "title": "A TACL paper",
            "fetched_at": time.time() - sources.SOURCE_MAX_AGE - 60,
        },
    )

    assert sources._resolve(DOI).url == PUBLISHER
    assert lookups == [DOI]


def test_a_row_saved_before_timestamps_is_still_used(lookups):
    # Expiring every old row at once would send every cited work back to Semantic Scholar,
    # which refuses many calls even with a key, so they stay until a download fails.
    store.remember_source(sources._normalised(DOI), {"url": PUBLISHER, "title": "A TACL paper"})

    assert sources._resolve(DOI).url == PUBLISHER
    assert lookups == []


def test_a_failed_download_drops_the_cached_rows(lookups, monkeypatch):
    def refuse(url: str, name: str):
        raise requests.HTTPError(f"403 Client Error: Forbidden for url: {url}")

    monkeypatch.setattr(sources, "_download", refuse)
    with pytest.raises(sources.NotDownloadable):
        sources._fetch(DOI)

    assert store.recall_source(sources._normalised(DOI)) is None
    assert store.recall_source(sources._normalised("A TACL paper")) is None
    sources._resolve(DOI)
    assert lookups == [DOI, DOI]


def test_a_working_download_keeps_the_row(lookups, monkeypatch, tmp_path):
    monkeypatch.setattr(sources, "_download", lambda url, name: tmp_path / f"{name}.pdf")

    sources._fetch(DOI)

    assert store.recall_source(sources._normalised(DOI))["url"] == PUBLISHER
