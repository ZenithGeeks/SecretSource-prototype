"""The parts of claims.py no other test file reaches: windowing, GROBID reference parsing, the
paper header, the cited-claim helpers and the three end-to-end entry points.

The LLM extractors, GROBID and the PDF text are replaced by fakes; the TEI is built inline and
the PDFs are drawn with pymupdf, so nothing here touches a network or a model.
"""

import xml.etree.ElementTree as ET
from types import SimpleNamespace

import pydantic
import pymupdf
import pytest
from app.pipeline import claims, sources

NS = 'xmlns="http://www.tei-c.org/ns/1.0"'


def tei(inner: str) -> ET.Element:
    return ET.fromstring(f"<TEI {NS}>{inner}</TEI>")


def reference(inner: str) -> ET.Element:
    return ET.fromstring(f"<biblStruct {NS}>{inner}</biblStruct>")


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """A fresh SQLite cache per test, so one test's cached LLM answer never leaks into another."""
    monkeypatch.setenv("ANALYSES_DB", str(tmp_path / "claims-test.db"))
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.setattr(sources, "known_title", lambda identifier: "")


# --- windows and claim text ----------------------------------------------------------


def test_a_short_text_is_one_window():
    assert claims._windows("first\n\nsecond", size=100) == ["first\n\nsecond"]


def test_paragraphs_that_do_not_fit_together_start_a_new_window():
    assert claims._windows("aaaaaa\n\nbbbbbb", size=10) == ["aaaaaa", "bbbbbb"]


def test_a_paragraph_longer_than_a_window_is_cut_to_size():
    assert claims._windows("abcdefghij", size=4) == ["abcd", "efgh", "ij"]


def test_text_that_ends_exactly_on_a_window_edge_leaves_no_empty_window():
    assert claims._windows("abcdefgh", size=4) == ["abcd", "efgh"]


def test_an_empty_text_is_one_empty_window():
    assert claims._windows("") == [""]


def test_claims_that_differ_only_in_case_and_punctuation_normalise_alike():
    assert claims._normalised_claim("  ColBERT's recall, up 5%! ") == "colbert s recall up 5"


# --- word matching on a page ---------------------------------------------------------


class _Page:
    def __init__(self, *raws):
        self.entries = [(i * 10, 0, i * 10 + 9, 10, raw, 0, 0, i) for i, raw in enumerate(raws)]

    def get_text(self, kind):
        return self.entries


def test_a_page_word_the_pdf_glued_from_two_of_ours_covers_both():
    words = claims._page_words(_Page("stateof"))
    assert claims._match_at(words, ["state", "of"], 0, 0) == ([0], 2)


def test_two_page_words_that_make_one_of_ours_are_taken_together():
    words = claims._page_words(_Page("state", "of"))
    assert claims._match_at(words, ["stateof"], 0, 0) == ([0, 1], 1)


def test_a_page_word_that_matches_nothing_gives_none():
    words = claims._page_words(_Page("other"))
    assert claims._match_at(words, ["state"], 0, 0) is None


def test_a_relaxed_match_that_wanders_across_the_page_is_not_one_sentence():
    page = ["alpha"] + ["zz"] * 8 + ["bravo", "xx", "delta"]
    words = claims._page_words(_Page(*page))

    _, coverage = claims._best_span(words, ["alpha", "bravo", "delta"])

    assert coverage < claims.MIN_COVERAGE


def test_locate_finds_nothing_for_a_sentence_without_words():
    assert claims.locate("unused.pdf", "[] ... --") is None


# --- extract_claims ------------------------------------------------------------------


@pytest.fixture
def plain_extraction(monkeypatch):
    """extract_claims on a two-window text, with one fake extractor that answers per window."""
    built = []

    def extractor(window):
        return [f"Claim from {window[0]}.", "A shared claim."]

    monkeypatch.setattr(claims, "_claim_extractor", None)
    monkeypatch.setattr(claims, "_build_claim_extractor", lambda: built.append(1) or extractor)
    monkeypatch.setattr(claims, "local_pdf", lambda path: path)
    monkeypatch.setattr(claims, "_pdf_to_text", lambda path: "a" * 8000 + "\n\n" + "b" * 8000)
    return built


def test_claims_from_every_window_are_kept_without_repeats(plain_extraction):
    result = claims.extract_claims("paper.pdf")

    assert result == {
        "status": "ok",
        "file": "paper.pdf",
        "claims": ["Claim from a.", "A shared claim.", "Claim from b."],
        "windows": 2,
    }


def test_the_claim_extractor_is_built_once(plain_extraction):
    claims.extract_claims("paper.pdf")
    claims.extract_claims("paper.pdf")

    assert plain_extraction == [1]


def test_extract_claims_returns_the_error_instead_of_raising(monkeypatch):
    def refuse(path):
        raise ValueError("no such paper")

    monkeypatch.setattr(claims, "local_pdf", refuse)

    result = claims.extract_claims("missing.pdf")

    assert result["status"] == "error"
    assert result["message"] == "no such paper"


# --- reference titles, names and arXiv ids -------------------------------------------


def test_a_full_name_joins_forename_and_surname_and_skips_empty_parts():
    person = ET.fromstring(
        f"<persName {NS}><forename>Omar</forename><forename/><surname>Khattab</surname></persName>"
    )
    assert claims._full_name(person) == "Omar Khattab"


def test_the_title_is_the_articles_own_with_the_preprint_note_cut():
    ref = reference('<analytic><title level="a">Dense Passage Retrieval</title></analytic>')
    assert claims._raw_title(ref) == "Dense Passage Retrieval"
    assert claims._title_of(ref) == "Dense Passage Retrieval"


def test_an_author_list_in_the_title_slot_is_not_a_title():
    ref = reference(
        '<analytic><title level="a">Omar Khattab, Matei Zaharia</title></analytic>'
        '<monogr><title level="m">Proceedings of SIGIR</title></monogr>'
    )
    assert claims._raw_title(ref) == "Proceedings of SIGIR"


def test_a_reference_with_no_title_has_an_empty_one():
    ref = reference("<monogr><imprint/></monogr>")
    assert claims._raw_title(ref) == ""
    assert claims._title_of(ref) == ""


@pytest.mark.parametrize(
    ("arxiv_id", "issued"),
    [
        ("2303.12712", True),
        ("1412.1234", True),
        ("1412.12345", False),
        ("1501.12345", True),
        ("1501.1234", False),
        ("0703.1234", False),
        ("2313.12345", False),
        ("2303", False),
        ("2303.123456", False),
        ("2303.12a45", False),
    ],
)
def test_only_ids_arxiv_has_issued_are_taken_for_ids(arxiv_id, issued):
    assert claims._looks_like_an_arxiv_id(arxiv_id) is issued


# --- the paper's header --------------------------------------------------------------


def test_a_tei_without_a_header_gives_an_empty_one():
    assert claims._paper_header(tei("<text/>")) == {"title": "", "authors": [], "year": ""}


def test_the_header_gives_title_authors_and_year():
    header = claims._paper_header(
        tei(
            "<teiHeader><fileDesc>"
            "<titleStmt><title>ColBERTv2:\n   Effective</title></titleStmt>"
            '<publicationStmt><date when="2022-07-10"/></publicationStmt>'
            "<sourceDesc><biblStruct><analytic>"
            "<author><persName><forename>Keshav</forename><surname>Santhanam</surname></persName></author>"
            "<author><persName/></author>"
            "</analytic></biblStruct></sourceDesc>"
            "</fileDesc></teiHeader>"
        )
    )
    assert header == {"title": "ColBERTv2: Effective", "authors": ["Keshav Santhanam"], "year": "2022"}


def test_the_year_falls_back_to_the_source_description():
    header = claims._paper_header(
        tei(
            "<teiHeader><fileDesc><sourceDesc><biblStruct>"
            '<monogr><imprint><date when="2020-05-01"/></imprint></monogr>'
            "</biblStruct></sourceDesc></fileDesc></teiHeader>"
        )
    )
    assert header == {"title": "", "authors": [], "year": "2020"}


def test_a_header_with_nothing_in_it_is_empty():
    header = claims._paper_header(tei("<teiHeader><fileDesc/></teiHeader>"))
    assert header == {"title": "", "authors": [], "year": ""}


def test_a_pdf_with_no_text_has_no_printed_title(tmp_path):
    pdf = tmp_path / "blank.pdf"
    with pymupdf.open() as document:
        document.new_page()
        document.save(pdf)

    assert claims._printed_title(str(pdf)) == ""


# --- the bibliography ----------------------------------------------------------------

BIBLIOGRAPHY = tei(
    "<text><body/><back><listBibl>"
    '<biblStruct xml:id="b0"><analytic><title level="a">ColBERT</title></analytic>'
    '<monogr><imprint><date when="2020"/></imprint></monogr></biblStruct>'
    '<biblStruct xml:id="b1"><monogr><imprint/></monogr></biblStruct>'
    '<biblStruct><analytic><title level="a">No identifier</title></analytic></biblStruct>'
    "</listBibl></back></text>"
)


def test_references_with_nothing_to_look_up_are_counted_as_dropped():
    findable, dropped = claims._findable_references(BIBLIOGRAPHY)

    assert [citation["title"] for citation in findable] == ["ColBERT", "No identifier"]
    assert dropped == 1


def test_references_by_id_skip_those_without_an_id_and_count_the_unfindable():
    references, dropped = claims._references_by_id(BIBLIOGRAPHY)

    assert list(references) == ["b0"]
    assert references["b0"]["ref"] == "b0"
    assert dropped == 1


def test_extract_citations_lists_the_findable_references(monkeypatch):
    monkeypatch.setattr(claims, "local_pdf", lambda path: path)
    monkeypatch.setattr(claims, "_grobid_pdf", lambda endpoint, path: BIBLIOGRAPHY)

    result = claims.extract_citations("paper.pdf")

    assert (result["status"], result["file"], result["count"], result["dropped"]) == ("ok", "paper.pdf", 2, 1)
    assert [citation["title"] for citation in result["citations"]] == ["ColBERT", "No identifier"]


def test_extract_citations_returns_the_error_instead_of_raising(monkeypatch):
    def refuse(path):
        raise ValueError("no such paper")

    monkeypatch.setattr(claims, "local_pdf", refuse)

    assert claims.extract_citations("missing.pdf")["message"] == "no such paper"


# --- printed labels, page sizes and markers ------------------------------------------


def test_a_tei_without_a_body_has_no_printed_labels():
    assert claims._printed_labels(tei("<text/>")) == {}


def test_a_surface_with_a_bad_size_is_skipped():
    document = tei(
        "<facsimile>"
        '<surface n="1" lrx="612" lry="792"/>'
        '<surface lrx="612" lry="792"/>'
        '<surface n="3" lrx="wide" lry="792"/>'
        "</facsimile>"
    )
    assert claims._page_sizes(document) == {1: (612.0, 792.0)}


# --- the outline ---------------------------------------------------------------------


def test_a_tei_without_a_body_has_no_outline():
    assert claims._outline(tei("<text/>")) == []


def test_an_unreadable_pdf_leaves_grobids_outline_as_it_is():
    document = tei('<text><body><div><head n="1" coords="1,50,100,60,10">Intro</head></div></body></text>')

    outline = claims._outline(document, "missing.pdf")

    assert [(heading["n"], heading["title"]) for heading in outline] == [("1", "Intro")]


@pytest.fixture
def headings_pdf(tmp_path):
    """Page 1 has two plain lines in the heading font; page 2 starts with "2 RELATED WORK"."""
    document = pymupdf.open()
    for _ in range(2):
        document.new_page()
    first, second = document[0], document[1]
    first.insert_text((54, 100), "Plain opening line", fontname="hebo", fontsize=10.9)
    first.insert_text((54, 130), "Another plain line", fontname="hebo", fontsize=10.9)
    second.insert_text((54, 190), "2 RELATED WORK", fontname="hebo", fontsize=10.9)
    box = second.search_for("2 RELATED WORK")[0]
    path = tmp_path / "paper.pdf"
    document.save(path)
    first_heading = {
        "n": "2",
        "title": "RELATED WORK",
        "page": 2,
        "y": box.y0,
        "boxes": [{"page": 2, "x0": box.x0, "y0": box.y0, "x1": box.x1, "y1": box.y1}],
    }
    return str(path), first_heading


def test_no_first_section_is_made_up_when_no_line_reads_as_one(headings_pdf):
    path, first_heading = headings_pdf
    assert claims._first_section_from_pdf(first_heading, path) == []


def test_no_first_section_is_looked_for_in_an_unreadable_pdf(headings_pdf):
    _, first_heading = headings_pdf
    assert claims._first_section_from_pdf(first_heading, "missing.pdf") == []


def test_no_first_section_is_looked_for_on_a_page_the_pdf_does_not_have(headings_pdf):
    path, first_heading = headings_pdf
    assert claims._first_section_from_pdf({**first_heading, "page": 9}, path) == []


def test_no_first_section_when_no_line_shares_the_headings_place_on_the_page(headings_pdf):
    path, first_heading = headings_pdf
    far_below = {**first_heading, "boxes": [{**first_heading["boxes"][0], "y0": 700, "x1": 400}]}
    assert claims._first_section_from_pdf(far_below, path) == []


def test_a_heading_on_a_page_the_pdf_does_not_have_keeps_its_title(headings_pdf):
    path, first_heading = headings_pdf
    heading = {**first_heading, "page": 9}

    claims._read_titles_back([heading], path)

    assert heading["title"] == "RELATED WORK"


# --- citing text ---------------------------------------------------------------------


def test_a_citation_without_a_target_leaves_only_the_name_before_its_bracket():
    document = tei(
        "<text><body>"
        '<p>HallusionBench <ref type="bibr">(Guan et al., 2023)</ref> and <hi>our</hi> '
        '<ref type="bibr" target="#b3">[3]</ref> work.</p>'
        "</body></text>"
    )
    assert claims._body_text(document) == "HallusionBench  and our [b3] work."


def test_a_tei_without_a_body_has_no_text():
    assert claims._body_text(tei("<text/>")) == ""


def test_only_sentences_with_a_marker_are_cited_sentences():
    text = "Plain sentence. It works [b1]. Another plain one! Also this [b2] [b3]?"
    assert claims._cited_sentences(text) == ["It works [b1].", "Also this [b2] [b3]?"]


def test_citing_windows_are_built_from_citing_paragraphs_only():
    text = "No citation here.\n\nThis cites [b1].\n\nNor this one."
    assert claims._citing_windows(text) == ["This cites [b1]."]


def test_a_paper_that_cites_nothing_has_no_citing_windows():
    assert claims._citing_windows("One paragraph.\n\nAnother paragraph.") == []


def test_markers_the_model_kept_in_the_claim_are_used_once_each():
    assert claims._markers_for("It works [b2] [b1] [b2]", "", []) == ["b2", "b1"]


@pytest.mark.parametrize(("sentence", "cited"), [("", ["It works [b1]."]), ("It works.", [])])
def test_markers_cannot_be_recovered_without_the_sentence_or_the_papers_copy(sentence, cited):
    assert claims._markers_for("It works", sentence, cited) == []


def test_markers_are_recovered_from_the_papers_closest_sentence():
    cited = ["Dense retrieval beats BM25 on BEIR [b4] [b5].", "Unrelated text [b9]."]
    found = claims._markers_for("Dense retrieval beats BM25", "Dense retrieval beats BM25 on BEIR.", cited)
    assert found == ["b4", "b5"]


def test_markers_are_not_taken_from_a_sentence_that_looks_nothing_like_it():
    cited = ["Completely different words about something else [b9]."]
    assert claims._markers_for("ab", "Dense retrieval beats BM25 on BEIR.", cited) == []


# --- the cited-claim extractor and the role classifier -------------------------------


class _Prediction:
    def __init__(self, **fields):
        self.__dict__.update(fields)


class _Role(pydantic.BaseModel):
    claim: int
    about_this_paper: bool
    named: list[int]


def _stub_chain_of_thought(monkeypatch, calls, answer):
    import dspy

    def chain_of_thought(signature):
        def call(**kwargs):
            calls.append(kwargs)
            return answer(**kwargs)

        return call

    monkeypatch.setattr(dspy, "ChainOfThought", chain_of_thought)


def _cited(*titles):
    return [
        {"claim": f"We use {title}", "sentence": f"We use {title}.", "citations": [{"title": title}]}
        for title in titles
    ]


def test_citation_roles_name_only_the_citations_of_claims_about_this_paper(monkeypatch):
    calls = []
    roles = [
        _Role(claim=1, about_this_paper=True, named=[1]),
        _Role(claim=2, about_this_paper=False, named=[1]),
        _Role(claim=9, about_this_paper=True, named=[1]),
    ]
    _stub_chain_of_thought(monkeypatch, calls, lambda paper, claims: _Prediction(roles=roles))

    classify = claims._build_citation_roles()

    assert classify("A Title", _cited("BEIR", "MS MARCO")) == [{0}, set()]


def test_citation_roles_are_asked_once_for_the_same_claims(monkeypatch):
    calls = []
    answer = lambda paper, claims: _Prediction(roles=[_Role(claim=1, about_this_paper=True, named=[1])])  # noqa: E731
    _stub_chain_of_thought(monkeypatch, calls, answer)

    classify = claims._build_citation_roles()
    classify("A Title", _cited("BEIR"))
    classify("A Title", _cited("BEIR"))

    assert len(calls) == 1


def test_named_citations_are_marked_in_batches_of_ten(monkeypatch):
    batches = []

    def classify(title, batch):
        batches.append(len(batch))
        return [{0} for _ in batch]

    monkeypatch.setattr(claims, "_citation_roles", None)
    monkeypatch.setattr(claims, "_build_citation_roles", lambda: classify)
    found = _cited(*[f"Dataset{n}" for n in range(12)])

    claims._mark_named_citations("A Title", found)

    assert batches == [10, 2]
    assert found[11]["named"] == ["Dataset11"]


def test_no_role_call_is_made_when_no_claim_cites_anything(monkeypatch):
    def classify(title, batch):
        raise AssertionError("no claim cites anything")

    monkeypatch.setattr(claims, "_citation_roles", classify)
    found = [{"claim": "We train it", "sentence": "", "citations": []}]

    claims._mark_named_citations("A Title", found)

    assert found[0]["named"] == []


# --- claims as cited, repeated and ranked --------------------------------------------


def _claim(text, citations=(), source=None):
    return {"claim": text, "citations": list(citations), "sentence": text, "source": source}


def test_a_cited_claim_loses_its_markers_and_keeps_the_references_it_points_at(monkeypatch):
    monkeypatch.setattr(claims, "locate", lambda path, sentence: {"page": 2, "sentence": sentence})
    references = {"b1": {"title": "ColBERT"}}
    extracted = SimpleNamespace(claim="It beats BM25 [b1] [b7]", sentence="It beats BM25 [b1].")

    result = claims._cited_claim(extracted, references, [], "paper.pdf")

    assert result == {
        "claim": "It beats BM25",
        "citations": [{"title": "ColBERT"}],
        "sentence": "It beats BM25 [b1].",
        "source": {"page": 2, "sentence": "It beats BM25."},
    }


def test_a_cited_claim_without_a_sentence_has_no_place_in_the_pdf():
    extracted = SimpleNamespace(claim="It beats BM25 [b1]", sentence="")

    assert claims._cited_claim(extracted, {}, [], "paper.pdf")["source"] is None


def test_a_claim_is_followed_to_its_citations_first_and_its_page_second():
    assert claims._provenance(_claim("x", [{}, {}], source={"page": 1})) == (2, 1)
    assert claims._provenance(_claim("x")) == (0, 0)


@pytest.mark.parametrize(
    ("claim", "asserts_nothing"),
    [
        ("This paper explores late interaction", True),
        ("Our work also presents a new index", True),
        ("We show that late interaction wins", False),
    ],
)
def test_a_claim_that_only_announces_the_paper_asserts_nothing(claim, asserts_nothing):
    assert claims._asserts_nothing(claim) is asserts_nothing


def test_claims_with_different_numbers_are_not_the_same_assertion():
    assert not claims._same_assertion("improves recall by 5", "improves recall by 15")


def test_a_reworded_claim_with_the_same_numbers_is_the_same_assertion():
    one = "colbert improves recall by 5 on beir"
    assert claims._same_assertion(one, "colbert improves the recall by 5 on beir")


def test_claims_that_say_different_things_are_not_the_same_assertion():
    assert not claims._same_assertion("colbert is fast", "the weather is mild today")


def test_a_repeated_claim_keeps_the_copy_with_more_provenance():
    bare = _claim("ColBERT improves recall by 5%")
    cited = _claim("Colbert improves recall by 5%.", [{"title": "ColBERT"}])
    other_number = _claim("ColBERT improves recall by 15%")
    repeat = _claim("ColBERT improves recall by 5%")

    assert claims._deduplicated([bare, cited, other_number, repeat]) == [cited, other_number]


@pytest.mark.parametrize("limit", [0, 3, 9])
def test_claims_within_the_limit_or_with_no_limit_are_all_kept(limit):
    found = [_claim(f"claim {n}") for n in range(3)]
    assert claims._most_checkable(found, limit) == found


def test_the_most_traceable_claims_are_kept_in_the_papers_order():
    found = [_claim("zero"), _claim("one", [{}, {}]), _claim("two", [{}]), _claim("three")]

    kept = claims._most_checkable(found, 2)

    assert [claim["claim"] for claim in kept] == ["one", "two"]


# --- extract_claims_with_citations ---------------------------------------------------

PAPER = tei(
    "<teiHeader><fileDesc>"
    "<titleStmt><title>Paper Title</title></titleStmt>"
    '<publicationStmt><date when="2022-01-01"/></publicationStmt>'
    "<sourceDesc><biblStruct><analytic>"
    "<author><persName><forename>Ada</forename><surname>Lovelace</surname></persName></author>"
    "</analytic></biblStruct></sourceDesc>"
    "</fileDesc></teiHeader>"
    '<facsimile><surface n="1" lrx="612" lry="792"/></facsimile>'
    "<text><body>"
    '<div><head n="1" coords="1,50,100,60,10">Introduction</head>'
    '<p>We beat the baseline <ref type="bibr" target="#b0" coords="1,100,200,20,10">[1]</ref>. '
    "This paper explores more.</p></div>"
    "</body><back><listBibl>"
    '<biblStruct xml:id="b0"><analytic><title level="a">ColBERT</title></analytic></biblStruct>'
    '<biblStruct xml:id="b1"><monogr><imprint/></monogr></biblStruct>'
    "</listBibl></back></text>"
)


@pytest.fixture
def full_extraction(monkeypatch):
    def extractor(window):
        return [
            SimpleNamespace(claim="We beat the baseline [b0]", sentence="We beat the baseline [b0]."),
            SimpleNamespace(claim="This paper explores more", sentence="This paper explores more."),
            SimpleNamespace(claim="We beat the baseline [b0]", sentence=""),
        ]

    monkeypatch.setattr(claims, "local_pdf", lambda path: path)
    monkeypatch.setattr(claims, "_grobid_pdf", lambda endpoint, path, coordinates=(): PAPER)
    monkeypatch.setattr(claims, "_cited_claim_extractor", extractor)
    monkeypatch.setattr(claims, "_citation_roles", lambda title, found: [{0} for _ in found])
    monkeypatch.setattr(claims, "CLAIM_LIMIT", 0)
    found_at = {"page": 1, "page_width": 612, "boxes": [{"x0": 60, "y0": 200}]}
    monkeypatch.setattr(claims, "locate", lambda path, sentence: found_at)


def test_claims_come_back_with_their_references_section_and_outline(full_extraction):
    result = claims.extract_claims_with_citations("missing.pdf")

    assert result["status"] == "ok"
    assert (result["title"], result["authors"], result["year"]) == ("Paper Title", ["Ada Lovelace"], "2022")
    assert (result["extracted"], result["dropped"], result["windows"]) == (3, 1, 1)
    assert [(c["claim"], c["section"]) for c in result["claims"]] == [("We beat the baseline", "1")]
    assert result["claims"][0]["named"] == [claims.lookup_key({"title": "ColBERT"})]
    assert result["outline"] == [{"n": "1", "title": "Introduction", "page": 1, "y": 100.0}]
    assert list(result["references"]) == ["b0"]
    assert [(m["ref"], m["text"]) for m in result["markers"]] == [("b0", "1")]


def test_a_claim_not_found_in_the_pdf_has_no_section(full_extraction, monkeypatch):
    monkeypatch.setattr(claims, "locate", lambda path, sentence: None)

    result = claims.extract_claims_with_citations("missing.pdf")

    assert "section" not in result["claims"][0]


def test_a_paper_that_cites_nothing_has_no_claims(monkeypatch):
    def extractor(window):
        raise AssertionError("there is no citing text to extract from")

    monkeypatch.setattr(claims, "local_pdf", lambda path: path)
    nothing_cited = tei("<text><body><p>Nothing.</p></body></text>")
    monkeypatch.setattr(claims, "_grobid_pdf", lambda endpoint, path, coordinates=(): nothing_cited)
    monkeypatch.setattr(claims, "_cited_claim_extractor", extractor)

    result = claims.extract_claims_with_citations("missing.pdf")

    assert (result["claims"], result["windows"], result["extracted"]) == ([], 0, 0)


def test_the_cited_claim_extractor_is_built_on_first_use(monkeypatch):
    monkeypatch.setattr(claims, "local_pdf", lambda path: path)
    monkeypatch.setattr(claims, "_grobid_pdf", lambda endpoint, path, coordinates=(): tei("<text/>"))
    monkeypatch.setattr(claims, "_cited_claim_extractor", None)
    monkeypatch.setattr(claims, "_build_cited_claim_extractor", lambda: lambda window: [])

    assert claims.extract_claims_with_citations("missing.pdf")["status"] == "ok"
    assert claims._cited_claim_extractor is not None


def test_a_grobid_failure_comes_back_as_an_error(monkeypatch):
    def refuse(endpoint, path, coordinates=()):
        raise ConnectionError("GROBID is down")

    monkeypatch.setattr(claims, "local_pdf", lambda path: path)
    monkeypatch.setattr(claims, "_grobid_pdf", refuse)

    result = claims.extract_claims_with_citations("paper.pdf")

    assert (result["status"], result["message"]) == ("error", "GROBID is down")


def test_a_reference_with_an_arxiv_id_and_no_title_gets_the_title_from_arxiv(monkeypatch):
    # GROBID leaves the title empty when a long author list runs into it (#840).
    asked = []
    monkeypatch.setattr(
        claims, "arxiv_titles", lambda ids: asked.append(ids) or {"2112.11446": "Scaling Language Models"}
    )
    references = {
        "b0": {"title": "", "arxiv": "2112.11446"},
        "b1": {"title": "ColBERT", "arxiv": "2004.12832"},
        "b2": {"title": "", "arxiv": "2203.15556"},
    }

    claims._fill_arxiv_titles(references)

    assert asked == [["2112.11446", "2203.15556"]]
    titles = [reference["title"] for reference in references.values()]
    assert titles == ["Scaling Language Models", "ColBERT", ""]


def test_references_of_keys_the_references_by_their_grobid_id(monkeypatch):
    asked = []
    monkeypatch.setattr(claims, "local_pdf", lambda path: path)

    def grobid(endpoint, path, coordinates=()):
        asked.append((endpoint, coordinates))
        return BIBLIOGRAPHY

    monkeypatch.setattr(claims, "_grobid_pdf", grobid)

    references = claims.references_of("paper.pdf")

    assert list(references) == ["b0"]
    # The full-text call extract_claims_with_citations makes, so the ids match its sentences.
    assert asked == [("processFulltextDocument", ("ref", "head"))]
