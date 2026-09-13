"""The researcher screens are built from the user's own analyses.

Two small analyses stand in for a user's library: one paper whose claim a cited work
contradicts, and one that cites the same work twice without being checked.
"""

from app import researcher

COLBERT = {
    "title": "ColBERT: Efficient and Effective Passage Search",
    "authors": ["Omar Khattab", "Matei Zaharia"],
    "year": "2020",
    "doi": "",
    "arxiv": "2004.12832",
    "url": "",
}
PLAID = {
    "title": "PLAID: An Efficient Engine for Late Interaction Retrieval",
    "authors": ["Keshav Santhanam"],
    "year": "2022",
    "doi": "",
    "arxiv": "2205.09707",
    "url": "",
}

CHECKED = {
    "id": "a1",
    "paper": "data/papers/2112.01488.pdf",
    "file": "data/papers/2112.01488.pdf",
    "status": "done",
    "title": "ColBERTv2: Effective and Efficient Retrieval",
    "authors": ["Keshav Santhanam", "Omar Khattab"],
    "year": "2022",
    "claims": [
        {
            "claim": "Residual compression reduces the index size by six to ten times.",
            "sentence": "",
            "citations": [COLBERT],
            "verdicts": [
                {
                    "verdict": "refutes",
                    "cited": "2004.12832",
                    "quote": "we leave compression to future work",
                    "reasoning": "defers compression",
                    "evidence": [{"page": 7}],
                }
            ],
        },
        {
            "claim": "Late interaction keeps retrieval quality high.",
            "sentence": "",
            "citations": [COLBERT, PLAID],
            "verdicts": [
                {"verdict": "supports", "cited": "2004.12832", "quote": "late interaction", "evidence": []},
                {
                    "verdict": "supports",
                    "cited": "2205.09707",
                    "quote": "fast late interaction",
                    "evidence": [],
                },
            ],
        },
    ],
}
UNCHECKED = {
    "id": "b1",
    "paper": "data/papers/other.pdf",
    "file": "data/papers/other.pdf",
    "status": "done",
    "claims": [
        {"claim": "PLAID is fast.", "citations": [PLAID]},
        {"claim": "PLAID uses centroids.", "citations": [PLAID]},
    ],
}
RUNNING = {"id": "c1", "paper": "x.pdf", "status": "running", "claims": []}
ANALYSES = [CHECKED, UNCHECKED, RUNNING]


def test_home_counts_claims_and_lists_the_contradicted_one():
    home = researcher.home(ANALYSES)
    assert home["library"] == {
        "papers": 2,
        "claims": 4,
        "verified": 2,
        "tally": {"backed": 1, "silent": 0, "contradicted": 1, "unchecked": 2},
    }
    assert home["conflicts"][0]["against"] == ["ColBERT"]
    assert home["conflicts"][0]["analysis"] == "a1"
    assert home["alert"].startswith("1 claim in your papers")


def test_the_reading_queue_suggests_works_cited_more_than_once_that_are_not_analysed():
    queue = researcher.home(ANALYSES)["queue"]
    assert queue[0]["paper"] == "PLAID (2022)"
    assert queue[0]["identifier"] == "2205.09707"
    assert "2 papers" in queue[0]["note"]


def test_an_analysed_paper_is_not_suggested_for_reading():
    colbert = {
        "id": "d1",
        "paper": "2004.12832",
        "file": "data/papers/2004.12832.pdf",
        "status": "done",
        "claims": [],
    }
    papers = [paper["paper"] for paper in researcher.home(ANALYSES + [colbert])["queue"]]
    assert not any(paper.startswith("ColBERT") for paper in papers)


def test_papers_in_no_project_are_unsorted_and_a_project_lists_its_own():
    stored = [{"id": "p1", "name": "Retrieval", "analyses": ["a1"], "updated": "2026-09-13T10:00:00+00:00"}]
    projects = researcher.projects(stored, ANALYSES)
    assert [(p["id"], p["papers"]) for p in projects] == [("p1", 1), ("unsorted", 1)]
    library = researcher.library("p1", stored, ANALYSES)
    assert [paper["id"] for paper in library["papers"]] == ["a1"]
    assert library["papers"][0]["cite"] == "Santhanam et al. 2022"
    assert library["papers"][0]["contradicted"] == 1
    assert researcher.library("unsorted", stored, ANALYSES)["papers"][0]["backed"] is None
    assert researcher.library("missing", stored, ANALYSES) is None


def test_consensus_reuses_the_verdicts_of_matching_claims():
    answer = researcher.consensus("does residual compression reduce index size", ANALYSES)
    assert answer["refutes"] == 1
    assert answer["rows"][0]["paper"] == "ColBERT"
    assert answer["rows"][0]["cite"] == "Khattab et al., 2020"
    assert researcher.consensus("", ANALYSES)["rows"] == []
    assert researcher.consensus("quantum chromodynamics", ANALYSES)["rows"] == []


def test_the_graph_links_papers_claims_and_the_works_that_answer_them():
    graph = researcher.graph(ANALYSES)
    relations = {edge["relation"] for edge in graph["edges"]}
    assert {"asserts", "backs", "contradicts"} <= relations
    papers = {node["label"] for node in graph["nodes"] if node["kind"] == "paper"}
    assert {"ColBERTv2", "other", "ColBERT", "PLAID"} <= papers
    assert any(edge["cites"] and edge["contradicted"] == 1 for edge in graph["paperEdges"])
