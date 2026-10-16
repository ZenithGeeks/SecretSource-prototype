"""A verdict checked against a work's arXiv copy says it used the preprint (#424).

A preprint's wording or numbers can differ from the published version. The lookup, the
download, the search and the judge are fakes, so these tests make no network calls.
"""

from pathlib import Path

import pytest
import requests
from app.author.verify import citation_outcome
from app.pipeline import sources, verify

DOI = "10.1162/tacl.a.729"
LANDING = "https://doi.org/10.1162/tacl.a.729"
ARXIV = "https://arxiv.org/pdf/2507.11408"
PASSAGE = {
    "source": "paper.pdf",
    "text": "Math reasoning improves.",
    "page": 1,
    "start": 0,
    "end": 24,
    "score": 1.0,
}


@pytest.fixture(autouse=True)
def local_store(monkeypatch, tmp_path):
    """The lookup is cached in the store. Keep it in a temp SQLite file, not the shared store."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))


@pytest.fixture
def publisher(monkeypatch):
    """The lookup finds the publisher's link and an arXiv id; `refuses` is whether that link fails."""

    def install(refuses: bool):
        found = sources.Resolution(LANDING, "KisMATH", "semantic-scholar", {"ArXiv": "2507.11408"})
        monkeypatch.setattr(sources, "_lookup", lambda identifier: found)

        def download(url: str, name: str) -> Path:
            if refuses and url == LANDING:
                raise requests.HTTPError(f"403 Client Error: Forbidden for url: {url}")
            return Path(f"/papers/{name}.pdf")

        monkeypatch.setattr(sources, "_download", download)

    return install


@pytest.fixture
def judge(monkeypatch):
    monkeypatch.setattr(verify, "evidence_from", lambda claim, name: [PASSAGE])
    monkeypatch.setattr(verify, "_figures_ready", lambda source: False)
    verdict = {"verdict": "supports", "quote": "Math reasoning improves.", "reasoning": "It says so."}
    monkeypatch.setattr(verify, "_judge", lambda claim, passages: verdict)


def check(claim: str = "KisMATH improves math reasoning") -> dict:
    path, _ = sources._fetch(DOI)
    return verify.check_prepared(claim, DOI, path)


def test_a_verdict_from_the_arxiv_copy_is_marked_as_a_preprint(publisher, judge):
    publisher(refuses=True)

    verdict = check()

    assert verdict["status"] == "ok"
    assert verdict["source_version"] == "preprint"
    assert verdict["arxiv"] == "2507.11408"


def test_a_verdict_from_the_publisher_pdf_is_not_marked(publisher, judge):
    publisher(refuses=False)

    verdict = check()

    assert verdict["status"] == "ok"
    assert "source_version" not in verdict and "arxiv" not in verdict


def test_a_second_run_still_knows_it_read_the_preprint(publisher, judge, monkeypatch):
    publisher(refuses=True)
    check()
    # The PDF is on disk now, so the next run downloads nothing, from either link.
    monkeypatch.setattr(sources, "_download", lambda url, name: Path(f"/papers/{name}.pdf"))

    assert check()["source_version"] == "preprint"


def test_the_author_citation_carries_the_preprint():
    result = {
        "status": "ok",
        "verdict": "supports",
        "source": "paper.pdf",
        "evidence": [],
        "source_version": "preprint",
        "arxiv": "2507.11408",
    }

    outcome = citation_outcome(result)

    assert outcome["sourceVersion"] == "preprint"
    assert outcome["arxiv"] == "2507.11408"


def test_an_author_citation_from_the_publisher_has_no_version():
    outcome = citation_outcome({"status": "ok", "verdict": "supports", "source": "paper.pdf", "evidence": []})

    assert "sourceVersion" not in outcome and "arxiv" not in outcome


@pytest.mark.parametrize(
    ("url", "version"),
    [
        (ARXIV, {"source_version": "preprint", "arxiv": "2507.11408"}),
        ("https://arxiv.org/pdf/2112.01488v3", {"source_version": "preprint", "arxiv": "2112.01488v3"}),
        (LANDING, {}),
        ("https://aclanthology.org/2022.naacl-main.272.pdf", {}),
    ],
)
def test_only_an_arxiv_link_is_a_preprint(url, version):
    assert sources.preprint_of(url) == version
