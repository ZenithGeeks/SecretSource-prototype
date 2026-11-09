"""Sentence splitting keeps the abbreviations papers use inside one sentence."""

from app.text import search_terms, sentence_spans, split_sentences


def test_paper_abbreviations_do_not_end_a_sentence():
    text = "Shin et al. [b47] show it in Fig. 2, e.g. on SST-2. We do not."
    assert split_sentences(text) == ["Shin et al. [b47] show it in Fig. 2, e.g. on SST-2.", "We do not."]


def test_spans_point_at_each_sentence():
    text = "One. Two."
    assert [text[start:end] for start, end in sentence_spans(text)] == ["One.", "Two."]


def test_search_terms_stem_words_and_drop_stopwords():
    assert search_terms("The indexes of Müller's retrievers") == search_terms("index müller retriever")
    assert search_terms("what is the and of") == set()
