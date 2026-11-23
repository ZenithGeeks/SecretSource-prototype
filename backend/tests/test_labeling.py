"""The labeling API: what a session shows, what a save writes, and what it refuses.

The Sheet is replaced by an in-memory store and the analysis by a fixture, so this needs neither
Google nor the gateway's heavy imports.
"""

import asyncio
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import app
import pytest
import requests
from app import auth, config
from app.labeling import dspy_export, ledger, pool, scopus
from app.labeling import router as labeling
from app.labeling.schema import ALL_TABS, current
from app.pipeline import verify
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


class MemoryLedger:
    def __init__(self):
        self.tabs = {tab: [] for tab in ALL_TABS}
        self.reads: list[tuple[str, str | None]] = []

    def read(self, tab, paper_id=None):
        self.reads.append((tab, paper_id))
        return [dict(r) for r in self.tabs[tab] if paper_id is None or r.get("paper_id") == paper_id]

    def append(self, tab, rows):
        self.tabs[tab] += [{c: str(r.get(c, "")) for c in ALL_TABS[tab]} for r in rows]


ANALYSIS = {
    "id": "a1",
    "status": "done",
    "file": "data/papers/paperA-0123456789ab.pdf",
    "title": "Paper A",
    "claims": [
        {
            "claim": "Method Y improves recall.",
            "sentence": "We show Y improves recall.",
            "section": "3",
            "verdicts": [
                {
                    "source": "refB-aaaaaaaaaaaa.pdf",
                    "cited": "Ref B",
                    "evidence": [
                        {"text": "recall rose by 4 points", "page": 5, "score": 9.1},
                        {"text": "unrelated", "page": 2, "score": 3.0},
                    ],
                }
            ],
        },
        {"claim": "Y is fast.", "verdicts": []},
    ],
}


@pytest.fixture
def api(monkeypatch):
    db = MemoryLedger()
    monkeypatch.setattr(ledger, "get_store", lambda: db)
    monkeypatch.setattr(pool, "_cache", (0.0, []))
    # The paper list asks OpenAlex for keywords; a test that wants some stubs openalex_details.
    monkeypatch.setattr(scopus, "_subjects", {})
    monkeypatch.setattr(scopus, "openalex_details", lambda dois: {})
    monkeypatch.setattr(scopus, "rank_of", lambda doi: None)  # listing a paper looks up its venue
    app = FastAPI()
    app.include_router(labeling.router)
    app.dependency_overrides[labeling.owned_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.mine_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.annotator] = lambda: "chanya"
    app.dependency_overrides[labeling.current_user] = lambda: None
    app.dependency_overrides[labeling.is_lead] = lambda: True  # a test of a non-lead says so
    return TestClient(app), db, app


def passage(client, rank=1):
    s = client.get("/labeling/sessions/a1").json()
    return s, s["claims"][0]["candidates"][rank - 1]


def test_session_lists_claims_with_ranked_candidates(api):
    client, _, _ = api
    s, first = passage(client)
    assert s["paper_id"] == "paperA-0123456789ab"
    assert [c["claim_id"] for c in s["claims"]] == ["paperA-0123456789ab#0", "paperA-0123456789ab#1"]
    assert (first["rank"], first["reference_id"], first["passage"]) == (
        1,
        "refB-aaaaaaaaaaaa",
        "recall rose by 4 points",
    )
    assert s["references"] == [
        {
            "reference_id": "refB-aaaaaaaaaaaa",
            "file": "refB-aaaaaaaaaaaa.pdf",
            "label": "Ref B",
            "ref": "",
            "authors": [],
            "year": "",
        }
    ]


def test_a_reference_is_named_by_its_title_when_the_citation_list_has_it():
    citation = {
        "ref": "b47",
        "title": "Passage Re-ranking with BERT",
        "authors": ["Rodrigo Nogueira", "Kyunghyun Cho"],
        "year": "2019",
        "arxiv": "1901.04085",
        "doi": "",
        "url": "",
    }
    claim = {
        "claim": "BERT re-ranks passages well.",
        "citations": [citation],
        "verdicts": [{"source": "data/papers/1901.04085.pdf", "cited": "1901.04085", "evidence": []}],
    }
    session = labeling.build_session({**ANALYSIS, "claims": [claim]})
    assert session["references"] == [
        {
            "reference_id": "1901.04085",
            "file": "1901.04085.pdf",
            "label": "Passage Re-ranking with BERT",
            "ref": "b47",
            "authors": ["Rodrigo Nogueira", "Kyunghyun Cho"],
            "year": "2019",
        }
    ]


def test_session_carries_where_the_paper_cites_its_references():
    marker = {"ref": "b4", "text": "[4]", "page": 1, "x0": 1, "y0": 2, "x1": 3, "y1": 4}

    assert labeling.build_session({**ANALYSIS, "markers": [marker]})["markers"] == [marker]
    assert labeling.build_session(ANALYSIS)["markers"] == []  # an analysis from before markers


def test_session_asks_the_store_only_for_that_papers_rows(api):
    client, db, _ = api
    db.append("claims", [_claim("chanya", "paperA-0123456789ab#0")])
    db.append("claims", [_claim("chanya", "other-paper#0", paper="other-paper")])
    db.reads.clear()
    s = client.get("/labeling/sessions/a1").json()
    # The assignments (who checks what blind) are one small cached read of their own.
    assert sorted(r for r in db.reads if r[0] != "assignments") == sorted(
        (tab, "paperA-0123456789ab") for tab in ("claims", "candidates", "labels")
    )
    assert [r["claim_id"] for r in s["saved"]["claims"]] == ["paperA-0123456789ab#0"]


def test_save_copies_retrieved_fields_from_the_analysis_not_the_request(api):
    client, db, _ = api
    s, cand = passage(client)
    body = {
        "candidates": [
            {
                "claim_id": "paperA-0123456789ab#0",
                "reference_id": "forged",
                "cand_id": cand["cand_id"],
                "origin": "retrieved",
                "status": "relevant",
                "passage": "forged text",
            }
        ]
    }
    assert client.post("/labeling/sessions/a1/save", json=body).status_code == 200
    row = db.tabs["candidates"][0]
    assert (row["passage"], row["reference_id"], row["rank"], row["annotator"]) == (
        "recall rose by 4 points",
        "refB-aaaaaaaaaaaa",
        "1",
        "chanya",
    )


def test_save_label_and_read_it_back_as_mine_with_others_listed(api):
    client, db, app = api
    label = {
        "claim_id": "paperA-0123456789ab#0",
        "reference_id": "refB-aaaaaaaaaaaa",
        "evidence": 3,
        "rationale": "=SUM(A1)",
        "spans": ["recall rose by 4 points"],
        "confidence": "high",
    }
    assert client.post("/labeling/sessions/a1/save", json={"labels": [label]}).json()["labels"] == 1
    assert db.tabs["labels"][0]["rationale"] == "=SUM(A1)"  # kept as text, never run as a formula
    assert db.tabs["labels"][0]["claim"] == "Method Y improves recall."
    mine = client.get("/labeling/sessions/a1").json()
    assert [r["evidence"] for r in mine["saved"]["labels"]] == ["3"]
    app.dependency_overrides[labeling.annotator] = lambda: "nuttanon"
    other = client.get("/labeling/sessions/a1").json()
    assert other["saved"]["labels"] == []
    assert other["others"] == {"paperA-0123456789ab#0|refB-aaaaaaaaaaaa": ["chanya"]}


def test_an_unset_confidence_is_stored_empty_and_an_omitted_one_stays_medium(api):
    client, db, _ = api
    label = {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 3}
    assert client.post("/labeling/sessions/a1/save", json={"labels": [label]}).status_code == 200
    assert db.tabs["labels"][0]["confidence"] == "medium"  # an older client leaves the field out
    unset = client.post("/labeling/sessions/a1/save", json={"labels": [{**label, "confidence": ""}]})
    assert unset.status_code == 200
    assert db.tabs["labels"][-1]["confidence"] == ""
    assert client.get("/labeling/sessions/a1").json()["saved"]["labels"][0]["confidence"] == ""
    bad = client.post("/labeling/sessions/a1/save", json={"labels": [{**label, "confidence": "skipped"}]})
    assert bad.status_code == 422


def test_rows_belong_to_the_account_not_to_the_name(api):
    client, db, app = api
    claim = {"claim_id": "paperA-0123456789ab#0", "origin": "extracted", "status": "accepted", "claim": "x"}

    def saved():
        return [r["status"] for r in client.get("/labeling/sessions/a1").json()["saved"]["claims"]]

    app.dependency_overrides[labeling.current_user] = lambda: "account-1"
    client.post("/labeling/sessions/a1/save", json={"claims": [claim]})
    row = db.tabs["claims"][0]
    assert (row["annotator"], row["annotator_id"]) == ("chanya", "account-1")
    # The same account under a new name still has its rows.
    app.dependency_overrides[labeling.annotator] = lambda: "chanya k."
    assert saved() == ["accepted"]
    # Another account with the very same name has none, and its save does not replace the first one's.
    app.dependency_overrides[labeling.current_user] = lambda: "account-2"
    assert saved() == []
    client.post("/labeling/sessions/a1/save", json={"claims": [{**claim, "status": "rejected"}]})
    assert saved() == ["rejected"]
    app.dependency_overrides[labeling.current_user] = lambda: "account-1"
    assert saved() == ["accepted"]


def test_a_row_saved_before_annotator_id_counts_as_the_name_that_saved_it(api):
    client, db, _ = api
    old = {c: "" for c in ALL_TABS["claims"] if c != "annotator_id"}
    row = {
        **old,
        "paper_id": "paperA-0123456789ab",
        "claim_id": "paperA-0123456789ab#0",
        "origin": "extracted",
    }
    db.tabs["claims"] += [
        {**row, "annotator": "chanya", "status": "accepted", "claim": "x"},
        {**row, "annotator": "nuttanon", "status": "rejected", "claim": "x"},
    ]
    saved = client.get("/labeling/sessions/a1").json()["saved"]["claims"]
    assert [r["status"] for r in saved] == ["accepted"]
    assert client.get("/labeling/export?tab=claims").status_code == 200
    assert client.get("/labeling/export?tab=labels").status_code == 200


def test_a_later_save_replaces_the_earlier_one_but_keeps_both_rows(api):
    client, db, _ = api
    label = {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 2}
    client.post("/labeling/sessions/a1/save", json={"labels": [label]})
    client.post("/labeling/sessions/a1/save", json={"labels": [{**label, "evidence": 4}]})
    assert len(db.tabs["labels"]) == 2
    assert [r["evidence"] for r in current("labels", db.tabs["labels"])] == ["4"]


@pytest.mark.parametrize(
    "body",
    [
        {
            "labels": [
                {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 5}
            ]
        },
        {"labels": [{"claim_id": "paperA-0123456789ab#0", "reference_id": "nope", "evidence": 2}]},
        {"labels": [{"claim_id": "other-paper#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 2}]},
        {
            "labels": [
                {"claim_id": "paperA-0123456789ab#9", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 2}
            ]
        },
        {
            "claims": [
                {
                    "claim_id": "paperA-0123456789ab#9",
                    "origin": "extracted",
                    "status": "accepted",
                    "claim": "x",
                }
            ]
        },
        {
            "candidates": [
                {
                    "claim_id": "paperA-0123456789ab#0",
                    "reference_id": "refB-aaaaaaaaaaaa",
                    "cand_id": "bogus",
                    "origin": "retrieved",
                    "status": "relevant",
                }
            ]
        },
        {
            "candidates": [
                {
                    "claim_id": "paperA-0123456789ab#0",
                    "reference_id": "not-read",
                    "origin": "human_added",
                    "status": "relevant",
                    "passage": "x",
                }
            ]
        },
    ],
)
def test_save_refuses_what_the_analysis_does_not_contain(api, body):
    client, db, _ = api
    assert client.post("/labeling/sessions/a1/save", json=body).status_code in (422,)
    assert all(not rows for rows in db.tabs.values())  # nothing half-written


def test_misses_are_recorded(api):
    client, db, _ = api
    body = {
        "claims": [
            {
                "claim_id": "paperA-0123456789ab#1",
                "origin": "extracted",
                "status": "rejected",
                "claim": "tampered",
            },
            {
                "claim_id": "paperA-0123456789ab#h-abc123",
                "origin": "human_added",
                "status": "accepted",
                "claim": "Z works.",
            },
        ],
        "candidates": [
            {
                "claim_id": "paperA-0123456789ab#h-abc123",
                "reference_id": "refB-aaaaaaaaaaaa",
                "origin": "human_added",
                "status": "relevant",
                "page": 7,
                "passage": "Z works in table 2",
            }
        ],
    }
    assert client.post("/labeling/sessions/a1/save", json=body).status_code == 200
    rows = {r["claim_id"]: r for r in db.tabs["claims"]}
    assert (
        rows["paperA-0123456789ab#1"]["claim"] == "Y is fast."
        and rows["paperA-0123456789ab#1"]["status"] == "rejected"
    )
    assert rows["paperA-0123456789ab#h-abc123"]["origin"] == "human_added"
    assert db.tabs["candidates"][0]["origin"] == "human_added"


UNREAD = {
    "ref": "b2",
    "title": "Chain-of-Thought Is Not Explainability",
    "authors": ["Fazl Barez"],
    "year": "2020",
}


def _with_an_unread_citation() -> dict:
    """ANALYSIS whose first claim also cites [b2], a work with no PDF (#824)."""
    read = {"ref": "b5", "title": "Ref B", "authors": [], "year": ""}
    first = {**ANALYSIS["claims"][0], "citations": [read, UNREAD]}
    return {**ANALYSIS, "claims": [first, ANALYSIS["claims"][1]]}


def _citing(*citations: dict) -> dict:
    """ANALYSIS whose second claim cites these works, none of which was read."""
    second = {**ANALYSIS["claims"][1], "sentence": "Y is fast [b9].", "citations": list(citations)}
    return {**ANALYSIS, "claims": [ANALYSIS["claims"][0], second]}


VENUE_ONLY = {
    "ref": "b9",
    "label": "10",
    "title": "",
    "venue": "ACM Transactions on Modeling and Computer Simulation (TOMACS)",
    "authors": ["P Velho", "L M Schnorr", "H Casanova", "A Legrand"],
    "year": "2013",
    "doi": "",
    "arxiv": "",
    "url": "",
}


def test_a_cited_work_with_no_title_is_listed_by_its_authors_and_venue():
    # #937: the reference list gave no article title, so the work was not looked up.
    session = labeling.build_session(_citing(VENUE_ONLY))

    assert session["claims"][1]["cited"] == ["b9"]
    assert session["claims"][1]["unchecked"][0]["source_outcome"]["outcome"] == "not-attempted"
    assert session["unread"] == [
        {
            "reference_id": "unread-b9",
            "file": "",
            "label": "Velho et al., ACM Transactions on Modeling and Computer Simulation (TOMACS)",
            "ref": "b9",
            "authors": ["P Velho", "L M Schnorr", "H Casanova", "A Legrand"],
            "year": "2013",
        }
    ]


@pytest.mark.parametrize(
    ("authors", "year", "label"),
    [
        ([], "2008", "Journal of Instrumentation"),
        (["H B Newman"], "", "Newman, Journal of Instrumentation"),
        (["H B Newman", "I C Legrand"], "2001", "Newman and Legrand, Journal of Instrumentation"),
    ],
)
def test_a_titleless_work_is_labelled_with_the_authors_it_has(authors, year, label):
    work = {
        **VENUE_ONLY,
        "ref": "b2",
        "venue": "Journal of Instrumentation",
        "authors": authors,
        "year": year,
    }

    [unread] = labeling.build_session(_citing(work))["unread"]

    assert unread["label"] == label
    assert unread["year"] == year


def test_a_work_with_neither_title_nor_venue_keeps_its_printed_number():
    work = {**VENUE_ONLY, "venue": "", "url": "https://example.org/x"}

    [unread] = labeling.build_session(_citing(work))["unread"]

    assert unread["label"] == "10"


def test_session_lists_cited_works_that_have_no_pdf():
    session = labeling.build_session(_with_an_unread_citation())

    assert [r["reference_id"] for r in session["references"]] == ["refB-aaaaaaaaaaaa"]
    assert session["unread"] == [
        {
            "reference_id": "unread-b2",
            "file": "",
            "label": "Chain-of-Thought Is Not Explainability",
            "ref": "b2",
            "authors": ["Fazl Barez"],
            "year": "2020",
        }
    ]
    assert labeling.build_session(ANALYSIS)["unread"] == []


def test_session_exposes_web_evidence_with_a_stable_page_location():
    url = "https://example.org/article"
    web_claim = {
        **ANALYSIS["claims"][0],
        "citations": [
            {"ref": "b5", "title": "Useful page", "url": url, "authors": ["A Writer"], "year": "2024"}
        ],
        "verdicts": [
            {
                "cited": url,
                "source": url,
                "source_kind": "web-page",
                "web_title": "Useful page",
                "retrieved_at": "2026-11-23T00:00:00+00:00",
                "verdict": "supports",
                "evidence": [
                    {
                        "text": "The web paragraph is the evidence.",
                        "page": None,
                        "paragraph": 1,
                        "locator": f"{url}#finding",
                    }
                ],
            }
        ],
    }

    session = labeling.build_session({**ANALYSIS, "claims": [web_claim]})

    assert session["references"] == [
        {
            "reference_id": "web-b5",
            "file": "web-b5",
            "label": "Useful page",
            "ref": "b5",
            "authors": ["A Writer"],
            "year": "2024",
            "source_kind": "web-page",
            "url": url,
            "retrieved_at": "2026-11-23T00:00:00+00:00",
            "web_passages": [
                {
                    "text": "The web paragraph is the evidence.",
                    "locator": f"{url}#finding",
                    "paragraph": 1,
                }
            ],
        }
    ]
    assert session["claims"][0]["candidates"][0]["locator"] == f"{url}#finding"
    assert session["claims"][0]["candidates"][0]["paragraph"] == 1
    assert session["unread"] == []


def test_a_hand_added_claim_searches_cached_web_paragraphs_without_colbert(api, monkeypatch):
    url = "https://example.org/article"
    web_claim = {
        **ANALYSIS["claims"][0],
        "citations": [{"ref": "b5", "title": "Useful page", "url": url}],
        "verdicts": [
            {
                "cited": url,
                "source": url,
                "source_kind": "web-page",
                "web_title": "Useful page",
                "verdict": "supports",
                "evidence": [
                    {
                        "text": "Static analysis detects software defects in large projects.",
                        "page": None,
                        "paragraph": 2,
                        "locator": f"{url}#finding",
                    }
                ],
            }
        ],
    }
    analysis = {**ANALYSIS, "claims": [web_claim]}
    client, _, app_client = api
    app_client.dependency_overrides[labeling.owned_analysis] = lambda: analysis
    monkeypatch.setattr(verify, "evidence_from", lambda *args: pytest.fail("web pages are not in ColBERT"))

    found = client.post(
        "/labeling/sessions/a1/candidates",
        json={
            "claim_id": HAND_ADDED,
            "claim": "Static analysis detects software defects.",
        },
    )

    assert found.status_code == 200
    [candidate] = found.json()["candidates"]
    assert candidate["reference_id"] == "web-b5"
    assert candidate["page"] is None
    assert candidate["paragraph"] == 2
    assert candidate["locator"] == f"{url}#finding"


def test_a_labeler_can_acknowledge_review_of_changed_source_evidence(monkeypatch):
    analysis = copy.deepcopy(ANALYSIS)
    analysis["claims"][0]["needs_review"] = True
    saved = []
    monkeypatch.setattr(app, "main", SimpleNamespace(_save_soon=saved.append), raising=False)

    response = asyncio.run(
        labeling.acknowledge_source_review(
            "a1",
            {"claim_id": "paperA-0123456789ab#0", "evidence_revision": 0},
            analysis,
            "chanya",
        )
    )

    assert response == {
        "claim_id": "paperA-0123456789ab#0", "evidence_revision": 0, "reviewed": True
    }
    assert analysis["claims"][0]["needs_review"] is False
    assert saved == ["a1"]


def test_source_review_cannot_acknowledge_a_newer_evidence_revision():
    analysis = copy.deepcopy(ANALYSIS)
    analysis["claims"][0].update(needs_review=True, evidence_revision=2)

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            labeling.acknowledge_source_review(
                "a1",
                {"claim_id": "paperA-0123456789ab#0", "evidence_revision": 1},
                analysis,
                "chanya",
            )
        )

    assert error.value.status_code == 409
    assert analysis["claims"][0]["needs_review"] is True


def test_save_keeps_a_passage_and_a_level_for_a_work_with_no_pdf(api):
    client, db, app = api
    app.dependency_overrides[labeling.owned_analysis] = _with_an_unread_citation
    body = {
        "candidates": [
            {
                "claim_id": "paperA-0123456789ab#0",
                "reference_id": "unread-b2",
                "origin": "human_added",
                "status": "relevant",
                "page": 3,
                "passage": "CoT traces are not faithful explanations.",
            }
        ],
        "labels": [{"claim_id": "paperA-0123456789ab#0", "reference_id": "unread-b2", "evidence": 3}],
    }

    assert client.post("/labeling/sessions/a1/save", json=body).status_code == 200
    saved = client.get("/labeling/sessions/a1").json()["saved"]
    assert [r["reference_id"] for r in saved["candidates"]] == ["unread-b2"]
    assert [r["evidence"] for r in saved["labels"]] == ["3"]


def test_unconfigured_store_is_a_503_with_setup_message(api, monkeypatch):
    client, _, _ = api

    def boom():
        raise ledger.NotConfigured("set SUPABASE_URL")

    monkeypatch.setattr(ledger, "get_store", boom)
    r = client.get("/labeling/sessions/a1")
    assert r.status_code == 503 and "SUPABASE_URL" in r.json()["detail"]


def test_export_is_csv_of_current_rows(api):
    client, _, _ = api
    label = {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 2}
    client.post("/labeling/sessions/a1/save", json={"labels": [label]})
    client.post("/labeling/sessions/a1/save", json={"labels": [{**label, "evidence": 4}]})
    text = client.get("/labeling/export?tab=labels").text.splitlines()
    assert len(text) == 2 and text[0].startswith("ts,annotator,annotator_id,paper_id")


def test_export_gives_your_own_rows_unless_the_team_is_asked_for(api):
    client, db, _ = api

    def label(account, paper):
        return {"annotator_id": account, "paper_id": paper, "claim_id": f"{paper}#0", "evidence": 3}

    db.append("labels", [label("somchai", "paperB"), label("chanya", "paperA"), label("somchai", "paperA")])

    def accounts_and_papers(url):
        lines = client.get(url).text.splitlines()[1:]
        return [tuple(line.split(",")[2:4]) for line in lines]

    assert accounts_and_papers("/labeling/export?tab=labels") == [("chanya", "paperA")]
    assert accounts_and_papers("/labeling/export?tab=labels&scope=team") == [
        ("chanya", "paperA"),
        ("somchai", "paperA"),
        ("somchai", "paperB"),
    ]
    assert client.get("/labeling/export?tab=labels&scope=everyone").status_code == 422


def test_export_drops_what_a_person_took_back(api):
    client, _, _ = api
    c0, c1 = "paperA-0123456789ab#0", "paperA-0123456789ab#1"
    ref = "refB-aaaaaaaaaaaa"
    client.post(
        "/labeling/sessions/a1/save",
        json={
            "claims": [{"claim_id": c0, "origin": "extracted", "status": "accepted", "claim": "x"}],
            "labels": [{"claim_id": c0, "reference_id": ref, "evidence": 3}],
            "candidates": [
                {
                    "claim_id": c0,
                    "reference_id": ref,
                    "origin": "human_added",
                    "status": "relevant",
                    "passage": "p",
                }
            ],
        },
    )
    client.post(
        "/labeling/sessions/a1/save",
        json={
            "claims": [{"claim_id": c0, "origin": "extracted", "status": "accepted", "claim": "x"}],
            "candidates": [
                {
                    "claim_id": c0,
                    "reference_id": ref,
                    "origin": "human_added",
                    "status": "rejected",
                    "passage": "p",
                }
            ],
        },
    )
    assert len(client.get("/labeling/export?tab=candidates").text.splitlines()) == 1  # header only
    client.post(
        "/labeling/sessions/a1/save",
        json={"claims": [{"claim_id": c0, "origin": "extracted", "status": "rejected", "claim": "x"}]},
    )
    assert len(client.get("/labeling/export?tab=labels").text.splitlines()) == 1
    assert c1 not in client.get("/labeling/export?tab=labels").text


def test_only_a_lead_downloads_the_whole_teams_labels(api):
    client, _, app = api
    app.dependency_overrides[labeling.is_lead] = lambda: False
    assert client.get("/labeling/export?tab=labels&scope=team").status_code == 403
    assert client.get("/labeling/export?tab=labels").status_code == 200  # your own rows stay open
    assert client.get("/labeling/pool").json()["lead"] is False


def _blind_round(api, monkeypatch):
    """Paper a1 shared under NLP, and somchai given it as a blind check by the lead chanya."""
    from app import main

    monkeypatch.setattr(main.analyses, "get", lambda i: ANALYSIS)
    monkeypatch.setattr(labeling, "_team", lambda: ["chanya", "somchai"])
    client, db, app = api
    app.dependency_overrides[labeling.is_lead] = lambda: True
    client.put("/labeling/papers/a1/topic", json={"topic": "NLP"})
    label = {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 3}
    client.post("/labeling/sessions/a1/save", json={"labels": [label]})
    assert client.put("/labeling/blind", json={"name": "somchai", "analysis_id": "a1"}).status_code == 200
    return client, db, app


def test_a_lead_gives_a_person_a_blind_check_and_can_take_it_back(api, monkeypatch):
    client, _, app = _blind_round(api, monkeypatch)
    assert client.get("/labeling/pool").json()["blind_checks"] == [{"name": "somchai", "analysis_id": "a1"}]
    app.dependency_overrides[labeling.annotator] = lambda: "somchai"
    app.dependency_overrides[labeling.is_lead] = lambda: False
    state = client.get("/labeling/pool").json()
    assert state["blind"] == ["a1"]
    assert state["blind_checks"] == []  # only a lead sees everyone's
    assert client.put("/labeling/blind", json={"name": "chanya", "analysis_id": "a1"}).status_code == 403
    app.dependency_overrides[labeling.is_lead] = lambda: True
    client.put("/labeling/blind", json={"name": "somchai", "analysis_id": "a1", "on": False})
    assert client.get("/labeling/pool").json()["blind"] == []


def test_a_blind_check_needs_a_team_member_and_a_shared_paper(api, monkeypatch):
    client, _, _ = _blind_round(api, monkeypatch)
    assert client.put("/labeling/blind", json={"name": "stranger", "analysis_id": "a1"}).status_code == 422
    assert client.put("/labeling/blind", json={"name": "somchai", "analysis_id": "nope"}).status_code == 422


def test_a_blind_check_hides_other_labelers_and_turns_off_review_and_ask(api, monkeypatch):
    client, _, app = _blind_round(api, monkeypatch)
    app.dependency_overrides[labeling.annotator] = lambda: "somchai"
    session = client.get("/labeling/sessions/a1").json()
    assert session["blind"] is True
    assert session["others"] == {}  # chanya's label exists, but is not even named
    review = client.post("/labeling/sessions/a1/review", json={"claim_id": "paperA-0123456789ab#0"})
    assert review.status_code == 403
    assert client.post("/labeling/sessions/a1/ask", json={"question": "What does it say?"}).status_code == 403
    app.dependency_overrides[labeling.annotator] = lambda: "nuttanon"  # not on a blind check
    assert client.get("/labeling/sessions/a1").json()["others"] != {}


def test_a_person_gets_a_topic_and_it_can_be_taken_back(api):
    client, db, _ = api
    assert client.put("/labeling/people", json={"name": "chanya", "topic": "NLP"}).status_code == 200
    state = client.get("/labeling/pool").json()
    assert {"name": "chanya", "topic": "NLP"} in state["people"]
    client.put("/labeling/people", json={"name": "chanya", "topic": ""})
    assert {"name": "chanya", "topic": ""} in client.get("/labeling/pool").json()["people"]
    assert len(db.tabs["assignments"]) == 2  # appended, never edited


def test_a_topic_must_be_one_of_the_team_topics(api):
    client, _, _ = api
    assert client.put("/labeling/people", json={"name": "chanya", "topic": "Cooking"}).status_code == 422
    assert client.put("/labeling/people", json={"name": "nobody-here", "topic": "NLP"}).status_code == 422


def test_sharing_a_paper_makes_it_listed_and_its_pdfs_openable_for_the_team(api, monkeypatch):
    from app import main

    monkeypatch.setattr(main.analyses, "get", lambda i: ANALYSIS)
    client, _, _ = api
    assert client.get("/labeling/pool").json()["papers"] == []
    assert client.put("/labeling/papers/a1/topic", json={"topic": "HPC"}).status_code == 200
    papers = client.get("/labeling/pool").json()["papers"]
    assert [(p["analysis_id"], p["topic"], p["claims"]) for p in papers] == [("a1", "HPC", 2)]
    names = pool.pdf_names(lambda i: ANALYSIS, lambda rows: frozenset(Path(r["file"]).name for r in rows))
    assert names == {"paperA-0123456789ab.pdf"}
    client.put("/labeling/papers/a1/topic", json={"topic": ""})
    assert client.get("/labeling/pool").json()["papers"] == []
    assert pool.pdf_names(lambda i: ANALYSIS, lambda rows: frozenset({"x"})) == frozenset()


def test_a_cited_pdf_its_owner_uploaded_is_not_openable_by_the_team(monkeypatch):
    monkeypatch.setattr(pool, "pooled", lambda: {"a1": "HPC"})
    row = {"file": "paper.pdf", "pdfs": {"b13": "gmres-0123456789ab.pdf"}}
    every_pdf = frozenset({"paper.pdf", "gmres-0123456789ab.pdf", "2412.19322.pdf"})
    assert pool.pdf_names(lambda i: row, lambda rows: every_pdf) == {"paper.pdf", "2412.19322.pdf"}


def test_a_paper_that_could_not_be_read_can_be_taken_back(api):
    client, _, app = api
    failed = {"id": "e1", "status": "error", "file": None, "owner": None}
    app.dependency_overrides[labeling.mine_analysis] = lambda: failed
    pool.assign("chanya", "paper", "e1", "SE", "")

    assert client.put("/labeling/papers/e1/topic", json={"topic": "SE"}).status_code == 409
    assert client.put("/labeling/papers/e1/topic", json={"topic": ""}).status_code == 200
    assert pool.pooled() == {}


def test_only_a_shared_analysis_opens_for_someone_else(monkeypatch):
    from app import main
    from app.auth import current_user

    db = MemoryLedger()
    monkeypatch.setattr(ledger, "get_store", lambda: db)
    monkeypatch.setattr(pool, "_cache", (0.0, []))
    rows = {"a1": {**ANALYSIS, "owner": "alice", "kind": "paper"}}
    monkeypatch.setattr(main.analyses, "get", lambda i: rows.get(i))
    app = FastAPI()
    app.include_router(labeling.router)
    app.dependency_overrides[current_user] = lambda: "bob"
    app.dependency_overrides[labeling.annotator] = lambda: "bob"
    client = TestClient(app)
    assert client.get("/labeling/sessions/a1").status_code == 404
    pool.assign("alice", "paper", "a1", "NLP", "alice")
    assert client.get("/labeling/sessions/a1").status_code == 200
    assert (
        client.put("/labeling/papers/a1/topic", json={"topic": ""}).status_code == 404
    )  # not bob's to take back


class FakeTable:
    """Just enough of supabase-py's query builder: insert, and select/eq/order/range."""

    def __init__(self, stored):
        self.stored, self._rows, self._range = stored, None, None
        self.filters: dict[str, str] = {}

    def insert(self, rows):
        self._rows = rows
        return self

    def select(self, _):
        self._rows = None
        return self

    def eq(self, column, value):
        if column == "tab":
            self._tab = value
        else:
            self.filters[column] = value
        return self

    def order(self, _):
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        if self._rows is not None:
            self.stored += self._rows
            return type("R", (), {"data": []})
        mine = [
            {"data": r["data"]}
            for r in self.stored
            if r["tab"] == self._tab
            and all(r["data"].get(c.removeprefix("data->>")) == v for c, v in self.filters.items())
        ]
        start, end = self._range
        return type("R", (), {"data": mine[start : end + 1]})


def test_ledger_appends_strings_and_reads_every_page(monkeypatch):
    stored: list[dict] = []
    from app import store

    class Client:
        def table(self, name):
            assert name == "labeling_rows"
            return FakeTable(stored)

    monkeypatch.setattr(store, "_supabase", lambda: Client())
    monkeypatch.setattr(ledger, "PAGE", 2)
    db = ledger.Ledger()
    db.append(
        "labels", [{"claim_id": f"p#{i}", "evidence": 3, "score": None, "extra": "dropped"} for i in range(5)]
    )
    db.append("claims", [{"claim_id": "p#0"}])
    assert stored[0] == {
        "tab": "labels",
        "data": {**dict.fromkeys(ALL_TABS["labels"], ""), "claim_id": "p#0", "evidence": "3"},
    }
    assert [r["claim_id"] for r in db.read("labels")] == [f"p#{i}" for i in range(5)]  # three pages of two
    assert [r["claim_id"] for r in db.read("claims")] == ["p#0"]


def test_ledger_read_can_ask_for_one_paper_only(monkeypatch):
    stored: list[dict] = []
    from app import store

    class Client:
        def table(self, name):
            return FakeTable(stored)

    monkeypatch.setattr(store, "_supabase", lambda: Client())
    monkeypatch.setattr(ledger, "PAGE", 2)
    db = ledger.Ledger()
    db.append("claims", [{"paper_id": f"p{i % 2}", "claim_id": f"p{i % 2}#{i}"} for i in range(6)])
    assert [r["claim_id"] for r in db.read("claims", "p1")] == ["p1#1", "p1#3", "p1#5"]
    assert len(db.read("claims")) == 6


SCOPUS_REPLY = {
    "search-results": {
        "entry": [
            {
                "dc:title": "A late interaction retriever",
                "prism:doi": "10.18653/v1/2022.naacl-main.272",
                "prism:publicationName": "NAACL 2022",
                "prism:coverDate": "2022-07-10",
                "dc:creator": "Santhanam K.",
                "citedby-count": "412",
            },
            {"dc:title": "No DOI here", "prism:publicationName": "NAACL 2022"},
        ],
        "opensearch:totalResults": "375",
    }
}


def test_scopus_query_is_the_topics_open_access_venues_with_safe_text():
    q = scopus.build_query("NLP", 'late "interaction" {x}', 2021)
    assert 'SRCTITLE("Empirical Methods in Natural Language Processing")' in q
    assert "OPENACCESS(1)" in q and "PUBYEAR > 2020" in q
    assert 'TITLE-ABS-KEY("late interaction x")' in q  # query syntax stripped, spaces collapsed
    assert 'SRCTITLE("High-Performance Parallel and Distributed Computing")' not in q  # another topic's venue


def test_scopus_query_can_end_at_a_year():
    q = scopus.build_query("CV", "", 2020, 2022)
    assert "PUBYEAR > 2019" in q and "PUBYEAR < 2023" in q
    assert "PUBYEAR <" not in scopus.build_query("CV", "", 2020)


class ScopusReply:
    """A requests.Response with the given status and JSON body."""

    def __init__(self, body=None, status=200):
        self.body, self.status_code = body or SCOPUS_REPLY, status

    def raise_for_status(self):
        import requests

        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}", response=self)

    def json(self):
        return self.body


def test_scopus_query_leaves_out_venues_that_only_start_with_a_topic_venue():
    q = scopus.build_query("SE", "", 2020)
    # "... Software Engineering and Computer Applications" is not ICSE (#579).
    assert 'SRCTITLE("International Conference on Software Engineering and*")' in q
    # Scopus applies AND NOT last, so it must close the query.
    assert q.endswith(")") and q.rsplit(" AND NOT ", 1)[1].startswith("(SRCTITLE(")


def test_scopus_query_over_all_of_scopus_keeps_every_filter_but_the_venues():
    q = scopus.build_query("HPC", "Ozaki scheme", 2020, 2026, scope="all")
    assert q == 'OPENACCESS(1) AND PUBYEAR > 2019 AND PUBYEAR < 2027 AND TITLE-ABS-KEY("Ozaki scheme")'


def test_a_pasted_doi_or_paper_link_finds_that_paper_in_any_venue():
    # The SCA/HPCAsia 2026 paper the HPC venue list could not reach.
    link = "https://dl.acm.org/doi/10.1145/3784828.3785017"
    assert scopus.build_query("HPC", link, 2020) == 'DOI("10.1145/3784828.3785017")'
    assert scopus.doi_in("doi.org/10.1145/3784828.3785017.") == "10.1145/3784828.3785017"
    assert scopus.doi_in("https://x.org/10.1109/TPDS.2024.1?via=feed") == "10.1109/TPDS.2024.1"
    assert scopus.doi_in("Ozaki scheme 2026") is None


def test_a_doi_keeps_its_own_parentheses_and_never_ends_in_a_backslash():
    wiley = "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0"
    assert scopus.doi_in("10.1002/(SICI)1097-4571(199806)") == "10.1002/(SICI)1097-4571(199806)"
    assert scopus.doi_in(f"see ({wiley[:31]}).") == "10.1002/(SICI)1097-4571(199806)"
    assert scopus.doi_in("(doi 10.1145/3784828.3785017)") == "10.1145/3784828.3785017"
    assert scopus.doi_in(f"see {wiley}.") == wiley  # "<" and ">" are part of it
    assert scopus.doi_in("<https://doi.org/10.1145/3784828.3785017>") == "10.1145/3784828.3785017"
    # A backslash would escape the closing quote of DOI("...") and Scopus would refuse the query.
    assert scopus.build_query("HPC", "10.1145/x\\", 2020) == 'DOI("10.1145/x")'


class S2Reply:
    def __init__(self, papers):
        self.papers = papers

    def raise_for_status(self):
        pass

    def json(self):
        return self.papers


def test_a_paper_is_downloadable_with_an_arxiv_copy_or_a_pdf_scripts_may_fetch(monkeypatch):
    import requests

    papers = [
        {"externalIds": {"ArXiv": "2307.08177"}, "openAccessPdf": {"url": "https://dl.acm.org/doi/pdf/1"}},
        {"externalIds": {}, "openAccessPdf": {"url": "https://dl.acm.org/doi/pdf/2"}},
        {"externalIds": {}, "openAccessPdf": {"url": "https://www.example.edu/paper.pdf"}},
        {"externalIds": {}, "openAccessPdf": None},
        None,  # Semantic Scholar does not know this DOI
    ]
    monkeypatch.setattr(requests, "post", lambda *a, **k: S2Reply(papers))

    found = scopus.downloadable(["10.1/A", "10.1/b", "10.1/c", "10.1/d", "10.1/e"])

    assert found == {"10.1/a": True, "10.1/b": False, "10.1/c": True, "10.1/d": False}


def test_downloadable_is_unknown_when_semantic_scholar_does_not_answer(monkeypatch):
    import requests

    def refuse(*args, **kwargs):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(requests, "post", refuse)
    assert scopus.downloadable(["10.1/a"]) == {}


def test_scopus_search_needs_a_key_and_reads_records_with_a_doi(monkeypatch):
    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "")
    with pytest.raises(scopus.NotConfigured):
        scopus.search("NLP", "", 2020)

    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "k")
    details = {"abstract": "We retrieve late.", "subject": "Information Retrieval", "keywords": ["ColBERT"]}
    monkeypatch.setattr(scopus, "openalex_details", lambda dois: {"10.18653/v1/2022.naacl-main.272": details})
    seen = {}

    def fake_get(url, params, headers, timeout):
        seen.update(url=url, params=params, headers=headers)
        return ScopusReply()

    import requests

    monkeypatch.setattr(requests, "get", fake_get)
    found = scopus.search("NLP", "retrieval", 2020, sort="oldest", start=25)
    assert seen["headers"]["X-ELS-APIKey"] == "k" and seen["params"]["start"] == 25
    assert seen["params"]["sort"] == "+coverDate"
    assert found == {
        "total": 375,
        "results": [
            {
                "doi": "10.18653/v1/2022.naacl-main.272",
                "title": "A late interaction retriever",
                "venue": "NAACL 2022",
                "year": "2022",
                "first_author": "Santhanam K.",
                "cited_by": 412,
                "rank": scopus.UNRANKED,  # no ISSN and no source type in this record
                "abstract": "We retrieve late.",
                "subject": "Information Retrieval",
                "keywords": ["ColBERT"],
            }
        ],
        "hidden": 0,
    }


def test_scopus_search_asks_again_once_after_a_timeout_but_not_after_a_refused_key(monkeypatch):
    import requests

    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "k")
    monkeypatch.setattr(scopus, "openalex_details", lambda dois: {})
    replies = [requests.Timeout("slow"), ScopusReply()]

    def flaky_get(url, params, headers, timeout):
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(requests, "get", flaky_get)
    assert scopus.search("NLP", "", 2020)["total"] == 375

    calls = []
    monkeypatch.setattr(requests, "get", lambda *a, **k: calls.append(1) or ScopusReply(status=401))
    with pytest.raises(requests.HTTPError):
        scopus.search("NLP", "", 2020)
    assert len(calls) == 1


NO_RECORD = {
    "search-results": {
        "opensearch:totalResults": "0",
        "entry": [{"@_fa": "true", "error": "Result set was empty"}],
    }
}


def openalex_work(source):
    return {
        "doi": "https://doi.org/10.1145/3806653",
        "title": "Generative AI for Testing of Autonomous Driving Systems: A Survey",
        "publication_date": "2026-04-04",
        "authorships": [{"author": {"display_name": "Ann Lee"}}],
        "cited_by_count": 3,
        "primary_location": {"source": source},
    }


def test_a_doi_scopus_does_not_list_yet_is_found_in_openalex_with_its_venue_rank(monkeypatch):
    from app.pipeline import indexes

    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "k")
    monkeypatch.setattr(scopus, "openalex_details", lambda dois: {})
    monkeypatch.setattr(requests, "get", lambda *a, **k: ScopusReply(NO_RECORD))
    q1 = {"system": "CiteScore", "value": "Q1", "year": 2025}
    monkeypatch.setattr(scopus, "citescore_ranks", lambda issns: {"1049331X": q1, "15577392": None})
    tosem = {
        "display_name": "ACM Transactions on Software Engineering and Methodology",
        "issn": ["1049-331X", "1557-7392"],
        "type": "journal",
    }
    asked = []
    monkeypatch.setattr(
        indexes, "openalex_works", lambda params: asked.append(params) or [openalex_work(tosem)]
    )

    found = scopus.search("SE", "https://dl.acm.org/doi/epdf/10.1145/3806653", 2020)
    assert asked[0]["filter"] == "doi:10.1145/3806653"
    assert found["total"] == 1 and found["hidden"] == 0
    paper = found["results"][0]
    assert (paper["doi"], paper["venue"], paper["year"], paper["first_author"], paper["cited_by"]) == (
        "10.1145/3806653",
        "ACM Transactions on Software Engineering and Methodology",
        "2026",
        "Ann Lee",
        3,
    )
    assert paper["rank"] == q1
    assert scopus.rank_of("10.1145/3806653") == q1  # listing the paper ranks it the same way

    # A conference is ranked by its name, as a Scopus proceedings record is.
    models = {
        "display_name": "ACM/IEEE International Conference on Model Driven Engineering Languages and Systems"
        " (MODELS)",
        "issn": None,
        "type": "conference",
    }
    monkeypatch.setattr(indexes, "openalex_works", lambda params: [openalex_work(models)])
    assert scopus.rank_of("10.1145/3822455.3830327") == {"system": "CORE", "value": "A", "year": 2026}

    monkeypatch.setattr(indexes, "openalex_works", lambda params: [])
    assert scopus.search("SE", "10.1/none", 2020) == {"total": 0, "results": [], "hidden": 0}
    assert scopus.rank_of("10.1/none") is None


def serial(issn, e_issn, years):
    """A Serial Title entry: years maps "2025" to (status, [percentile per subject])."""
    return {
        "prism:issn": issn,
        "prism:eIssn": e_issn,
        "citeScoreYearInfoList": {
            "citeScoreYearInfo": [
                {
                    "@year": year,
                    "@status": status,
                    "citeScoreInformationList": [
                        {"citeScoreInfo": [{"citeScoreSubjectRank": [{"percentile": str(p)} for p in ps]}]}
                    ],
                }
                for year, (status, ps) in years.items()
            ]
        },
    }


def test_citescore_quartile_is_the_best_subject_in_the_latest_complete_year_and_is_kept(monkeypatch):
    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "k")
    monkeypatch.setattr(scopus, "_citescores", {})
    reply = {
        "serial-metadata-response": {
            "entry": [
                # 2026 is still being counted, so 2025 counts: best subject 80 -> Q1.
                serial(
                    "0162-8828", "1939-3539", {"2026": ("In-Progress", [10]), "2025": ("Complete", [40, 80])}
                ),
                serial("1111-1111", None, {"2024": ("Complete", [74]), "2023": ("Complete", [99])}),
                serial(None, "2222-2222", {"2025": ("Complete", [24])}),
                serial("3333-3333", None, {"2026": ("In-Progress", [99])}),  # no complete year yet
            ]
        }
    }
    asked = []
    monkeypatch.setattr(
        requests, "get", lambda url, params, headers, timeout: asked.append(params) or ScopusReply(reply)
    )
    found = scopus.citescore_ranks(["01628828", "19393539", "11111111", "22222222", "33333333", "44444444"])
    assert asked[0]["view"] == "CITESCORE" and asked[0]["count"] == 6
    assert found == {
        "01628828": {"system": "CiteScore", "value": "Q1", "year": 2025},
        "19393539": {"system": "CiteScore", "value": "Q1", "year": 2025},
        "11111111": {"system": "CiteScore", "value": "Q2", "year": 2024},
        "22222222": {"system": "CiteScore", "value": "Q4", "year": 2025},
        "33333333": None,
        "44444444": None,  # Scopus does not know it
    }
    assert scopus.citescore_ranks(["01628828"]) == {"01628828": found["01628828"]} and len(asked) == 1


def test_citescore_lookup_that_fails_is_left_out_and_tried_again_later(monkeypatch):
    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "k")
    monkeypatch.setattr(scopus, "_citescores", {})
    monkeypatch.setattr(requests, "get", lambda *a, **k: ScopusReply(status=500))
    assert scopus.citescore_ranks(["01628828"]) == {}
    entry = {"prism:aggregationType": "Journal", "prism:issn": "01628828"}
    assert scopus.venue_rank(entry, {}) is None  # not checked, which is not "unranked"
    monkeypatch.setattr(scopus, "_citescores", {"01628828": (None, 0.0)})  # the retry time has come
    monkeypatch.setattr(
        requests,
        "get",
        lambda *a, **k: ScopusReply({"serial-metadata-response": {"error": "No results found"}}),
    )
    assert scopus.citescore_ranks(["01628828"]) == {"01628828": None}


def test_conference_rank_is_the_one_written_for_its_venue_and_nothing_is_guessed():
    def rank(venue, kind="Conference Proceeding", **issns):
        return scopus.venue_rank({"prism:publicationName": venue, "prism:aggregationType": kind, **issns}, {})

    icse = "Proceedings 2026 IEEE ACM 48th International Conference on Software Engineering ICSE 2026"
    assert rank(icse) == {"system": "CORE", "value": "A*", "year": 2026}
    hpdc = "35th ACM International Symposium on High Performance Parallel and Distributed Computing"
    assert rank(hpdc)["value"] == "A"
    unranked = [
        # Workshops and companion volumes carry the name but are not the ranked main track.
        "Proceedings of the IEEE International Conference on Computer Vision Workshops",
        "Proceedings ICSE Companion: International Conference on Software Engineering",
        # The same "and" rule as the query (#579), and a conference not in VENUES.
        "International Conference on Software Engineering and Computer Applications",
        "Proceedings of the ACM SIGIR Conference",
    ]
    assert [rank(venue) for venue in unranked] == [scopus.UNRANKED] * 4
    # A journal named in VENUES still gets its quartile from CiteScore, not from the hand list.
    tpami = "IEEE Transactions on Pattern Analysis and Machine Intelligence"
    assert rank(tpami, "Journal") == scopus.UNRANKED  # no ISSN in the record
    q2 = {"system": "CiteScore", "value": "Q2", "year": 2025}
    entry = {"prism:publicationName": tpami, "prism:aggregationType": "Journal", "prism:eIssn": "1939-3539"}
    assert scopus.venue_rank(entry, {"19393539": q2}) == q2
    assert scopus.venue_rank(entry, {"19393539": None}) == scopus.UNRANKED


def test_rank_filter_leaves_topic_venues_out_of_the_query_and_hides_the_rest_of_a_page(monkeypatch):
    q = scopus.build_query("NLP", "", 2020, ranks=frozenset({"A"}))
    assert 'SRCTITLE("North American Chapter' in q and "Empirical Methods" not in q
    assert scopus.build_query("NLP", "", 2020, ranks=frozenset({"Q4"})) is None
    assert "SRCTITLE" not in scopus.build_query("NLP", "", 2020, scope="all", ranks=frozenset({"Q1"}))

    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "k")
    monkeypatch.setattr(scopus, "openalex_details", lambda dois: {})
    monkeypatch.setattr(requests, "get", lambda *a, **k: pytest.fail("no query to send"))
    assert scopus.search("NLP", "", 2020, ranks=frozenset({"Q4"})) == {"total": 0, "results": [], "hidden": 0}

    acl = {"prism:publicationName": "Annual Meeting of the Association for Computational Linguistics"}
    entries = [
        {"prism:doi": "10.1/acl", "prism:aggregationType": "Conference Proceeding", **acl},
        {
            "prism:doi": "10.1/sigir",
            "prism:aggregationType": "Conference Proceeding",
            "prism:publicationName": "SIGIR",
        },
    ]
    reply = {"search-results": {"entry": entries, "opensearch:totalResults": "2"}}
    monkeypatch.setattr(requests, "get", lambda *a, **k: ScopusReply(reply))
    found = scopus.search("NLP", "", 2020, scope="all", ranks=frozenset({"A*"}))
    assert [p["doi"] for p in found["results"]] == ["10.1/acl"] and found["hidden"] == 1


def test_abstract_subject_and_keywords_come_from_openalex_by_doi_and_are_skipped_when_it_fails(monkeypatch):
    from app.pipeline import indexes

    asked = {}

    def works(params):
        asked.update(params)
        keywords = [{"display_name": f"k{n}", "score": n / 10} for n in range(7)]
        return [
            {
                "doi": "https://doi.org/10.1/ABC",
                "abstract_inverted_index": {"Late": [0], "wins": [2], "interaction": [1]},
                "primary_topic": {"display_name": "Information Retrieval"},
                "keywords": keywords,
            },
            {"doi": "https://doi.org/10.1/bare"},  # OpenAlex knows the paper, nothing more
        ]

    monkeypatch.setattr(indexes, "openalex_works", works)
    found = scopus.openalex_details(["10.1/ABC", "10.1/bare", "10.1/a,b"])
    assert found["10.1/abc"] == {
        "abstract": "Late interaction wins",
        "subject": "Information Retrieval",
        "keywords": ["k6", "k5", "k4", "k3", "k2"],  # the best five, best first
    }
    assert found["10.1/bare"] == scopus.NO_DETAILS
    assert asked["filter"] == "doi:10.1/ABC|10.1/bare"  # a DOI holding "," would break the filter

    def down(params):
        raise indexes._IndexError("HTTP 503")

    monkeypatch.setattr(indexes, "openalex_works", down)
    assert scopus.openalex_details(["10.1/ABC"]) == {}


def test_an_abstract_loses_a_leading_heading_but_not_a_word_that_starts_like_it():
    assert scopus._abstract_text({"Abstract": [0], "Event": [1], "cameras": [2]}) == "Event cameras"
    assert scopus._abstract_text({"Abstraction": [0], "helps": [1]}) == "Abstraction helps"


def test_scopus_add_lists_the_paper_under_a_topic_once(api, monkeypatch):
    from app import main

    client, db, _ = api
    started = []

    # The real _start runs, so a call it cannot make from this route fails the test (#397).
    def fake_enqueue(analysis_id, paper, verify, owner, stages, started_at=None, claim_limit=None):
        started.append((analysis_id, paper, verify, owner, claim_limit))

    monkeypatch.setattr(main, "enqueue_analysis", fake_enqueue)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: SimpleNamespace(publish=lambda *a: 0))
    doi = "10.18653/v1/2022.naacl-main.272"
    first = client.post("/labeling/scopus/add", json={"doi": doi, "topic": "NLP"})
    assert first.status_code == 200
    analysis_id = first.json()["id"]
    assert first.json() == {"id": analysis_id, "existing": False}
    # A paper analysed for the team keeps every claim.
    assert started == [(analysis_id, doi, True, None, 0)]
    assert pool.pooled() == {analysis_id: "NLP"}
    again = client.post("/labeling/scopus/add", json={"doi": doi.upper(), "topic": "CV"})
    assert again.json() == {"id": analysis_id, "existing": True} and len(started) == 1
    assert client.post("/labeling/scopus/add", json={"doi": "not a doi", "topic": "NLP"}).status_code == 422


def test_a_listed_paper_keeps_its_venue_rank_into_the_labels_csv(api, monkeypatch):
    from app import main

    client, db, _ = api
    monkeypatch.setattr(main, "enqueue_analysis", lambda *a, **k: None)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: SimpleNamespace(publish=lambda *a: 0))
    monkeypatch.setattr(scopus, "rank_of", lambda doi: {"system": "CORE", "value": "A*", "year": 2026})
    analysis_id = client.post("/labeling/scopus/add", json={"doi": "10.1234/x", "topic": "NLP"}).json()["id"]
    assert db.tabs["assignments"][-1]["venue_rank"] == "A*"
    assert db.tabs["assignments"][-1]["venue_rank_source"] == "CORE 2026"

    # Taking the paper back and sharing it again keeps the rank it was listed with.
    monkeypatch.setattr(scopus, "rank_of", lambda doi: pytest.fail("ranked already"))
    monkeypatch.setattr(main, "lookup", lambda i: {**ANALYSIS, "id": i, "paper": "10.1234/x"})
    app = api[2]
    app.dependency_overrides[labeling.mine_analysis] = lambda: {
        **ANALYSIS,
        "id": analysis_id,
        "paper": "10.1234/x",
    }
    client.put(f"/labeling/papers/{analysis_id}/topic", json={"topic": ""})
    client.put(f"/labeling/papers/{analysis_id}/topic", json={"topic": "CV"})
    assert db.tabs["assignments"][-1]["venue_rank"] == "A*"
    paper = client.get("/labeling/pool").json()["papers"][0]
    assert (paper["venue_rank"], paper["venue_rank_source"]) == ("A*", "CORE 2026")

    label = {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 2}
    client.post("/labeling/sessions/a1/save", json={"labels": [label]})
    header, row = client.get("/labeling/export?tab=labels").text.splitlines()
    assert header.endswith(",venue_rank,venue_rank_source,topic") and row.endswith(",A*,CORE 2026,CV")


def test_a_paper_is_listed_without_a_rank_when_scopus_fails(api, monkeypatch):
    from app import main

    client, db, _ = api
    monkeypatch.setattr(main, "enqueue_analysis", lambda *a, **k: None)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: SimpleNamespace(publish=lambda *a: 0))

    def refused(doi):
        raise requests.HTTPError("HTTP 429")

    monkeypatch.setattr(scopus, "rank_of", refused)
    assert client.post("/labeling/scopus/add", json={"doi": "10.1234/x", "topic": "NLP"}).status_code == 200
    assert db.tabs["assignments"][-1]["venue_rank"] == ""


def test_pool_shows_a_paper_still_processing_and_why_one_failed(api, monkeypatch):
    from app import main

    client, db, _ = api
    rows = {
        "r1": {"id": "r1", "paper": "10.1/a", "owner": "x", "status": "running", "stages": [], "claims": []},
        "e1": {
            "id": "e1",
            "paper": "10.1/b",
            "owner": None,
            "status": "error",
            "stages": [{"stage": "error", "message": "no open-access PDF known for DOI:10.1/b"}],
            "claims": [],
        },
    }
    monkeypatch.setattr(main.analyses, "get", lambda i: rows.get(i))
    pool.assign("chanya", "paper", "r1", "CV", "x")
    pool.assign("chanya", "paper", "e1", "SE", "")
    papers = {p["analysis_id"]: p for p in client.get("/labeling/pool").json()["papers"]}
    assert (papers["r1"]["status"], papers["r1"]["title"], papers["r1"]["mine"]) == (
        "running",
        "10.1/a",
        False,
    )
    assert papers["e1"]["status"] == "error" and "no open-access PDF" in papers["e1"]["reason"]


def test_pool_shows_each_papers_subject_and_keywords_and_asks_openalex_once(api, monkeypatch):
    from app import main

    client, _, _ = api
    running = {"owner": "x", "status": "running", "stages": [], "claims": []}
    rows = {
        "d1": {"id": "d1", "paper": "10.1145/3784828.3785017", **running},
        "u1": {"id": "u1", "paper": "upload.pdf", **running},
    }
    monkeypatch.setattr(main.analyses, "get", lambda i: rows.get(i))
    pool.assign("chanya", "paper", "d1", "HPC", "x")
    pool.assign("chanya", "paper", "u1", "HPC", "x")
    asked = []

    def details(dois):
        asked.append(dois)
        found = {"abstract": "", "subject": "Parallel Computing", "keywords": ["DGEMM"]}
        return {"10.1145/3784828.3785017": found}

    monkeypatch.setattr(scopus, "openalex_details", details)
    for _ in range(2):  # the page asks every few seconds
        papers = {p["analysis_id"]: p for p in client.get("/labeling/pool").json()["papers"]}
    assert (papers["d1"]["subject"], papers["d1"]["keywords"]) == ("Parallel Computing", ["DGEMM"])
    assert (papers["u1"]["subject"], papers["u1"]["keywords"]) == ("", [])  # no DOI, nothing to ask
    assert asked == [["10.1145/3784828.3785017"]]


def test_a_paper_openalex_does_not_know_is_asked_about_again_later(monkeypatch):
    monkeypatch.setattr(scopus, "_subjects", {})
    asked = []
    monkeypatch.setattr(scopus, "openalex_details", lambda dois: asked.append(dois) or {})
    clock = [1000.0]
    monkeypatch.setattr(scopus.time, "monotonic", lambda: clock[0])

    assert scopus.subjects_of(["10.1/X"]) == {"10.1/x": {"subject": "", "keywords": []}}
    scopus.subjects_of(["10.1/X"])
    clock[0] += scopus.RETRY_UNKNOWN + 1
    scopus.subjects_of(["10.1/X"])
    assert asked == [["10.1/x"], ["10.1/x"]]


def test_pool_says_who_added_each_paper(api, monkeypatch):
    from app import main

    client, _, _ = api
    monkeypatch.setattr(main.analyses, "get", lambda i: {**ANALYSIS, "id": i, "status": "running"})
    pool.assign("Nuttadon", "paper", "p1", "HPC", "nuttadon-id")
    pool.assign("chanya", "paper", "p2", "CV", "chanya-id")
    papers = {p["analysis_id"]: p for p in client.get("/labeling/pool").json()["papers"]}
    assert (papers["p1"]["added_by"], papers["p2"]["added_by"]) == ("Nuttadon", "chanya")


FAILED = {
    "id": "e1",
    "paper": "10.1145/3712285.3771787",
    "owner": "nuttadon-id",
    "status": "error",
    "stages": [{"stage": "error", "message": "Connection broken: IncompleteRead"}],
    "claims": [],
}


def _fake_start(monkeypatch, started):
    from app import main

    def fake_enqueue(analysis_id, paper, verify, owner, stages, started_at=None, claim_limit=None):
        started.append((analysis_id, paper, owner, claim_limit))

    monkeypatch.setattr(main, "enqueue_analysis", fake_enqueue)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: SimpleNamespace(publish=lambda *a: 0))


def test_retry_puts_a_new_analysis_of_the_same_doi_in_place_of_the_failed_one(api, monkeypatch):
    client, _, app = api
    app.dependency_overrides[labeling.mine_analysis] = lambda: FAILED
    app.dependency_overrides[labeling.current_user] = lambda: "nuttadon-id"
    started = []
    _fake_start(monkeypatch, started)
    pool.assign("Nuttadon", "paper", "e1", "HPC", "nuttadon-id")

    reply = client.post("/labeling/papers/e1/retry")

    assert reply.status_code == 200
    new_id = reply.json()["id"]
    # The retried paper keeps every claim too.
    assert started == [(new_id, "10.1145/3712285.3771787", "nuttadon-id", 0)]
    assert pool.pooled() == {new_id: "HPC"}


def _uploaded(analysis_id, owner):
    """An analysis started from an uploaded PDF: it only knows the file."""
    paper = f"data/papers/{analysis_id}-0123456789ab.pdf"
    running = {"status": "running", "stages": [], "claims": []}
    return {"id": analysis_id, "paper": paper, "owner": owner, **running}


def test_an_uploaded_paper_is_listed_with_its_doi_once(api, monkeypatch):
    from app import main

    client, _, app = api
    rows = {"u1": _uploaded("u1", "chanya-id"), "u2": _uploaded("u2", "chanya-id")}
    monkeypatch.setattr(main.analyses, "get", lambda i: rows.get(i))
    app.dependency_overrides[labeling.current_user] = lambda: "chanya-id"
    app.dependency_overrides[labeling.mine_analysis] = lambda: rows["u1"]
    body = {"topic": "HPC", "doi": "https://dl.acm.org/doi/10.1145/3784828.3785017"}

    assert client.post("/labeling/papers/u1/share-upload", json=body).json() == {"id": "u1"}
    assert pool.pooled() == {"u1": "HPC"}
    assert pool.uploaded_dois() == {"u1": "10.1145/3784828.3785017"}
    # The same analysis twice, or a second upload of the same paper, is refused.
    assert client.post("/labeling/papers/u1/share-upload", json=body).status_code == 409
    app.dependency_overrides[labeling.mine_analysis] = lambda: rows["u2"]
    again = client.post("/labeling/papers/u2/share-upload", json=body)
    assert again.status_code == 409 and "upload its PDF from its row" in again.json()["detail"]
    assert pool.pooled() == {"u1": "HPC"}


def test_an_uploaded_paper_takes_the_place_of_your_failed_one_with_its_topic_and_doi(api, monkeypatch):
    from app import main

    client, _, app = api
    rows = {"e1": FAILED, "u1": _uploaded("u1", "nuttadon-id")}
    monkeypatch.setattr(main.analyses, "get", lambda i: rows.get(i))
    app.dependency_overrides[labeling.current_user] = lambda: "nuttadon-id"
    app.dependency_overrides[labeling.mine_analysis] = lambda: rows["u1"]
    pool.assign("Nuttadon", "paper", "e1", "HPC", "nuttadon-id")

    reply = client.post("/labeling/papers/u1/share-upload", json={"replaces": "e1"})

    assert reply.status_code == 200
    assert pool.pooled() == {"u1": "HPC"}
    assert pool.uploaded_dois() == {"u1": "10.1145/3712285.3771787"}


def test_an_upload_can_replace_only_your_own_failed_paper_that_is_still_listed(api, monkeypatch):
    from app import main

    client, _, app = api
    rows = {"e1": FAILED, "u1": _uploaded("u1", "nuttadon-id")}
    monkeypatch.setattr(main.analyses, "get", lambda i: rows.get(i))
    app.dependency_overrides[labeling.mine_analysis] = lambda: rows["u1"]

    def share(**body):
        return client.post("/labeling/papers/u1/share-upload", json=body)

    pool.assign("Nuttadon", "paper", "e1", "HPC", "nuttadon-id")
    assert share(replaces="e1").status_code == 404  # e1 is Nuttadon's; this caller is no one
    app.dependency_overrides[labeling.current_user] = lambda: "nuttadon-id"
    rows["e1"] = {**FAILED, "status": "done"}
    assert share(replaces="e1").status_code == 409
    rows["e1"] = FAILED
    pool.assign("Nuttadon", "paper", "e1", "", "nuttadon-id")  # tried again, so off the list
    assert share(replaces="e1").status_code == 404
    assert share().status_code == 422  # no topic, and nothing to take one from
    assert pool.pooled() == {}


def test_a_topic_change_keeps_the_doi_a_paper_was_uploaded_with(api):
    pool.assign("Chanya", "paper", "u1", "HPC", "chanya-id", "10.1/x")
    pool.assign("Chanya", "paper", "u1", "NLP", "chanya-id")
    assert pool.pooled() == {"u1": "NLP"} and pool.uploaded_dois() == {"u1": "10.1/x"}


def test_retry_refuses_a_paper_that_did_not_fail_or_is_not_listed(api, monkeypatch):
    client, _, app = api
    started = []
    _fake_start(monkeypatch, started)
    app.dependency_overrides[labeling.mine_analysis] = lambda: {**FAILED, "status": "done"}
    pool.assign("Nuttadon", "paper", "e1", "HPC", "nuttadon-id")
    assert client.post("/labeling/papers/e1/retry").status_code == 409

    app.dependency_overrides[labeling.mine_analysis] = lambda: {**FAILED, "id": "e2"}
    assert client.post("/labeling/papers/e2/retry").status_code == 404
    assert started == []


def _claim(who, claim_id, paper="paperA-0123456789ab", status="accepted"):
    return {
        "annotator": who,
        "annotator_id": who,
        "paper_id": paper,
        "claim_id": claim_id,
        "status": status,
    }


def test_pool_shows_how_far_each_person_is_through_a_paper(api, monkeypatch):
    from app import main

    client, db, _ = api
    rows = {
        "a1": ANALYSIS,
        "a2": {**ANALYSIS, "id": "a2", "file": "data/papers/paperB-bbbbbbbbbbbb.pdf"},
        "a3": {"id": "a3", "paper": "10.1/c", "status": "running", "stages": [], "claims": []},
    }
    monkeypatch.setattr(main.analyses, "get", lambda i: rows.get(i))
    for key in rows:
        pool.assign("chanya", "paper", key, "CV", "")
    db.append(
        "claims", [_claim("chanya", "paperA-0123456789ab#0"), _claim("somchai", "paperA-0123456789ab#0")]
    )
    db.append("claims", [_claim("somchai", "paperA-0123456789ab#1", status="rejected")])
    # A later row for the same claim replaces the earlier one, so it is still one claim judged.
    db.append("claims", [_claim("chanya", "paperA-0123456789ab#0", status="edited")])
    db.append("claims", [_claim("somchai", "paperB-bbbbbbbbbbbb#0", paper="paperB-bbbbbbbbbbbb")])
    # A claim added by hand is not one of the paper's extracted claims, so it is not counted.
    db.append("claims", [{**_claim("chanya", "paperA-0123456789ab#h-1"), "origin": "human_added"}])
    db.reads.clear()
    papers = {p["analysis_id"]: p for p in client.get("/labeling/pool").json()["papers"]}
    assert (papers["a1"]["judged"], papers["a1"]["labelers"]) == (1, ["chanya", "somchai"])
    assert (papers["a2"]["judged"], papers["a2"]["labelers"]) == (0, ["somchai"])  # only others have judged
    assert (papers["a3"]["judged"], papers["a3"]["labelers"]) == (0, [])  # no file yet
    assert [t for t, _ in db.reads].count("claims") == 1  # one read for the whole list
    # The team has decided #0 (twice, counted once) and #1; the hand-added claim is not counted.
    assert [papers[a]["team_judged"] for a in ("a1", "a2", "a3")] == [2, 1, 0]


def test_pool_still_answers_with_no_progress_when_the_rows_cannot_be_read(api, monkeypatch):
    from app import main

    client, db, _ = api
    monkeypatch.setattr(main.analyses, "get", lambda i: ANALYSIS if i == "a1" else None)
    pool.assign("chanya", "paper", "a1", "CV", "")
    db.append("claims", [_claim("chanya", "paperA-0123456789ab#0")])

    def unconfigured():
        raise ledger.NotConfigured("no supabase")

    monkeypatch.setattr(labeling.ledger, "get_store", unconfigured)
    monkeypatch.setattr(pool, "_cache", (float("inf"), [{"kind": "paper", "key": "a1", "topic": "CV"}]))
    paper = client.get("/labeling/pool").json()["papers"][0]
    assert (paper["claims"], paper["judged"], paper["labelers"]) == (2, 0, [])

    class Broken(MemoryLedger):
        def read(self, tab, paper_id=None):
            raise RuntimeError("database down")

    monkeypatch.setattr(labeling.ledger, "get_store", lambda: Broken())
    paper = client.get("/labeling/pool").json()["papers"][0]
    assert (paper["judged"], paper["labelers"]) == (0, [])


def test_scopus_search_says_when_it_is_not_set_up(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "")
    assert client.get("/labeling/scopus/search", params={"topic": "NLP"}).status_code == 503
    assert client.get("/labeling/scopus/search", params={"topic": "Cooking"}).status_code == 422
    assert client.get("/labeling/scopus/search", params={"topic": "NLP", "sort": "random"}).status_code == 422
    assert client.get("/labeling/scopus/search", params={"topic": "NLP", "scope": "web"}).status_code == 422


def test_a_failed_scopus_search_says_why(api, monkeypatch):
    import requests

    client, _, _ = api

    def fail_with(error):
        def search(*args):
            raise error

        monkeypatch.setattr(scopus, "search", search)
        return client.get("/labeling/scopus/search", params={"topic": "NLP"})

    quota = fail_with(requests.HTTPError("HTTP 429", response=ScopusReply(status=429)))
    assert quota.status_code == 429 and "quota" in quota.json()["detail"]
    assert fail_with(requests.Timeout("slow")).status_code == 504
    key = fail_with(requests.HTTPError("HTTP 401", response=ScopusReply(status=401)))
    assert key.status_code == 502 and "API key" in key.json()["detail"]


def test_scopus_search_says_which_papers_can_be_downloaded(api, monkeypatch):
    client, _, _ = api
    found = [{"doi": doi, "title": doi} for doi in ("10.1/A", "10.1/b", "10.1/c")]
    monkeypatch.setattr(scopus, "search", lambda *args: {"total": 3, "results": found, "hidden": 0})
    monkeypatch.setattr(scopus, "downloadable", lambda dois: {"10.1/a": True, "10.1/b": False})

    results = client.get("/labeling/scopus/search", params={"topic": "SE"}).json()["results"]

    assert [(r["doi"], r["downloadable"]) for r in results] == [
        ("10.1/A", True),
        ("10.1/b", False),
        ("10.1/c", None),
    ]


def test_every_venue_name_is_specific_enough_to_match_only_that_venue():
    # "Supercomputing" matched a journal and "Computer Vision and Pattern Recognition" a book series
    # when checked against the live Scopus index; short names do that. "IEEE Software" matched only
    # that journal in 200 open-access records since 2020 (checked 2026-10-28).
    checked = {"IEEE Software"}
    assert all(
        len(venue.split()) >= 4
        for venues in scopus.VENUES.values()
        for venue in venues
        if venue not in checked
    )


C0, C1 = "paperA-0123456789ab#0", "paperA-0123456789ab#1"
REF = "refB-aaaaaaaaaaaa"


def ndjson(client, tab):
    reply = client.get("/labeling/export", params={"tab": tab})
    assert reply.status_code == 200 and reply.headers["content-type"].startswith("application/x-ndjson")
    return [json.loads(line) for line in reply.text.splitlines()]


def test_dspy_claims_keep_what_a_person_kept_and_list_what_they_rejected(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(dspy_export, "article_text", lambda paper_id: f"text of {paper_id}")
    client.post(
        "/labeling/sessions/a1/save",
        json={
            "claims": [
                {
                    "claim_id": C0,
                    "origin": "extracted",
                    "status": "edited",
                    "claim": "x",
                    "claim_edited": "Y improves recall by 4 points.",
                },
                {"claim_id": C1, "origin": "extracted", "status": "rejected", "claim": "x"},
            ]
        },
    )
    assert ndjson(client, "dspy_claims") == [
        {
            "paper_id": "paperA-0123456789ab",
            "annotator_id": "chanya",
            "article": "text of paperA-0123456789ab",
            "annotator": "chanya",
            "claims": ["Y improves recall by 4 points."],
            "rejected": ["Y is fast."],
            "ai_reviewed": False,
        }
    ]


def test_dspy_claims_skip_a_paper_whose_text_is_missing(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(dspy_export, "article_text", lambda paper_id: "")
    client.post(
        "/labeling/sessions/a1/save",
        json={"claims": [{"claim_id": C0, "origin": "extracted", "status": "accepted", "claim": "x"}]},
    )
    assert ndjson(client, "dspy_claims") == []


def test_dspy_verdicts_are_the_level_with_the_passages_called_relevant(api):
    client, _, _ = api
    label = {
        "claim_id": C0,
        "reference_id": REF,
        "evidence": 3,
        "rationale": "two controlled runs",
        "spans": ["recall rose by 4 points", "and held on BEIR"],
        "confidence": "high",
    }
    client.post(
        "/labeling/sessions/a1/save",
        json={
            "claims": [
                {"claim_id": C0, "origin": "extracted", "status": "accepted", "claim": "x"},
                {"claim_id": C1, "origin": "extracted", "status": "rejected", "claim": "x"},
            ],
            "labels": [label, {**label, "claim_id": C1}],
        },
    )
    assert ndjson(client, "dspy_verdicts") == [
        {
            "paper_id": "paperA-0123456789ab",
            "claim_id": C0,
            "reference_id": REF,
            "annotator": "chanya",
            "annotator_id": "chanya",
            "claim": "Method Y improves recall.",
            "source": "recall rose by 4 points\n\nand held on BEIR",
            "verdict": "3",
            "verdict_name": "Clear",
            "rationale": "two controlled runs",
            "confidence": "high",
            "ai_reviewed": False,
            "verdict_before_review": "3",
        }
    ]


def test_a_label_saved_after_a_review_keeps_the_persons_own_level_beside_it(api, monkeypatch):
    client, _, _ = api
    label = {"claim_id": C0, "reference_id": REF, "evidence": 4, "spans": ["recall rose by 4 points"]}
    claim = {"claim_id": C0, "origin": "extracted", "status": "accepted", "claim": "x"}
    client.post("/labeling/sessions/a1/save", json={"claims": [claim], "labels": [label]})
    monkeypatch.setattr(verify, "judge_passages", lambda c, p: {"verdict": "insufficient", "reasoning": ""})
    client.post("/labeling/sessions/a1/review", json={"claim_id": C0})
    client.post("/labeling/sessions/a1/save", json={"claims": [claim], "labels": [{**label, "evidence": 2}]})

    [record] = ndjson(client, "dspy_verdicts")
    assert (record["verdict"], record["ai_reviewed"], record["verdict_before_review"]) == ("2", True, "4")


def test_dspy_verdicts_leave_out_a_label_with_no_passage(api):
    client, _, _ = api
    client.post(
        "/labeling/sessions/a1/save",
        json={
            "claims": [{"claim_id": C0, "origin": "extracted", "status": "accepted", "claim": "x"}],
            "labels": [{"claim_id": C0, "reference_id": REF, "evidence": 1, "spans": []}],
        },
    )
    assert ndjson(client, "dspy_verdicts") == []


def test_article_text_reads_a_pdf_and_is_empty_when_the_pdf_is_missing(tmp_path, monkeypatch):
    import fitz

    pdf = fitz.open()
    pdf.new_page().insert_text((72, 72), "Late interaction keeps one vector per token.")
    pdf.save(tmp_path / "paperA.pdf")
    monkeypatch.setattr(dspy_export, "PAPERS_DIR", tmp_path)
    assert "one vector per token" in dspy_export.article_text("paperA")
    assert dspy_export.article_text("not-here") == ""


HAND_ADDED = "paperA-0123456789ab#h-abc12345"


def test_a_hand_added_claim_gets_passages_from_each_reference(api, monkeypatch):
    client, _, _ = api
    searched = []

    def evidence_from(claim, source_name):
        searched.append((claim, source_name))
        return [
            {"text": "Y doubles recall", "page": 3, "score": 7.5},
            {"text": "on Z", "page": 4, "score": 2.0},
        ]

    monkeypatch.setattr(labeling.verify, "evidence_from", evidence_from)
    found = client.post(
        "/labeling/sessions/a1/candidates", json={"claim_id": HAND_ADDED, "claim": "Y doubles recall"}
    )

    assert found.status_code == 200
    assert searched == [("Y doubles recall", "refB-aaaaaaaaaaaa.pdf")]
    first, second = found.json()["candidates"]
    assert first == {
        "cand_id": labeling._candidate_id(HAND_ADDED, "refB-aaaaaaaaaaaa", 1, "Y doubles recall"),
        "reference_id": "refB-aaaaaaaaaaaa",
        "reference_file": "refB-aaaaaaaaaaaa.pdf",
        "rank": 1,
        "score": 7.5,
        "page": 3,
        "passage": "Y doubles recall",
    }
    assert second["rank"] == 2


def test_only_claims_of_this_paper_are_searched_live(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(labeling.verify, "evidence_from", lambda claim, source_name: [])
    no_such_claim = client.post(
        "/labeling/sessions/a1/candidates", json={"claim_id": "paperA-0123456789ab#9", "claim": "x"}
    )
    other_paper = client.post(
        "/labeling/sessions/a1/candidates", json={"claim_id": "paperB#h-abc12345", "claim": "x"}
    )
    assert no_such_claim.status_code == 422 and other_paper.status_code == 422


# Power of Scale (#836): claim 0 checked T5 and has its PDF; claim 1 only names T5 and SuperGLUE,
# so they were never checked, and GPT-3's lookup failed.
T5 = {"ref": "b39", "title": "T5 paper", "doi": "", "arxiv": "", "url": "", "authors": [], "year": "2020"}
SUPERGLUE = {**T5, "ref": "b49", "title": "SuperGLUE"}
GPT3 = {**T5, "ref": "b4", "title": "NeurIPS"}
NAMED_ONLY = {
    **ANALYSIS,
    "claims": [
        {
            "claim": "T5-XXL beats GPT-3.",
            "citations": [T5],
            "verdicts": [
                {"source": "t5-aaaaaaaaaaaa.pdf", "cited": "T5 paper", "evidence": [{"text": "t", "page": 1}]}
            ],
        },
        {
            "claim": "We cast all tasks as text generation.",
            "citations": [T5, SUPERGLUE, GPT3],
            "named": ["T5 paper", "SuperGLUE"],
            "unchecked": [{"source": "NeurIPS", "reason": "no-open-access", "message": "no open-access PDF"}],
        },
    ],
}
NAMED_CLAIM = "paperA-0123456789ab#1"


def test_a_claim_says_why_its_citations_were_not_checked(api):
    client, _, app = api
    app.dependency_overrides[labeling.owned_analysis] = lambda: NAMED_ONLY

    checked, named = client.get("/labeling/sessions/a1").json()["claims"]

    assert checked["unchecked"] == []
    links = {"url": "", "doi": "", "year": "2020"}
    assert named["unchecked"] == [
        {
            "ref": "b39",
            "label": "T5 paper",
            "reason": "named",
            **links,
            "source_outcome": {
                "source_kind": "unknown",
                "outcome": "named-only",
                "retryable": False,
                "attempts": [],
            },
        },
        {
            "ref": "b49",
            "label": "SuperGLUE",
            "reason": "named",
            **links,
            "source_outcome": {
                "source_kind": "unknown",
                "outcome": "named-only",
                "retryable": False,
                "attempts": [],
            },
        },
        {"ref": "b4", "label": "NeurIPS", "reason": "no-open-access", **links},
    ]


def test_an_empty_citation_is_marked_not_attempted(api):
    client, _, app = api
    empty = {
        **ANALYSIS,
        "claims": [{"claim": "A claim.", "citations": [{"ref": "b10"}]}],
    }
    app.dependency_overrides[labeling.owned_analysis] = lambda: empty

    [claim] = client.get("/labeling/sessions/a1").json()["claims"]

    assert claim["unchecked"] == [
        {
            "ref": "b10",
            "label": "Reference [b10]",
            "reason": "unresolvable",
            "url": "",
            "doi": "",
            "year": "",
            "source_outcome": {
                "source_kind": "unknown",
                "outcome": "not-attempted",
                "retryable": False,
                "attempts": [],
            },
        }
    ]


def test_an_unchecked_citation_carries_its_own_link_doi_and_year(api):
    """A web page has no PDF to open, so the labeler links to where the reference list points."""
    client, _, app = api
    top500 = {"ref": "b23", "title": "Top500", "url": "https://www.top500.org/", "doi": "", "year": "2021"}
    with_doi = {"ref": "b7", "title": "Kokkos", "url": "", "doi": "10.1016/j.jpdc.2014.07.003", "year": 2014}
    bare = {"ref": "b9", "title": "A talk"}
    app.dependency_overrides[labeling.owned_analysis] = lambda: {
        **ANALYSIS,
        "claims": [
            {
                "claim": "GPUs make up six of the ten fastest systems.",
                "citations": [top500, with_doi, bare],
                "unchecked": [
                    {"source": "Top500", "reason": "not-downloadable", "message": "no address"},
                    {"source": "10.1016/j.jpdc.2014.07.003", "reason": "no-open-access", "message": "none"},
                    {"source": "A talk", "reason": "unresolvable", "message": "not found"},
                ],
            }
        ],
    }

    (claim,) = client.get("/labeling/sessions/a1").json()["claims"]

    assert claim["unchecked"] == [
        {
            "ref": "b23",
            "label": "Top500",
            "reason": "not-downloadable",
            "url": "https://www.top500.org/",
            "doi": "",
            "year": "2021",
        },
        {
            "ref": "b7",
            "label": "Kokkos",
            "reason": "no-open-access",
            "url": "",
            "doi": "10.1016/j.jpdc.2014.07.003",
            "year": "2014",
        },
        {"ref": "b9", "label": "A talk", "reason": "unresolvable", "url": "", "doi": "", "year": ""},
    ]


def test_an_extracted_claim_is_searched_in_the_references_it_cites_that_have_a_pdf(api, monkeypatch):
    client, _, app = api
    app.dependency_overrides[labeling.owned_analysis] = lambda: NAMED_ONLY
    searched = []
    monkeypatch.setattr(
        labeling.verify,
        "evidence_from",
        lambda claim, source_name: searched.append(source_name) or [{"text": "text-to-text", "page": 2}],
    )

    found = client.post("/labeling/sessions/a1/candidates", json={"claim_id": NAMED_CLAIM, "claim": "x"})

    assert found.status_code == 200
    assert searched == ["t5-aaaaaaaaaaaa.pdf"]
    [candidate] = found.json()["candidates"]
    assert candidate["cand_id"] == labeling._candidate_id(NAMED_CLAIM, "t5-aaaaaaaaaaaa", 1, "text-to-text")


def test_a_retrieval_outage_is_a_502_not_a_crash(api, monkeypatch):
    client, _, _ = api

    def down(claim, source_name):
        raise requests.ConnectionError("colbert is waking up")

    monkeypatch.setattr(labeling.verify, "evidence_from", down)
    found = client.post("/labeling/sessions/a1/candidates", json={"claim_id": HAND_ADDED, "claim": "x"})
    assert found.status_code == 502
    assert found.json()["detail"] == "retrieval did not answer"


def test_save_keeps_a_passage_found_for_a_hand_added_claim(api):
    client, db, _ = api
    passage = {
        "claim_id": HAND_ADDED,
        "reference_id": "refB-aaaaaaaaaaaa",
        "origin": "retrieved_added",
        "status": "relevant",
        "rank": 1,
        "score": 7.5,
        "page": 3,
        "passage": "Y doubles recall",
    }
    claim = {
        "claim_id": HAND_ADDED,
        "origin": "human_added",
        "status": "accepted",
        "claim": "Y doubles recall",
    }
    saved = client.post("/labeling/sessions/a1/save", json={"claims": [claim], "candidates": [passage]})

    assert saved.status_code == 200
    [row] = db.tabs["candidates"]
    assert row["origin"] == "retrieved_added" and row["rank"] == "1" and row["page"] == "3"
    assert row["cand_id"] == labeling._candidate_id(HAND_ADDED, "refB-aaaaaaaaaaaa", 1, "Y doubles recall")

    # The live search also runs for an extracted claim with no passages (#836).
    on_extracted = {**passage, "claim_id": "paperA-0123456789ab#0"}
    assert client.post("/labeling/sessions/a1/save", json={"candidates": [on_extracted]}).status_code == 200
    unknown_paper = {**passage, "reference_id": "refZ"}
    assert client.post("/labeling/sessions/a1/save", json={"candidates": [unknown_paper]}).status_code == 422


# The AI review of a saved claim (review.py)

CLAIM_0 = "paperA-0123456789ab#0"
REF_B = "refB-aaaaaaaaaaaa"


def _save_claim(client, evidence=4, rationale="", relevant=1):
    session = client.get("/labeling/sessions/a1").json()
    first, second = session["claims"][0]["candidates"]
    body = {
        "claims": [{"claim_id": CLAIM_0, "origin": "extracted", "status": "accepted", "claim": "x"}],
        "candidates": [
            {
                "claim_id": CLAIM_0,
                "reference_id": REF_B,
                "origin": "retrieved",
                "status": "relevant",
                "cand_id": first["cand_id"],
            },
        ][:relevant],
        "labels": [
            {"claim_id": CLAIM_0, "reference_id": REF_B, "evidence": evidence, "rationale": rationale}
        ],
    }
    assert client.post("/labeling/sessions/a1/save", json=body).status_code == 200
    return first, second


def _events(response):
    return [json.loads(line[6:]) for line in response.text.split("\n\n") if line.startswith("data: ")]


def test_review_needs_the_claim_saved_first(api):
    client, _, _ = api
    response = client.post("/labeling/sessions/a1/review", json={"claim_id": CLAIM_0})
    assert response.status_code == 409


def test_review_points_at_what_is_left_and_where_the_judge_disagrees(api, monkeypatch):
    client, db, _ = api
    _, second = _save_claim(client, evidence=4)
    asked = []

    def judge(claim, passages):
        asked.append((claim, passages))
        return {"verdict": "insufficient", "quote": "", "reasoning": "It reports recall, not why."}

    monkeypatch.setattr(verify, "judge_passages", judge)
    events = _events(client.post("/labeling/sessions/a1/review", json={"claim_id": CLAIM_0}))

    findings = [e for e in events if e["type"] == "finding"]
    # The rules: the second passage is not judged; level 4 has no reason.
    assert findings[0]["target"] == {"kind": "passage", "id": second["cand_id"]}
    assert findings[1]["tone"] == "asks" and findings[1]["target"]["id"] == REF_B
    # The judge, on the one passage marked relevant, against level 4: a question, not a change.
    assert asked == [("Method Y improves recall.", ["recall rose by 4 points"])]
    assert findings[2]["tone"] == "asks"
    assert "Does level 4 hold for the part this paper is cited for?" in findings[2]["text"]
    assert "It reports recall, not why." in findings[2]["text"]
    assert "suggestion" not in findings[2]
    assert events[-1] == {"type": "done", "findings": 3}
    # What the review said is kept, by claim and account.
    [row] = db.tabs["reviews"]
    assert (row["claim_id"], row["annotator"]) == (CLAIM_0, "chanya")
    assert len(json.loads(row["findings"])) == 3


def test_review_agrees_when_the_level_fits_the_verdict(api, monkeypatch):
    client, _, _ = api
    _save_claim(client, evidence=3, rationale="Recall rose by 4 points.")
    monkeypatch.setattr(
        verify, "judge_passages", lambda c, p: {"verdict": "supports", "quote": "", "reasoning": ""}
    )
    findings = [
        e
        for e in _events(client.post("/labeling/sessions/a1/review", json={"claim_id": CLAIM_0}))
        if e["type"] == "finding"
    ]
    assert [f["tone"] for f in findings if f["target"]["kind"] == "reference"] == ["agrees"]


def test_review_skips_the_judge_on_a_rejected_claim(api, monkeypatch):
    client, _, _ = api
    body = {"claims": [{"claim_id": CLAIM_0, "origin": "extracted", "status": "rejected", "claim": "x"}]}
    client.post("/labeling/sessions/a1/save", json=body)
    monkeypatch.setattr(verify, "judge_passages", lambda c, p: pytest.fail("the judge was asked"))
    findings = _events(client.post("/labeling/sessions/a1/review", json={"claim_id": CLAIM_0}))
    assert [f["tone"] for f in findings if f["type"] == "finding"] == ["agrees"]


def test_a_failed_judge_call_asks_the_person_to_check_instead_of_ending_the_review(api, monkeypatch):
    client, _, _ = api
    _save_claim(client, evidence=3, rationale="r")

    def down(claim, passages):
        raise ConnectionError("gateway down")

    monkeypatch.setattr(verify, "judge_passages", down)
    events = _events(client.post("/labeling/sessions/a1/review", json={"claim_id": CLAIM_0}))
    judged = [e for e in events if e["type"] == "finding" and e["target"]["kind"] == "reference"]
    assert judged[-1]["tone"] == "asks" and "check this level yourself" in judged[-1]["text"]
    assert events[-1]["type"] == "done"


def test_saves_after_a_review_are_marked_ai_reviewed(api, monkeypatch):
    client, db, _ = api
    _save_claim(client, evidence=4)
    assert {row["ai_reviewed"] for tab in ("claims", "candidates", "labels") for row in db.tabs[tab]} == {""}
    monkeypatch.setattr(
        verify, "judge_passages", lambda c, p: {"verdict": "supports", "quote": "", "reasoning": ""}
    )
    client.post("/labeling/sessions/a1/review", json={"claim_id": CLAIM_0})
    _save_claim(client, evidence=3)
    later = [db.tabs[tab][-1]["ai_reviewed"] for tab in ("claims", "candidates", "labels")]
    assert later == ["1", "1", "1"]


def test_ask_answers_from_a_reference_the_claim_cites(api, monkeypatch):
    from app import assistant

    client, _, _ = api
    asked = []
    monkeypatch.setattr(verify, "prepare_source", lambda pdf: {"status": "ok", "path": pdf})

    async def answer(question, paper=None, papers=None, passages=None):
        asked.append((question, paper.as_posix()))
        yield {"type": "done", "statements": 0}

    monkeypatch.setattr(assistant, "answer", answer)
    body = {"question": "Does B report recall?", "reference_id": REF_B}
    events = _events(client.post("/labeling/sessions/a1/ask", json=body))
    assert asked == [("Does B report recall?", "data/papers/refB-aaaaaaaaaaaa.pdf")]
    assert events == [{"type": "done", "statements": 0}]
    unknown = {"question": "q", "reference_id": "nope"}
    assert client.post("/labeling/sessions/a1/ask", json=unknown).status_code == 422


def test_ask_about_one_passage_reads_only_it_with_the_claim(api, monkeypatch):
    from app import assistant

    client, _, _ = api
    asked = []
    monkeypatch.setattr(verify, "prepare_source", lambda pdf: {"status": "ok", "path": pdf})

    async def answer(question, paper=None, papers=None, passages=None):
        asked.append((question, paper.as_posix(), passages))
        yield {"type": "done", "statements": 0}

    monkeypatch.setattr(assistant, "answer", answer)
    body = {
        "question": "Does this passage back the claim?",
        "reference_id": REF_B,
        "passage": "recall rose by 4 points",
        "claim": "Recall improves.",
    }
    _events(client.post("/labeling/sessions/a1/ask", json=body))
    assert asked == [
        (
            'Does this passage back the claim?\nThe claim: "Recall improves."',
            "data/papers/refB-aaaaaaaaaaaa.pdf",
            ["recall rose by 4 points"],
        )
    ]
    no_reference = {"question": "q", "passage": "recall rose by 4 points"}
    assert client.post("/labeling/sessions/a1/ask", json=no_reference).status_code == 422


# review_for: the same review for a coding agent over MCP (app/mcp_server.py)


@pytest.fixture
def agent(monkeypatch):
    """The fixture's analysis and labeler, for review_for, which runs outside a request."""

    async def owned_analysis(analysis_id, user):
        return ANALYSIS

    monkeypatch.setattr(labeling, "owned_analysis", owned_analysis)
    # With login off the page saves as "chanya" (the api fixture); the agent is the same person.
    monkeypatch.setattr(labeling.identity, "annotator_for", lambda user: "chanya")


def test_an_agent_reviews_a_saved_claim_by_its_number(api, agent, monkeypatch):
    client, db, _ = api
    _save_claim(client, evidence=4)
    judged = {"verdict": "insufficient", "quote": "", "reasoning": "It reports recall, not why."}
    monkeypatch.setattr(verify, "judge_passages", lambda claim, passages: judged)

    findings = asyncio.run(labeling.review_for("a1", 1, None))

    assert len(findings) == 3
    assert findings[0]["target"]["kind"] == "passage"
    [row] = db.tabs["reviews"]
    assert (row["claim_id"], row["annotator"]) == (CLAIM_0, "chanya")
    assert json.loads(row["findings"]) == findings


def test_an_agent_cannot_review_an_unsaved_claim_or_a_claim_that_is_not_there(api, agent):
    with pytest.raises(HTTPException) as unsaved:
        asyncio.run(labeling.review_for("a1", 1, None))
    with pytest.raises(HTTPException) as missing:
        asyncio.run(labeling.review_for("a1", 99, None))

    assert unsaved.value.status_code == 409
    assert missing.value.status_code == 404


def test_progress_for_names_the_first_claim_the_person_has_not_saved(api, agent):
    client, _, _ = api

    before = asyncio.run(labeling.progress_for("a1", None))
    _save_claim(client, evidence=4)
    after = asyncio.run(labeling.progress_for("a1", None))

    assert (before["saved"], before["reviewed"]) == (0, 0)
    assert before["next_unsaved"]["number"] == 1
    assert before["next_unsaved"]["passages"]
    assert after["saved"] == 1
    assert after["next_unsaved"]["number"] == 2  # claim 1 is saved, so the next one is offered


def test_an_agent_reads_the_saved_labels_of_a_claim(api, agent):
    client, db, _ = api
    first, _ = _save_claim(client, evidence=3, rationale="Table 2 reports it.")

    saved = asyncio.run(labeling.labels_for("a1", 1, None))

    assert saved["labels"] == [
        {"paper": "Ref B", "level": 3, "rationale": "Table 2 reports it.", "confidence": "medium"}
    ]
    [passage] = saved["passages"]
    assert (passage["status"], passage["text"]) == ("relevant", first["passage"])


def test_reading_saved_labels_marks_the_next_save_ai_reviewed(api, agent):
    client, db, _ = api
    _save_claim(client, evidence=4)

    asyncio.run(labeling.labels_for("a1", 1, None))
    _save_claim(client, evidence=3)

    [row] = db.tabs["reviews"]
    assert json.loads(row["findings"])[0]["tone"] == "asks"
    assert [db.tabs[tab][-1]["ai_reviewed"] for tab in ("claims", "candidates", "labels")] == ["1", "1", "1"]


def test_an_agent_cannot_read_labels_of_an_unsaved_claim_or_a_claim_that_is_not_there(api, agent):
    with pytest.raises(HTTPException) as unsaved:
        asyncio.run(labeling.labels_for("a1", 1, None))
    with pytest.raises(HTTPException) as missing:
        asyncio.run(labeling.labels_for("a1", 99, None))

    assert unsaved.value.status_code == 409
    assert missing.value.status_code == 404


# Gaps in the router: the status line, the team list, odd pool rows, search errors and failed streams


def test_status_says_who_is_labeling_and_what_is_set_up(api, monkeypatch):
    from app import auth

    client, _, _ = api
    monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
    monkeypatch.setattr(labeling.config, "SCOPUS_API_KEY", "")
    assert client.get("/labeling/status").json() == {
        "annotator": "chanya",
        "configured": True,
        "scopus": False,
    }


def test_a_verdict_with_no_source_file_adds_no_reference_or_passage():
    verdicts = [{"cited": "Ref B", "evidence": []}]
    analysis = {**ANALYSIS, "claims": [{"claim": "Y is fast.", "verdicts": verdicts}]}
    built = labeling.build_session(analysis)
    assert built["references"] == [] and built["claims"][0]["candidates"] == []


def _accounts(list_users):
    return SimpleNamespace(auth=SimpleNamespace(admin=SimpleNamespace(list_users=list_users)))


def test_team_is_every_account_by_its_name_or_the_start_of_its_email(monkeypatch):
    from app import auth, store

    named = SimpleNamespace(user_metadata={"full_name": " Somchai "}, email="s@example.com")
    unnamed = SimpleNamespace(user_metadata=None, email="chanya@example.com")
    nameless = SimpleNamespace(user_metadata={}, email=None)
    monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
    monkeypatch.setattr(store, "_supabase", lambda: _accounts(lambda: [named, unnamed, nameless]))
    assert labeling._team() == ["Somchai", "chanya"]


def test_team_is_empty_without_login_or_when_supabase_cannot_list(monkeypatch):
    from app import auth, store

    monkeypatch.setattr(auth, "_supabase_configured", lambda: False)
    assert labeling._team() == []

    def refuse():
        raise RuntimeError("down")

    monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
    monkeypatch.setattr(store, "_supabase", lambda: _accounts(refuse))
    assert labeling._team() == []


def test_pool_leaves_out_a_paper_that_is_gone_and_a_finished_one_with_no_claims(api, monkeypatch):
    from app import main

    client, _, _ = api
    empty = {
        "id": "empty",
        "paper": "x",
        "status": "done",
        "claims": [],
        "file": "data/papers/e-0123456789ab.pdf",
    }
    monkeypatch.setattr(main.analyses, "get", lambda i: {"empty": empty}.get(i))
    for analysis_id in ("gone", "empty"):
        pool.assign("chanya", "paper", analysis_id, "CV", "x")
    assert client.get("/labeling/pool").json()["papers"] == []


def test_sharing_a_paper_by_doi_looks_up_its_venue_rank(api, monkeypatch):
    client, db, app = api
    app.dependency_overrides[labeling.mine_analysis] = lambda: {**ANALYSIS, "id": "d1", "paper": "10.1234/x"}
    monkeypatch.setattr(scopus, "rank_of", lambda doi: {"system": "CORE", "value": "B", "year": 2026})
    assert client.put("/labeling/papers/d1/topic", json={"topic": "NLP"}).status_code == 200
    assert db.tabs["assignments"][-1]["venue_rank"] == "B"


@pytest.mark.parametrize(
    ("error", "detail"),
    [
        (requests.HTTPError("HTTP 500", response=ScopusReply(status=500)), "Scopus answered HTTP 500"),
        (requests.HTTPError("HTTP ?"), "Scopus answered HTTP 0"),
        (requests.ConnectionError("refused"), "Scopus could not be reached"),
    ],
)
def test_scopus_search_errors_become_a_502(api, monkeypatch, error, detail):
    client, _, _ = api

    def search(*args):
        raise error

    monkeypatch.setattr(scopus, "search", search)
    response = client.get("/labeling/scopus/search", params={"topic": "NLP"})
    assert (response.status_code, response.json()["detail"]) == (502, detail)


def test_a_passage_on_a_claim_of_another_paper_is_refused(api):
    client, _, _ = api
    stray = {
        "claim_id": "other-0123456789ab#0",
        "reference_id": REF_B,
        "origin": "retrieved",
        "status": "relevant",
    }
    response = client.post("/labeling/sessions/a1/save", json={"candidates": [stray]})
    assert response.status_code == 422 and "unknown claim" in response.json()["detail"]


def test_progress_has_no_next_claim_once_every_claim_is_saved(api, agent):
    client, _, _ = api
    claims = [{"claim_id": c, "origin": "extracted", "status": "accepted", "claim": "x"} for c in (C0, C1)]
    client.post("/labeling/sessions/a1/save", json={"claims": claims})
    done = asyncio.run(labeling.progress_for("a1", None))
    assert (done["saved"], done["next_unsaved"]) == (2, None)


def test_a_review_that_breaks_partway_ends_in_an_error_event_and_is_not_kept(api, monkeypatch):
    client, db, _ = api
    _save_claim(client)

    async def broken(claim, saved):
        raise RuntimeError("judge exploded")
        yield  # makes this an async generator

    monkeypatch.setattr(labeling.review, "review", broken)
    events = _events(client.post("/labeling/sessions/a1/review", json={"claim_id": CLAIM_0}))
    assert events == [{"type": "error", "message": "the review stopped partway; try again"}]
    assert db.tabs["reviews"] == []


def test_ask_without_a_reference_reads_the_paper_under_review(api, monkeypatch):
    from app import assistant

    client, _, _ = api
    opened = []

    def prepare(pdf):
        opened.append(pdf)
        return {"status": "ok", "path": pdf}

    async def answer(question, paper=None, papers=None, passages=None):
        yield {"type": "done", "statements": 0}

    monkeypatch.setattr(verify, "prepare_source", prepare)
    monkeypatch.setattr(assistant, "answer", answer)
    _events(client.post("/labeling/sessions/a1/ask", json={"question": "What is the aim?"}))
    assert opened == [ANALYSIS["file"]]


def test_ask_says_so_when_the_paper_cannot_be_read(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(verify, "prepare_source", lambda pdf: {"status": "failed"})
    events = _events(client.post("/labeling/sessions/a1/ask", json={"question": "q"}))
    assert events == [{"type": "error", "message": "this paper could not be read"}]


def test_ask_that_breaks_partway_ends_in_an_error_event(api, monkeypatch):
    from app import assistant

    client, _, _ = api

    async def answer(question, paper=None, papers=None, passages=None):
        yield {"type": "statement", "text": "one"}
        raise RuntimeError("model down")

    monkeypatch.setattr(verify, "prepare_source", lambda pdf: {"status": "ok", "path": pdf})
    monkeypatch.setattr(assistant, "answer", answer)
    events = _events(client.post("/labeling/sessions/a1/ask", json={"question": "q"}))
    assert events[-1] == {"type": "error", "message": "the answer stopped partway; try again"}


def test_papers_without_a_file_or_a_row_have_no_paper_id(monkeypatch):
    from app import main

    rows = {"a": {"id": "a", "file": "data/papers/p-0123456789ab.pdf"}, "b": {"id": "b"}}
    monkeypatch.setattr(main, "lookup", lambda i: rows.get(i))
    assert labeling._by_paper({"a": 1, "b": 2, "gone": 3}) == {"p-0123456789ab": 1}


def test_export_of_an_unknown_tab_is_a_404(api):
    client, _, _ = api
    assert client.get("/labeling/export", params={"tab": "nope"}).status_code == 404


# Gaps in scopus.py


def test_ranking_one_paper_needs_a_scopus_key(monkeypatch):
    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "")
    with pytest.raises(scopus.NotConfigured):
        scopus.rank_of("10.1/x")


def test_a_doi_with_a_filter_separator_is_not_asked_of_openalex(monkeypatch):
    from app.pipeline import indexes

    monkeypatch.setattr(indexes, "openalex_works", lambda params: pytest.fail("OpenAlex was asked"))
    assert scopus._openalex_entries("10.1/a,b") == []
    assert scopus.openalex_details(["10.1/a,b", "10.1/c|d"]) == {}


def test_a_failing_openalex_gives_no_record_for_a_doi_scopus_lacks(monkeypatch):
    from app.pipeline import indexes

    def down(params):
        raise indexes._IndexError("HTTP 503")

    monkeypatch.setattr(indexes, "openalex_works", down)
    assert scopus._openalex_entries("10.1/x") == []


def test_a_latest_year_with_no_subject_percentile_has_no_quartile():
    assert scopus._citescore_quartile(serial("1111-1111", None, {"2025": ("Complete", [])})) is None


def test_scopus_is_asked_again_after_a_server_error(monkeypatch):
    monkeypatch.setattr(scopus.config, "SCOPUS_API_KEY", "k")
    replies = [ScopusReply(status=503), ScopusReply()]
    monkeypatch.setattr(requests, "get", lambda *a, **k: replies.pop(0))
    assert scopus._ask_scopus({"query": "x"}) == SCOPUS_REPLY
    assert replies == []


def test_an_account_off_the_team_list_cannot_use_the_labeler(api, monkeypatch):
    # annotator reads the token itself, so the router must also run current_user's team check.
    _, _, app = api
    del app.dependency_overrides[labeling.current_user]
    monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
    monkeypatch.setattr(auth, "_user_for", lambda token: ("user-x", "stranger@example.com"))
    monkeypatch.setattr(config, "TEAM_EMAILS", frozenset({"chanya@example.com"}))

    response = TestClient(app).get("/labeling/status", headers={"authorization": "Bearer token"})

    assert response.status_code == 403


def save_as(client, app, name, evidence=None, status="accepted", rationale=""):
    """Save claim 0 as `name`: its status and, unless rejected, a level for Ref B."""
    app.dependency_overrides[labeling.annotator] = lambda: name
    body = {"claims": [{"claim_id": CLAIM_0, "origin": "extracted", "status": status, "claim": "x"}]}
    if evidence is not None:
        body["labels"] = [
            {
                "claim_id": CLAIM_0,
                "reference_id": REF_B,
                "evidence": evidence,
                "rationale": rationale,
                "confidence": "high",
            }
        ]
    assert client.post("/labeling/sessions/a1/save", json=body).status_code == 200


def view_as(client, app, name, lead=False):
    app.dependency_overrides[labeling.annotator] = lambda: name
    app.dependency_overrides[labeling.is_lead] = lambda: lead
    return client.get("/labeling/compare/a1")


def test_compare_puts_the_viewers_verdict_first_and_flags_a_disagreement(api):
    client, _, app = api
    save_as(client, app, "wittawat", 3, rationale="partly")
    save_as(client, app, "aye", 4)
    got = view_as(client, app, "aye").json()
    assert (got["paper_id"], got["title"], got["labelers"]) == (
        "paperA-0123456789ab",
        "Paper A",
        ["aye", "wittawat"],
    )
    [pair] = got["pairs"]
    assert (pair["claim"], pair["reference_title"], pair["agree"], pair["notes"]) == (
        "Method Y improves recall.",
        "Ref B",
        False,
        [],
    )
    assert pair["verdicts"] == [
        {"labeler": "aye", "evidence": 4, "confidence": "high", "rationale": "", "claim_status": "accepted"},
        {
            "labeler": "wittawat",
            "evidence": 3,
            "confidence": "high",
            "rationale": "partly",
            "claim_status": "accepted",
        },
    ]
    assert "ai_reviewed" not in pair["verdicts"][0]


def test_compare_is_refused_before_saving_and_open_to_a_lead(api):
    client, _, app = api
    save_as(client, app, "wittawat", 3)
    assert view_as(client, app, "aye").status_code == 403
    assert view_as(client, app, "lead", lead=True).json()["pairs"][0]["verdicts"][0]["labeler"] == "wittawat"


def test_compare_hides_the_pairs_the_viewer_has_not_judged(api):
    # A blind labeler who saved one pair must not see the others' levels on the rest.
    client, db, app = api
    save_as(client, app, "wittawat", 3)
    db.append(
        "labels",
        [
            {
                "annotator": "wittawat",
                "annotator_id": "wittawat",
                "paper_id": "paperA-0123456789ab",
                "claim_id": "paperA-0123456789ab#1",
                "reference_id": REF_B,
                "evidence": "2",
                "claim": "Y is fast.",
            }
        ],
    )
    save_as(client, app, "aye", 3)
    assert [p["claim_id"] for p in view_as(client, app, "aye").json()["pairs"]] == [CLAIM_0]
    lead_pairs = view_as(client, app, "lead", lead=True).json()["pairs"]
    # Agreement before a pair one person labeled; the lead labeled neither.
    assert [(p["claim_id"], p["agree"]) for p in lead_pairs] == [
        (CLAIM_0, True),
        ("paperA-0123456789ab#1", False),
    ]


def test_a_rejected_claim_disagrees_with_a_level_and_drops_its_old_label(api):
    client, _, app = api
    save_as(client, app, "wittawat", 3)
    save_as(client, app, "aye", 2)
    save_as(client, app, "aye", status="rejected")  # her earlier level 2 no longer counts
    [pair] = view_as(client, app, "aye").json()["pairs"]
    assert pair["agree"] is False
    assert pair["verdicts"][0] == {
        "labeler": "aye",
        "evidence": None,
        "confidence": "",
        "rationale": "",
        "claim_status": "rejected",
    }


def test_compare_orders_disagreements_first_and_names_a_hand_added_claim(api):
    client, db, app = api
    added = "paperA-0123456789ab#h-abc123"
    rows = [
        {
            "annotator": who,
            "annotator_id": who,
            "paper_id": "paperA-0123456789ab",
            "claim_id": cid,
            "reference_id": REF_B,
            "evidence": level,
            "claim": text,
        }
        for who, cid, level, text in [
            ("aye", CLAIM_0, "3", ""),
            ("wittawat", CLAIM_0, "3", ""),
            ("aye", added, "1", "A claim typed by hand."),
            ("wittawat", added, "2", ""),
        ]
    ]
    db.append("labels", rows)
    pairs = view_as(client, app, "aye").json()["pairs"]
    assert [(p["claim_id"], p["agree"], p["claim"]) for p in pairs] == [
        (added, False, "A claim typed by hand."),
        (CLAIM_0, True, "Method Y improves recall."),
    ]


def test_a_note_is_kept_on_a_pair_and_comes_back_in_order(api):
    client, db, app = api
    save_as(client, app, "wittawat", 3)
    save_as(client, app, "aye", 4)
    note = {"claim_id": CLAIM_0, "reference_id": REF_B, "note": "The passage only says recall rose."}
    first = client.post("/labeling/compare/a1/notes", json=note).json()
    assert (first["author"], first["note"]) == ("aye", note["note"])
    db.tabs["compare_notes"].insert(
        0, {**db.tabs["compare_notes"][0], "ts": "2000-01-01T00:00:00+00:00", "note": "older"}
    )
    [pair] = view_as(client, app, "wittawat").json()["pairs"]
    assert [n["note"] for n in pair["notes"]] == ["older", note["note"]]
    assert db.tabs["labels"] and "compare_notes" not in labeling.TABS


def test_a_note_needs_a_pair_the_caller_can_see(api):
    client, db, app = api
    save_as(client, app, "wittawat", 3)
    db.append(
        "labels",
        [
            {
                "annotator": "wittawat",
                "annotator_id": "wittawat",
                "paper_id": "paperA-0123456789ab",
                "claim_id": "paperA-0123456789ab#1",
                "reference_id": REF_B,
                "evidence": "2",
            }
        ],
    )
    save_as(client, app, "aye", 3)
    app.dependency_overrides[labeling.is_lead] = lambda: False
    hidden = {"claim_id": "paperA-0123456789ab#1", "reference_id": REF_B, "note": "x"}
    assert client.post("/labeling/compare/a1/notes", json=hidden).status_code == 404
    unknown = {"claim_id": CLAIM_0, "reference_id": "nope", "note": "x"}
    assert client.post("/labeling/compare/a1/notes", json=unknown).status_code == 404
    app.dependency_overrides[labeling.annotator] = lambda: "stranger"
    app.dependency_overrides[labeling.is_lead] = lambda: False
    assert client.post("/labeling/compare/a1/notes", json=hidden).status_code == 403
    app.dependency_overrides[labeling.is_lead] = lambda: True
    assert client.post("/labeling/compare/a1/notes", json=hidden).status_code == 200
    assert db.tabs["compare_notes"][-1]["annotator_id"] == "stranger"


def test_a_lead_on_their_own_blind_check_compares_like_anyone_else(api, monkeypatch):
    client, db, app = _blind_round(api, monkeypatch)
    db.append(
        "labels",
        [
            {
                "annotator": "chanya",
                "annotator_id": "chanya",
                "paper_id": "paperA-0123456789ab",
                "claim_id": "paperA-0123456789ab#1",
                "reference_id": REF_B,
                "evidence": "2",
            }
        ],
    )
    assert view_as(client, app, "somchai", lead=True).status_code == 403
    save_as(client, app, "somchai", 4)
    assert [p["claim_id"] for p in view_as(client, app, "somchai", lead=True).json()["pairs"]] == [CLAIM_0]
    hidden = {"claim_id": "paperA-0123456789ab#1", "reference_id": REF_B, "note": "x"}
    assert client.post("/labeling/compare/a1/notes", json=hidden).status_code == 404
    assert len(view_as(client, app, "chanya", lead=True).json()["pairs"]) == 2  # not blind for chanya
