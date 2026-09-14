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
    started = []
    monkeypatch.setattr(main, "_start", lambda paper, verify, owner: started.append(paper) or {"id": "x"})
    client = TestClient(main.app)

    def upload(name: str, content: bytes) -> str:
        assert client.post("/analyses/upload", files={"file": (name, content)}).status_code == 200
        return started[-1]

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
