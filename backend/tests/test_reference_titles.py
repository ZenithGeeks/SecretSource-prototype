"""A reference title that GROBID read with its author list in front loses the authors,
whatever alphabet the names are written in."""

import xml.etree.ElementTree as ET

import pytest
from app.pipeline import claims, sources, verify


def bibl(article: str = "", journal: str = "", tagged: str = "") -> ET.Element:
    analytic = f'<analytic><title level="a">{article}</title></analytic>' if article else "<analytic/>"
    journal_xml = f'<title level="j">{journal}</title>' if journal else ""
    idno = f'<idno type="arXiv">{tagged}</idno>' if tagged else ""
    return ET.fromstring(
        '<biblStruct xmlns="http://www.tei-c.org/ns/1.0">'
        f"{analytic}<monogr>{journal_xml}{idno}</monogr></biblStruct>"
    )


def test_an_accented_author_list_is_cut_off_the_title():
    assert (
        claims._without_the_authors(
            "Benjamin Piwowarski, and Stéphane Clinchant. 2021a. "
            "SPLADE v2: Sparse Lexical and Expansion Model for Information Retrieval"
        )
        == "SPLADE v2: Sparse Lexical and Expansion Model for Information Retrieval"
    )


def test_an_ascii_author_list_is_still_cut_off():
    assert (
        claims._without_the_authors(
            "Benjamin Piwowarski, and Stephane Clinchant. 2021a. "
            "SPLADE v2: Sparse Lexical and Expansion Model for Information Retrieval"
        )
        == "SPLADE v2: Sparse Lexical and Expansion Model for Information Retrieval"
    )


def test_an_author_list_cut_short_with_others_is_cut_off():
    assert (
        claims._without_the_authors(
            "Alexander Prokofiev, Alexander Wei, Allison Tam, and 244 others. 2024. OpenAI o1 System Card"
        )
        == "OpenAI o1 System Card"
    )


def test_an_author_list_cut_short_with_et_al_is_cut_off():
    assert claims._without_the_authors("Aaron Jaech, et al. 2024. OpenAI o1 System Card") == (
        "OpenAI o1 System Card"
    )


def test_a_title_ending_in_others_is_left_alone():
    assert claims._without_the_authors("Learning from 3 others") == "Learning from 3 others"


def test_other_alphabets_count_as_names():
    assert claims._looks_like_authors("Łukasz Kaiser, and Jürgen Schmidhuber") is True


def test_a_real_title_is_left_alone():
    assert claims._without_the_authors("Attention is all you need") == "Attention is all you need"


def test_a_lowercase_word_is_not_a_name():
    assert claims._looks_like_authors("deep learning, and neural networks") is False


def test_a_preprint_note_after_the_title_is_cut_off():
    title = "Thought Anchors: Which LLM Reasoning Steps Matter?"
    assert claims._cleaned_title(f"{title} ArXiv preprint, abs/2506") == title
    sparks = "Sparks of AGI. arXiv preprint arXiv:2303.12712"
    # The venue note goes. The arXiv id stays, on the title and on the reference, so the
    # lookup resolves 2303.12712 directly instead of searching for "Sparks of AGI".
    assert claims._cleaned_title(sparks) == "Sparks of AGI arXiv:2303.12712"
    parsed = claims._parse_reference(bibl(sparks))
    assert parsed["title"] == "Sparks of AGI arXiv:2303.12712"
    assert parsed["arxiv"] == "2303.12712"
    assert sources.lookup_key(parsed) == "2303.12712"
    assert sources._lookup(sources.lookup_key(parsed)).url == "https://arxiv.org/pdf/2303.12712"


def test_a_title_about_preprints_keeps_its_words():
    assert claims._cleaned_title("An arXiv preprint server study") == "An arXiv preprint server study"


def test_a_word_broken_across_lines_is_joined():
    assert claims._cleaned_title("Reason-ingFlow: Semantic Structure of Complex Reasoning Traces") == (
        "ReasoningFlow: Semantic Structure of Complex Reasoning Traces"
    )


def test_real_hyphens_are_kept():
    for title in ("Chain-of-Thought Is Not Explainability", "Zero-shot Mixture-of-Experts", "DIM-SUM"):
        assert claims._cleaned_title(title) == title


def test_hyphenated_compounds_stay_intact():
    for title in ("Self-Attention", "BERT-base", "Q-learning", "state-of-the-art", "t-SNE"):
        assert claims._cleaned_title(title) == title


def test_a_note_that_would_erase_the_title_keeps_the_original():
    # A truncated id is not an arXiv id, so the note would wipe the title. Keep the original
    # rather than drop the reference as unfindable.
    raw = "ArXiv preprint, abs/2506"
    assert claims._cleaned_title(raw) == raw
    parsed = claims._parse_reference(bibl(journal=raw))
    assert parsed["title"] == raw
    assert parsed["arxiv"] == ""


def test_an_id_only_preprint_title_keeps_the_id():
    # The journal line GROBID falls back to when it parsed no article title.
    raw = "arXiv preprint arXiv:2303.12712"
    assert claims._cleaned_title(raw) == "arXiv:2303.12712"
    parsed = claims._parse_reference(bibl(journal=raw))
    assert parsed["title"] == "arXiv:2303.12712"
    assert parsed["arxiv"] == "2303.12712"
    assert sources.lookup_key(parsed) == "2303.12712"


def test_a_title_ending_in_arxiv_preprint_is_left_alone():
    title = "Notes toward an arXiv preprint"
    assert claims._cleaned_title(title) == title
    parsed = claims._parse_reference(bibl(title))
    assert parsed["title"] == title
    assert parsed["arxiv"] == ""


def test_a_reference_title_collapses_line_breaks():
    parsed = claims._parse_reference(bibl("Sparks of\nAGI. arXiv preprint\narXiv:2303.12712"))
    assert parsed["title"] == "Sparks of AGI arXiv:2303.12712"
    assert parsed["arxiv"] == "2303.12712"


def test_a_tagged_arxiv_id_wins_over_one_written_in_the_title():
    parsed = claims._parse_reference(
        bibl("Sparks of AGI. arXiv preprint arXiv:2303.12712", tagged="1111.22222")
    )
    assert parsed["arxiv"] == "1111.22222"


def test_a_tagged_arxiv_id_loses_the_category_grobid_read_with_it():
    # From the HPG-MxP paper's reference list: "arXiv: 2412.19322 [cs.CE]".
    assert claims._parse_reference(bibl("A survey", tagged="2412.19322[cs.CE"))["arxiv"] == "2412.19322"


def test_an_arxiv_id_on_the_journal_line_is_kept_beside_an_article_title():
    # GROBID 0.8.2: the article title is the work, and the monogr line is the preprint note.
    parsed = claims._parse_reference(bibl("Sparks of AGI", journal="arXiv preprint arXiv:2303.12712"))
    assert parsed["title"] == "Sparks of AGI"
    assert parsed["arxiv"] == "2303.12712"
    assert sources.lookup_key(parsed) == "2303.12712"


def test_a_year_range_after_the_word_arxiv_is_not_an_id():
    parsed = claims._parse_reference(bibl("ArXiv usage statistics 2019.2020"))
    assert parsed["arxiv"] == ""
    assert parsed["title"] == "ArXiv usage statistics 2019.2020"


def test_abs_version_and_trailing_punctuation_still_mark_an_id():
    assert claims._parse_reference(bibl("abs/2303.12712"))["arxiv"] == "2303.12712"
    assert claims._parse_reference(bibl("arXiv:2303.12712v2"))["arxiv"] == "2303.12712"
    assert claims._parse_reference(bibl("arXiv:2303.12712."))["arxiv"] == "2303.12712"


def test_a_space_or_a_doi_still_marks_an_arxiv_id():
    assert claims._parse_reference(bibl("arXiv 2303.12712"))["arxiv"] == "2303.12712"
    assert claims._parse_reference(bibl("arXiv.2303.12712"))["arxiv"] == "2303.12712"
    assert claims._parse_reference(bibl("10.48550/arXiv.2303.12712"))["arxiv"] == "2303.12712"


def test_a_slash_a_six_digit_tail_or_words_before_a_year_range_are_not_an_id():
    for title in ("labs/2019.2020", "arXiv:2101.000012", "ArXiv usage statistics 2019.2020"):
        assert claims._parse_reference(bibl(title))["arxiv"] == ""


def test_a_year_range_after_an_arxiv_marker_is_not_an_id():
    for title in (
        "arXiv 2019.2020",
        "arXiv:2019.2020",
        "arxiv preprint 2019.2020",
        "arXiv2019.2020",
        "arXiv.2019.2020",
        "Trends on arXiv 2010.2020",
        "arXiv 2023.12345",
    ):
        assert claims._parse_reference(bibl(title))["arxiv"] == ""


def test_issued_arxiv_ids_still_count():
    for arxiv_id in ("2303.12712", "0704.0001", "1412.1234"):
        assert claims._parse_reference(bibl(f"arXiv:{arxiv_id}"))["arxiv"] == arxiv_id


def reference(inner: str) -> ET.Element:
    return ET.fromstring(f'<biblStruct xmlns="http://www.tei-c.org/ns/1.0">{inner}</biblStruct>')


def test_a_title_left_in_a_note_wins_over_the_venue():
    # GPT-3 in Power of Scale (#908): the end of the author list is the article title, the venue
    # is the monograph title, and the real title is in the note.
    gpt3 = reference(
        '<analytic><title level="a">Alec Radford, Ilya Sutskever, and Dario Amodei</title></analytic>'
        '<monogr><title level="m">Advances in Neural Information Processing Systems</title></monogr>'
        "<note>Language models are few-shot learners</note>"
    )

    assert claims._parse_reference(gpt3)["title"] == "Language models are few-shot learners"


def test_a_note_is_not_read_when_the_article_title_is_real():
    paper = reference(
        '<analytic><title level="a">Dense passage retrieval</title></analytic>'
        "<monogr/><note>In Proceedings of EMNLP</note>"
    )

    assert claims._parse_reference(paper)["title"] == "Dense passage retrieval"


def test_a_typed_note_is_not_taken_for_a_title():
    report = reference(
        '<analytic><title level="a">Alec Radford, Ilya Sutskever, and Dario Amodei</title></analytic>'
        '<monogr><title level="m">OpenAI blog</title></monogr>'
        '<note type="report_type">Technical report</note>'
    )

    assert claims._parse_reference(report)["title"] == "OpenAI blog"


# --- A reference with no article title (#937) ---------------------------------------------------

# Analysis c646a7a53a35 (EPJ Web of Conferences): the reference list gives authors, journal and
# year, and no article title, so the journal line was the only title GROBID wrote.
JOURNAL_ONLY = [
    ("b2", "Journal of Instrumentation", [], "2008"),
    ("b4", "AIP Conference Proceedings", ["H B Newman", "I C Legrand"], "2001"),
    ("b5", "Journal of Parallel and Distributed Computing", ["H Casanova", "A Giersch", "A Legrand"], "2014"),
    ("b7", "Future Generation Computer Systems", ["H Casanova", "R Ferreira Da Silva", "F Suter"], "2020"),
    (
        "b9",
        "ACM Transactions on Modeling and Computer Simulation (TOMACS)",
        ["P Velho", "L M Schnorr", "H Casanova", "A Legrand"],
        "2013",
    ),
]


def journal_only(journal: str, authors: list[str], year: str) -> ET.Element:
    people = "".join(
        f"<author><persName><forename>{name.rsplit(' ', 1)[0]}</forename>"
        f"<surname>{name.rsplit(' ', 1)[1]}</surname></persName></author>"
        for name in authors
    )
    return ET.fromstring(
        f'<biblStruct xmlns="http://www.tei-c.org/ns/1.0"><analytic>{people}</analytic>'
        f'<monogr><title level="j">{journal}</title><imprint><date when="{year}"/></imprint></monogr>'
        "</biblStruct>"
    )


@pytest.mark.parametrize(("ref", "journal", "authors", "year"), JOURNAL_ONLY)
def test_a_journal_line_is_the_venue_and_not_the_title(ref, journal, authors, year):
    parsed = claims._parse_reference(journal_only(journal, authors, year))

    assert parsed["title"] == ""
    assert parsed["venue"] == journal
    assert parsed["authors"] == authors
    assert parsed["year"] == year


@pytest.mark.parametrize(("ref", "journal", "authors", "year"), JOURNAL_ONLY)
def test_a_reference_with_only_a_venue_is_kept_and_not_looked_up(ref, journal, authors, year, monkeypatch):
    asked = []
    monkeypatch.setattr(sources, "_lookup", lambda identifier: asked.append(identifier))
    parsed = claims._parse_reference(journal_only(journal, authors, year))
    claim = {"claim": "A claim.", "sentence": f"A claim [{ref}].", "citations": [{**parsed, "ref": ref}]}

    assert claims._findable(parsed)
    assert sources.lookup_key(parsed) == ""
    for _citation, source in verify.checked_citations(claim):
        verify.prepare_source(source)
    assert asked == []


def test_an_article_keeps_its_title_and_gets_its_journal_as_the_venue():
    parsed = claims._parse_reference(
        bibl("Kokkos 3", journal="IEEE Transactions on Parallel and Distributed Systems")
    )

    assert parsed["title"] == "Kokkos 3"
    assert parsed["venue"] == "IEEE Transactions on Parallel and Distributed Systems"


def test_a_book_or_proceedings_cited_whole_keeps_its_title():
    book = ET.fromstring(
        '<biblStruct xmlns="http://www.tei-c.org/ns/1.0"><monogr>'
        '<title level="m">Structured Parallel Programming: Patterns for Efficient Computation</title>'
        "</monogr></biblStruct>"
    )

    parsed = claims._parse_reference(book)

    assert parsed["title"] == "Structured Parallel Programming: Patterns for Efficient Computation"
    assert parsed["venue"] == ""


def test_a_preprint_note_on_the_journal_line_is_not_a_venue():
    # "arXiv preprint arXiv:2303.12712" on the journal line says where the preprint is, not
    # which journal printed the work, so it is read as before.
    parsed = claims._parse_reference(bibl(journal="arXiv preprint arXiv:2303.12712"))

    assert parsed["title"] == "arXiv:2303.12712"
    assert parsed["venue"] == ""


def test_a_journal_line_beside_a_link_is_still_the_title():
    # arXiv 2409.12191 [b28]: software, with its maker and name on the journal line and a link.
    # The line is not a journal there; keep its title for scholarly lookup before using the link.
    software = ET.fromstring(
        '<biblStruct xmlns="http://www.tei-c.org/ns/1.0">'
        '<analytic><title/><ptr target="http://ffmpeg.org/"/></analytic>'
        '<monogr><title level="j">FFmpeg-Developers. ffmpeg tool</title>'
        '<imprint><date type="published" when="2024">2024</date></imprint></monogr>'
        "</biblStruct>"
    )

    parsed = claims._parse_reference(software)

    assert parsed["title"] == "FFmpeg-Developers. ffmpeg tool"
    assert parsed["venue"] == ""
    assert parsed["authors"] == []
    assert parsed["year"] == "2024"
    assert sources.lookup_key(parsed) == "FFmpeg-Developers. ffmpeg tool"


def test_a_journal_line_beside_a_doi_is_still_the_title():
    with_doi = ET.fromstring(
        '<biblStruct xmlns="http://www.tei-c.org/ns/1.0"><analytic/>'
        '<monogr><title level="j">Journal of Instrumentation</title>'
        '<idno type="DOI">10.1088/1748-0221/3/08/S08004</idno></monogr></biblStruct>'
    )

    parsed = claims._parse_reference(with_doi)

    assert parsed["title"] == "Journal of Instrumentation"
    assert parsed["venue"] == ""
    assert sources.lookup_key(parsed) == "10.1088/1748-0221/3/08/S08004"


def test_the_citation_roles_listing_names_a_work_by_its_venue_when_it_has_no_title():
    claim = {
        "claim": "Flow-level models are accurate.",
        "sentence": "Flow-level models are accurate [b9].",
        "citations": [
            {"title": "", "venue": "ACM Transactions on Modeling and Computer Simulation", "year": "2013"}
        ],
    }

    assert claims._claims_with_citations([claim]).endswith(
        "[1] ACM Transactions on Modeling and Computer Simulation (2013)"
    )
