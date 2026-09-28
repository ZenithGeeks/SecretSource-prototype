"""The Settings modal's backend: a per-user preferences blob, bulk delete, and an avatar
image. Same ownership rules as analyses — each user only ever reads or writes their own.
"""

import pytest
from app import auth, main
from fastapi.testclient import TestClient

TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    # SUPABASE_URL above is only to turn login on (auth._supabase_configured); storage still
    # goes to the tmp SQLite db, not a real Supabase project.
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main, "AVATARS_DIR", tmp_path / "avatars")
    main.analyses.clear()
    yield TestClient(main.app)
    main.analyses.clear()


ADA = {"Authorization": "Bearer token-ada"}
BO = {"Authorization": "Bearer token-bo"}


def test_preferences_start_empty_and_a_patch_merges_and_persists(client):
    assert client.get("/user/preferences", headers=ADA).json() == {}

    first = client.patch("/user/preferences", headers=ADA, json={"patch": {"theme": "Dark"}})
    assert first.json() == {"theme": "Dark"}

    second = client.patch(
        "/user/preferences", headers=ADA, json={"patch": {"weeklyDigest": False}}
    )
    assert second.json() == {"theme": "Dark", "weeklyDigest": False}
    assert client.get("/user/preferences", headers=ADA).json() == {
        "theme": "Dark",
        "weeklyDigest": False,
    }


def test_each_users_preferences_are_their_own(client):
    client.patch("/user/preferences", headers=ADA, json={"patch": {"theme": "Dark"}})
    client.patch("/user/preferences", headers=BO, json={"patch": {"theme": "Light"}})
    assert client.get("/user/preferences", headers=ADA).json() == {"theme": "Dark"}
    assert client.get("/user/preferences", headers=BO).json() == {"theme": "Light"}


def test_a_request_without_a_token_is_refused(client):
    assert client.get("/user/preferences").status_code == 401
    assert client.patch("/user/preferences", json={"patch": {}}).status_code == 401
    assert client.delete("/user/data").status_code == 401


def test_delete_all_data_removes_only_the_callers_analyses(client):
    for analysis_id, owner in (("a1", "user-ada"), ("a2", "user-ada"), ("b1", "user-bo")):
        main.analyses[analysis_id] = {
            "id": analysis_id, "paper": "x.pdf", "status": "done",
            "owner": owner, "stages": [], "claims": [],
        }

    response = client.delete("/user/data", headers=ADA)
    assert response.json() == {"deleted": 2, "skipped": 0}
    assert sorted(main.analyses) == ["b1"]


def test_avatar_upload_download_and_remove_round_trip(client):
    assert client.get("/user/avatar/me", headers=ADA).status_code == 404

    upload = client.post(
        "/user/avatar", headers=ADA, files={"file": ("me.png", b"\x89PNG fake bytes", "image/png")}
    )
    assert upload.status_code == 200
    assert upload.json()["url"].startswith("/api/user/avatar/me")

    got = client.get("/user/avatar/me", headers=ADA)
    assert got.status_code == 200
    assert got.content == b"\x89PNG fake bytes"

    # Someone else's avatar is not this user's, even at the same fixed path.
    assert client.get("/user/avatar/me", headers=BO).status_code == 404

    client.delete("/user/avatar", headers=ADA)
    assert client.get("/user/avatar/me", headers=ADA).status_code == 404


def test_avatar_upload_rejects_the_wrong_type_or_too_large(client):
    text = client.post(
        "/user/avatar", headers=ADA, files={"file": ("me.txt", b"not an image", "text/plain")}
    )
    assert text.status_code == 400

    huge = client.post(
        "/user/avatar", headers=ADA,
        files={"file": ("me.png", b"0" * (main.MAX_AVATAR_BYTES + 1), "image/png")},
    )
    assert huge.status_code == 413


def test_a_re_upload_replaces_the_old_file_instead_of_stacking(client):
    client.post("/user/avatar", headers=ADA, files={"file": ("a.png", b"one", "image/png")})
    client.post("/user/avatar", headers=ADA, files={"file": ("b.jpg", b"two", "image/jpeg")})
    assert client.get("/user/avatar/me", headers=ADA).content == b"two"


def test_concurrent_patches_to_different_keys_both_survive(client, monkeypatch):
    """Two PATCHes in flight at once must not lose each other's key. The read step is slowed
    so both requests are guaranteed to interleave: without a lock around load→merge→save,
    both read `{}` and the last save wins, dropping the other key."""
    import time
    from concurrent.futures import ThreadPoolExecutor

    real_load = main.store.load_preferences

    def slow_load(owner):
        current = real_load(owner)
        time.sleep(0.2)  # on a worker thread, so the other request's handler can run meanwhile
        return current

    monkeypatch.setattr(main.store, "load_preferences", slow_load)

    def patch(key, value):
        return client.patch("/user/preferences", headers=ADA, json={"patch": {key: value}})

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(patch, "theme", "Dark")
        second = pool.submit(patch, "weeklyDigest", False)
        assert first.result().status_code == 200
        assert second.result().status_code == 200

    monkeypatch.setattr(main.store, "load_preferences", real_load)
    assert client.get("/user/preferences", headers=ADA).json() == {
        "theme": "Dark",
        "weeklyDigest": False,
    }


# --- avatar upload: the size cap is enforced before the body is buffered ---


def test_an_oversized_avatar_with_a_known_size_is_refused_before_it_is_read(client, monkeypatch):
    from starlette.datastructures import UploadFile

    reads = []
    real_read = UploadFile.read

    async def counting_read(self, size=-1):
        reads.append(size)
        return await real_read(self, size)

    monkeypatch.setattr(UploadFile, "read", counting_read)
    huge = client.post(
        "/user/avatar", headers=ADA,
        files={"file": ("me.png", b"0" * (main.MAX_AVATAR_BYTES + 1), "image/png")},
    )
    assert huge.status_code == 413
    assert reads == []  # rejected on file.size alone


def test_an_avatar_with_an_unknown_size_is_read_no_further_than_the_cap(client, monkeypatch):
    """Without a size (chunked upload) the body is read up to one byte past the cap, never
    whole: an oversized one is refused and a normal one is stored."""
    from starlette.datastructures import UploadFile

    no_size = property(lambda self: None, lambda self, value: None)
    monkeypatch.setattr(UploadFile, "size", no_size, raising=False)
    reads = []
    real_read = UploadFile.read

    async def counting_read(self, size=-1):
        reads.append(size)
        return await real_read(self, size)

    monkeypatch.setattr(UploadFile, "read", counting_read)

    huge = client.post(
        "/user/avatar", headers=ADA,
        files={"file": ("me.png", b"0" * (main.MAX_AVATAR_BYTES + 1), "image/png")},
    )
    assert huge.status_code == 413
    assert reads == [main.MAX_AVATAR_BYTES + 1]

    reads.clear()
    ok = client.post("/user/avatar", headers=ADA, files={"file": ("me.png", b"small", "image/png")})
    assert ok.status_code == 200
    assert reads == [main.MAX_AVATAR_BYTES + 1]
    assert client.get("/user/avatar/me", headers=ADA).content == b"small"


# --- avatar upload: one file per user, even for two uploads at once ---


def test_concurrent_uploads_leave_exactly_one_avatar_file(client, monkeypatch):
    """Two uploads for the same user in flight together (double-click, two tabs) with
    different extensions must not both pass the glob and leave two files. The unlink step is
    slowed so the two requests interleave if nothing serialises them."""
    import time
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path

    client.post("/user/avatar", headers=ADA, files={"file": ("a.png", b"one", "image/png")})

    real_unlink = Path.unlink

    def slow_unlink(self, missing_ok=False):
        time.sleep(0.2)
        return real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", slow_unlink)

    def upload(name, body, kind):
        return client.post("/user/avatar", headers=ADA, files={"file": (name, body, kind)})

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(upload, "b.jpg", b"two", "image/jpeg")
        second = pool.submit(upload, "c.webp", b"three", "image/webp")
        assert first.result().status_code == 200
        assert second.result().status_code == 200

    files = sorted(p.name for p in main.AVATARS_DIR.glob("user-ada.*"))
    assert len(files) == 1, files
    assert client.get("/user/avatar/me", headers=ADA).content in (b"two", b"three")


# --- delete all: a running analysis is left to finish ---


def test_delete_all_data_skips_a_running_analysis_and_its_run_can_still_publish(client, monkeypatch):
    """A running analysis's worker keeps saving it, so deleting it would not stick. Running ones
    are skipped and reported instead, and the run can still publish."""
    import asyncio

    monkeypatch.setattr(main.store, "save", lambda analysis: None)
    for analysis_id, status in (("done1", "done"), ("run1", "running")):
        main.analyses[analysis_id] = {
            "id": analysis_id, "paper": "x.pdf", "status": status,
            "owner": "user-ada", "stages": [], "claims": [],
        }
    main.streams["run1"] = asyncio.Queue()

    response = client.delete("/user/data", headers=ADA)
    assert response.json() == {"deleted": 1, "skipped": 1}
    assert sorted(main.analyses) == ["run1"]

    async def publish_then_close():
        await main._publish("run1", "verifying", claim=0)
        await main.streams["run1"].put(None)
        await main._saved("run1")

    asyncio.run(publish_then_close())  # no KeyError: the run's dicts are still there
    assert main.analyses["run1"]["stages"][0]["stage"] == "verifying"
    main.streams.clear()
