"""The data tools of the screen agent and the MCP server: they read only the caller's own
analyses, answer from the stored verdicts, and the MCP server lists them as read only."""

import asyncio
from types import SimpleNamespace

import pytest
from app import assistant, main, researcher
from app.agents import data_tools
from fastapi import HTTPException

ME = SimpleNamespace(state={"user": "user-1"})

PAPER = {
    "id": "a1",
    "status": "done",
    "title": "Late interaction survey",
    "authors": ["Omar Khattab"],
    "year": "2020",
    "file": "data/papers/survey.pdf",
    "stages": [{"stage": "done", "message": ""}],
    "claims": [
        {
            "claim": "ColBERT cuts the index size by 10x",
            "sentence": "As shown, ColBERT cuts the index size by 10x [b1].",
            "section": "Results",
            "verdicts": [
                {"cited": "2004.12832", "verdict": "supports", "quote": "6-10x smaller", "reasoning": "Yes."},
            ],
        },
        {"claim": "Late interaction is always slower", "verdicts": [{"cited": "x", "verdict": "refutes"}]},
        {"claim": "Dense retrieval needs no index", "unchecked": [{"source": "y", "reason": "not found"}]},
    ],
}


@pytest.fixture
def library(monkeypatch):
    """main.visible_to and main._owned over one paper that user-1 owns."""

    def owned(analysis_id, user, kind="paper"):
        if analysis_id != "a1" or user != "user-1":
            raise HTTPException(404, "no such analysis")
        return PAPER

    monkeypatch.setattr(main, "_owned", owned)
    monkeypatch.setattr(main, "visible_to", lambda user: [PAPER] if user == "user-1" else [])


def run(tool, *args):
    return asyncio.run(tool(*args, tool_context=ME))


def test_get_analysis_gives_status_standing_and_numbered_claims(library):
    result = run(data_tools.get_analysis, "a1")

    assert result["status"] == "done"
    assert result["standing"] == {"backed": 1, "silent": 0, "contradicted": 1, "unchecked": 1}
    assert [(c["number"], c["standing"]) for c in result["claims"]] == [
        (1, "backed"),
        (2, "contradicted"),
        (3, "unchecked"),
    ]


def test_get_analysis_of_a_failed_run_says_why(library, monkeypatch):
    failed = {**PAPER, "status": "error", "message": "GROBID could not read the PDF"}
    monkeypatch.setattr(main, "_owned", lambda *args, **kwargs: failed)

    assert run(data_tools.get_analysis, "a1")["message"] == "GROBID could not read the PDF"


def test_someone_elses_analysis_reads_as_missing(library):
    stranger = SimpleNamespace(state={"user": "user-2"})

    result = asyncio.run(data_tools.get_analysis("a1", tool_context=stranger))

    assert result["status"] == "error"
    assert "list_papers" in result["message"]


def test_get_claim_gives_the_quote_and_reasoning(library):
    result = run(data_tools.get_claim, "a1", 1)

    assert result["verdicts"] == [
        {"cited": "2004.12832", "verdict": "supports", "quote": "6-10x smaller", "reasoning": "Yes."}
    ]
    assert run(data_tools.get_claim, "a1", 3)["unchecked"] == [{"source": "y", "reason": "not found"}]


def test_get_claim_with_a_number_the_paper_lacks_names_the_range(library):
    assert "1 to 3, not 9" in run(data_tools.get_claim, "a1", 9)["message"]


def test_search_claims_ranks_by_shared_words(library):
    found = run(data_tools.search_claims, "colbert index size")["claims"]

    assert [(c["analysis_id"], c["number"]) for c in found] == [("a1", 1), ("a1", 3)]  # 3 shares "index"


def test_search_claims_of_another_person_finds_nothing(library):
    stranger = SimpleNamespace(state={"user": "user-2"})

    assert asyncio.run(data_tools.search_claims("colbert", tool_context=stranger)) == {"claims": []}


def test_bibtex_lists_the_paper_and_what_its_claims_cite(library, monkeypatch):
    cited = {"title": "ColBERT: Efficient Passage Search", "authors": ["Omar Khattab"], "year": "2020"}
    monkeypatch.setattr(researcher, "find_citation", lambda claim, verdict: cited)

    text = run(data_tools.bibtex, "a1")["bibtex"]

    assert "@misc{khattab2020late," in text
    assert "@misc{khattab2020colbert," in text
    assert "author = {Omar Khattab}" in text


def test_check_text_judges_the_first_sentences_and_counts_the_rest(monkeypatch):
    seen = []

    async def judged(sentences, papers):
        seen.extend(sentences)
        return [{"text": s, "verdict": "supports"} for s in sentences]

    monkeypatch.setattr(main, "papers_of", lambda user: frozenset({"survey.pdf"}))
    monkeypatch.setattr(assistant, "check_text", judged)
    text = " ".join(f"Sentence number {n} makes a claim." for n in range(8)) + " Short."

    result = run(data_tools.check_text, text)

    assert len(seen) == data_tools.MAX_SENTENCES
    assert result["not_checked"] == 2  # "Short." is under MIN_SENTENCE and is not counted
    assert len(result["results"]) == data_tools.MAX_SENTENCES


def test_assistant_check_text_leaves_a_sentence_no_passage_fits_unchecked(monkeypatch):
    monkeypatch.setattr(assistant, "library_passages", lambda sentence, papers: [])

    results = asyncio.run(assistant.check_text(["Nothing here matches at all."], frozenset()))

    assert [(r["source"], r["verdict"]) for r in results] == [(None, "unchecked")]


def test_submit_analysis_starts_a_run_for_the_caller(monkeypatch):
    started = []

    def start(paper, verify, owner):
        started.append((paper, verify, owner))
        return {"id": "n1", "status": "running"}

    monkeypatch.setattr(main, "_start", start)

    assert run(data_tools.submit_analysis, "2112.01488") == {"id": "n1", "status": "running"}
    assert started == [("2112.01488", True, "user-1")]
