"""find_cited_work: a title-only bib entry is checked against the work with that title whose
year and first author agree with the entry, never a same-titled work by others (#436).

A real SQLite store in a temp file; requests is faked per host, so nothing leaves the machine.
"""

import sys
import time

import pytest
from app import store
from app.author import verify
from app.pipeline import sources

GOODFELLOW = {"title": "Deep learning", "author": "Goodfellow, Ian and Bengio, Yoshua", "year": "2016"}

# The paper the #425 run checked 18 citations of Goodfellow et al. against.
POLSON_ATOM = """<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>http://arxiv.org/abs/1807.07987v2</id><title>Deep Learning</title>
  <published>2018-07-20T17:51:58Z</published>
  <author><name>Nicholas G. Polson</name></author><author><name>Vadim O. Sokolov</name></author>
  </entry>
</feed>"""

BOOK = {
    "title": "Deep Learning",
    "year": 2016,
    "authors": [{"authorId": "153440022", "name": "Ian J. Goodfellow"}],
    "externalIds": {"DOI": "10.5555/3086952"},
    "openAccessPdf": {"url": "https://www.deeplearningbook.org/book.pdf"},
}


class Response:
    def __init__(self, payload=None, text=""):
        self.status_code = 200
        self._payload = payload or {}
        self.text = text
        self.headers = {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        pass


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    """A fresh SQLite store, and no waiting between Semantic Scholar calls."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    monkeypatch.setattr(sources, "S2_MIN_INTERVAL", 0.0)
    monkeypatch.setattr(sources, "_s2_free_at", 0.0)


def route(monkeypatch, **by_host):
    """Fake requests.get, answering per host: arxiv, semanticscholar. sources imports
    requests inside each function, so replacing the module is enough."""
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        for host, response in by_host.items():
            if host in url:
                return response
        raise AssertionError(f"unexpected request to {url}")

    monkeypatch.setitem(sys.modules, "requests", type("requests", (), {"get": staticmethod(get)}))
    return calls


def test_a_same_titled_work_by_other_authors_is_not_checked(monkeypatch):
    route(
        monkeypatch,
        arxiv=Response(text=POLSON_ATOM),
        semanticscholar=Response(payload={"data": []}),
    )
    with pytest.raises(sources.OnlyOtherWorks, match=r"Deep Learning \(2018, Nicholas G\. Polson\)"):
        verify.find_cited_work("Deep learning", GOODFELLOW)


def test_a_paywall_on_the_matching_work_is_reported_over_the_skipped_one(monkeypatch):
    route(
        monkeypatch,
        arxiv=Response(text=POLSON_ATOM),
        semanticscholar=Response(payload={"data": [{**BOOK, "openAccessPdf": None}]}),
    )
    with pytest.raises(sources.NoOpenAccessCopy):
        verify.find_cited_work("Deep learning", GOODFELLOW)


def test_the_matching_work_is_used_when_another_shares_its_title(monkeypatch):
    route(
        monkeypatch,
        arxiv=Response(text=POLSON_ATOM),
        semanticscholar=Response(payload={"data": [BOOK]}),
    )
    assert verify.find_cited_work("Deep learning", GOODFELLOW) == "10.5555/3086952"


def test_an_arxiv_paper_that_fits_is_named_by_its_link(monkeypatch):
    route(monkeypatch, arxiv=Response(text=POLSON_ATOM))
    polson = {"title": "Deep learning", "author": "Polson, Nicholas", "year": "2017"}
    assert verify.find_cited_work("Deep learning", polson) == "https://arxiv.org/pdf/1807.07987"


def test_an_entry_without_year_or_author_takes_the_first_work_with_its_title(monkeypatch):
    route(monkeypatch, arxiv=Response(text=POLSON_ATOM))
    found = verify.find_cited_work("Deep learning", {"title": "Deep learning"})
    assert found == "https://arxiv.org/pdf/1807.07987"


def test_a_cached_work_saved_without_year_or_author_is_looked_up_again(monkeypatch):
    """Rows from before #436 hold the wrong paper for "deep learning", with nothing to check."""
    store.remember_source(
        sources._normalised("Deep learning"),
        {
            "url": "https://arxiv.org/pdf/1807.07987",
            "title": "Deep Learning",
            "index": "arxiv",
            "ids": {"ArXiv": "1807.07987"},
            "fetched_at": time.time(),
        },
    )
    calls = route(
        monkeypatch,
        arxiv=Response(text=POLSON_ATOM),
        semanticscholar=Response(payload={"data": [BOOK]}),
    )
    assert verify.find_cited_work("Deep learning", GOODFELLOW) == "10.5555/3086952"
    assert len(calls) == 2


def test_a_cached_work_that_fits_is_used_without_a_lookup(monkeypatch):
    route(
        monkeypatch,
        arxiv=Response(text=POLSON_ATOM),
        semanticscholar=Response(payload={"data": [BOOK]}),
    )
    verify.find_cited_work("Deep learning", GOODFELLOW)

    calls = route(monkeypatch)  # any request at all would fail the test
    assert verify.find_cited_work("Deep learning", GOODFELLOW) == "10.5555/3086952"
    assert calls == []
