"""Where each citation marker sits on its page, and which reference it points to.

_boxes turns GROBID's "page,x,y,width,height;..." string into boxes. _page_sizes reads
the page dimensions from the <surface> elements. _citation_markers joins the two so the
web app can draw a clickable area on each marker, only for references we kept, and only
on pages that actually have a surface.
"""

import xml.etree.ElementTree as ET

import pytest
from app.pipeline import claims

TEI = """
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <facsimile>
    <surface n="1" ulx="0.0" uly="0.0" lrx="612.0" lry="792.0"/>
    <surface n="2" ulx="0.0" uly="0.0" lrx="612.0" lry="792.0"/>
  </facsimile>
  <text>
    <body>
      <div>
        <p>
          As shown in <ref type="bibr" target="#b4"
            coords="1,245.55,644.74,10.69,8.64">[4]</ref>
          and <ref type="bibr" target="#b7"
            coords="1,500.0,100.0,20.0,8.0;1,72.0,112.0,10.0,8.0">[7]</ref>
          we also cite <ref type="bibr" target="#b99"
            coords="1,300.0,300.0,10.0,8.0">[99]</ref>
          and the <ref type="figure" target="#fig_1"
            coords="1,400.0,400.0,10.0,8.0">figure</ref>,
          and once more <ref type="bibr" target="#b4"
            coords="3,10.0,10.0,10.0,8.0">[4]</ref> on a page with no surface.
        </p>
      </div>
    </body>
    <back>
      <listBibl>
        <biblStruct xml:id="b4"><analytic><title>Kept.</title></analytic></biblStruct>
        <biblStruct xml:id="b7"><analytic><title>Kept too.</title></analytic></biblStruct>
      </listBibl>
    </back>
  </text>
</TEI>
"""

REFERENCES = {
    "b4": {"id": "b4", "authors": ["Someone"], "title": "Kept."},
    "b7": {"id": "b7", "authors": ["Another"], "title": "Kept too."},
}


def test_a_single_box_string_becomes_one_box_with_edge_coordinates():
    boxes = claims._boxes("1,245.55,644.74,10.69,8.64")
    assert boxes == [
        {
            "page": 1,
            "x0": pytest.approx(245.55),
            "y0": pytest.approx(644.74),
            "x1": pytest.approx(256.24),
            "y1": pytest.approx(653.38),
        }
    ]


def test_a_marker_broken_across_lines_gives_one_box_per_semicolon_part():
    boxes = claims._boxes("1,500.0,100.0,20.0,8.0;1,72.0,112.0,10.0,8.0")
    assert len(boxes) == 2
    assert boxes[0] == {
        "page": 1,
        "x0": pytest.approx(500.0),
        "y0": pytest.approx(100.0),
        "x1": pytest.approx(520.0),
        "y1": pytest.approx(108.0),
    }
    assert boxes[1] == {
        "page": 1,
        "x0": pytest.approx(72.0),
        "y0": pytest.approx(112.0),
        "x1": pytest.approx(82.0),
        "y1": pytest.approx(120.0),
    }


def test_an_empty_or_malformed_coords_string_gives_no_boxes():
    assert claims._boxes("") == []
    assert claims._boxes("1,2,3") == []


def test_page_sizes_reads_width_and_height_from_each_surface():
    tei = ET.fromstring(TEI)
    assert claims._page_sizes(tei) == {1: (612.0, 792.0), 2: (612.0, 792.0)}


def test_citation_markers_gives_one_entry_per_box_for_kept_references_only():
    tei = ET.fromstring(TEI)
    markers = claims._citation_markers(tei, REFERENCES)

    # b4 on page 1 (1 box) + b7 on page 1 (2 boxes). b99 is not kept, the figure ref
    # is not a bibr, and the b4 on page 3 is skipped because page 3 has no surface.
    assert len(markers) == 3

    for marker in markers:
        assert set(marker) == {
            "ref", "text", "page", "x0", "y0", "x1", "y1",
            "page_width", "page_height",
        }
        assert marker["page_width"] == 612.0
        assert marker["page_height"] == 792.0

    by_ref = {}
    for marker in markers:
        by_ref.setdefault(marker["ref"], []).append(marker)

    assert set(by_ref) == {"b4", "b7"}
    assert len(by_ref["b4"]) == 1
    assert len(by_ref["b7"]) == 2

    b4 = by_ref["b4"][0]
    assert b4["text"] == "4"  # printed as "[4]": the brackets are not part of the marker
    assert b4["page"] == 1
    assert b4["x0"] == pytest.approx(245.55)
    assert b4["y0"] == pytest.approx(644.74)
    assert b4["x1"] == pytest.approx(256.24)
    assert b4["y1"] == pytest.approx(653.38)

    for marker in by_ref["b7"]:
        assert marker["text"] == "7"
        assert marker["page"] == 1


def test_citation_markers_is_empty_when_the_tei_has_no_body():
    tei = ET.fromstring(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0">'
        "<facsimile><surface n=\"1\" lrx=\"612.0\" lry=\"792.0\"/></facsimile>"
        "<text><back/></text>"
        "</TEI>"
    )
    assert claims._citation_markers(tei, REFERENCES) == []


def test_the_punctuation_of_a_marker_list_is_not_part_of_a_marker():
    """GROBID prints "[5, 8, 24]" as three refs with the text "[5," "8," and "24]"."""
    tei = ET.fromstring(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0">'
        '<facsimile><surface n="1" ulx="0" uly="0" lrx="612" lry="792"/></facsimile>'
        '<text><body><p>'
        '<ref type="bibr" coords="1,10,10,5,8" target="#b4">[5,</ref>'
        '<ref type="bibr" coords="1,20,10,5,8" target="#b7">8,</ref>'
        '<ref type="bibr" coords="1,30,10,5,8" target="#b24">24]</ref>'
        '</p></body></text></TEI>'
    )
    references = {"b4": {}, "b7": {}, "b24": {}}
    assert [marker["text"] for marker in claims._citation_markers(tei, references)] == ["5", "8", "24"]
