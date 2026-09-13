"""Each reference carries the number the paper prints for it, read from the body's markers.

GROBID ids start at b0, so "b12" is not "[13]". The bibliography has no label, so the number
comes from how the body cites the reference.
"""

import xml.etree.ElementTree as ET

from app.pipeline import claims

TEI = """
<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <text>
    <body><div>
      <p>Late interaction <ref type="bibr" target="#b4">[5,</ref><ref type="bibr" target="#b7">8]</ref>
         and again <ref type="bibr" target="#b4">[5]</ref> and <ref type="bibr" target="#b4">5,</ref>
         with a figure <ref type="figure" target="#fig_1">1</ref>
         and an author-year one <ref type="bibr" target="#b9">(Khattab et al., 2020)</ref>.</p>
    </div></body>
    <back><listBibl>
      <biblStruct xml:id="b4"><analytic><title level="a">ColBERT</title></analytic></biblStruct>
      <biblStruct xml:id="b7"><analytic><title level="a">PLAID</title></analytic></biblStruct>
      <biblStruct xml:id="b8"><analytic><title level="a">Not cited</title></analytic></biblStruct>
      <biblStruct xml:id="b9"><analytic><title level="a">ColBERT again</title></analytic></biblStruct>
    </listBibl></back>
  </text>
</TEI>
"""


def test_the_most_common_printed_form_is_the_label():
    labels = claims._printed_labels(ET.fromstring(TEI))
    assert labels["b4"] == "5"  # printed as "[5,", "[5]" and "5,"
    assert labels["b7"] == "8"
    assert "fig_1" not in labels  # a figure reference is not a citation


def test_an_author_year_marker_keeps_its_text():
    assert claims._printed_labels(ET.fromstring(TEI))["b9"] == "Khattab et al., 2020"


def test_each_reference_gets_its_id_and_label():
    references, dropped = claims._references_by_id(ET.fromstring(TEI))
    assert dropped == 0
    assert references["b4"]["ref"] == "b4"
    assert references["b4"]["label"] == "5"
    assert references["b8"]["label"] == ""  # in the list, but never cited in the body
