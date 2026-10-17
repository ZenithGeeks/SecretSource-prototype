"""The result cache (app/store.py's cache_key/remember_cache/recall_cache) and the three call
sites that use it: GROBID's PDF parse (app/pipeline/claims.py), claim extraction (same file,
both extractors), and claim judging (app/pipeline/verify.py). Each of those should call the real
GROBID/LLM exactly once for a given input and reuse the cached answer after that — and never
reuse it for a genuinely different input.
"""

import sys

import pydantic
import pytest
from app import store
from app.pipeline import claims, verify


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """A fresh SQLite file per test, so one test's cached rows never leak into another's."""
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "cache-test.db"))
    monkeypatch.delenv("SUPABASE_URL", raising=False)


def test_cache_key_is_deterministic_and_input_sensitive():
    assert store.cache_key("a", "b", "c") == store.cache_key("a", "b", "c")
    assert store.cache_key("a", "b", "c") != store.cache_key("a", "b", "d")
    # Parts are joined with a separator a caller's own text can't forge, so "ab" + "c" and
    # "a" + "bc" (no separator between them) must not collide.
    assert store.cache_key("ab", "c") != store.cache_key("a", "bc")


def test_remember_and_recall_round_trip():
    key = store.cache_key("ns", "x")
    assert store.recall_cache(key) is None  # nothing stored yet
    store.remember_cache(key, {"value": 42})
    assert store.recall_cache(key) == {"value": 42}
    store.remember_cache(key, {"value": 43})  # overwrite, not a second row
    assert store.recall_cache(key) == {"value": 43}


class _FakeGrobidResponse:
    status_code = 200

    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


def _fake_requests_module(monkeypatch, calls):
    def post(url, files=None, data=None, headers=None, timeout=None):
        calls.append({"url": url, "data": data})
        return _FakeGrobidResponse("<TEI/>")

    fake = type("requests", (), {"post": staticmethod(post)})
    monkeypatch.setitem(sys.modules, "requests", fake)


def test_grobid_pdf_is_cached_by_content_endpoint_and_coordinates(monkeypatch, tmp_path):
    calls = []
    _fake_requests_module(monkeypatch, calls)
    monkeypatch.setattr("app.clients.service_auth.auth_headers", lambda url: {})

    pdf = tmp_path / "paper.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake content")

    claims._grobid_pdf("processFulltextDocument", str(pdf), coordinates=("ref",))
    claims._grobid_pdf("processFulltextDocument", str(pdf), coordinates=("ref",))
    assert len(calls) == 1  # second call was a cache hit

    claims._grobid_pdf("processReferences", str(pdf))  # different endpoint: not a hit
    assert len(calls) == 2

    claims._grobid_pdf("processFulltextDocument", str(pdf), coordinates=("ref", "head"))
    assert len(calls) == 3  # different coordinates: not a hit either

    other_pdf = tmp_path / "other.pdf"
    other_pdf.write_bytes(b"%PDF-1.4 different content")
    claims._grobid_pdf("processFulltextDocument", str(other_pdf), coordinates=("ref",))
    assert len(calls) == 4  # different file content: not a hit


class _FakePrediction:
    def __init__(self, **fields):
        self.__dict__.update(fields)


class _FakeChainOfThought:
    """Stands in for dspy.ChainOfThought(Signature): records every call and answers from a
    dict keyed by the call's own kwargs, so a test can tell a real miss from a wrongly-shared
    cache hit by using two distinct inputs with two distinct expected answers."""

    def __init__(self, calls, answer):
        self._calls = calls
        self._answer = answer

    def __call__(self, **kwargs):
        self._calls.append(kwargs)
        return self._answer(**kwargs)


def _stub_dspy(monkeypatch, calls, answer):
    import dspy

    monkeypatch.setattr(dspy, "ChainOfThought", lambda signature: _FakeChainOfThought(calls, answer))


def test_claim_extraction_is_cached_per_paper_text(monkeypatch):
    calls = []
    _stub_dspy(monkeypatch, calls, lambda paper: _FakePrediction(claims=[f"claim about {paper[:10]}"]))

    run = claims._build_claim_extractor()
    first = run("paper one text")
    again = run("paper one text")
    assert first == again == ["claim about paper one "]
    assert len(calls) == 1  # second call was a cache hit

    different = run("a completely different paper")
    assert different == ["claim about a complete"]
    assert len(calls) == 2  # different input, genuinely re-ran


def test_cited_claim_extraction_is_cached_and_reconstructs_claim_objects(monkeypatch):
    calls = []

    class FakeCitedClaim(pydantic.BaseModel):
        claim: str
        sentence: str

    def answer(paper):
        # Same shape (claim, sentence) as the real CitedClaim that _build_cited_claim_extractor
        # defines locally; run()'s caching code only needs .model_dump() to write the cache — the
        # read path always reconstructs with the real (inaccessible-from-here) local class.
        return _FakePrediction(claims=[FakeCitedClaim(claim="c [b1]", sentence="s.")])

    _stub_dspy(monkeypatch, calls, answer)

    run = claims._build_cited_claim_extractor()
    first = run("window text")
    again = run("window text")
    assert len(calls) == 1
    assert [c.claim for c in first] == [c.claim for c in again] == ["c [b1]"]
    assert [c.sentence for c in first] == [c.sentence for c in again] == ["s."]


def test_judge_is_cached_by_claim_and_evidence_together(monkeypatch):
    calls = []

    def answer(claim, evidence):
        return _FakePrediction(verdict="supports", quote=evidence[0], reasoning="because")

    _stub_dspy(monkeypatch, calls, answer)

    run = verify._build_judge()
    first = run("claim A", ["evidence 1"])
    again = run("claim A", ["evidence 1"])
    assert first == again == {"verdict": "supports", "quote": "evidence 1", "reasoning": "because"}
    assert len(calls) == 1

    # Same claim, different evidence: must not reuse claim A's cached verdict.
    changed_evidence = run("claim A", ["evidence 2"])
    assert changed_evidence["quote"] == "evidence 2"
    assert len(calls) == 2


def test_the_judge_instructions_are_part_of_its_cache_key(monkeypatch):
    keys = []
    monkeypatch.setattr(verify.store, "cache_key", lambda *parts: keys.append(parts) or "key")
    answer = _FakePrediction(verdict="supports", quote="q", reasoning="r")
    _stub_dspy(monkeypatch, [], lambda claim, evidence: answer)

    verify._build_judge()("claim A", ["evidence 1"])

    # A reworded prompt must not read answers cached under the old one.
    assert any("Before answering" in part for part in keys[0])


def test_a_claim_with_the_cited_mark_gets_the_citation_aware_judge(monkeypatch):
    import dspy

    used = []

    def chain_of_thought(signature):
        def judge(claim, evidence):
            used.append(signature.__name__)
            return _FakePrediction(verdict="supports", quote="q", reasoning="r")

        return judge

    monkeypatch.setattr(dspy, "ChainOfThought", chain_of_thought)

    run = verify._build_judge()
    run("We use AdamW [cited] with weight decay 0.1.", ["AdamW decouples weight decay."])
    run("ColBERT reduces the index 10x.", ["evidence"])
    assert used == ["JudgeCitedClaim", "JudgeClaim"]
