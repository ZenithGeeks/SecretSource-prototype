"""locate(): where a sentence sits on a PDF page, as one box per line.

The PDFs are made here with PyMuPDF, so the tests need no network and no model: a
two-column-ish page with a sentence that wraps, a word hyphenated at the line end, a
citation in the middle, and a ligature, the way real papers differ from the sentence the
model copied out of them.
"""

from pathlib import Path

import pymupdf
import pytest
from app.pipeline.claims import locate

BODY = (
    "An alternative is late interaction, in-\n"
    "troduced in ColBERT (Khattab and Zaharia, 2020), where queries and documents\n"
    "are encoded at a finer granularity into multi-vector representations, and\n"
    "relevance is estimated using rich yet scalable interactions.\n"
    "\n"
    "We start with BEIR, reporting the quality of ColBERT (Khattab and Zaharia,\n"
    "2020), DPR-MARCO (Xin et al., 2021), ANCE (Xiong et al., 2020), and MoDIR\n"
    "(Xin et al., 2021) on the ﬁve datasets.\n"
)


@pytest.fixture(scope="module")
def paper(tmp_path_factory) -> str:
    path = Path(tmp_path_factory.mktemp("pdf")) / "paper.pdf"
    with pymupdf.open() as document:
        document.new_page()  # a blank first page: the sentence must be found on the second
        page = document.new_page()
        page.insert_text((72, 100), BODY, fontsize=11, fontname="helv")
        document.save(path)
    return path.as_posix()


def test_finds_the_whole_sentence_across_lines_hyphen_and_citation(paper):
    sentence = (
        "An alternative is late interaction, introduced in ColBERT, where queries and "
        "documents are encoded at a finer granularity into multi-vector representations, "
        "and relevance is estimated using rich yet scalable interactions."
    )
    found = locate(paper, sentence)
    assert found and found["page"] == 2
    assert found["coverage"] >= 0.95
    boxes = found["boxes"]
    assert len(boxes) == 4  # one box per line the sentence spans
    assert [box["y0"] for box in boxes] == sorted(box["y0"] for box in boxes)  # top to bottom
    assert abs(boxes[0]["x0"] - 72) < 2  # from the first word, at the left margin
    # The first line stops at "in-", well before the margin the longer lines reach.
    assert boxes[0]["x1"] < boxes[1]["x1"]
    assert {"x0", "y0", "x1", "y1"} <= set(boxes[0])


def test_a_sentence_listing_cited_systems(paper):
    sentence = (
        "We start with BEIR, reporting the quality of ColBERT, DPR-MARCO, ANCE, and MoDIR "
        "on the five datasets."
    )
    found = locate(paper, sentence, page=2)
    assert found and found["coverage"] >= 0.9
    assert len(found["boxes"]) == 3


def test_a_sentence_that_is_not_there_gets_no_box(paper):
    assert locate(paper, "Residual compression loses no retrieval quality on any benchmark we tried.") is None


def test_a_page_out_of_range_gets_no_box(paper):
    assert locate(paper, "An alternative is late interaction", page=9) is None
