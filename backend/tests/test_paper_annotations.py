import hashlib

import pytest
from app import auth, main, store
from fastapi.testclient import TestClient


TOKENS = {"token-ada": "user-ada", "token-bo": "user-bo"}
ADA = {"Authorization": "Bearer token-ada"}
BO = {"Authorization": "Bearer token-bo"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(auth, "_user_id_for", TOKENS.get)
    monkeypatch.setattr(store, "_use_supabase", lambda: False)
    papers = tmp_path / "papers"
    papers.mkdir()
    (papers / "paper.pdf").write_bytes(b"stable pdf bytes")
    monkeypatch.setattr(main, "PAPERS_DIR", papers)
    monkeypatch.setattr(main, "papers_of", lambda user: {"paper.pdf"} if user == "user-ada" else set())
    return TestClient(main.app)


def test_annotations_are_persisted_per_owner_and_pdf_content(client):
    saved = [{
        "id": "mark-1",
        "kind": "highlight",
        "page": 2,
        "color": "yellow",
        "rects": [{"x0": 0.1, "y0": 0.2, "x1": 0.8, "y1": 0.24}],
    }]

    assert client.get("/papers/paper.pdf/annotations", headers=ADA).json() == {"annotations": []}
    response = client.put("/papers/paper.pdf/annotations", headers=ADA, json={"annotations": saved})

    assert response.status_code == 200, response.text
    assert response.json() == {"annotations": saved}
    assert client.get("/papers/paper.pdf/annotations", headers=ADA).json() == {"annotations": saved}

    digest = hashlib.sha256(b"stable pdf bytes").hexdigest()
    assert store.load_paper_annotations("user-ada", digest) == saved
    assert store.load_paper_annotations("user-bo", digest) == []


def test_annotations_require_access_to_the_pdf(client):
    assert client.get("/papers/paper.pdf/annotations", headers=BO).status_code == 404
    assert client.put("/papers/paper.pdf/annotations", headers=BO, json={"annotations": []}).status_code == 404


def test_annotations_require_a_signed_in_user(client):
    assert client.get("/papers/paper.pdf/annotations").status_code == 401


@pytest.mark.parametrize(
    "annotation",
    [
        {"id": "x", "kind": "highlight", "page": 0, "color": "yellow"},
        {"id": "x", "kind": "unknown", "page": 1, "color": "yellow"},
        {"id": "x", "kind": "highlight", "page": 1, "color": "yellow", "rects": [{"x0": -1, "y0": 0, "x1": 1, "y1": 1}]},
    ],
)
def test_annotations_reject_invalid_shapes(client, annotation):
    response = client.put(
        "/papers/paper.pdf/annotations", headers=ADA, json={"annotations": [annotation]}
    )

    assert response.status_code == 422
