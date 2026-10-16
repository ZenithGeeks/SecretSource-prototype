"""Direct uploads to the papers bucket (#266): POST /uploads hands out an upload URL for one PDF,
and POST /analyses/from-upload starts an analysis of it, for the user who asked for the URL only.

Starting the upload session is replaced, the store is a temp SQLite file, and _start is replaced,
so these tests make no call to Google or Redis. PAPERS_DIR stands in for the mounted bucket.
"""

import re

import pytest
from app import main, uploads
from app.auth import current_user
from fastapi.testclient import TestClient

PDF = b"%PDF-1.7\n%test\n"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(main, "PAPERS_BUCKET", "test-papers")
    sessions = []

    def upload_session(name, size, origin):
        sessions.append((name, size, origin))
        return f"https://storage.test/upload?upload_id={len(sessions)}"

    monkeypatch.setattr(uploads, "_upload_session", upload_session)
    started = []
    monkeypatch.setattr(
        main, "_start", lambda paper, verify, owner: started.append((paper, verify, owner)) or {"id": "a1"}
    )
    main.app.dependency_overrides[current_user] = lambda: "user-ada"
    yield TestClient(main.app), started, tmp_path, sessions
    main.app.dependency_overrides.clear()


PDF_SIZE = len(PDF)


def ask(test_client, filename="Attention Is All You Need.pdf", size=PDF_SIZE):
    return test_client.post(
        "/uploads",
        json={"filename": filename, "size": size},
        headers={"Origin": "https://secretsource-web.vercel.app"},
    )


def test_an_upload_session_is_started_for_one_pdf_of_the_stated_size(client):
    test_client, _, _, sessions = client
    ticket = ask(test_client, size=8_400_000).json()

    assert re.fullmatch(r"Attention-Is-All-You-Need-[0-9a-f]{12}\.pdf", ticket["object"])
    assert ticket["url"] == "https://storage.test/upload?upload_id=1"
    assert ticket["headers"] == {"Content-Type": "application/pdf"}
    assert sessions == [(ticket["object"], 8_400_000, "https://secretsource-web.vercel.app")]


def test_storage_refusing_the_session_is_a_503(client, monkeypatch):
    test_client, _, _, _ = client

    def refused(name, size, origin):
        raise uploads.UploadUnavailable("Cloud Storage answered 403")

    monkeypatch.setattr(uploads, "_upload_session", refused)
    assert ask(test_client).status_code == 503


def test_without_a_bucket_the_pdf_goes_through_the_gateway(client, monkeypatch):
    test_client, _, _, _ = client
    monkeypatch.setattr(main, "PAPERS_BUCKET", "")
    assert ask(test_client).json() == {"url": None}


def test_a_pdf_over_100_mb_gets_no_url(client):
    test_client, _, _, _ = client
    assert ask(test_client, size=uploads.MAX_UPLOAD_BYTES + 1).status_code == 422


def test_the_uploaded_pdf_is_analysed_from_the_bucket(client):
    test_client, started, papers, _ = client
    ticket = ask(test_client).json()
    (papers / ticket["object"]).write_bytes(PDF)

    answer = test_client.post("/analyses/from-upload", json={"object": ticket["object"], "verify": False})

    assert answer.json() == {"id": "a1"}
    assert started == [((papers / ticket["object"]).as_posix(), False, "user-ada")]


def test_another_users_upload_cannot_be_analysed(client):
    test_client, started, papers, _ = client
    ticket = ask(test_client).json()
    (papers / ticket["object"]).write_bytes(PDF)
    main.app.dependency_overrides[current_user] = lambda: "user-bo"

    answer = test_client.post("/analyses/from-upload", json={"object": ticket["object"]})

    assert answer.status_code == 404 and started == []


@pytest.mark.parametrize("name", ["../secret.pdf", "paper.pdf", "x-0123456789ab.pdf/../../etc"])
def test_a_name_that_was_not_handed_out_is_refused(client, name):
    test_client, started, _, _ = client
    assert test_client.post("/analyses/from-upload", json={"object": name}).status_code == 404
    assert started == []


def test_an_upload_that_never_arrived_says_so(client):
    test_client, _, _, _ = client
    ticket = ask(test_client).json()

    answer = test_client.post("/analyses/from-upload", json={"object": ticket["object"]})

    assert answer.status_code == 404
    assert answer.json() == {"detail": "the upload has not reached storage"}


def test_a_file_that_is_not_a_pdf_is_refused(client):
    test_client, started, papers, _ = client
    ticket = ask(test_client).json()
    (papers / ticket["object"]).write_bytes(b"<html>not a paper</html>")

    answer = test_client.post("/analyses/from-upload", json={"object": ticket["object"]})

    assert answer.status_code == 400 and started == []


def test_an_object_name_keeps_only_a_safe_stem():
    assert re.fullmatch(r"pass-wd-[0-9a-f]{12}\.pdf", uploads.object_name("../../etc/pass wd.pdf"))
    assert re.fullmatch(r"paper-[0-9a-f]{12}\.pdf", uploads.object_name("???.pdf"))
