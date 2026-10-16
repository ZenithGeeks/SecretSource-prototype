"""Direct uploads to the papers bucket (#266): POST /uploads hands out an upload URL for one PDF,
and POST /analyses/from-upload starts one analysis of it, for the user who asked for the URL.

Cloud Storage is faked, the store is a temp SQLite file, and _start is replaced, so these tests
make no call to Google or Redis. PAPERS_DIR stands in for the mounted bucket.
"""

import re
import types

import pytest
from app import main, uploads
from app.auth import current_user
from fastapi.testclient import TestClient

PDF = b"%PDF-1.7\n%test\n"
PDF_SIZE = len(PDF)
SITE = "https://secretsource-web.vercel.app"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "analyses.db"))
    monkeypatch.setattr(main.store, "_use_supabase", lambda: False)
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    monkeypatch.setattr(main, "PAPERS_BUCKET", "test-papers")
    monkeypatch.setattr(uploads, "UPLOAD_ORIGINS", {SITE})
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
    yield types.SimpleNamespace(
        http=TestClient(main.app), started=started, papers=tmp_path, sessions=sessions
    )
    main.app.dependency_overrides.clear()


def ask(http, size=PDF_SIZE, origin=SITE):
    headers = {"Origin": origin} if origin else {}
    return http.post(
        "/uploads", json={"filename": "Attention Is All You Need.pdf", "size": size}, headers=headers
    )


def uploaded(client, content=PDF):
    """Ask for an upload and put `content` where the bucket would have it."""
    ticket = ask(client.http).json()
    (client.papers / ticket["object"]).write_bytes(content)
    return ticket["object"]


def analyse(http, name, verify=True):
    return http.post("/analyses/from-upload", json={"object_name": name, "verify": verify})


def test_an_upload_session_is_started_for_one_pdf_of_the_stated_size(client):
    ticket = ask(client.http, size=8_400_000).json()

    assert re.fullmatch(r"Attention-Is-All-You-Need-[0-9a-f]{12}\.pdf", ticket["object"])
    assert ticket["url"] == "https://storage.test/upload?upload_id=1"
    assert ticket["headers"] == {"Content-Type": "application/pdf"}
    assert client.sessions == [(ticket["object"], 8_400_000, SITE)]


@pytest.mark.parametrize("origin", ["https://evil.example", ""])
def test_an_origin_not_allowed_gets_no_session(client, origin):
    assert ask(client.http, origin=origin).status_code == 403
    assert client.sessions == []


def test_without_a_bucket_the_pdf_goes_through_the_gateway(client, monkeypatch):
    monkeypatch.setattr(main, "PAPERS_BUCKET", "")
    assert ask(client.http).json() == {"url": None}


def test_without_an_allowed_page_the_pdf_goes_through_the_gateway(client, monkeypatch):
    monkeypatch.setattr(uploads, "UPLOAD_ORIGINS", set())
    assert ask(client.http).json() == {"url": None}


@pytest.mark.parametrize("size", [0, uploads.MAX_UPLOAD_BYTES + 1])
def test_an_empty_pdf_or_one_over_100_mb_gets_no_url(client, size):
    assert ask(client.http, size=size).status_code == 422


def test_storage_refusing_the_session_is_a_503(client, monkeypatch):
    def refused(name, size, origin):
        raise uploads.UploadRefused("Cloud Storage answered 403")

    monkeypatch.setattr(uploads, "_upload_session", refused)
    assert ask(client.http).status_code == 503


def test_the_uploaded_pdf_is_analysed_from_the_bucket_once(client):
    name = uploaded(client)

    assert analyse(client.http, name, verify=False).json() == {"id": "a1"}
    assert client.started == [((client.papers / name).as_posix(), False, "user-ada")]
    assert analyse(client.http, name).status_code == 404
    assert len(client.started) == 1


def test_another_users_upload_cannot_be_analysed(client):
    name = uploaded(client)
    main.app.dependency_overrides[current_user] = lambda: "user-bo"

    assert analyse(client.http, name).status_code == 404
    assert client.started == []


@pytest.mark.parametrize("name", ["../secret.pdf", "paper.pdf", "x-0123456789ab.pdf/../../etc"])
def test_a_name_that_was_not_handed_out_is_refused(client, name):
    assert analyse(client.http, name).status_code == 404
    assert client.started == []


def test_an_upload_that_never_arrived_can_be_analysed_once_it_does(client):
    ticket = ask(client.http).json()

    answer = analyse(client.http, ticket["object"])
    assert answer.status_code == 404
    assert answer.json() == {"detail": "the upload has not reached storage"}

    (client.papers / ticket["object"]).write_bytes(PDF)
    assert analyse(client.http, ticket["object"]).status_code == 200


@pytest.mark.parametrize("content", [b"<html>not a paper</html>", PDF + b"more than was announced"])
def test_a_file_that_is_not_the_announced_pdf_is_refused(client, content):
    assert analyse(client.http, uploaded(client, content)).status_code == 400
    assert client.started == []


def test_an_object_name_keeps_only_a_safe_stem():
    assert re.fullmatch(r"pass-wd-[0-9a-f]{12}\.pdf", uploads.object_name("../../etc/pass wd.pdf"))
    assert re.fullmatch(r"paper-[0-9a-f]{12}\.pdf", uploads.object_name("???.pdf"))


class FakeStorage:
    def __init__(self, status=200, location="https://storage.googleapis.com/upload/session-1"):
        self.calls = []
        self.response = types.SimpleNamespace(
            status_code=status, headers={"Location": location} if location else {}
        )

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


def test_a_session_is_asked_for_that_one_pdf_size_and_origin(monkeypatch):
    storage = FakeStorage()
    monkeypatch.setattr(uploads, "PAPERS_BUCKET", "test-papers")
    monkeypatch.setattr(uploads, "_storage", lambda: storage)

    url = uploads._upload_session("paper-0123456789ab.pdf", 8_400_000, SITE)

    assert url == "https://storage.googleapis.com/upload/session-1"
    ((sent_to, request),) = storage.calls
    assert sent_to == "https://storage.googleapis.com/upload/storage/v1/b/test-papers/o"
    assert request["params"] == {"uploadType": "resumable", "name": "paper-0123456789ab.pdf"}
    assert request["headers"] == {
        "X-Upload-Content-Type": "application/pdf",
        "X-Upload-Content-Length": "8400000",
        "Origin": SITE,
    }


@pytest.mark.parametrize("storage", [FakeStorage(status=403), FakeStorage(location="")])
def test_a_refused_session_raises(monkeypatch, storage):
    monkeypatch.setattr(uploads, "_storage", lambda: storage)
    with pytest.raises(uploads.UploadRefused):
        uploads._upload_session("paper-0123456789ab.pdf", 10, SITE)
