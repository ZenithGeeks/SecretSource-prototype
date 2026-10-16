"""_download writes a cited paper aside and renames it into place, so a second worker that
finds the file name never reads a half-written PDF."""

import sys

from app.pipeline import sources


class _Response:
    headers = {"Content-Type": "application/pdf"}
    content = b"%PDF-1.7 the whole paper"

    def raise_for_status(self):
        pass


def test_download_is_renamed_into_place(monkeypatch, tmp_path):
    monkeypatch.setattr(sources, "PAPERS_DIR", tmp_path)
    fake = type("requests", (), {"get": staticmethod(lambda *args, **kwargs: _Response())})
    monkeypatch.setitem(sys.modules, "requests", fake)
    moves = []
    real_replace = sources.os.replace

    def replace(src, dst):
        moves.append((src, dst))
        if sources.Path(dst).suffix == ".pdf":
            assert sources.Path(src).read_bytes() == _Response.content  # complete before it moves
        real_replace(src, dst)

    monkeypatch.setattr(sources.os, "replace", replace)

    path = sources._download("https://example.org/paper.pdf", "paper")

    assert path == tmp_path / "paper.pdf"
    assert path.read_bytes() == _Response.content
    # The link the PDF came from goes in place first (#424), then the PDF.
    assert [sources.Path(dst).name for _, dst in moves] == ["paper.pdf.url", "paper.pdf"]
    assert all(sources.Path(src).parent == tmp_path for src, _ in moves)
    assert (tmp_path / "paper.pdf.url").read_text() == "https://example.org/paper.pdf"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["paper.pdf", "paper.pdf.url"]  # no temp file left
