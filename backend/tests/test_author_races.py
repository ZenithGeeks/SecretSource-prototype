"""Two Author writes at once must not undo one another (SCRUM-477).

Every project, draft and source route reads the whole row and writes it back. Each pair below
sends two real requests at the same moment through the app (httpx over ASGI, asyncio.gather), so
their store calls run on different threads, against a temp SQLite store. A short random pause
inside the store's read and write makes the two overlap within a few runs: without the row locks
every pair here loses data in most runs; with them, none may. RACE_RUNS sets how many runs each
pair gets (default 10; 200 shows the rates in the PR).
"""

import asyncio
import os
import random
import threading
import time

import httpx
import pytest
from app import auth, main
from app.author import router as author

TOKENS = {"token-ada": "user-ada"}
ADA = {"Authorization": "Bearer token-ada"}
RUNS = int(os.environ.get("RACE_RUNS", "10"))
BIB = "@article{kept2020, title={Kept}, year={2020}}\n\n@misc{gone2019, title={Gone}, year={2019}}\n"


@pytest.fixture
def app(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "races.db"))
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path / "papers")
    monkeypatch.setattr(main.dependencies, "report", lambda: {"degraded": False, "dependencies": []})
    monkeypatch.setattr(author, "enqueue_draft_check", lambda *args, **kwargs: None)
    monkeypatch.setattr(author, "_publish_row", lambda *args, **kwargs: None)
    load, save = main.store.load_author_row, main.store.save_author_row

    def slow_load(table, row_id):
        row = load(table, row_id)
        time.sleep(random.uniform(0, 0.004))
        return row

    def slow_save(table, row):
        time.sleep(random.uniform(0, 0.004))
        save(table, row)

    monkeypatch.setattr(main.store, "load_author_row", slow_load)
    monkeypatch.setattr(main.store, "save_author_row", slow_save)
    main.analyses.clear()
    main.streams.clear()
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")
    main.analyses.clear()
    main.streams.clear()


def stored(table, row_id):
    return main.store.load_author_row(table, row_id)


def text(draft, name):
    return next((f["content"] for f in draft["files"] if f["name"] == name), None)


def races(app, setup, first, second, lost, runs=None):
    """How many of `runs` runs (RUNS by default) lost data: each makes fresh rows with `setup`,
    sends `first` and `second` together, and asks `lost` about the rows afterwards."""

    async def run():
        losses = 0
        async with app as client:
            for _ in range(runs or RUNS):
                main.analyses.clear()
                made = await setup(client)
                answers = await asyncio.gather(first(client, made), second(client, made))
                losses += bool(await asyncio.to_thread(lost, made, answers))
        return losses

    return asyncio.run(run())


async def a_draft(client, project_id=None):
    files = [{"name": "a.tex", "content": "old"}, {"name": "b.tex", "content": "B"}]
    body = {"title": "Race", "projectId": project_id, "files": files}
    response = await client.post("/author/drafts", headers=ADA, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def a_project(client):
    response = await client.post("/author/projects", headers=ADA, json={"name": "P", "bib": BIB})
    assert response.status_code == 200, response.text
    return response.json()


def a_pdf():
    return {"file": ("p.pdf", b"%PDF-1.4\n" + os.urandom(8), "application/pdf")}


def autosave(content="new"):
    return lambda c, d: c.put(f"/author/drafts/{d['id']}/files/a.tex", headers=ADA, json={"content": content})


def ctrl_s(c, d):
    return c.post(f"/author/drafts/{d['id']}/save", headers=ADA)


def delete_b(c, d):
    return c.delete(f"/author/drafts/{d['id']}/files/b.tex", headers=ADA)


def pdf_upload(c, d):
    return c.post(f"/author/drafts/{d['id']}/citations/k1/pdf", headers=ADA, files=a_pdf())


def delete_draft(c, d):
    return c.delete(f"/author/drafts/{d['id']}", headers=ADA)


async def nothing(client):
    return None


# --- drafts ---------------------------------------------------------------------------


@pytest.mark.parametrize("save_first", [True, False], ids=["save-first", "delete-first"])
def test_ctrl_s_and_a_file_delete_keep_both(app, save_first):
    """a. Neither the deleted file comes back nor the new version is lost, whichever goes first."""
    pair = (ctrl_s, delete_b) if save_first else (delete_b, ctrl_s)

    def lost(d, _):
        draft = stored(author.DRAFTS, d["id"])
        return text(draft, "b.tex") is not None or draft["version"] != 2

    assert races(app, a_draft, *pair, lost) == 0


def test_an_autosave_and_a_file_delete_keep_both(app):
    def lost(d, _):
        draft = stored(author.DRAFTS, d["id"])
        return text(draft, "a.tex") != "new" or text(draft, "b.tex") is not None

    assert races(app, a_draft, autosave(), delete_b, lost) == 0


def test_an_autosave_and_a_pdf_upload_keep_both(app):
    """b. On a draft with no project the PDF goes on the draft row the autosave writes too."""

    def lost(d, _):
        draft = stored(author.DRAFTS, d["id"])
        return text(draft, "a.tex") != "new" or "k1" not in draft.get("pdfs", {})

    assert races(app, a_draft, autosave(), pdf_upload, lost) == 0


def test_ctrl_s_and_a_pdf_upload_keep_both(app):
    def lost(d, _):
        draft = stored(author.DRAFTS, d["id"])
        return draft["version"] != 2 or "k1" not in draft.get("pdfs", {})

    assert races(app, a_draft, ctrl_s, pdf_upload, lost) == 0


def test_a_check_saving_unsaved_edits_never_puts_older_text_back(app):
    """c. The check reads the row again before it saves, so the newer autosave stays."""

    async def setup(client):
        draft = await a_draft(client)
        assert (await autosave("unsaved")(client, draft)).status_code == 200
        return draft

    def check(c, d):
        return c.post(f"/author/drafts/{d['id']}/check", headers=ADA)

    def lost(d, answers):
        assert all(a.status_code == 200 for a in answers), [a.text for a in answers]
        return text(stored(author.DRAFTS, d["id"]), "a.tex") != "newer"

    assert races(app, setup, check, autosave("newer"), lost) == 0


@pytest.mark.parametrize(
    "write", [autosave(), ctrl_s, delete_b, pdf_upload], ids=["autosave", "ctrl-s", "delete-file", "pdf"]
)
def test_a_write_racing_a_draft_delete_never_brings_the_draft_back(app, write):
    """d. The write either lands first and is deleted with the row, or answers 404."""

    def lost(d, answers):
        assert answers[0].status_code == 200
        assert answers[1].status_code in (200, 404), answers[1].text
        return stored(author.DRAFTS, d["id"]) is not None

    assert races(app, a_draft, delete_draft, write, lost) == 0


def test_two_blank_drafts_at_once_get_two_numbers(app):
    """e. "+ New draft" twice at the same moment."""

    def new(c, _):
        return c.post("/author/drafts", headers=ADA, json={})

    def lost(_, answers):
        titles = [a.json()["title"] for a in answers]
        for answer in answers:
            main.store.delete_author_row(author.DRAFTS, answer.json()["id"])
        return titles[0] == titles[1]

    assert races(app, nothing, new, new, lost) == 0


# --- projects and sources ---------------------------------------------------------------


def test_two_blank_projects_at_once_get_two_numbers(app):
    def new(c, _):
        return c.post("/author/projects", headers=ADA, json={})

    def lost(_, answers):
        names = [a.json()["name"] for a in answers]
        for answer in answers:
            main.store.delete_author_row(author.PROJECTS, answer.json()["id"])
        return names[0] == names[1]

    assert races(app, nothing, new, new, lost) == 0


def test_two_sources_saved_at_once_get_two_bib_keys(app):
    """A saved source with no key gets the next free one (khattab2020, khattab2020a, …)."""
    body = {"title": "ColBERT", "authorsList": ["Omar Khattab"], "year": 2020}

    def save(c, _):
        return c.post("/author/sources", headers=ADA, json=body)

    def lost(_, answers):
        keys = [a.json()["key"] for a in answers]
        for answer in answers:
            main.store.delete_author_row(author.SOURCES, answer.json()["id"])
        return keys[0] == keys[1]

    assert races(app, nothing, save, save, lost) == 0


def test_a_source_saved_into_a_project_being_deleted_never_points_there(app):
    def delete(c, p):
        return c.delete(f"/author/projects/{p['id']}", headers=ADA)

    def save(c, p):
        body = {"title": "Into P", "key": "into2022", "year": 2022, "projectId": p["id"]}
        return c.post("/author/sources", headers=ADA, json=body)

    def lost(p, answers):
        assert answers[1].status_code in (200, 404), answers[1].text
        if answers[1].status_code == 404:
            return False
        return stored(author.SOURCES, answers[1].json()["id"]).get("projectId") is not None

    assert races(app, a_project, delete, save, lost) == 0


def test_a_rename_and_an_entry_removal_keep_both(app):
    def rename(c, p):
        return c.patch(f"/author/projects/{p['id']}", headers=ADA, json={"name": "Renamed"})

    def remove(c, p):
        return c.delete(f"/author/projects/{p['id']}/bib/gone2019", headers=ADA)

    def lost(p, _):
        project = stored(author.PROJECTS, p["id"])
        return project["name"] != "Renamed" or "gone2019" in project["bib"]["content"]

    assert races(app, a_project, rename, remove, lost) == 0


def test_a_project_pdf_and_a_rename_keep_both(app):
    def upload(c, p):
        return c.post(f"/author/projects/{p['id']}/bib/kept2020/pdf", headers=ADA, files=a_pdf())

    def rename(c, p):
        return c.patch(f"/author/projects/{p['id']}", headers=ADA, json={"name": "Renamed"})

    def lost(p, _):
        project = stored(author.PROJECTS, p["id"])
        return project["name"] != "Renamed" or "kept2020" not in project.get("pdfs", {})

    assert races(app, a_project, upload, rename, lost) == 0


def test_add_to_bib_and_an_entry_removal_keep_both(app):
    async def setup(client):
        project = await a_project(client)
        body = {"title": "Added", "key": "added2021", "year": 2021}
        source = await client.post("/author/sources", headers=ADA, json=body)
        assert source.status_code == 200, source.text
        return {"project": project, "source": source.json()}

    def add(c, m):
        body = {"projectId": m["project"]["id"]}
        return c.post(f"/author/sources/{m['source']['id']}/add-to-bib", headers=ADA, json=body)

    def remove(c, m):
        return c.delete(f"/author/projects/{m['project']['id']}/bib/gone2019", headers=ADA)

    def lost(m, _):
        content = stored(author.PROJECTS, m["project"]["id"])["bib"]["content"]
        return "added2021" not in content or "gone2019" in content

    assert races(app, setup, add, remove, lost) == 0


def test_a_pdf_on_a_drafts_project_racing_the_project_delete_never_brings_it_back(app):
    async def setup(client):
        project = await a_project(client)
        return {"project": project, "draft": await a_draft(client, project["id"])}

    def delete(c, m):
        return c.delete(f"/author/projects/{m['project']['id']}", headers=ADA)

    def upload(c, m):
        return pdf_upload(c, m["draft"])

    def lost(m, answers):
        assert all(a.status_code == 200 for a in answers), [a.text for a in answers]
        draft = stored(author.DRAFTS, m["draft"]["id"])
        return stored(author.PROJECTS, m["project"]["id"]) is not None or draft.get("projectId") is not None

    # Without the locks this pair loses data in about 1 run in 7, so it gets more runs.
    assert races(app, setup, delete, upload, lost, runs=3 * RUNS) == 0


def test_moving_a_draft_into_a_project_being_deleted_never_leaves_it_pointing_there(app):
    async def setup(client):
        return {"project": await a_project(client), "draft": await a_draft(client)}

    def delete(c, m):
        return c.delete(f"/author/projects/{m['project']['id']}", headers=ADA)

    def move(c, m):
        body = {"projectId": m["project"]["id"]}
        return c.patch(f"/author/drafts/{m['draft']['id']}", headers=ADA, json=body)

    def lost(m, answers):
        assert answers[1].status_code in (200, 404), answers[1].text
        return stored(author.DRAFTS, m["draft"]["id"]).get("projectId") is not None

    assert races(app, setup, delete, move, lost) == 0


def test_deleting_a_project_leaves_its_drafts_updated_alone(app):
    """#802: an open editor's next write after the delete must not be a conflict."""

    async def run():
        async with app as client:
            project = await a_project(client)
            draft = await a_draft(client, project["id"])
            assert (await client.delete(f"/author/projects/{project['id']}", headers=ADA)).status_code == 200
            after = stored(author.DRAFTS, draft["id"])
            assert after["projectId"] is None and after["updated"] == draft["updated"]
            body = {"content": "x", "updated": draft["updated"]}
            write = await client.put(f"/author/drafts/{draft['id']}/files/a.tex", headers=ADA, json=body)
            assert write.status_code == 200, write.text

    asyncio.run(run())


# --- the locks themselves -------------------------------------------------------------------


def test_the_registry_is_empty_once_the_races_are_over(app):
    assert races(app, a_draft, autosave(), pdf_upload, lambda d, a: False) == 0
    assert len(author.ROW_LOCKS) == 0


def test_the_registry_drops_a_key_once_nobody_holds_or_waits_for_it():
    locks = author.RowLocks()
    for n in range(500):
        with locks.hold((1, "author_drafts", f"d{n}")):
            assert len(locks) == 1
    assert len(locks) == 0

    key = (0, "author_projects", "p")
    waiting, through = threading.Event(), threading.Event()

    def waiter():
        waiting.set()
        with locks.hold(key):
            through.set()

    with locks.hold(key):
        thread = threading.Thread(target=waiter, daemon=True)
        thread.start()
        assert waiting.wait(timeout=5)
        time.sleep(0.05)
        assert len(locks) == 1 and not through.is_set()
    thread.join(timeout=5)
    assert through.is_set()
    assert len(locks) == 0


def test_two_holders_naming_the_same_rows_in_opposite_orders_never_deadlock():
    """Each takes the project first whatever order it names them in, so neither can hold the draft
    while it waits for the project the other holds."""
    locks = author.RowLocks()
    project, draft = (0, "author_projects", "p"), (1, "author_drafts", "d")
    ready = threading.Barrier(2)
    done = []

    def worker(keys):
        for _ in range(300):
            ready.wait(timeout=5)
            with locks.hold(*keys):
                time.sleep(0.0005)
        done.append(keys)

    orders = ((project, draft), (draft, project))
    threads = [threading.Thread(target=worker, args=(keys,), daemon=True) for keys in orders]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)
    assert len(done) == 2, "deadlocked"
    assert len(locks) == 0


@pytest.fixture
def short_wait(monkeypatch):
    monkeypatch.setattr(author, "LOCK_TIMEOUT_S", 0.5)


def test_a_draft_whose_lock_is_stuck_answers_busy_and_the_others_still_save(app, short_wait):
    """A write never waits on a stuck row for long: it answers 503 (409 for the editor's file
    write, which retries or offers its choice), and other drafts' writes are not held up."""

    async def run():
        async with app as client:
            stuck, other = await a_draft(client), await a_draft(client)
            held, done = threading.Event(), threading.Event()

            def holder():
                with author.ROW_LOCKS.hold((1, author.DRAFTS, stuck["id"])):
                    held.set()
                    done.wait(10)

            thread = threading.Thread(target=holder, daemon=True)
            thread.start()
            assert held.wait(5)
            try:
                started = time.monotonic()
                written = await autosave()(client, other)
                assert written.status_code == 200, written.text
                assert time.monotonic() - started < 0.4

                started = time.monotonic()
                saved, autosaved = await asyncio.gather(ctrl_s(client, stuck), autosave()(client, stuck))
                assert time.monotonic() - started < 3
            finally:
                done.set()
                thread.join(5)
            assert saved.status_code == 503 and saved.json()["detail"] == author.BUSY
            assert autosaved.status_code == 409 and autosaved.json()["detail"] == author.DRAFT_BUSY
            assert stored(author.DRAFTS, stuck["id"])["version"] == 1
            assert (await ctrl_s(client, stuck)).status_code == 200
            assert len(author.ROW_LOCKS) == 0

    asyncio.run(run())


def test_a_timeout_lets_go_of_the_locks_it_had_already_taken():
    locks = author.RowLocks()
    project, draft = (0, "author_projects", "p"), (1, "author_drafts", "d")
    held, done = threading.Event(), threading.Event()

    def holder():
        with locks.hold(draft):
            held.set()
            done.wait(10)

    thread = threading.Thread(target=holder, daemon=True)
    thread.start()
    assert held.wait(5)
    with pytest.raises(TimeoutError):
        with locks.hold(project, draft, timeout=0.1):
            pass
    # The project's lock, taken before the draft's timed out, is free again.
    with locks.hold(project, timeout=0.1):
        assert len(locks) == 2
    done.set()
    thread.join(5)
    assert len(locks) == 0


def test_one_deadline_covers_the_whole_hold_however_many_locks_are_busy():
    locks = author.RowLocks()
    keys = [(1, "author_drafts", f"d{n}") for n in range(5)]
    held, done = threading.Event(), threading.Event()

    def holder():
        with locks.hold(*keys):
            held.set()
            done.wait(10)

    thread = threading.Thread(target=holder, daemon=True)
    thread.start()
    assert held.wait(5)
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        with locks.hold(*keys, timeout=0.3):
            pass
    assert time.monotonic() - started < 0.6
    done.set()
    thread.join(5)
    assert len(locks) == 0


def test_routes_that_lock_a_project_and_its_draft_never_deadlock(app):
    """A PDF on a draft's project, the project's delete and a rename of the draft, all at once:
    every one finishes, run after run."""

    async def run():
        async with app as client:
            for _ in range(RUNS):
                project = await a_project(client)
                draft = await a_draft(client, project["id"])
                three = asyncio.gather(
                    pdf_upload(client, draft),
                    client.delete(f"/author/projects/{project['id']}", headers=ADA),
                    client.patch(f"/author/drafts/{draft['id']}", headers=ADA, json={"title": "Renamed"}),
                )
                answers = await asyncio.wait_for(three, timeout=20)
                assert all(a.status_code == 200 for a in answers), [a.text for a in answers]

    asyncio.run(run())
