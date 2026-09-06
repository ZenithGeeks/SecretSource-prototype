"""The gateway's run through the workflow graph: the stages it streams and the analysis it
stores look as they did when the run was a loop. The pipeline is stubbed, so this needs no
service, model or network."""

import asyncio
import copy
import os

import pytest

os.environ.setdefault("ANALYSES_DB", os.path.join(os.environ.get("TMPDIR", "/tmp"), "test-analyses.db"))

import app.workflow as workflow  # noqa: E402
from app import main  # noqa: E402

CLAIMS = [
    {"claim": "A", "citations": [{"doi": "10.1/a"}, {"title": "T"}]},
    {"claim": "B", "citations": []},
    {"claim": "C", "citations": [{"url": "https://x"}]},
]


def fake_extract(paper):
    if paper == "missing.pdf":
        return {"status": "error", "message": "no such file: missing.pdf"}
    return {
        "status": "ok",
        "file": "data/papers/x.pdf",
        "claims": copy.deepcopy(CLAIMS),
        "extracted": 5,
        "windows": 2,
    }


def fake_verify(text, source):
    if source == "https://x":
        return {"status": "error", "message": "no pdf", "reason": "unresolvable"}
    return {
        "status": "ok",
        "verdict": "supports",
        "quote": "q",
        "reasoning": "r",
        "source": source,
        "evidence": [],
    }


@pytest.fixture(autouse=True)
def stubbed_pipeline(monkeypatch, tmp_path):
    monkeypatch.setattr(workflow, "extract_claims_with_citations", fake_extract)
    monkeypatch.setattr(workflow, "verify_claim", fake_verify)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    main.analyses.clear()
    main.streams.clear()


def run(paper, verify=True):
    analysis_id = "test1234"
    main.analyses[analysis_id] = {
        "id": analysis_id,
        "paper": paper,
        "status": "running",
        "stages": [],
        "claims": [],
    }
    main.streams[analysis_id] = asyncio.Queue()
    asyncio.run(main._run(analysis_id, paper, verify))
    return main.analyses[analysis_id]


def test_stages_and_claims_match_the_loop():
    analysis = run("x.pdf")
    kinds = [stage["stage"] for stage in analysis["stages"]]
    assert kinds[:2] == ["extracting", "extracted"]
    assert kinds.count("verifying") == 3  # two sources for A, one for C; B cites nothing
    assert sorted(kinds[2:-1]) == sorted(["verifying"] * 3 + ["verified", "verified", "failed"])
    assert kinds[-1] == "done" and analysis["status"] == "done"
    extracted = analysis["stages"][1]
    assert (extracted["claims"], extracted["extracted"], extracted["windows"]) == (3, 5, 2)
    assert analysis["file"] == "data/papers/x.pdf"
    claims = analysis["claims"]
    assert [v["cited"] for v in claims[0]["verdicts"]] == ["10.1/a", "T"]
    assert "verdicts" not in claims[1] and "unchecked" not in claims[1]
    assert claims[2]["unchecked"] == [{"source": "https://x", "reason": "web-source", "message": "no pdf"}]
    failed = next(stage for stage in analysis["stages"] if stage["stage"] == "failed")
    assert failed["claim"] == 2 and failed["reason"] == "web-source"


def test_verification_off_stops_after_the_claims():
    analysis = run("x.pdf", verify=False)
    assert [stage["stage"] for stage in analysis["stages"]] == ["extracting", "extracted", "done"]
    assert len(analysis["claims"]) == 3 and "verdicts" not in analysis["claims"][0]


def test_a_paper_that_cannot_be_read_is_an_error():
    analysis = run("missing.pdf")
    assert analysis["status"] == "error" and "missing.pdf" in analysis["message"]
    assert [stage["stage"] for stage in analysis["stages"]] == ["extracting", "error"]
