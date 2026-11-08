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

# A single-claim check (POST /verify) is never stored against a paper: no `file`, no `paper`.
CHECK_ONLY = {"id": "e1", "status": "done", "claims": [{"claim": "PLAID is fast.", "citations": []}]}


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
    assert home["conflictsTotal"] == 1
    assert home["alert"].startswith("1 claim in your papers")


def test_home_counts_every_conflict_but_lists_only_the_first_few():
    many = [
        {**CHECKED, "id": f"a{n}", "file": f"data/papers/{n}.pdf", "paper": f"data/papers/{n}.pdf"}
        for n in range(researcher.HOME_CONFLICTS + 2)
    ]
    home = researcher.home(many)
    assert len(home["conflicts"]) == researcher.HOME_CONFLICTS
    assert home["conflictsTotal"] == researcher.HOME_CONFLICTS + 2


def test_short_title_never_cuts_a_word_in_half():
    title = "Retrieval-augmented generation for knowledge-intensive NLP tasks and other things"
    short = researcher.short_title(title)
    assert short.endswith("…")
    assert title.startswith(short.removesuffix("…"))
    assert title[len(short) - 1] == " "


def test_a_conflict_claim_loses_the_pdf_space_before_a_comma():
    tidy = researcher._tidy("limited effectiveness , or worse ; see")
    assert tidy == "limited effectiveness, or worse; see"


def test_a_finished_check_with_no_paper_is_skipped_instead_of_crashing_the_library():
    home = researcher.home(ANALYSES + [CHECK_ONLY])
    assert home["library"]["papers"] == 2  # e1 does not count as a library paper
    assert researcher.library_papers(ANALYSES + [CHECK_ONLY]) == researcher.library_papers(ANALYSES)


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


def test_library_rows_count_how_many_cited_sources_are_publicly_indexed():
    url_only = {"title": "", "authors": [], "year": "", "doi": "", "arxiv": "", "url": "http://example.com/x"}
    paper = {
        "id": "f1",
        "paper": "data/papers/f1.pdf",
        "file": "data/papers/f1.pdf",
        "status": "done",
        "claims": [
            {
                "claim": "A",
                "citations": [COLBERT],
                "verdicts": [
                    {
                        "verdict": "supports",
                        "cited": "2004.12832",
                        "indexed_in": {"index": "semantic-scholar"},
                        "quote": "",
                        "evidence": [],
                    }
                ],
            },
            {
                "claim": "B",
                "citations": [url_only],
                "verdicts": [
                    {"verdict": "insufficient", "cited": "http://example.com/x", "quote": "", "evidence": []}
                ],
            },
        ],
    }
    row = researcher.library(researcher.UNSORTED, [], [paper])["papers"][0]
    assert row["sourcesIndexed"] == 1
    assert row["sourcesNotIndexed"] == 1


def test_library_and_graph_mark_whether_the_analysed_paper_itself_is_indexed():
    checked_and_found = {
        "id": "f2", "paper": "data/papers/f2.pdf", "file": "data/papers/f2.pdf",
        "status": "done", "title": "Found Paper", "claims": [],
        "indexed_in": {"index": "arxiv", "ids": {}},
    }
    checked_and_not_found = {
        "id": "f3", "paper": "data/papers/f3.pdf", "file": "data/papers/f3.pdf",
        "status": "done", "title": "Missing Paper", "claims": [],
        "indexed_in": {"index": "", "ids": {}},
    }
    not_yet_checked = {
        "id": "f4", "paper": "data/papers/f4.pdf", "file": "data/papers/f4.pdf",
        "status": "done", "title": "Unchecked Paper", "claims": [],
    }
    analyses = [checked_and_found, checked_and_not_found, not_yet_checked]

    rows = {row["id"]: row for row in researcher.library(researcher.UNSORTED, [], analyses)["papers"]}
    assert rows["f2"]["indexed"] == "yes" and rows["f2"]["index"] == "arXiv"
    assert rows["f3"]["indexed"] == "no" and rows["f3"]["index"] == ""
    assert rows["f4"]["indexed"] == "" and rows["f4"]["index"] == ""

    nodes = {n["label"]: n for n in researcher.graph(analyses)["nodes"] if n["kind"] == "paper"}
    assert nodes["Found Paper"]["indexed"] == "yes"
    assert nodes["Missing Paper"]["indexed"] == "no"
    assert nodes["Unchecked Paper"]["indexed"] == ""


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


def work(title: str, arxiv: str = "", url: str = "") -> dict:
    return {"title": title, "authors": [], "year": "2021", "doi": "", "arxiv": arxiv, "url": url}


def test_a_cited_work_says_whether_a_public_index_knew_it():
    beir, splade, blog, lost, flaky = (
        work("BEIR: A Heterogeneous Benchmark", "2104.08663"),
        work("SPLADE v2"),
        work("Tevatron docs", url="https://example.org/tevatron"),
        work("A garbled reference title"),
        work("Paper whose PDF would not download"),
    )
    analysis = {
        "id": "i1",
        "paper": "data/papers/i1.pdf",
        "status": "done",
        "title": "Index marks",
        "claims": [
            {
                "claim": "Late interaction generalises out of domain.",
                "citations": [beir, splade, blog],
                "verdicts": [
                    {
                        "verdict": "supports",
                        "cited": "2104.08663",
                        "indexed_in": {"index": "arxiv", "ids": {}},
                    },
                    {
                        "verdict": "insufficient",
                        "cited": "https://example.org/tevatron",
                        "indexed_in": {"index": ""},
                    },
                ],
                "unchecked": [{"source": "SPLADE v2", "reason": "no-open-access", "message": ""}],
            },
            {
                "claim": "Distillation is needed.",
                "citations": [lost, flaky],
                "unchecked": [
                    {"source": "A garbled reference title", "reason": "unresolvable", "message": ""},
                    {
                        "source": "Paper whose PDF would not download",
                        "reason": "not-downloadable",
                        "message": "",
                    },
                ],
            },
        ],
    }
    graph = researcher.graph([analysis])
    marks = {
        node["label"]: (node["indexed"], node["index"]) for node in graph["nodes"] if node["kind"] == "paper"
    }
    assert marks == {
        "Index marks": ("", ""),  # the analysed paper itself was never looked up
        "BEIR": ("yes", "arXiv"),
        "SPLADE v2": ("yes", ""),  # found, but no free copy
        "Tevatron docs": ("no", ""),  # a bare link no index was asked about
        "A garbled reference title": ("no", ""),
        "Paper whose PDF would not download": ("", ""),
    }
    unchecked = [edge for edge in graph["edges"] if edge["relation"] == "unchecked"]
    assert sorted(edge["reason"] for edge in unchecked) == [
        "no-open-access",
        "not-downloadable",
        "unresolvable",
    ]
    # Works we could not check still link to the paper that cites them.
    assert sum(edge["cites"] for edge in graph["paperEdges"]) == 5


def test_found_by_one_citation_beats_not_found_by_another():
    node = {"indexed": "", "index": ""}
    researcher._mark_index(node, ("no", ""))
    researcher._mark_index(node, ("yes", ""))
    researcher._mark_index(node, ("yes", "Semantic Scholar"))
    researcher._mark_index(node, ("no", ""))
    assert node == {"indexed": "yes", "index": "Semantic Scholar"}


SILENT = {
    "id": "g1",
    "paper": "data/papers/gn.pdf",
    "file": "data/papers/gn.pdf",
    "status": "done",
    "claims": [
        {
            "claim": "BN stops working below 8 images per batch.",
            "citations": [COLBERT],
            "verdicts": [{"verdict": "insufficient", "cited": "2004.12832", "evidence": []}],
        },
        {
            # One source says too little, another backs it: the claim is backed, not a gap.
            "claim": "GN is stable across batch sizes.",
            "citations": [COLBERT, PLAID],
            "verdicts": [
                {"verdict": "insufficient", "cited": "2004.12832", "evidence": []},
                {"verdict": "supports", "cited": "2205.09707", "evidence": []},
            ],
        },
    ],
}


def test_gaps_lists_claims_no_source_backs_with_the_works_that_were_checked():
    not_backed = researcher.gaps(ANALYSES + [SILENT])["notBacked"]
    assert not_backed == [
        {
            "claim": "BN stops working below 8 images per batch.",
            "checked": ["ColBERT"],
            "analysis": "g1",
            "claimIndex": 0,
        }
    ]


def test_gaps_lists_every_contradicted_claim_and_every_missing_work_without_homes_limit():
    many = [
        {**CHECKED, "id": f"a{n}", "file": f"data/papers/{n}.pdf", "paper": f"data/papers/{n}.pdf"}
        for n in range(researcher.HOME_CONFLICTS + 2)
    ]
    found = researcher.gaps(many + [UNCHECKED])
    assert len(found["contradicted"]) == researcher.HOME_CONFLICTS + 2
    assert len(researcher.home(many)["conflicts"]) == researcher.HOME_CONFLICTS
    assert found["missing"][0]["paper"] == "PLAID (2022)"


def test_gaps_of_an_empty_library_are_empty():
    assert researcher.gaps([]) == {"notBacked": [], "contradicted": [], "missing": []}
