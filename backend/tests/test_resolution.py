"""What each way of naming a cited work resolves to.

A wrong edit in sources.py does not raise: it quietly resolves fewer works, which reaches
the reader as claims nobody could check. These pin the answer for every path through
_lookup — an arXiv id, a DOI, a PMID, a bare title, a URL — so a change to the resolvers
has to be deliberate. No network: requests is faked, as in test_sources.py.
"""

import sys

import pytest
from app.pipeline import sources

ARXIV_ATOM = """<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>http://arxiv.org/abs/2112.01488v3</id><title>ColBERTv2: Effective and Efficient
  Retrieval via Lightweight Late Interaction</title></entry>
</feed>"""

S2_PAPER = {
    "title": "ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction",
    "year": 2022,
    "externalIds": {"DOI": "10.18653/v1/2022.naacl-main.272", "ArXiv": "2112.01488", "CorpusId": 244799739},
    "openAccessPdf": {"url": "https://aclanthology.org/2022.naacl-main.272.pdf"},
}


class Response:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text
        self.headers = {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"unexpected {self.status_code}")


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """No waiting, no network, and no cache between tests."""
    monkeypatch.setattr(sources, "S2_MIN_INTERVAL", 0.0)
    monkeypatch.setattr(sources, "RETRY_WAITS", (0.01,))
    monkeypatch.setattr(sources, "_s2_free_at", 0.0)


def route(monkeypatch, **by_host):
    """Fake requests.get, answering per host: s2, arxiv, unpaywall."""
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        for host, response in by_host.items():
            if host in url:
                return response
        raise AssertionError(f"unexpected request to {url}")

    monkeypatch.setitem(sys.modules, "requests", type("requests", (), {"get": staticmethod(get)}))
    return calls


def test_an_arxiv_id_resolves_without_asking_anyone(monkeypatch):
    route(monkeypatch)  # any request at all would fail the test
    assert sources._lookup("2112.01488").url == "https://arxiv.org/pdf/2112.01488"


def test_a_doi_resolves_through_semantic_scholar(monkeypatch):
    route(monkeypatch, semanticscholar=Response(payload=S2_PAPER))
    found = sources._lookup("10.18653/v1/2022.naacl-main.272")
    assert found.url == "https://aclanthology.org/2022.naacl-main.272.pdf"
    assert found.title.startswith("ColBERTv2")


def test_a_paywalled_doi_falls_back_to_its_arxiv_twin(monkeypatch):
    paywalled = {**S2_PAPER, "openAccessPdf": None}
    route(monkeypatch, semanticscholar=Response(payload=paywalled))
    assert sources._lookup("10.18653/v1/2022.naacl-main.272").url == "https://arxiv.org/pdf/2112.01488"


def test_a_pmid_resolves_through_semantic_scholar(monkeypatch):
    calls = route(monkeypatch, semanticscholar=Response(payload=S2_PAPER))
    assert sources._lookup("31452104").url == "https://aclanthology.org/2022.naacl-main.272.pdf"
    assert "PMID:31452104" in calls[0]


def test_a_title_resolves_through_arxiv_first(monkeypatch):
    route(monkeypatch, arxiv=Response(text=ARXIV_ATOM))
    found = sources._lookup("ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction")
    assert found.url == "https://arxiv.org/pdf/2112.01488"


def test_a_title_arxiv_does_not_know_falls_through_to_semantic_scholar(monkeypatch):
    route(
        monkeypatch,
        arxiv=Response(text='<feed xmlns="http://www.w3.org/2005/Atom"></feed>'),
        semanticscholar=Response(payload={"data": [S2_PAPER]}),
    )
    found = sources._lookup(S2_PAPER["title"])
    assert found.url == "https://aclanthology.org/2022.naacl-main.272.pdf"


def test_a_wrong_title_is_not_answered_with_the_wrong_paper(monkeypatch):
    route(
        monkeypatch,
        arxiv=Response(text=ARXIV_ATOM),
        semanticscholar=Response(payload={"data": [S2_PAPER]}),
    )
    with pytest.raises(sources.Unresolvable):
        sources._lookup("An entirely different paper about pastry")


def test_a_url_is_taken_as_the_paper_itself(monkeypatch):
    route(monkeypatch)
    assert sources._lookup("https://example.org/paper.pdf").url == "https://example.org/paper.pdf"


def test_the_index_that_answered_is_recorded(monkeypatch):
    """The point of carrying ids at all: the answer says where the work was found."""
    route(monkeypatch, semanticscholar=Response(payload=S2_PAPER))
    found = sources._lookup("10.18653/v1/2022.naacl-main.272")
    assert found.index == "semantic-scholar"
    assert found.ids["ArXiv"] == "2112.01488"
    assert "Scopus" not in found.ids  # Semantic Scholar does not answer for Scopus

    route(monkeypatch)
    direct = sources._lookup("2112.01488")
    assert direct.index == "arxiv"
    assert direct.ids == {"ArXiv": "2112.01488"}

    route(monkeypatch)
    unknown = sources._lookup("https://example.org/paper.pdf")
    assert unknown.index == ""  # a bare URL says nothing about where it is indexed
    assert unknown.ids == {}
