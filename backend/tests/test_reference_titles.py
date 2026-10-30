"""A reference title that GROBID read with its author list in front loses the authors,
whatever alphabet the names are written in."""

from app.pipeline import claims


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
    assert claims._cleaned_title("Sparks of AGI. arXiv preprint arXiv:2303.12712") == "Sparks of AGI"


def test_a_title_about_preprints_keeps_its_words():
    assert claims._cleaned_title("An arXiv preprint server study") == "An arXiv preprint server study"


def test_a_word_broken_across_lines_is_joined():
    assert claims._cleaned_title("Reason-ingFlow: Semantic Structure of Complex Reasoning Traces") == (
        "ReasoningFlow: Semantic Structure of Complex Reasoning Traces"
    )


def test_real_hyphens_are_kept():
    for title in ("Chain-of-Thought Is Not Explainability", "Zero-shot Mixture-of-Experts", "DIM-SUM"):
        assert claims._cleaned_title(title) == title
