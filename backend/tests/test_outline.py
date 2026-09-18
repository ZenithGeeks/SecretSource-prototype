"""The paper's numbered sections, and which section each claim comes from (#152).

The TEI copies the shapes GROBID gave for ColBERT (SIGIR 2020, 10.1145/3397271.3401075) with
teiCoordinates=head: numbered heads inside body divs, figure captions as heads without a
number, and a title that lost the letters of a ligature ("ery & Document Encoders").
"""

import xml.etree.ElementTree as ET

import pymupdf
from app.pipeline import claims

PAGE = (612.0, 792.0)


def tei(body: str) -> ET.Element:
    surfaces = "".join(f'<surface n="{n}" lrx="{PAGE[0]}" lry="{PAGE[1]}"/>' for n in range(1, 10))
    return ET.fromstring(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0">'
        f"<facsimile>{surfaces}</facsimile><text><body>{body}</body></text></TEI>"
    )


COLBERT = tei(
    '<div><head n="2" coords="3,53.80,181.33,103.79,10.91">RELATED WORK</head><p>...</p></div>'
    '<div><head n="3" coords="3,317.96,597.77,67.18,10.91">COLBERT</head><p>...</p></div>'
    '<div><head n="3.1" coords="4,53.80,158.93,87.32,10.91">Architecture</head><p>...</p></div>'
    '<div><head n="3.2" coords="4,53.80,553.93,13.88,10.91;4,93.08,553.93,120.00,10.91">'
    "ery &amp; Document Encoders</head><p>...</p></div>"
    '<div><head coords="4,60,700,50,10">stray fragment</head><p>...</p></div>'
    '<div><head n="4.1.3">Hardware &amp; Time Measurements.</head><p>...</p></div>'
    "<figure><head>Figure 1 :</head></figure>"
)


def test_the_outline_keeps_numbered_headings_in_order():
    outline = claims._outline(COLBERT)
    assert [(h["n"], h["title"], h["page"], h["y"]) for h in outline] == [
        ("2", "RELATED WORK", 3, 181.33),
        ("3", "COLBERT", 3, 597.77),
        ("3.1", "Architecture", 4, 158.93),
        ("3.2", "ery & Document Encoders", 4, 553.93),
    ]


def test_figure_captions_unnumbered_heads_and_heads_without_a_position_are_left_out():
    titles = [heading["title"] for heading in claims._outline(COLBERT)]
    assert "Figure 1 :" not in titles
    assert "stray fragment" not in titles
    assert "Hardware & Time Measurements." not in titles


def source(page: int, x0: float, y0: float) -> dict:
    return {
        "page": page,
        "boxes": [{"x0": x0, "y0": y0, "x1": x0 + 200, "y1": y0 + 10}],
        "page_width": PAGE[0],
        "page_height": PAGE[1],
    }


def test_a_claim_gets_the_last_heading_before_it_in_reading_order():
    outline, sizes = claims._outline(COLBERT), claims._page_sizes(COLBERT)
    # Page 3, left column, below the height of "3 COLBERT", which sits in the right column:
    # the reader is still in section 2.
    assert claims._section_of(source(3, 60, 700), outline, sizes) == "2"
    assert claims._section_of(source(3, 320, 650), outline, sizes) == "3"
    assert claims._section_of(source(4, 60, 300), outline, sizes) == "3.1"
    assert claims._section_of(source(5, 60, 100), outline, sizes) == "3.2"


def test_a_sentence_that_runs_into_the_next_column_starts_where_it_starts():
    outline, sizes = claims._outline(COLBERT), claims._page_sizes(COLBERT)
    running = source(4, 60, 750)  # bottom of the left column ...
    running["boxes"].append({"x0": 320, "y0": 70, "x1": 500, "y1": 80})  # ... then the top of the right
    assert claims._section_of(running, outline, sizes) == "3.2"


def test_no_section_before_the_first_heading_or_without_a_place_in_the_pdf():
    outline, sizes = claims._outline(COLBERT), claims._page_sizes(COLBERT)
    assert claims._section_of(source(1, 60, 400), outline, sizes) == ""
    assert claims._section_of(None, outline, sizes) == ""


def test_a_title_that_lost_ligature_letters_is_read_back_from_the_pdf(tmp_path):
    document = pymupdf.open()
    page = document.new_page(width=PAGE[0], height=PAGE[1])
    page.insert_text((54, 564), "3.2", fontsize=10)
    page.insert_text((93, 564), "Query & Document Encoders", fontsize=10)
    page.insert_text((54, 600), "Our encoders map each token to a vector.", fontsize=9)
    heading = page.search_for("Query & Document Encoders")[0]
    number = page.search_for("3.2")[0]
    pdf = tmp_path / "colbert.pdf"
    document.save(pdf)
    coords = ";".join(f"1,{r.x0},{r.y0},{r.width},{r.height}" for r in (number, heading))
    grobid = tei(f'<div><head n="3.2" coords="{coords}">ery &amp; Document Encoders</head></div>')

    assert claims._outline(grobid, str(pdf))[0]["title"] == "Query & Document Encoders"


def test_a_box_that_reads_as_something_else_keeps_grobids_title(tmp_path):
    document = pymupdf.open()
    page = document.new_page(width=PAGE[0], height=PAGE[1])
    page.insert_text((54, 564), "Completely different words", fontsize=10)
    box = page.search_for("Completely different words")[0]
    pdf = tmp_path / "other.pdf"
    document.save(pdf)
    grobid = tei(
        f'<div><head n="4" coords="1,{box.x0},{box.y0},{box.width},{box.height}">Methodology</head></div>'
    )

    assert claims._outline(grobid, str(pdf))[0]["title"] == "Methodology"


def test_a_first_heading_grobid_missed_is_found_on_the_page(tmp_path):
    # ColBERT's "1 INTRODUCTION" is two lines on one baseline, in the heading font. GROBID's
    # outline starts at "2 RELATED WORK", so the claims before it had no section.
    document = pymupdf.open()
    for _ in range(3):
        document.new_page(width=PAGE[0], height=PAGE[1])
    first, third = document[0], document[2]
    first.insert_text((54, 90), "ColBERT: Efficient Passage Search", fontname="hebo", fontsize=14)
    first.insert_text((54, 567), "1", fontname="hebo", fontsize=10.9)
    first.insert_text((70, 567), "INTRODUCTION", fontname="hebo", fontsize=10.9)
    first.insert_text((54, 590), "1 billion passages were indexed in our tests.", fontname="helv", fontsize=9)
    third.insert_text((54, 190), "2", fontname="hebo", fontsize=10.9)
    third.insert_text((70, 190), "RELATED WORK", fontname="hebo", fontsize=10.9)
    box = third.search_for("2")[0]
    pdf = tmp_path / "colbert.pdf"
    document.save(pdf)
    grobid = tei(
        f'<div><head n="2" coords="3,{box.x0},{box.y0},90,{box.height}">RELATED WORK</head><p>...</p></div>'
    )

    outline = claims._outline(grobid, str(pdf))
    assert [(h["n"], h["title"], h["page"]) for h in outline] == [
        ("1", "INTRODUCTION", 1),
        ("2", "RELATED WORK", 3),
    ]
    sizes = claims._page_sizes(grobid)
    assert claims._section_of(source(2, 60, 300), outline, sizes) == "1"
