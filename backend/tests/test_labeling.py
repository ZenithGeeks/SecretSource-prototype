"""The labeling API: what a session shows, what a save writes, and what it refuses.

The Sheet is replaced by an in-memory store and the analysis by a fixture, so this needs neither
Google nor the gateway's heavy imports.
"""

from pathlib import Path

import pytest
from app.labeling import pool
from app.labeling import router as labeling
from app.labeling.schema import ALL_TABS, current
from fastapi import FastAPI
from fastapi.testclient import TestClient


class MemorySheet:
    def __init__(self):
        self.tabs = {tab: [] for tab in ALL_TABS}

    def read(self, tab):
        return [dict(r) for r in self.tabs[tab]]

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
                    "source": "data/papers/refB-aaaaaaaaaaaa.pdf",
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
    sheet = MemorySheet()
    monkeypatch.setattr(labeling.sheet, "get_store", lambda: sheet)
    monkeypatch.setattr(pool, "_cache", (0.0, []))
    app = FastAPI()
    app.include_router(labeling.router)
    app.dependency_overrides[labeling.owned_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.mine_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.annotator] = lambda: "chanya"
    return TestClient(app), sheet, app


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
        {"reference_id": "refB-aaaaaaaaaaaa", "file": "refB-aaaaaaaaaaaa.pdf", "label": "Ref B"}
    ]


def test_save_copies_retrieved_fields_from_the_analysis_not_the_request(api):
    client, sheet, _ = api
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
    row = sheet.tabs["candidates"][0]
    assert (row["passage"], row["reference_id"], row["rank"], row["annotator"]) == (
        "recall rose by 4 points",
        "refB-aaaaaaaaaaaa",
        "1",
        "chanya",
    )


def test_save_label_and_read_it_back_as_mine_with_others_listed(api):
    client, sheet, app = api
    label = {
        "claim_id": "paperA-0123456789ab#0",
        "reference_id": "refB-aaaaaaaaaaaa",
        "evidence": 3,
        "rationale": "=SUM(A1)",
        "spans": ["recall rose by 4 points"],
        "confidence": "high",
    }
    assert client.post("/labeling/sessions/a1/save", json={"labels": [label]}).json()["labels"] == 1
    assert sheet.tabs["labels"][0]["rationale"] == "=SUM(A1)"  # stored as text, written RAW
    assert sheet.tabs["labels"][0]["claim"] == "Method Y improves recall."
    mine = client.get("/labeling/sessions/a1").json()
    assert [r["evidence"] for r in mine["saved"]["labels"]] == ["3"]
    app.dependency_overrides[labeling.annotator] = lambda: "nuttanon"
    other = client.get("/labeling/sessions/a1").json()
    assert other["saved"]["labels"] == []
    assert other["others"] == {"paperA-0123456789ab#0|refB-aaaaaaaaaaaa": ["chanya"]}


def test_a_later_save_replaces_the_earlier_one_but_keeps_both_rows(api):
    client, sheet, _ = api
    label = {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 2}
    client.post("/labeling/sessions/a1/save", json={"labels": [label]})
    client.post("/labeling/sessions/a1/save", json={"labels": [{**label, "evidence": 4}]})
    assert len(sheet.tabs["labels"]) == 2
    assert [r["evidence"] for r in current("labels", sheet.tabs["labels"])] == ["4"]


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
    client, sheet, _ = api
    assert client.post("/labeling/sessions/a1/save", json=body).status_code in (422,)
    assert all(not rows for rows in sheet.tabs.values())  # nothing half-written


def test_misses_are_recorded(api):
    client, sheet, _ = api
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
    rows = {r["claim_id"]: r for r in sheet.tabs["claims"]}
    assert (
        rows["paperA-0123456789ab#1"]["claim"] == "Y is fast."
        and rows["paperA-0123456789ab#1"]["status"] == "rejected"
    )
    assert rows["paperA-0123456789ab#h-abc123"]["origin"] == "human_added"
    assert sheet.tabs["candidates"][0]["origin"] == "human_added"


def test_unconfigured_sheet_is_a_503_with_setup_message(api, monkeypatch):
    client, _, _ = api

    def boom():
        raise labeling.sheet.NotConfigured("set LABELING_SHEET_ID")

    monkeypatch.setattr(labeling.sheet, "get_store", boom)
    r = client.get("/labeling/sessions/a1")
    assert r.status_code == 503 and "LABELING_SHEET_ID" in r.json()["detail"]


def test_export_is_csv_of_current_rows(api):
    client, _, _ = api
    label = {"claim_id": "paperA-0123456789ab#0", "reference_id": "refB-aaaaaaaaaaaa", "evidence": 2}
    client.post("/labeling/sessions/a1/save", json={"labels": [label]})
    client.post("/labeling/sessions/a1/save", json={"labels": [{**label, "evidence": 4}]})
    text = client.get("/labeling/export?tab=labels").text.splitlines()
    assert len(text) == 2 and text[0].startswith("ts,annotator,paper_id")


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


def test_a_person_gets_a_topic_and_it_can_be_taken_back(api):
    client, sheet, _ = api
    assert client.put("/labeling/people", json={"name": "chanya", "topic": "NLP"}).status_code == 200
    state = client.get("/labeling/pool").json()
    assert {"name": "chanya", "topic": "NLP"} in state["people"]
    client.put("/labeling/people", json={"name": "chanya", "topic": ""})
    assert {"name": "chanya", "topic": ""} in client.get("/labeling/pool").json()["people"]
    assert len(sheet.tabs["assignments"]) == 2  # appended, never edited


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


def test_only_a_shared_analysis_opens_for_someone_else(monkeypatch):
    from app import main
    from app.auth import current_user

    sheet = MemorySheet()
    monkeypatch.setattr(labeling.sheet, "get_store", lambda: sheet)
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
