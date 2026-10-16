"""POST /api/add indexes only files inside PAPERS_DIR, and refuses every other path with the
same message, so a caller cannot learn which files exist."""

import pytest


@pytest.fixture
def papers(server, monkeypatch, tmp_path):
    folder = tmp_path / "papers"
    folder.mkdir()
    (folder / "colbertv2.pdf").write_bytes(b"%PDF-1.4")
    (tmp_path / "secret.pdf").write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(server, "PAPERS_DIR", folder)
    return folder


def outside_paths(papers):
    return [
        "/etc/passwd",
        str(papers.parent / "secret.pdf"),
        str(papers / ".." / "secret.pdf"),
        str(papers / "missing.pdf"),
    ]


def test_api_add_indexes_a_paper_in_papers_dir(client, papers):
    response = client.post("/api/add", json={"path": str(papers / "colbertv2.pdf")})

    assert response.status_code == 200
    assert response.json() == {"added": 12, "papers": 1}


def test_api_add_refuses_other_paths_with_one_message(client, papers, server):
    for path in outside_paths(papers):
        response = client.post("/api/add", json={"path": path})

        assert response.status_code == 400
        assert response.json() == {"detail": server.PATH_REFUSED}
