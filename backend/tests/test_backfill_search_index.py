"""app/backfill_search_index.py indexes the PDF of each done analysis once, and only with --apply."""

from app import backfill_search_index


def test_it_indexes_each_done_analysis_pdf_once(tmp_path, monkeypatch):
    pdf = tmp_path / "simcse.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    analyses = {
        "a": {"status": "done", "file": str(pdf)},
        "b": {"status": "done", "file": str(pdf)},  # the same paper analysed twice
        "c": {"status": "error", "file": str(pdf)},
        "d": {"status": "done", "file": str(tmp_path / "gone.pdf")},
    }
    indexed = []

    def add_paper(file):
        indexed.append(file)
        return {"status": "ok"}

    monkeypatch.setattr(backfill_search_index.store, "load_all", lambda: analyses)
    monkeypatch.setattr(backfill_search_index, "add_paper", add_paper)

    assert backfill_search_index.backfill(apply=False) == 1
    assert indexed == []

    backfill_search_index.backfill(apply=True)
    assert indexed == [str(pdf)]
