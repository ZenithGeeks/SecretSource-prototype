"""Author-year citations GROBID could not link still point at their reference.

GROBID tags "(Ren et al., 2021b)" as a citation but leaves out the target when it cannot match
it. Without a target the claim looks like it cites nothing. The references below copy the
shapes seen in ColBERTv2's TEI, including entries with no date whose text carries "2021a".
"""

import xml.etree.ElementTree as ET

from app.pipeline import claims


def entry(ref_id: str, surnames: list[str], year: str = "", text: str = "") -> str:
    authors = "".join(f"<author><persName><surname>{name}</surname></persName></author>" for name in surnames)
    date = f'<date when="{year}"/>' if year else ""
    return (
        f'<biblStruct xml:id="{ref_id}"><analytic>{authors}<title level="a">{text}</title></analytic>'
        f"<monogr><imprint>{date}</imprint></monogr></biblStruct>"
    )


BIBLIOGRAPHY = "".join(
    [
        entry("b11", ["Formal", "Lassance"], text="2021a. SPLADE v2"),
        entry("b12", ["Formal", "Piwowarski", "Clinchant"], text="2021b. SPLADE"),
        entry("b13", ["Gao", "Callan"], "2021", "Unsupervised corpus aware language model pre-training"),
        entry("b15", ["Gao", "Dai", "Callan"], "2021", "COIL"),
        entry("b41", ["MacAvaney", "Nardini", "Perego"], "2020", "Efficient document re-ranking"),
        entry("b51", ["Ren", "Lv", "Qu"], "2021", "PAIR"),
        entry("b52", ["Ren", "Qu", "Liu"], "2021", "RocketQAv2"),
    ]
)


def tei(*citations: str) -> ET.Element:
    body = "".join(f'<ref type="bibr">{text}</ref> ' for text in citations)
    return ET.fromstring(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:xml="http://www.w3.org/XML/1998/namespace">'
        f"<text><body><p>{body}</p></body><back><listBibl>{BIBLIOGRAPHY}</listBibl></back></text></TEI>"
    )


def targets(document: ET.Element) -> list[str | None]:
    return [ref.get("target") for ref in document.iter("{http://www.tei-c.org/ns/1.0}ref")]


def test_the_letter_after_the_year_picks_the_right_work():
    document = tei("(Ren et al., 2021b;", "Formal et al., 2021a)", "(Formal et al., 2021b)")
    assert claims._link_author_year_citations(document) == 3
    assert targets(document) == ["#b52", "#b11", "#b12"]


def test_one_citation_with_two_letters_links_both_works():
    # "Nie et al., 2019a,b" in the Vitamin C paper cites two papers; linking only 2019a lost
    # the fact-verification one (#838).
    document = tei("(Formal et al., 2021a,b;", "Formal et al., 2021a, b)")
    assert claims._link_author_year_citations(document) == 2
    assert targets(document) == ["#b11 #b12", "#b11 #b12"]


def test_a_letter_with_no_work_leaves_the_whole_citation_unlinked():
    document = tei("(Formal et al., 2021a,c)")
    assert claims._link_author_year_citations(document) == 0
    assert targets(document) == [None]


def test_every_work_of_a_two_letter_citation_becomes_a_marker():
    document = tei("(Formal et al., 2021a,b)")
    claims._link_author_year_citations(document)
    assert claims._body_text(document).split() == ["[b11][b12]"]


def test_each_work_of_a_two_letter_citation_gets_its_printed_label():
    document = tei("(Formal et al., 2021a,b)")
    claims._link_author_year_citations(document)
    labels = claims._printed_labels(document)
    assert set(labels) == {"b11", "b12"}


def test_two_authors_or_et_al_tell_works_of_the_same_year_apart():
    document = tei("(Gao and Callan, 2021)", "(Gao et al., 2021)")
    claims._link_author_year_citations(document)
    assert targets(document) == ["#b13", "#b15"]


def test_a_name_before_the_citation_is_not_taken_for_the_author():
    document = tei("PreTTR (MacAvaney et al., 2020)")
    claims._link_author_year_citations(document)
    assert targets(document) == ["#b41"]


def test_an_unclear_citation_stays_unlinked():
    document = tei("(Ren et al., 2021)", "(Smith et al., 2019)")
    assert claims._link_author_year_citations(document) == 0
    assert targets(document) == [None, None]


def test_a_citation_that_already_has_a_target_is_left_alone():
    document = ET.fromstring(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:xml="http://www.w3.org/XML/1998/namespace">'
        f'<text><body><p><ref type="bibr" target="#b51">(Ren et al., 2021b)</ref></p></body>'
        f"<back><listBibl>{BIBLIOGRAPHY}</listBibl></back></text></TEI>"
    )
    assert claims._link_author_year_citations(document) == 0
    assert targets(document) == ["#b51"]


def test_a_linked_citation_becomes_a_marker_the_claim_can_use():
    document = tei("(Ren et al., 2021b;", "Formal et al., 2021a)")
    claims._link_author_year_citations(document)
    assert claims._body_text(document).split() == ["[b52]", "[b11]"]


def test_a_citation_that_stays_unlinked_leaves_no_text_in_the_paragraph():
    document = tei("(Ren et al., 2021)", "OpenAI., 2023;", "HallusionBench (Guan et al., 2023)", "Figure 3")
    claims._link_author_year_citations(document)

    text = claims._paragraph_text(document.find(".//tei:p", claims.TEI_NAMESPACE))

    assert "OpenAI" not in text and "Guan" not in text and "2023" not in text
    assert "HallusionBench" in text  # a name written before the bracket is not the citation
    assert "Figure 3" in text  # GROBID sometimes tags text with no year as bibr; it stays


def test_a_tei_without_a_body_links_nothing():
    document = ET.fromstring('<TEI xmlns="http://www.tei-c.org/ns/1.0"><text/></TEI>')
    assert claims._link_author_year_citations(document) == 0


def test_references_with_no_id_or_no_authors_are_never_linked():
    nameless = entry("b1", [], "2021", "No authors")
    anonymous = (
        "<biblStruct><analytic><author><persName><surname>Ren</surname></persName></author>"
        '<title level="a">No id</title></analytic>'
        '<monogr><imprint><date when="2021"/></imprint></monogr></biblStruct>'
    )
    document = ET.fromstring(
        '<TEI xmlns="http://www.tei-c.org/ns/1.0">'
        '<text><body><p><ref type="bibr">(Ren, 2021)</ref></p></body>'
        f"<back><listBibl>{nameless}{anonymous}</listBibl></back></text></TEI>"
    )
    assert claims._link_author_year_citations(document) == 0


def test_a_citation_that_fits_several_works_equally_is_left_unlinked():
    document = tei("(Ren, 2021)")
    assert claims._link_author_year_citations(document) == 0
    assert targets(document) == [None]


def test_a_letter_beyond_the_works_of_that_year_is_left_unlinked():
    document = tei("(Ren et al., 2021e)")
    assert claims._link_author_year_citations(document) == 0
    assert targets(document) == [None]
