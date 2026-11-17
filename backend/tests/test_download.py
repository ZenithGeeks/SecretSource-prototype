"""_download writes a cited paper aside and renames it into place, so a second worker that
finds the file name never reads a half-written PDF."""

import sys

import pytest
from app.pipeline import sources
from app.uploads import MAX_UPLOAD_BYTES


class _Response:
    def __init__(self, content=b"%PDF-1.7 the whole paper", headers=None):
        self.headers = (
            headers if headers is not None else {"Content-Type": "application/pdf"}
        )
        self.content = content

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size=1):
        data = self.content
        size = chunk_size or len(data)
        for i in range(0, len(data), size):
            yield data[i : i + size]

    def close(self):
        pass


def test_download_is_renamed_into_place(monkeypatch, tmp_path):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    fake = type(
        "requests", (), {"get": staticmethod(lambda *args, **kwargs: _Response())}
    )
    monkeypatch.setitem(sys.modules, "requests", fake)
    moves = []
    real_replace = sources.os.replace

    def replace(src, dst):
        moves.append((src, dst))
        if sources.Path(dst).suffix == ".pdf":
            assert (
                sources.Path(src).read_bytes() == _Response().content
            )  # complete before it moves
        real_replace(src, dst)

    monkeypatch.setattr(sources.os, "replace", replace)

    path = sources._download("https://example.org/paper.pdf", "paper")

    assert path == tmp_path / "paper.pdf"
    assert path.read_bytes() == _Response().content
    # The link the PDF came from goes in place first (#424), then the PDF.
    assert [sources.Path(dst).name for _, dst in moves] == [
        "paper.pdf.url",
        "paper.pdf",
    ]
    assert all(sources.Path(src).parent == tmp_path for src, _ in moves)
    assert (tmp_path / "paper.pdf.url").read_text() == "https://example.org/paper.pdf"
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "paper.pdf",
        "paper.pdf.url",
    ]  # no temp file left


def test_a_declared_length_over_the_cap_is_refused_and_writes_nothing(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    headers = {
        "Content-Type": "application/pdf",
        "Content-Length": str(MAX_UPLOAD_BYTES + 1),
    }
    fake = type(
        "requests",
        (),
        {"get": staticmethod(lambda *args, **kwargs: _Response(headers=headers))},
    )
    monkeypatch.setitem(sys.modules, "requests", fake)

    with pytest.raises(sources.NotDownloadable, match="larger than 100 MB"):
        sources._download("https://example.org/huge.pdf", "huge")

    assert list(tmp_path.iterdir()) == []


def test_a_body_that_grows_past_the_cap_is_aborted_and_leaves_no_file(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    import app.uploads as uploads

    monkeypatch.setattr(uploads, "MAX_UPLOAD_BYTES", 20)
    body = b"%PDF-1.7 " + b"x" * 20
    fake = type(
        "requests",
        (),
        {"get": staticmethod(lambda *args, **kwargs: _Response(content=body))},
    )
    monkeypatch.setitem(sys.modules, "requests", fake)

    with pytest.raises(sources.NotDownloadable, match="larger than 100 MB"):
        sources._download("https://example.org/long.pdf", "long")

    assert [p.name for p in tmp_path.iterdir()] == []
