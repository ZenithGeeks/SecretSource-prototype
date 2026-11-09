"""The Author role's parsing and summaries (app/author/logic.py), on a small thesis chapter.

The chapter below is the one the Figma frames show: a duplicate bib key, an entry with no
DOI or URL, an entry no draft cites, a \\cite whose key is missing, and a \\cite that is
still being typed.
"""

import pytest
from app.author import logic

RELATED_WORK = r"""% Chapter 2 — related work
\section{Related work}
\label{sec:related}

Late interaction retrievers encode queries and documents into
token-level vectors and score them with MaxSim~\cite{khattab2020}.
ColBERTv2 further reduces index size by $6$--$10\times$ while
matching retrieval quality~\cite{khattab2020}.
On out-of-domain data these models outperform single-vector
retrievers on BEIR~\cite{thakur2021}.

\subsection{Distillation}
Denoised supervision from a \textbf{cross-encoder} teacher improves
learned representations~\citep[p.~3]{santhanam2022}.
MS MARCO contains 8.8M passages~\cite{nguyen2016}. % a comment \cite{not-a-cite}
Recent engines such as PLAID~\cite{santh
"""

MAIN_BIB = r"""@inproceedings{khattab2020,
  title = {ColBERT: Efficient and {Effective} Passage Search},
  author = {Khattab, Omar and Zaharia, Matei},
  booktitle = {SIGIR},
  year = {2020},
  doi = {10.1145/3397271.3401075},
}

@article{nguyen2016, title="MS MARCO", author="Nguyen, Tri and others", year=2016}

@inproceedings{santhanam2022,
  title = {ColBERTv2},
  author = {Santhanam, Keshav and Khattab, Omar and Potts, Christopher},
  year = {2022},
  eprint = {2112.01488},
}
@inproceedings{santhanam2022, title={dup}, year={2022}}
@comment{ignored entirely}
@misc{karpukhin2020, title={DPR}, year={2020}, url={https://x.y}}
"""

FILES = [
    {"name": "related-work.tex", "kind": "tex", "content": RELATED_WORK},
    {"name": "main.bib", "kind": "bib", "content": MAIN_BIB},
]


def test_every_cite_is_found_with_its_line_section_and_plain_claim():
    cites = logic.find_cites(FILES)
    assert [(c["key"], c["line"]) for c in cites] == [
        ("khattab2020", 6),
        ("khattab2020", 8),
        ("thakur2021", 10),
        ("santhanam2022", 14),
        ("nguyen2016", 15),
    ]
    assert cites[0]["section"] == "Related work"
    assert cites[3]["section"] == "Distillation"
    assert (
        cites[1]["claim"] == "ColBERTv2 further reduces index size by 6–10× while matching retrieval quality."
    )
    assert cites[3]["claim"] == (
        "Denoised supervision from a cross-encoder teacher improves learned representations."
    )
    # the half-typed \cite{santh and the one inside a comment are not citations
    assert all(c["key"] not in ("santh", "not-a-cite") for c in cites)


def test_bib_parser_handles_braces_quotes_bare_values_and_comments():
    entries = logic.parse_bib(MAIN_BIB)
    assert [e["key"] for e in entries] == [
        "khattab2020",
        "nguyen2016",
        "santhanam2022",
        "santhanam2022",
        "karpukhin2020",
    ]
    assert entries[0]["fields"]["title"] == "ColBERT: Efficient and {Effective} Passage Search"
    assert entries[1]["fields"] == {"title": "MS MARCO", "author": "Nguyen, Tri and others", "year": "2016"}
    assert entries[0]["line"] == 1 and entries[2]["line"] == 11


def test_parse_project_reports_the_four_warnings():
    parsed = logic.parse_project(FILES)
    assert (parsed["texFiles"], parsed["citeCommands"], parsed["bibEntries"]) == (1, 5, 5)
    by_type = {w["type"]: w for w in parsed["warnings"]}
    assert by_type["missing-key"]["detail"] == "\\cite{thakur2021} in related-work.tex L10"
    assert by_type["duplicate-key"]["detail"] == "santhanam2022 defined twice"
    assert by_type["unused-entry"]["detail"] == "karpukhin2020 is never cited"
    assert by_type["no-doi-url"]["detail"] == "nguyen2016"
    assert by_type["duplicate-key"]["file"] == "main.bib"


def test_lookup_identifier_prefers_an_uploaded_pdf_then_doi_arxiv_url_title():
    entries = {}
    for entry in logic.parse_bib(MAIN_BIB):
        entries.setdefault(entry["key"], entry)  # the first definition wins, as in the check
    assert logic.lookup_identifier(entries["khattab2020"]) == "10.1145/3397271.3401075"
    assert logic.lookup_identifier(entries["santhanam2022"]) == "2112.01488"
    assert logic.lookup_identifier(entries["karpukhin2020"]) == "https://x.y"
    assert logic.lookup_identifier(entries["nguyen2016"]) == "MS MARCO"
    assert (
        logic.lookup_identifier(entries["nguyen2016"], {"nguyen2016": "msmarco-abc.pdf"}) == "msmarco-abc.pdf"
    )
    assert logic.lookup_identifier(None) is None


def test_source_ref_reads_the_entry_as_the_evidence_panel_shows_it():
    entry = logic.parse_bib(MAIN_BIB)[0]
    ref = logic.source_ref(entry, {"khattab2020": "colbert.pdf"})
    assert ref == {
        "key": "khattab2020",
        "title": "ColBERT: Efficient and Effective Passage Search",
        "authors": "Khattab & Zaharia",
        "year": 2020,
        "venue": "SIGIR",
        "doi": "10.1145/3397271.3401075",
        "url": "",
        "pdf": "colbert.pdf",
    }
    assert (
        logic.short_authors("Santhanam, Keshav and Khattab, Omar and Potts, Christopher")
        == "Santhanam et al."
    )


def test_replace_cite_key_swaps_one_key_and_keeps_the_others():
    swapped = logic.replace_cite_key(RELATED_WORK, 8, "khattab2020", "santhanam2022")
    assert swapped.split("\n")[7] == r"matching retrieval quality~\cite{santhanam2022}."
    assert swapped.split("\n")[5].endswith(r"\cite{khattab2020}.")  # line 6 untouched
    assert logic.replace_cite_key("a~\\cite{x, y}.", 1, "y", "z") == "a~\\cite{x, z}."
    assert logic.replace_cite_key(RELATED_WORK, 99, "a", "b") == RELATED_WORK


def test_summary_delta_and_compare():
    previous = [
        {"key": "a", "verdict": "refutes"},
        {"key": "b", "verdict": "refutes"},
        {"key": "b", "verdict": "supports"},
    ]
    current = [
        {"key": "a", "verdict": "supports"},
        {"key": "b", "verdict": "refutes", "resolution": {"kind": "overridden", "note": "fine"}},
        {"key": "b", "verdict": "supports"},
        {"key": "c", "verdict": "insufficient"},
        {"key": "d", "verdict": "unavailable"},
    ]
    summary = logic.summarize(current)
    assert summary == {
        "checked": 5,
        "counts": {"supports": 2, "refutes": 1, "insufficient": 1, "unavailable": 1, "unchecked": 0},
        "open": 1,  # b's contradiction is overridden, so only c is open
    }
    assert logic.status_label(summary) == "1 issue"
    assert (
        logic.counts_line(summary)
        == "5 citations · 2 supported · 1 partial · 1 not supported · 1 unavailable"
    )
    assert logic.delta(current, previous) == {"addedCitations": 2, "fixedIssues": 1, "newIssues": 1}
    assert logic.delta(current, None) is None
    changes = {(r["key"], r["before"], r["after"]): r["change"] for r in logic.compare(current, previous)}
    assert changes[("a", "refutes", "supports")] == "fixed"
    assert changes[("b", "refutes", "refutes")] == "same"
    assert changes[("c", None, "insufficient")] == "added"


def test_saved_source_helpers_make_unique_escaped_bibtex():
    assert (
        logic.bib_key_for(["Keshav Santhanam", "Omar Khattab"], 2022, {"santhanam2022"}) == "santhanam2022b"
    )
    entry = logic.bibtex_for(
        {
            "title": "A & B: 50% of #1",
            "authorsList": ["Keshav Santhanam"],
            "year": 2022,
            "venue": "NAACL",
            "doi": "10.1/x",
        }
    )
    assert entry.startswith("@inproceedings{santhanam2022,")
    assert "title = {A \\& B: 50\\% of \\#1}" in entry
    assert "booktitle = {NAACL}" in entry and "doi = {10.1/x}" in entry
    journal = logic.bibtex_for({"title": "T", "authorsList": ["A B"], "year": 2020, "venue": "Journal of X"})
    assert journal.startswith("@article{b2020,") and "journal = {Journal of X}" in journal


def test_report_html_lists_every_citation_with_its_verdict_and_passage():
    check = {
        "version": 3,
        "finishedAt": "2026-09-27T10:00:00+00:00",
        "citations": [
            {
                "key": "khattab2020",
                "file": "related-work.tex",
                "line": 8,
                "section": "Related work",
                "claim": "ColBERTv2 reduces index size 6–10×.",
                "verdict": "refutes",
                "sourceRef": {"authors": "Khattab & Zaharia", "year": 2020, "title": "ColBERT <b>"},
                "evidence": {
                    "passage": "we leave compression to future work",
                    "pdf": "colbert.pdf",
                    "page": 7,
                },
                "explanation": "The 2020 paper defers compression.",
            },
            {
                "key": "nguyen2016",
                "file": "related-work.tex",
                "line": 15,
                "claim": "MS MARCO",
                "verdict": "unavailable",
                "message": "no free copy published",
            },
        ],
    }
    html = logic.report_html({"title": "Related work — thesis ch.2"}, check)
    assert "Related work — thesis ch.2 · v3" in html
    assert "2 citations · 1 not supported · 1 unavailable" in html
    assert "Source contradicts" in html and "ColBERT &lt;b&gt;" in html
    assert "colbert.pdf p.7" in html and "we leave compression to future work" in html
    assert "no free copy published" in html


def test_the_report_header_says_the_status_once():
    """#727: the header ends with the label, minus the unavailable count the counts line
    already ends with, and never says "all supported" for a citation nobody judged."""
    row = {"key": "a2020", "file": "main.tex", "line": 1, "claim": "A claim."}
    unread = {**row, "verdict": "unavailable", "message": "no free copy"}
    missing = {**row, "key": "nope", "verdict": "unchecked", "message": "nope is not in the bibliography"}

    def header(*citations: dict) -> str:
        return logic.report_html({"title": "T"}, {"version": 1, "citations": list(citations)})

    html = header(unread, unread)
    assert "<p>2 citations · 2 unavailable</p>" in html and "all supported" not in html
    html = header(unread, missing)
    assert "<p>1 citation · 1 unavailable · 1 not checked</p>" in html and "all supported" not in html
    html = header({**row, "verdict": "supports"}, missing)
    assert "<p>1 citation · 1 supported · 1 not checked</p>" in html and "all supported" not in html
    assert "<p>1 citation · 1 supported · all supported</p>" in header({**row, "verdict": "supports"})
    assert "<p>2 citations · 1 supported · 1 not supported · 1 issue</p>" in header(
        {**row, "verdict": "supports"}, {**row, "verdict": "refutes"}
    )
    assert "<p>0 citations · not checked</p>" in header()
    assert "<p>0 citations · 2 not checked</p>" in header(missing, missing)


def test_plain_text_unwraps_two_levels_of_formatting():
    """plain_text runs its unwrap twice on purpose (PR #291 review): each pass reaches only an
    innermost {...}, so nested formatting needs the second."""
    assert logic.plain_text(r"We show \textbf{\emph{strong}} gains.") == "We show strong gains."
    assert logic.plain_text(r"A \emph{clear} claim.") == "A clear claim."


def test_a_cite_on_an_item_or_paragraph_line_keeps_the_words_before_it():
    """The sentence used to start at the \\cite when its line began with a command (#437)."""
    tex = (
        "\\paragraph{Training:} We used the AdamW optimizer \\cite{adamw} with weight decay.\n"
        "\\begin{itemize}\n"
        "    \\item He initialization \\cite{he2015}: designed for ReLU.\n"
        "\\end{itemize}\n"
    )
    cites = logic.find_cites([{"name": "main.tex", "kind": "tex", "content": tex}])

    assert [c["claim"] for c in cites] == [
        "We used the AdamW optimizer with weight decay.",
        "He initialization: designed for ReLU.",
    ]


def test_a_bib_year_or_first_author_that_disagrees_with_the_index_is_reported():
    fields = {"year": "2021", "author": "Khattab, Omar and Zaharia, Matei"}

    assert logic.metadata_mismatches(fields, 2023, "Santhanam", "Crossref") == [
        "year: the .bib says 2021, Crossref says 2023",
        "first author: the .bib says Khattab, Crossref says Santhanam",
    ]


def test_a_year_one_off_accents_and_missing_fields_are_not_mismatches():
    # A preprint's year and its proceedings' year often differ by one.
    assert (
        logic.metadata_mismatches({"year": "2019", "author": 'M{\\"u}ller, Jan'}, 2020, "Müller", "Crossref")
        == []
    )
    assert logic.metadata_mismatches({"author": "Jan Muller"}, None, "", "OpenAlex") == []


def test_bib_doi_drops_a_doi_org_prefix():
    assert logic.bib_doi({"doi": " https://doi.org/10.1162/tacl.a.729 "}) == "10.1162/tacl.a.729"
    assert logic.bib_doi({"title": "no doi"}) == ""


def test_bib_doi_undoes_dblp_escapes_and_a_doi_prefix():
    assert logic.bib_doi({"doi": r"10.1007/978-3-030-58452-8\_13"}) == "10.1007/978-3-030-58452-8_13"
    assert logic.bib_doi({"doi": "doi:10.1162/tacl.a.729"}) == "10.1162/tacl.a.729"


@pytest.mark.parametrize(
    ("bib_author", "index_author"),
    [
        (r"Haji{\v{c}}, Jan", "Hajič"),
        (r"Paul Erd{\H{o}}s", "Erdős"),
        (r"{\O}vrelid, Lilja", "Øvrelid"),
        ("Jan van den Berg", "van den Berg"),
        ("John Smith Jr.", "Smith"),
    ],
)
def test_latex_accents_particles_and_suffixes_are_not_mismatches(bib_author, index_author):
    assert logic.metadata_mismatches({"author": bib_author}, None, index_author, "Crossref") == []


def test_cited_text_marks_where_the_key_is_cited():
    sentence = r"We use AdamW~\cite{adamw} with weight decay 0.1 in PyTorch~\citep{torch, jax}."

    assert logic.cited_text(sentence, "adamw") == "We use AdamW [cited] with weight decay 0.1 in PyTorch."
    assert logic.cited_text(sentence, "jax") == "We use AdamW with weight decay 0.1 in PyTorch [cited]."


KEPT = {"kind": "overridden", "note": "kept as written"}


@pytest.mark.parametrize(
    ("verdicts", "label"),
    [
        (["supports", "supports"], "all supported"),
        (["unavailable", "unavailable"], "2 unavailable"),  # #727: was "all supported"
        (["refutes", "insufficient"], "2 issues"),
        ([("refutes", KEPT)], "no open issues"),  # nothing supported, nothing left to do
        (["supports", "unavailable"], "1 unavailable"),
        (["supports", ("refutes", KEPT), "unavailable"], "1 unavailable"),
        (["supports", "refutes", "unavailable"], "1 issue"),
        (["supports", ("refutes", KEPT)], "no open issues"),
        (["unavailable", "unchecked"], "1 unavailable · 1 not checked"),  # #727's run
        (["supports", "unchecked"], "1 not checked"),  # a missing key is not supported
        (["supports", "unavailable", "unchecked", "unchecked"], "1 unavailable · 2 not checked"),
        (["insufficient", "unchecked"], "1 issue"),  # partial is open: it needs work
        ([("insufficient", KEPT)], "no open issues"),
        (["unchecked"], "1 not checked"),  # a check ran, every key missing
        (["unchecked", "unchecked"], "2 not checked"),
        ([], "not checked"),
    ],
)
def test_the_status_label_follows_the_counts(verdicts, label):
    """#727: "all supported" only when every citation is; an unread source, a missing key or
    a contradiction the author kept is never called supported."""

    def citation(item: str | tuple[str, dict]) -> dict:
        if isinstance(item, tuple):
            return {"verdict": item[0], "resolution": item[1]}
        return {"verdict": item}

    assert logic.status_label(logic.summarize([citation(v) for v in verdicts])) == label


def test_a_project_lint_keeps_a_forked_copys_own_duplicate():
    """A draft's own refs.bib is not the project's, even with the same name and the same duplicate."""
    twice = "@misc{k, title={A}, url={https://a.b}}\n@misc{k, title={B}, url={https://a.b}}\n"
    fork = [
        {"name": "a.tex", "kind": "tex", "content": r"\cite{k}"},
        {"name": "refs.bib", "kind": "bib", "content": twice},
    ]
    uses = [
        {"name": "b.tex", "kind": "tex", "content": r"\cite{k}"},
        {"name": "refs.bib", "kind": "bib", "content": twice, "shared": True},
    ]
    body = logic.lint_project({"name": "refs.bib", "content": twice}, [("fork", fork), ("uses", uses)])
    duplicates = {w["draftId"] for w in body["warnings"] if w["type"] == "duplicate-key"}
    assert duplicates == {None, "fork"}


def test_the_report_never_prints_a_raw_error_page():
    page = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>" + "<p>x</p>" * 300
    citation = {"key": "k", "file": "a.tex", "line": 1, "verdict": "unavailable", "message": page}
    html = logic.report_html({"title": "T"}, {"version": 1, "citations": [citation]})
    assert "the server sent an error page (Just a moment...)" in html
    assert "DOCTYPE" not in html


def test_a_half_typed_entry_does_not_hide_the_entries_after_it():
    text = (
        '@string{sigir = "SIGIR"}\n'
        "@article{broken, title={Unclosed\n\n"
        "@misc{after, booktitle=sigir, year=2020}\n"
    )
    entries = logic.parse_bib(text)
    assert [(e["key"], e["fields"].get("booktitle")) for e in entries] == [("after", "SIGIR")]


def test_saved_bibtex_escapes_braces_accents_and_authors():
    entry = logic.bibtex_for({"title": "{X} ~ y", "authorsList": ["Jan Müller"], "year": 2020})
    assert entry.startswith("@inproceedings{muller2020,")
    assert r'author = {Jan M\"uller}' in entry
    assert r"title = {\{X\} {\textasciitilde} y}" in entry
    assert logic.bib_surnames(logic.latex_escape("Jan Müller")) == ["Müller"]
