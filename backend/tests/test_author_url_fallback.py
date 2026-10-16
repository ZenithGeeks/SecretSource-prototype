"""verify_cached: a bib URL that is a landing page or a dead link is followed by a lookup of
the entry's title, and the claim is judged against what that finds (#438).

The judge and the title lookup are replaced; the verdict cache is a temp SQLite file.
"""

import pytest
from app import store
from app.author import verify
from app.pipeline import sources

OPENREVIEW = "https://openreview.net/forum?id=k7FuTOWMOc7"
EDM = {
    "title": "Elucidating the Design Space of Diffusion-Based Generative Models",
    "author": "Karras, Tero",
    "year": "2022",
    "url": OPENREVIEW,
}
ARXIV_COPY = "https://arxiv.org/pdf/2206.00364"


@pytest.fixture(autouse=True)
def cache(monkeypatch, tmp_path):
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "verdicts.db"))
    monkeypatch.setattr(store, "_use_supabase", lambda: False)


def judge(failures: dict[str, str]):
    """A stand-in for verify_claim: the reason for each source in `failures`, else a verdict."""
    calls = []

    def run(claim, source):
        calls.append(source)
        if source in failures:
            return {"status": "error", "reason": failures[source], "message": f"{failures[source]}: {source}"}
        return {"status": "ok", "verdict": "supports", "quote": "q", "reasoning": "r", "source": source}

    return run, calls


@pytest.mark.parametrize("reason", ["web-source", "not-downloadable"])
def test_an_unreadable_link_is_followed_by_the_title(monkeypatch, reason):
    monkeypatch.setattr(verify, "find_cited_work", lambda title, fields: ARXIV_COPY)
    run, calls = judge({OPENREVIEW: reason})

    result = verify.verify_cached("EDM samples in 35 steps", OPENREVIEW, run, EDM)

    assert result["verdict"] == "supports" and result["source"] == ARXIV_COPY
    assert calls == [OPENREVIEW, ARXIV_COPY]


def test_the_link_failure_stands_when_the_title_finds_nothing(monkeypatch):
    def nothing(title, fields):
        raise sources.Unresolvable(f"no paper found matching the title: {title}")

    monkeypatch.setattr(verify, "find_cited_work", nothing)
    run, calls = judge({OPENREVIEW: "web-source"})

    result = verify.verify_cached("EDM samples in 35 steps", OPENREVIEW, run, EDM)

    assert result["reason"] == "web-source" and calls == [OPENREVIEW]


def test_a_link_without_a_title_is_not_looked_up(monkeypatch):
    def not_called(title, fields):
        raise AssertionError("looked up an entry with no title")

    monkeypatch.setattr(verify, "find_cited_work", not_called)
    run, _ = judge({OPENREVIEW: "web-source"})

    result = verify.verify_cached("a claim", OPENREVIEW, run, {"url": OPENREVIEW})
    assert result["reason"] == "web-source"


def test_other_failures_of_a_link_are_not_looked_up(monkeypatch):
    def not_called(title, fields):
        raise AssertionError("a paywalled link was looked up by title")

    monkeypatch.setattr(verify, "find_cited_work", not_called)
    run, _ = judge({OPENREVIEW: "no-open-access"})

    result = verify.verify_cached("a claim", OPENREVIEW, run, EDM)
    assert result["reason"] == "no-open-access"
