"""The Labeler and Author screen agents' read tools (app/agents/role_tools.py). The route
functions they wrap are replaced, so these check what the tools pass on and what they leave out."""

import asyncio
from types import SimpleNamespace

from app.agents import role_tools
from fastapi import HTTPException

CONTEXT = SimpleNamespace(state={"user": "user-1"})
BUILT = {
    "references": [{"reference_id": "r1", "label": "ColBERTv2 (2022)"}],
    "claims": [
        {
            "claim": "Residual compression cuts the index 6-10x.",
            "sentence": "Residual compression cuts the index 6-10x [3].",
            "candidates": [
                {
                    "cand_id": "c1",
                    "reference_id": "r1",
                    "reference_file": "r1.pdf",
                    "rank": 1,
                    "score": 0.91,
                    "page": 3,
                    "passage": "ColBERTv2 encodes each vector as a centroid and a residual.",
                }
            ],
        }
    ],
}


async def owned(analysis_id, user):
    return {"id": analysis_id}


def test_a_claims_passages_carry_no_verdict_and_no_score(monkeypatch):
    monkeypatch.setattr(role_tools.labeling, "owned_analysis", owned)
    monkeypatch.setattr(role_tools.labeling, "build_session", lambda analysis: BUILT)
    got = asyncio.run(role_tools.claim_passages("a1", 1, CONTEXT))
    assert got["passages"] == [
        {
            "paper": "ColBERTv2 (2022)",
            "page": 3,
            "rank": 1,
            "text": "ColBERTv2 encodes each vector as a centroid and a residual.",
        }
    ]
    assert "verdict" not in str(got) and "score" not in str(got)


def test_a_claim_number_out_of_range_names_the_range(monkeypatch):
    monkeypatch.setattr(role_tools.labeling, "owned_analysis", owned)
    monkeypatch.setattr(role_tools.labeling, "build_session", lambda analysis: BUILT)
    got = asyncio.run(role_tools.claim_passages("a1", 5, CONTEXT))
    assert got == {"status": "error", "message": "this paper has claims 1 to 1, not 5"}


def test_a_paper_the_person_may_not_label_is_an_error_for_the_agent(monkeypatch):
    async def not_theirs(analysis_id, user):
        raise HTTPException(404, "no such analysis")

    monkeypatch.setattr(role_tools.labeling, "owned_analysis", not_theirs)
    got = asyncio.run(role_tools.claim_passages("b1", 1, CONTEXT))
    assert got == {"status": "error", "message": "no such analysis"}


def fake_author(monkeypatch, last_check_id, citations):
    async def get_draft(draft_id, user):
        return {"id": draft_id, "lastCheckId": last_check_id}

    async def parse_draft(draft_id, user):
        return {"warnings": [{"type": "unused-entry", "detail": "lewis2020", "file": "refs.bib", "line": 4}]}

    async def get_check(check_id, user):
        return {"citations": citations}

    monkeypatch.setattr(role_tools.author, "get_draft", get_draft)
    monkeypatch.setattr(role_tools.author, "parse_draft", parse_draft)
    monkeypatch.setattr(role_tools.author, "get_check", get_check)


def test_draft_issues_lists_only_open_citations_and_missing_keys(monkeypatch):
    citations = [
        {"key": "a", "verdict": "supports"},
        {"key": "b", "verdict": "refutes", "message": "the source says the opposite"},
        {"key": "c", "verdict": "insufficient", "resolution": "kept as is"},
        {"key": "d", "verdict": "unchecked", "reason": "missing-key", "message": "no entry d"},
    ]
    fake_author(monkeypatch, "k1", citations)
    got = asyncio.run(role_tools.draft_issues("d1", CONTEXT))
    assert got["checked"] is True
    assert [(c["key"], c["why"]) for c in got["citations"]] == [
        ("b", "the source says the opposite"),
        ("d", "no entry d"),
    ]
    assert got["warnings"][0]["type"] == "unused-entry"


def test_a_draft_never_checked_gives_its_warnings_only(monkeypatch):
    fake_author(monkeypatch, None, [{"key": "x", "verdict": "refutes"}])
    got = asyncio.run(role_tools.draft_issues("d1", CONTEXT))
    assert got["checked"] is False and got["citations"] == []
    assert len(got["warnings"]) == 1


def test_another_persons_draft_is_an_error_for_the_agent(monkeypatch):
    async def not_theirs(draft_id, user):
        raise HTTPException(404, "no such draft")

    monkeypatch.setattr(role_tools.author, "get_draft", not_theirs)
    got = asyncio.run(role_tools.draft_issues("d9", CONTEXT))
    assert got == {"status": "error", "message": "no such draft"}


def test_labeling_papers_keep_the_persons_progress_and_drop_the_rest(monkeypatch):
    async def pool_state(who, user, me):
        assert (who, user, me) == ("ada", "user-1", "user-1")
        paper = {"analysis_id": "a1", "title": "ColBERTv2", "topic": "ir", "claims": 12, "judged": 5}
        return {"papers": [{**paper, "team_judged": 9, "labelers": ["bo"], "keywords": ["retrieval"]}]}

    monkeypatch.setattr(role_tools.identity, "annotator_for", lambda user: "ada")
    monkeypatch.setattr(role_tools.labeling, "pool_state", pool_state)
    got = asyncio.run(role_tools.labeling_papers(CONTEXT))
    assert got == {"papers": [{"id": "a1", "title": "ColBERTv2", "topic": "ir", "claims": 12, "saved": 5}]}
