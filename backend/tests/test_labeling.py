"""The labeling API: what a session shows, what a save writes, and what it refuses.

The Sheet is replaced by an in-memory store and the analysis by a fixture, so this needs neither
Google nor the gateway's heavy imports.
"""

import json
from pathlib import Path

import pytest
from app.labeling import dspy_export, ledger, pool
from app.labeling import router as labeling
from app.labeling.schema import ALL_TABS, current
from fastapi import FastAPI
from fastapi.testclient import TestClient


class MemoryLedger:
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
    db = MemoryLedger()
    monkeypatch.setattr(ledger, "get_store", lambda: db)
    monkeypatch.setattr(pool, "_cache", (0.0, []))
    app = FastAPI()
    app.include_router(labeling.router)
    app.dependency_overrides[labeling.owned_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.mine_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.annotator] = lambda: "chanya"
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
        {"reference_id": "refB-aaaaaaaaaaaa", "file": "refB-aaaaaaaaaaaa.pdf", "label": "Ref B"}
    ]


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

    def insert(self, rows):
        self._rows = rows
        return self

    def select(self, _):
        self._rows = None
        return self

    def eq(self, _, tab):
        self._tab = tab
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
        mine = [{"data": r["data"]} for r in self.stored if r["tab"] == self._tab]
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
            "annotator": "chanya",
            "article": "text of paperA-0123456789ab",
            "claims": ["Y improves recall by 4 points."],
            "rejected": ["Y is fast."],
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
            "claim": "Method Y improves recall.",
            "source": "recall rose by 4 points\n\nand held on BEIR",
            "verdict": "3",
            "verdict_name": "Clear",
            "rationale": "two controlled runs",
            "confidence": "high",
        }
    ]


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
