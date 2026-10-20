"""The labeling API: what a session shows, what a save writes, and what it refuses.

The Sheet is replaced by an in-memory store and the analysis by a fixture, so this needs neither
Google nor the gateway's heavy imports.
"""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests
from app.labeling import dspy_export, ledger, pool, scopus
from app.labeling import router as labeling
from app.labeling.schema import ALL_TABS, current
from fastapi import FastAPI
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
    # The paper list asks OpenAlex for keywords; a test that wants some stubs openalex_details.
    monkeypatch.setattr(scopus, "_subjects", {})
    monkeypatch.setattr(scopus, "openalex_details", lambda dois: {})
    app = FastAPI()
    app.include_router(labeling.router)
    app.dependency_overrides[labeling.owned_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.mine_analysis] = lambda: ANALYSIS
    app.dependency_overrides[labeling.annotator] = lambda: "chanya"
    app.dependency_overrides[labeling.current_user] = lambda: None
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


def test_session_asks_the_store_only_for_that_papers_rows(api):
    client, db, _ = api
    db.append("claims", [_claim("chanya", "paperA-0123456789ab#0")])
    db.append("claims", [_claim("chanya", "other-paper#0", paper="other-paper")])
    db.reads.clear()
    s = client.get("/labeling/sessions/a1").json()
    assert sorted(db.reads) == sorted(
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
                "abstract": "We retrieve late.",
                "subject": "Information Retrieval",
                "keywords": ["ColBERT"],
            }
        ],
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
    def fake_enqueue(analysis_id, paper, verify, owner, stages, started_at=None):
        started.append((analysis_id, paper, verify, owner))

    monkeypatch.setattr(main, "enqueue_analysis", fake_enqueue)
    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    monkeypatch.setattr(main, "redis_connection", lambda: SimpleNamespace(publish=lambda *a: 0))
    doi = "10.18653/v1/2022.naacl-main.272"
    first = client.post("/labeling/scopus/add", json={"doi": doi, "topic": "NLP"})
    assert first.status_code == 200
    analysis_id = first.json()["id"]
    assert first.json() == {"id": analysis_id, "existing": False}
    assert started == [(analysis_id, doi, True, None)]
    assert pool.pooled() == {analysis_id: "NLP"}
    again = client.post("/labeling/scopus/add", json={"doi": doi.upper(), "topic": "CV"})
    assert again.json() == {"id": analysis_id, "existing": True} and len(started) == 1
    assert client.post("/labeling/scopus/add", json={"doi": "not a doi", "topic": "NLP"}).status_code == 422


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

    def fake_enqueue(analysis_id, paper, verify, owner, stages, started_at=None):
        started.append((analysis_id, paper, owner))

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
    assert started == [(new_id, "10.1145/3712285.3771787", "nuttadon-id")]
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
    monkeypatch.setattr(scopus, "search", lambda *args: {"total": 3, "results": found})
    monkeypatch.setattr(scopus, "downloadable", lambda dois: {"10.1/a": True, "10.1/b": False})

    results = client.get("/labeling/scopus/search", params={"topic": "SE"}).json()["results"]

    assert [(r["doi"], r["downloadable"]) for r in results] == [
        ("10.1/A", True),
        ("10.1/b", False),
        ("10.1/c", None),
    ]


def test_every_venue_name_is_specific_enough_to_match_only_that_venue():
    # "Supercomputing" matched a journal and "Computer Vision and Pattern Recognition" a book series
    # when checked against the live Scopus index; short names do that.
    assert all(len(venue.split()) >= 4 for venues in scopus.VENUES.values() for venue in venues)


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


def test_only_hand_added_claims_are_searched_live(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(labeling.verify, "evidence_from", lambda claim, source_name: [])
    extracted = client.post(
        "/labeling/sessions/a1/candidates", json={"claim_id": "paperA-0123456789ab#0", "claim": "x"}
    )
    other_paper = client.post(
        "/labeling/sessions/a1/candidates", json={"claim_id": "paperB#h-abc12345", "claim": "x"}
    )
    assert extracted.status_code == 422 and other_paper.status_code == 422


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

    on_extracted = {**passage, "claim_id": "paperA-0123456789ab#0"}
    unknown_paper = {**passage, "reference_id": "refZ"}
    for bad in (on_extracted, unknown_paper):
        assert client.post("/labeling/sessions/a1/save", json={"candidates": [bad]}).status_code == 422
