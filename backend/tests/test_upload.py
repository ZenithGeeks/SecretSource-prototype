"""An uploaded PDF is stored under a name made from its bytes, so two users' paper.pdf stay two
files (#168). The analysis is not run: _start is replaced by a stub that records the path.
"""

import pytest
from app import main
from fastapi.testclient import TestClient


@pytest.fixture
def uploads(monkeypatch, tmp_path):
    monkeypatch.delenv("SUPABASE_URL", raising=False)  # login off: no token needed
    monkeypatch.setattr(main, "PAPERS_DIR", tmp_path)
    enqueued = []
    monkeypatch.setattr(
        main, "enqueue_analysis",
        lambda analysis_id, paper, verify, owner, stages, started=None, claim_limit=None: enqueued.append(
            paper
        ),
    )
    main.analyses.clear()
    main.streams.clear()
    client = TestClient(main.app)

    def upload(name: str, content: bytes) -> str:
        assert client.post("/analyses/upload", files={"file": (name, content)}).status_code == 200
        return enqueued[-1]

    return upload


def test_different_pdfs_with_one_name_are_two_files(uploads):
    first = uploads("paper.pdf", b"%PDF-1.4 ada")
    second = uploads("paper.pdf", b"%PDF-1.4 bo")
    assert first != second
    assert main.Path(first).read_bytes() == b"%PDF-1.4 ada"
    assert main.Path(second).read_bytes() == b"%PDF-1.4 bo"


def test_the_same_pdf_uploaded_twice_is_one_file(uploads, tmp_path):
    first = uploads("paper.pdf", b"%PDF-1.4 same")
    assert uploads("paper.pdf", b"%PDF-1.4 same") == first
    # No second copy, and no partial file left behind.
    assert [path.name for path in tmp_path.iterdir()] == [main.Path(first).name]


def test_the_name_keeps_the_original_stem_and_drops_any_directory(uploads):
    name = main.Path(uploads("../../etc/paper.pdf", b"%PDF-1.4")).name
    assert name.startswith("paper-") and name.endswith(".pdf")
    assert main.Path(uploads(".hidden.pdf", b"%PDF-1.4 h")).name.startswith("hidden-")


def test_any_upload_is_saved_as_pdf(uploads):
    assert main.Path(uploads("paper.PDF", b"%PDF-1.4 x")).suffix == ".pdf"


def test_a_file_that_is_not_a_pdf_is_refused_and_not_saved(client_and_dir):
    client, papers_dir = client_and_dir
    response = client.post("/analyses/upload", files={"file": ("x.html", b"<html></html>")})
    assert response.status_code == 422
    assert list(papers_dir.iterdir()) == []


def test_an_oversized_file_is_refused_and_not_saved(client_and_dir, monkeypatch):
    client, papers_dir = client_and_dir
    monkeypatch.setattr(main.uploads, "MAX_UPLOAD_BYTES", 10)
    response = client.post("/analyses/upload", files={"file": ("big.pdf", b"%PDF-1.4 " + b"x" * 10)})
    assert response.status_code == 413
    assert list(papers_dir.iterdir()) == []


@pytest.fixture
def client_and_dir(uploads, tmp_path):
    return TestClient(main.app), tmp_path
