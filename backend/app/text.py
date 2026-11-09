"""Sentence splitting and stopwords for paper and draft text, from NLTK.

services/colbert/store.py cuts passages with the same model and abbreviations. The image
downloads the punkt_tab and stopwords data.
"""

from functools import cache

from nltk.corpus import stopwords
from nltk.tokenize import PunktTokenizer

# The English model is trained on news, so it splits after these, which papers use a lot.
PAPER_ABBREVIATIONS = {"al", "fig", "figs", "eq", "eqs", "sec", "tab", "e.g", "i.e", "cf", "vs", "approx"}


@cache
def _punkt() -> PunktTokenizer:
    """Load the English Punkt model once. The image downloads its punkt_tab data."""
    tokenizer = PunktTokenizer("english")
    tokenizer._params.abbrev_types.update(PAPER_ABBREVIATIONS)
    return tokenizer


def split_sentences(text: str) -> list[str]:
    """Split text into sentences: "Shin et al. [b47] propose X. We do not." gives two."""
    return _punkt().tokenize(text)


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """Return the (start, end) offset of each sentence in text."""
    return list(_punkt().span_tokenize(text))


@cache
def english_stopwords() -> frozenset[str]:
    """NLTK's English stopwords, without apostrophes ("dont"), as word tokens are compared."""
    return frozenset(word.replace("'", "") for word in stopwords.words("english"))
