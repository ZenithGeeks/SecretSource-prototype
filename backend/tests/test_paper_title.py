"""The analysed paper's title is the whole title, even where GROBID dropped its first line.

The PDFs are made with pymupdf in the shape of an arXiv paper: a two-line title in the largest
horizontal font, authors below it, and the sideways arXiv stamp in a bigger font still.
"""

import pymupdf
import pytest
from app.pipeline import claims, sources


def arxiv_like_pdf(path, title_lines):
    document = pymupdf.open()
    page = document.new_page(width=612, height=792)
    for number, line in enumerate(title_lines):
        page.insert_text((72, 90 + number * 20), line, fontsize=14.3)
    page.insert_text((72, 150), "Keshav Santhanam  Omar Khattab", fontsize=12)
    page.insert_text((72, 300), "Abstract. Neural retrieval ...", fontsize=10)
    page.insert_text((30, 500), "arXiv:2112.01488v3 [cs.IR] 10 Jul 2022", fontsize=20, rotate=90)
    document.save(path)
    return str(path)


@pytest.fixture(autouse=True)
def nothing_cached(monkeypatch):
    monkeypatch.setattr(sources, "known_title", lambda identifier: "")


def test_the_printed_title_restores_the_line_grobid_dropped(tmp_path):
    pdf = arxiv_like_pdf(
        tmp_path / "2112.01488.pdf",
        ["ColBERTv2:", "Effective and Efficient Retrieval via Lightweight Late Interaction"],
    )
    grobid = "Effective and Efficient Retrieval via Lightweight Late Interaction"
    assert (
        claims.paper_title(pdf, grobid, "2112.01488")
        == "ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction"
    )


def test_an_older_analysis_without_a_title_gets_the_printed_one(tmp_path):
    pdf = arxiv_like_pdf(tmp_path / "1512.03385.pdf", ["Deep Residual Learning for Image Recognition"])
    assert claims.paper_title(pdf) == "Deep Residual Learning for Image Recognition"


def test_a_printed_heading_that_is_not_grobids_title_is_not_taken(tmp_path):
    pdf = arxiv_like_pdf(tmp_path / "x.pdf", ["Workshop on Retrieval 2022"])
    assert claims.paper_title(pdf, "Deep Residual Learning for Image Recognition") == (
        "Deep Residual Learning for Image Recognition"
    )


def test_the_lookup_title_wins_when_the_paper_was_given_by_doi(tmp_path, monkeypatch):
    pdf = arxiv_like_pdf(tmp_path / "x.pdf", ["Something printed"])
    monkeypatch.setattr(sources, "known_title", lambda identifier: "The Title Semantic Scholar Gave")
    assert (
        claims.paper_title(pdf, "grobid title", "10.1145/3397271.3401075")
        == "The Title Semantic Scholar Gave"
    )


def test_an_unreadable_pdf_keeps_grobids_title(tmp_path):
    assert claims.paper_title(str(tmp_path / "missing.pdf"), "GROBID's title") == "GROBID's title"
