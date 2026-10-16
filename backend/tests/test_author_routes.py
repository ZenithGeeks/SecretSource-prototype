"""The Author role's routes (app/author/router.py): drafts, projects, sources, draft checks
and the report, each scoped to its owner like every other route.

Same fixture shape as test_checks.py / test_user_settings.py: login is on with a table of
known tokens, storage is a temp SQLite file, and the pipeline's verify_claim is replaced by
a stub so no retrieval service or model is needed. The draft-check background task is run
directly under asyncio.run, as test_checks.py does for _run_check.
"""

import asyncio
import io
import json
import time
import zipfile
from datetime import datetime, timedelta

import pytest
from app import auth, main
from app.author import router as author
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}
ADA = {"Authorization": "Bearer token-ada"}
BO = {"Authorization": "Bearer token-bo"}

TEX = r"""\section{Related work}
Late interaction scores with MaxSim~\cite{khattab2020}.
ColBERTv2 reduces index size by $6$--$10\times$~\cite{khattab2020}.
MS MARCO has 8.8M passages~\cite{nguyen2016}.
Nobody defined this~\cite{ghost2020}.
"""
BIB = r"""@inproceedings{khattab2020,
  title = {ColBERT},
  author = {Khattab, Omar and Zaharia, Matei},
  year = {2020},
  doi = {10.1145/3397271.3401075},
}
@article{nguyen2016, title={MS MARCO}, author={Nguyen, Tri}, year={2016}}
@misc{unused2019, title={Never cited}, year={2019}, url={https://x.y}}
"""


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path / "papers")
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    # The route hands the run to _spawn; the tests run the coroutine themselves under
    # asyncio.run (as test_checks.py does), so nothing races the TestClient's loop.
    monkeypatch.setattr(author, "_spawn", lambda coroutine: coroutine.close())
    # The index lookup for cited DOIs (#421) goes to Crossref; these tests stay offline.
    monkeypatch.setattr(author, "reference_check", lambda fields: {})
    main.analyses.clear()
    main.streams.clear()
    yield TestClient(main.app)
    main.analyses.clear()
    main.streams.clear()


def make_draft(client, headers=ADA, project_id=None, title="Related work"):
    files = [{"name": "related-work.tex", "content": TEX}, {"name": "main.bib", "content": BIB}]
    response = client.post(
        "/author/drafts", headers=headers, json={"title": title, "projectId": project_id, "files": files}
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- drafts ---------------------------------------------------------------------------


def test_a_draft_is_created_read_edited_saved_and_only_by_its_owner(client):
    draft = make_draft(client)
    assert draft["version"] == 1 and draft["status"]["checked"] == 0
    assert [f["name"] for f in draft["files"]] == ["related-work.tex", "main.bib"]

    assert client.get(f"/author/drafts/{draft['id']}", headers=BO).status_code == 404
    assert [d["id"] for d in client.get("/author/drafts", headers=BO).json()] == []
    assert [d["id"] for d in client.get("/author/drafts", headers=ADA).json()] == [draft["id"]]

    edited = client.put(
        f"/author/drafts/{draft['id']}/files/related-work.tex", headers=ADA, json={"content": "x"}
    )
    assert edited.json()["version"] == 1  # typing does not make a version
    saved = client.post(f"/author/drafts/{draft['id']}/save", headers=ADA).json()
    assert saved["version"] == 2
    stored = client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()
    assert stored["files"][0]["content"] == "x"

    added = client.put(
        f"/author/drafts/{draft['id']}/files/chapters/intro.tex", headers=ADA, json={"content": "hi"}
    )
    assert "chapters/intro.tex" in [f["name"] for f in added.json()["files"]]
    assert client.put(
        f"/author/drafts/{draft['id']}/files/../evil.tex", headers=ADA, json={"content": ""}
    ).status_code in (400, 404)
    assert (
        client.put(
            f"/author/drafts/{draft['id']}/files/notes.txt", headers=ADA, json={"content": ""}
        ).status_code
        == 400
    )

    assert client.delete(f"/author/drafts/{draft['id']}", headers=BO).status_code == 404
    assert client.delete(f"/author/drafts/{draft['id']}", headers=ADA).json() == {"deleted": draft["id"]}
    assert client.get(f"/author/drafts/{draft['id']}", headers=ADA).status_code == 404


def test_parse_reports_warnings_against_the_project_bib(client):
    project = client.post(
        "/author/projects", headers=ADA, json={"name": "Thesis", "bib": BIB, "bibName": "refs.bib"}
    ).json()
    draft = client.post(
        "/author/drafts",
        headers=ADA,
        json={"title": "ch2", "projectId": project["id"], "files": [{"name": "ch2.tex", "content": TEX}]},
    ).json()
    parsed = client.get(f"/author/drafts/{draft['id']}/parse", headers=ADA).json()
    assert parsed["citeCommands"] == 4 and parsed["bibEntries"] == 3
    assert {w["type"] for w in parsed["warnings"]} == {"missing-key", "unused-entry", "no-doi-url"}
    # the project's .bib is served with the draft's files, marked shared
    files = client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()["files"]
    assert [f["name"] for f in files] == ["ch2.tex", "refs.bib"] and files[1]["shared"] is True


def test_uploading_a_zip_makes_a_draft_from_its_tex_and_bib_files(client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("chapters/intro.tex", "intro")
        archive.writestr("main.tex", "main")
        archive.writestr("refs.bib", BIB)
        archive.writestr("figures/arch.pdf", b"%PDF not text")
        archive.writestr("__MACOSX/main.tex", "junk")
    response = client.post(
        "/author/drafts/upload",
        headers=ADA,
        files={"file": ("thesis.zip", buffer.getvalue(), "application/zip")},
    )
    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["title"] == "thesis"
    assert [f["name"] for f in draft["files"]] == ["main.tex", "chapters/intro.tex", "refs.bib"]

    bad = client.post("/author/drafts/upload", headers=ADA, files={"file": ("notes.txt", b"x", "text/plain")})
    assert bad.status_code == 400


# --- draft checks -----------------------------------------------------------------------


def stub_verify(monkeypatch, verdicts=None, fail_for=()):
    calls = []

    def verify(claim, source):
        calls.append((claim, source))
        if source in fail_for:
            return {"status": "error", "reason": "no-open-access", "message": "no free copy published"}
        verdict = (verdicts or {}).get(source, "supports")
        return {
            "status": "ok",
            "claim": claim,
            "source": f"{source}.pdf",
            "verdict": verdict,
            "quote": f"the paper says {verdict}",
            "reasoning": "because",
            "evidence": [{"text": "t", "page": 4, "score": 0.9}],
            "indexed_in": {"index": "semantic-scholar", "ids": {}},
        }

    monkeypatch.setattr(main, "verify_claim", verify)
    return calls


def run_check(client, draft_id, headers=ADA):
    started = client.post(f"/author/drafts/{draft_id}/check", headers=headers)
    assert started.status_code == 200, started.text
    check_id = started.json()["id"]
    asyncio.run(author._run_draft_check(check_id, TOKENS[headers["Authorization"].split()[1]]))
    return check_id


def test_a_draft_check_verifies_every_cite_and_persists_per_version(client, monkeypatch):
    calls = stub_verify(monkeypatch, verdicts={"10.1145/3397271.3401075": "refutes"}, fail_for=("MS MARCO",))
    draft = make_draft(client)
    check_id = run_check(client, draft["id"])

    check = client.get(f"/author/checks/{check_id}", headers=ADA).json()
    assert check["status"] == "done" and check["version"] == 1
    by_key = {(c["key"], c["line"]): c for c in check["citations"]}
    assert by_key[("khattab2020", 2)]["verdict"] == "refutes"
    assert by_key[("khattab2020", 2)]["sourceRef"]["authors"] == "Khattab & Zaharia"
    assert by_key[("khattab2020", 2)]["evidence"] == {
        "passage": "the paper says refutes",
        "pdf": "10.1145/3397271.3401075.pdf",
        "page": 4,
    }
    assert by_key[("khattab2020", 2)]["explanation"] == "because"
    assert by_key[("nguyen2016", 4)]["verdict"] == "unavailable"
    assert by_key[("nguyen2016", 4)]["reason"] == "no-open-access"
    assert by_key[("ghost2020", 5)]["verdict"] == "unchecked"
    assert by_key[("ghost2020", 5)]["reason"] == "missing-key"
    assert check["summary"] == {
        "checked": 3,
        "counts": {"supports": 0, "refutes": 2, "insufficient": 0, "unavailable": 1, "unchecked": 1},
        "open": 2,
    }
    assert [s["stage"] for s in check["stages"]][0] == "planned" and check["stages"][-1]["stage"] == "done"
    # the pipeline was called once per resolvable citation, with the plain claim
    assert sorted(calls) == sorted(
        [
            ("Late interaction scores with MaxSim.", "10.1145/3397271.3401075"),
            ("ColBERTv2 reduces index size by 6–10×.", "10.1145/3397271.3401075"),
            ("MS MARCO has 8.8M passages.", "MS MARCO"),
        ]
    )
    # the same pair is read from the cache the second time
    check2 = run_check(client, draft["id"])
    assert len(calls) == 4  # only the failed lookup (MS MARCO) is retried
    history = client.get(f"/author/drafts/{draft['id']}/checks", headers=ADA).json()
    assert [h["id"] for h in history] == [check2, check_id]
    assert history[0]["sinceLastCheck"] == {"addedCitations": 0, "fixedIssues": 0, "newIssues": 0}
    assert history[0]["previousVersion"] == 1 and "citations" not in history[0]
    assert history[0]["unchanged"] is True and history[1]["unchanged"] is False

    # the draft's own view shows the latest check
    view = client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()
    assert view["status"]["open"] == 2 and view["lastCheckId"] == check2
    # checks stay out of the researcher analyses list, and out of the other user's reach
    assert client.get("/analyses", headers=ADA).json() == []
    assert client.get(f"/author/checks/{check_id}", headers=BO).status_code == 404
    assert client.get(f"/author/checks/{check_id}/events", headers=BO).status_code == 404
    assert client.get(f"/author/checks/{check_id}/events", headers=ADA).status_code == 200


def test_a_check_saves_unsaved_edits_first_and_the_version_names_what_was_checked(client, monkeypatch):
    stub_verify(monkeypatch)
    draft = make_draft(client)
    first = run_check(client, draft["id"])
    assert client.get(f"/author/checks/{first}", headers=ADA).json()["version"] == 1

    # the editor wrote an edit (no Ctrl+S): the check saves it as v2 and checks that
    assert "MaxSim" in TEX
    edited = TEX.replace("MaxSim", "MaxSim scoring")
    client.put(f"/author/drafts/{draft['id']}/files/related-work.tex", headers=ADA, json={"content": edited})
    assert client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()["version"] == 1
    second = run_check(client, draft["id"])
    view = client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()
    assert view["version"] == 2 and "savedHash" not in view
    history = client.get(f"/author/drafts/{draft['id']}/checks", headers=ADA).json()
    rows = [(h["id"], h["version"], h["unchanged"]) for h in history]
    assert rows == [(second, 2, False), (first, 1, False)]

    # nothing edited since: no new version, and the run says so
    third = run_check(client, draft["id"])
    assert client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()["version"] == 2
    history = client.get(f"/author/drafts/{draft['id']}/checks", headers=ADA).json()
    assert history[0]["id"] == third and history[0]["version"] == 2 and history[0]["unchanged"] is True
    assert history[0]["previousVersion"] == 2

    # a Ctrl+S save still bumps on its own, and the next check does not bump again
    assert client.post(f"/author/drafts/{draft['id']}/save", headers=ADA).json()["version"] == 3
    run_check(client, draft["id"])
    assert client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()["version"] == 3


def test_timestamps_are_iso_8601_in_utc_with_the_offset_written(client, monkeypatch):
    """The browser turns these into "checked 2 min ago": a naive stamp would be read as local
    time and be hours off, so every one carries its offset."""
    stub_verify(monkeypatch)
    draft = make_draft(client)
    check = client.get(f"/author/checks/{run_check(client, draft['id'])}", headers=ADA).json()
    project = client.post("/author/projects", headers=ADA, json={"name": "Thesis", "bib": BIB}).json()
    saved = client.post(f"/author/drafts/{draft['id']}/save", headers=ADA).json()
    stamps = {
        "draft.created": draft["created"],
        "draft.updated": draft["updated"],
        "draft.savedAt": saved["savedAt"],
        "draft.lastCheckedAt": saved["lastCheckedAt"],
        "check.startedAt": check["startedAt"],
        "check.finishedAt": check["finishedAt"],
        "project.created": project["created"],
        "project.updated": project["updated"],
    }
    for name, stamp in stamps.items():
        parsed = datetime.fromisoformat(stamp)
        assert parsed.tzinfo is not None and parsed.utcoffset() == timedelta(0), (name, stamp)
        assert stamp.endswith("+00:00"), (name, stamp)


def test_two_simultaneous_check_requests_start_one_check(client, monkeypatch):
    """The "one check at a time" guard holds across the awaits that follow it (PR #291
    review): two requests in flight at once, both past the ownership lookup, still start one
    check. The project lookup is slowed so the second request is handled while the first
    is still inside it."""
    draft = make_draft(client)

    def slow_project_of(draft, user):
        time.sleep(0.05)
        return None

    monkeypatch.setattr(author, "_project_of", slow_project_of)

    async def both():
        return await asyncio.gather(
            author.start_draft_check(draft["id"], "user-ada"),
            author.start_draft_check(draft["id"], "user-ada"),
            return_exceptions=True,
        )

    first, second = asyncio.run(both())
    started = [r for r in (first, second) if isinstance(r, dict)]
    refused = [r for r in (first, second) if not isinstance(r, dict)]
    assert len(started) == 1 and len(refused) == 1
    assert refused[0].status_code == 409 and started[0]["id"] in refused[0].detail
    running = [r for r in main.analyses.values() if r.get("draftId") == draft["id"]]
    assert [r["id"] for r in running] == [started[0]["id"]]


def test_a_check_whose_setup_fails_leaves_no_row_behind(client, monkeypatch):
    """When the work between the guard and the run raises (or is cancelled), the reserved
    row goes with it; otherwise every later Re-check would be refused as "already running"."""
    draft = make_draft(client)

    def failing_project_of(draft, user):
        raise RuntimeError("store down")

    monkeypatch.setattr(author, "_project_of", failing_project_of)
    streams_before = set(main.streams)
    with pytest.raises(RuntimeError):
        asyncio.run(author.start_draft_check(draft["id"], "user-ada"))
    assert not [r for r in main.analyses.values() if r.get("draftId") == draft["id"]]
    assert set(main.streams) == streams_before

    monkeypatch.setattr(author, "_project_of", lambda draft, user: None)
    assert client.post(f"/author/drafts/{draft['id']}/check", headers=ADA).status_code == 200


def test_a_write_carrying_a_stale_updated_is_refused_and_a_chained_one_is_not(client):
    """PR #291 review: the editor sends the draft's `updated` it last saw with each write.
    Its own writes chain, each carrying the previous answer's value, and pass; a write from
    a tab that read the draft before those writes is a 409 and changes nothing. A client
    that sends no `updated` (an older one) is not checked."""
    draft = make_draft(client)
    url = f"/author/drafts/{draft['id']}/files/related-work.tex"

    first = client.put(url, headers=ADA, json={"content": "one", "updated": draft["updated"]})
    assert first.status_code == 200 and first.json()["updated"] != draft["updated"]
    second = client.put(url, headers=ADA, json={"content": "two", "updated": first.json()["updated"]})
    assert second.status_code == 200

    stale = client.put(url, headers=ADA, json={"content": "old", "updated": draft["updated"]})
    assert stale.status_code == 409 and "changed elsewhere" in stale.json()["detail"]
    stored = client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()
    assert stored["files"][0]["content"] == "two"
    assert stored["updated"] == second.json()["updated"]

    assert client.put(url, headers=ADA, json={"content": "three"}).status_code == 200


def test_one_drafts_checks_are_only_its_own_oldest_first(monkeypatch):
    def row(check_id, draft, started, owner="ada", kind=author.DRAFT_CHECK):
        return {"id": check_id, "draftId": draft, "startedAt": started, "owner": owner, "kind": kind}

    rows = [
        row("late", "d1", "2026-09-28T10:00:00+00:00"),
        row("other-draft", "d2", "2026-09-28T09:00:00+00:00"),
        row("early", "d1", "2026-09-27T10:00:00+00:00"),
        row("someone-else", "d1", "2026-09-26T10:00:00+00:00", owner="bo"),
        row("single-claim", "d1", "2026-09-25T10:00:00+00:00", kind="check"),
        {"id": "paper", "owner": "ada", "status": "done"},
    ]
    monkeypatch.setattr(main, "analyses", {r["id"]: r for r in rows})

    assert [r["id"] for r in author._checks_of("d1", "ada")] == ["early", "late"]
    assert author._checks_of("d3", "ada") == []
    # the same answer the per-request grouping gives the list routes
    assert author._checks_of("d1", "ada") == author._checks_by_draft("ada")["d1"]
    assert author._previous_of(rows[0] | {"status": "done"}, "ada") is None  # `early` is not done
    rows[2]["status"] = "done"
    assert author._previous_of(rows[0], "ada")["id"] == "early"


def test_a_second_check_while_one_runs_is_refused(client):
    draft = make_draft(client)
    first = client.post(f"/author/drafts/{draft['id']}/check", headers=ADA).json()["id"]
    refused = client.post(f"/author/drafts/{draft['id']}/check", headers=ADA)
    assert refused.status_code == 409 and first in refused.json()["detail"]
    # a running check is left alone by delete
    assert client.delete(f"/author/checks/{first}", headers=ADA).status_code == 409


def test_resolving_a_citation_is_kept_and_an_override_survives_a_recheck(client, monkeypatch):
    stub_verify(monkeypatch, verdicts={"10.1145/3397271.3401075": "refutes"})
    draft = make_draft(client)
    check_id = run_check(client, draft["id"])
    check = client.get(f"/author/checks/{check_id}", headers=ADA).json()
    contradicted = [c for c in check["citations"] if c["verdict"] == "refutes"]
    kept, replaced = contradicted

    over = client.patch(
        f"/author/checks/{check_id}/citations/{kept['id']}",
        headers=ADA,
        json={"resolution": {"kind": "overridden", "note": "the 2020 paper is fine here"}},
    ).json()
    assert over["summary"]["open"] == 1
    swapped = client.patch(
        f"/author/checks/{check_id}/citations/{replaced['id']}",
        headers=ADA,
        json={
            "resolution": {"kind": "replaced", "previousKey": "khattab2020"},
            "key": "santhanam2022",
            "verdict": "supports",
            "sourceRef": {
                "key": "santhanam2022",
                "title": "ColBERTv2",
                "authors": "Santhanam et al.",
                "year": 2022,
            },
        },
    ).json()
    assert swapped["summary"]["open"] == 0
    assert (
        client.patch(
            f"/author/checks/{check_id}/citations/{kept['id']}", headers=BO, json={"resolution": None}
        ).status_code
        == 404
    )
    bad = client.patch(
        f"/author/checks/{check_id}/citations/{kept['id']}", headers=ADA, json={"verdict": "maybe"}
    )
    assert bad.status_code == 400

    # a re-check keeps the author's override on the same sentence, but re-judges the rest
    check2 = run_check(client, draft["id"])
    again = client.get(f"/author/checks/{check2}", headers=ADA).json()
    carried = next(c for c in again["citations"] if c["line"] == kept["line"])
    assert carried["resolution"]["kind"] == "overridden" and carried["verdict"] == "refutes"
    assert again["summary"]["open"] == 1  # the replaced one is back to what the .tex says

    compare = client.get(f"/author/checks/{check2}/compare", headers=ADA).json()
    assert compare["previous"]["id"] == check_id
    assert {r["change"] for r in compare["rows"]} <= {"same", "new", "fixed", "changed", "added", "removed"}
    assert client.get(f"/author/checks/{check_id}/compare", headers=ADA).status_code == 404


def test_a_crash_in_the_pipeline_is_an_honest_unavailable(client, monkeypatch):
    def boom(claim, source):
        raise RuntimeError("colbert unreachable")

    monkeypatch.setattr(main, "verify_claim", boom)
    draft = make_draft(client)
    check_id = run_check(client, draft["id"])
    check = client.get(f"/author/checks/{check_id}", headers=ADA).json()
    assert check["status"] == "done"
    resolvable = [c for c in check["citations"] if c["key"] != "ghost2020"]
    assert {c["verdict"] for c in resolvable} == {"unavailable"}
    assert all(c["message"] == "colbert unreachable" for c in resolvable)
    assert not any("quote" in c for c in resolvable)


def test_an_uploaded_source_pdf_is_used_instead_of_a_lookup(client, monkeypatch):
    calls = stub_verify(monkeypatch)
    draft = make_draft(client)
    attached = client.post(
        f"/author/drafts/{draft['id']}/citations/nguyen2016/pdf",
        headers=ADA,
        files={"file": ("msmarco.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert attached.status_code == 200, attached.text
    name = attached.json()["pdf"]
    assert name.startswith("msmarco-") and name.endswith(".pdf")
    assert client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()["pdfs"] == {"nguyen2016": name}
    run_check(client, draft["id"])
    sources = {source for _, source in calls}
    assert any(source.endswith(name) for source in sources)
    assert "MS MARCO" not in sources
    # the uploaded paper can be opened by its owner and nobody else
    assert client.get(f"/papers/{name}", headers=ADA).status_code == 200
    assert client.get(f"/papers/{name}", headers=BO).status_code == 404
    rejected = client.post(
        f"/author/drafts/{draft['id']}/citations/x/pdf",
        headers=ADA,
        files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
    )
    assert rejected.status_code == 400


def test_the_report_needs_a_check_and_then_is_a_pdf(client, monkeypatch):
    pytest.importorskip("pymupdf")
    stub_verify(monkeypatch)
    draft = make_draft(client)
    assert client.post(f"/author/drafts/{draft['id']}/report", headers=ADA).status_code == 409
    run_check(client, draft["id"])
    report = client.post(f"/author/drafts/{draft['id']}/report", headers=ADA)
    assert report.status_code == 200
    assert report.headers["content-type"] == "application/pdf"
    assert report.content.startswith(b"%PDF")
    assert 'filename="related-work-report.pdf"' in report.headers["content-disposition"]


# --- projects, library, sources ---------------------------------------------------------


def test_projects_carry_a_bib_and_their_cards_count_entries_cited_and_issues(client, monkeypatch):
    stub_verify(monkeypatch, verdicts={"10.1145/3397271.3401075": "refutes"})
    project = client.post("/author/projects", headers=ADA, json={"name": "Thesis", "bib": BIB}).json()
    assert project["entries"] == 3 and project["cited"] == 0 and project["drafts"] == 0
    assert client.post("/author/projects", headers=ADA, json={"name": "  "}).status_code == 400

    draft = client.post(
        "/author/drafts",
        headers=ADA,
        json={"title": "ch2", "projectId": project["id"], "files": [{"name": "ch2.tex", "content": TEX}]},
    ).json()
    run_check(client, draft["id"])
    cards = client.get("/author/projects", headers=ADA).json()
    assert cards[0]["cited"] == 2 and cards[0]["needWork"] == 2 and cards[0]["tally"]["refutes"] == 2
    assert cards[0]["checkedAt"] and cards[0]["drafts"] == 1
    assert client.get("/author/projects", headers=BO).json() == []

    detail = client.get(f"/author/projects/{project['id']}", headers=ADA).json()
    assert [d["id"] for d in detail["draftList"]] == [draft["id"]]
    assert len(detail["history"][draft["id"]]) == 1
    assert detail["bib"]["content"] == BIB
    assert client.get(f"/author/projects/{project['id']}", headers=BO).status_code == 404

    removed = client.delete(f"/author/projects/{project['id']}/bib/unused2019", headers=ADA).json()
    assert removed == {"removed": "unused2019", "entries": 2}
    assert client.delete(f"/author/projects/{project['id']}/bib/unused2019", headers=ADA).status_code == 404

    gone = client.delete(f"/author/projects/{project['id']}", headers=ADA).json()
    assert gone == {"deleted": project["id"]}
    assert client.get(f"/author/drafts/{draft['id']}", headers=ADA).json()["projectId"] is None


def test_importing_a_bib_or_a_zip_makes_a_project(client):
    from_bib = client.post(
        "/author/projects/import", headers=ADA, files={"file": ("refs.bib", BIB.encode(), "text/plain")}
    )
    assert from_bib.status_code == 200, from_bib.text
    assert from_bib.json()["name"] == "refs" and from_bib.json()["entries"] == 3

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("main.tex", TEX)
        archive.writestr("main.bib", BIB)
    from_zip = client.post(
        "/author/projects/import",
        headers=ADA,
        files={"file": ("thesis.zip", buffer.getvalue(), "application/zip")},
    )
    assert from_zip.status_code == 200, from_zip.text
    assert from_zip.json()["drafts"] == 1 and from_zip.json()["bibName"] == "main.bib"
    detail = client.get(f"/author/projects/{from_zip.json()['id']}", headers=ADA).json()
    assert detail["draftList"][0]["title"] == "thesis"


def test_the_library_lists_attention_rows_and_saved_sources(client, monkeypatch):
    stub_verify(monkeypatch, verdicts={"10.1145/3397271.3401075": "refutes"})
    project = client.post("/author/projects", headers=ADA, json={"name": "Thesis", "bib": BIB}).json()
    draft = client.post(
        "/author/drafts",
        headers=ADA,
        json={"title": "ch2", "projectId": project["id"], "files": [{"name": "ch2.tex", "content": TEX}]},
    ).json()
    run_check(client, draft["id"])
    saved = client.post(
        "/author/sources",
        headers=ADA,
        json={
            "title": "ColBERTv2",
            "authorsList": ["Keshav Santhanam"],
            "year": 2022,
            "venue": "NAACL",
            "doi": "10.1/x",
            "identifier": "10.1/x",
            "claim": "index smaller",
            "verdict": "supports",
        },
    ).json()
    assert (
        saved["key"] == "santhanam2022"
        and saved["inBib"] is False
        and "@inproceedings{santhanam2022" in saved["bibtex"]
    )

    library = client.get("/author/library", headers=ADA).json()
    assert [p["id"] for p in library["projects"]] == [project["id"]]
    kinds = {(row["kind"], row["key"]) for row in library["attention"]}
    assert ("replace", "khattab2020") in kinds
    assert ("upload-pdf", "nguyen2016") in kinds  # unavailable after the check
    assert ("remove", "unused2019") in kinds
    assert len([r for r in library["attention"] if r["key"] == "nguyen2016"]) == 1
    assert library["unsorted"] == {"sources": 1, "pdfs": 0, "drafts": 0}
    assert [s["id"] for s in library["saved"]] == [saved["id"]]
    assert client.get("/author/library", headers=BO).json()["saved"] == []

    added = client.post(
        f"/author/sources/{saved['id']}/add-to-bib", headers=ADA, json={"projectId": project["id"]}
    ).json()
    assert added["inBib"] is True and added["projectId"] == project["id"]
    assert (
        client.post(
            f"/author/sources/{saved['id']}/add-to-bib", headers=ADA, json={"projectId": project["id"]}
        ).status_code
        == 409
    )
    assert (
        "santhanam2022"
        in client.get(f"/author/projects/{project['id']}", headers=ADA).json()["bib"]["content"]
    )

    pdf = client.post(
        f"/author/sources/{saved['id']}/pdf",
        headers=ADA,
        files={"file": ("cv2.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert pdf.status_code == 200 and pdf.json()["pdf"].endswith(".pdf")
    assert client.delete(f"/author/sources/{saved['id']}", headers=BO).status_code == 404
    assert client.delete(f"/author/sources/{saved['id']}", headers=ADA).json() == {"deleted": saved["id"]}


# --- your data --------------------------------------------------------------------------


def test_export_and_delete_all_cover_the_author_rows(client, monkeypatch):
    stub_verify(monkeypatch)
    project = client.post("/author/projects", headers=ADA, json={"name": "Thesis", "bib": BIB}).json()
    draft = make_draft(client, project_id=project["id"])
    run_check(client, draft["id"])
    client.post("/author/sources", headers=ADA, json={"title": "S", "authorsList": ["A B"], "year": 2020})
    make_draft(client, headers=BO, title="Bo's draft")

    export = client.get("/author/export", headers=ADA).json()
    assert [p["id"] for p in export["projects"]] == [project["id"]]
    assert [d["id"] for d in export["drafts"]] == [draft["id"]]
    assert len(export["sources"]) == 1 and len(export["checks"]) == 1
    assert "owner" not in export["drafts"][0]
    assert json.dumps(export)  # serialisable as a download

    deleted = client.delete("/user/data", headers=ADA).json()
    assert deleted["deleted"] == 1  # the draft check
    assert client.get("/author/drafts", headers=ADA).json() == []
    assert client.get("/author/projects", headers=ADA).json() == []
    assert client.get("/author/library", headers=ADA).json()["saved"] == []
    assert len(client.get("/author/drafts", headers=BO).json()) == 1


def test_delete_all_scoped_to_one_role_keeps_the_other_roles_data(client, monkeypatch):
    """PR #291 review: DELETE /user/data used to wipe both roles at once, so a Researcher
    clearing papers lost their Author drafts too. Each Settings tab now sends its own scope."""
    stub_verify(monkeypatch)
    project = client.post("/author/projects", headers=ADA, json={"name": "Thesis", "bib": BIB}).json()
    draft = make_draft(client, project_id=project["id"])
    run_check(client, draft["id"])
    client.post("/author/sources", headers=ADA, json={"title": "S", "authorsList": ["A B"], "year": 2020})
    researcher_project = client.post("/researcher/projects", headers=ADA, json={"name": "Survey"}).json()
    main.analyses["paper1"] = {
        "id": "paper1", "paper": "x.pdf", "status": "done", "owner": "user-ada",
        "stages": [], "claims": [],
    }

    def author_rows():
        return (
            client.get("/author/drafts", headers=ADA).json(),
            client.get("/author/projects", headers=ADA).json(),
            client.get("/author/library", headers=ADA).json()["saved"],
        )

    # The Researcher's Delete all: the paper and the researcher project go, the Author's rows stay.
    assert client.delete("/user/data?scope=researcher", headers=ADA).json() == {"deleted": 1, "skipped": 0}
    assert "paper1" not in main.analyses
    assert client.get("/researcher/projects", headers=ADA).json() == []
    drafts, projects, saved = author_rows()
    assert [d["id"] for d in drafts] == [draft["id"]] and [p["id"] for p in projects] == [project["id"]]
    assert len(saved) == 1
    assert len(client.get(f"/author/drafts/{draft['id']}/checks", headers=ADA).json()) == 1

    # The Author's Delete all: the draft check and rows go, a Researcher project made since stays.
    kept = client.post("/researcher/projects", headers=ADA, json={"name": "Kept"}).json()
    assert client.delete("/user/data?scope=author", headers=ADA).json() == {"deleted": 1, "skipped": 0}
    assert author_rows() == ([], [], [])
    assert [p["id"] for p in client.get("/researcher/projects", headers=ADA).json()] == [kept["id"]]
    assert researcher_project["id"] != kept["id"]


def test_delete_all_refuses_an_unknown_scope(client):
    response = client.delete("/user/data?scope=teacher", headers=ADA)
    assert response.status_code == 400
    assert "scope must be one of all, researcher, author" in response.text


def test_a_draft_check_says_which_cited_dois_no_index_knows(client, monkeypatch):
    # #421: the bib entry with a DOI is looked up in the indexes; the one without is not.
    stub_verify(monkeypatch, fail_for=("10.1145/3397271.3401075",))
    looked_up = []

    def reference_check(fields):
        looked_up.append(fields.get("doi"))
        return {"exists": "no"} if fields.get("doi") else {}

    monkeypatch.setattr(author, "reference_check", reference_check)
    draft = make_draft(client)
    check_id = run_check(client, draft["id"])

    check = client.get(f"/author/checks/{check_id}", headers=ADA).json()
    by_key = {(c["key"], c["line"]): c for c in check["citations"]}
    assert by_key[("khattab2020", 2)]["verdict"] == "unavailable"
    assert by_key[("khattab2020", 2)]["exists"] == "no"
    assert "exists" not in by_key[("nguyen2016", 4)]
    assert "exists" not in by_key[("ghost2020", 5)]  # no bib entry, so nothing to look up
    assert sorted(looked_up, key=str) == sorted(["10.1145/3397271.3401075"] * 2 + [None], key=str)
