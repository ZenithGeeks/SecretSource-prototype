"""Per-paper vector files of ColBERTv2 token embeddings.

    python -m store paper.pdf "papers/*.pdf" papers/   # files, globs or folders

Each PDF becomes ~120-word passages, encoded and written to one safetensors file per
paper (services/colbert/vectorfiles.py), stored under VECTOR_STORE (a GCS bucket in
production, a local folder in compose/tests). Each passage keeps the page and character
span, so a hit can be pointed at in the original. Re-adding a PDF with the same file
name replaces its old passages.
"""

import hashlib
import os
import re
import sys
from bisect import bisect_left
from functools import cache
from itertools import pairwise
from pathlib import Path

from encoder import DOC_LEN, Encoder
from pypdf import PdfReader
from vectorfiles import PaperFiles, maxsim

WORDS_PER_PASSAGE = 120
# A last window shorter than this joins the one before it, so a break at a caption leaves no
# scrap of a few words. At most 159 words, about 255 tokens: inside the encoder's DOC_LEN of 300.
MIN_TAIL_WORDS = 40
# With no sentence end in its first 120 words, a passage runs on to one, up to the same 159.
MAX_WORDS_PER_PASSAGE = WORDS_PER_PASSAGE + MIN_TAIL_WORDS - 1
# A passage also starts with the last sentence of the one before when that sentence is at most
# this long, so evidence that spans a cut is whole in one passage.
OVERLAP_WORDS = 40
# Part of the content hash, so a PDF indexed before a change to how passages are cut is
# indexed again the next time it is asked for. 2: reference lists are left out (#476).
# 3: a figure or table caption starts a new passage (#491). 6: passages end at a sentence
# end and overlap by one sentence, and a word hyphenated across a line break is joined again
# (4 and 5 were first tries, indexed only on a development machine). 7: page numbers are left
# out.
PASSAGES_VERSION = "7"

REFERENCES_HEADING = re.compile(
    r"^\s*(?:\d+\.?\s*)?(References|REFERENCES|Bibliography|BIBLIOGRAPHY)\s*$", re.M
)
# "Figure 3:", "Fig. 2.", "Table IV |" at the start of a line. The punctuation after the number
# is what tells a caption from a sentence that refers to one ("Table 3 presents ..."): on 28
# papers this matched 601 caption lines and left out 60 such references.
CAPTION = re.compile(r"^\s*(?:Figure|Fig\.|Table)\s*(?:\d+|[IVX]+)\s*[.:|]", re.I | re.M)
# A first or last line that is only a number: pypdf reads the page number there. On 428 pages
# of 40 papers, 238 such lines, all page numbers ("2229" at the foot, "6770" at the head).
PAGE_NUMBER = re.compile(r"\A\s*\d{1,5}[ \t]*$|^[ \t]*\d{1,5}\s*\Z", re.M)
YEAR = re.compile(r"\b(19[5-9]\d|20[0-3]\d)[a-z]?\b")
PROSE_WORDS = frozenset(
    {"the", "is", "are", "we", "this", "that", "which", "our", "it", "was", "be", "can", "these", "its", "as"}
)
# Punkt's form: lowercase, no final period.
PAPER_ABBREVIATIONS = {"al", "fig", "figs", "eq", "eqs", "sec", "tab", "e.g", "i.e", "cf", "vs", "approx"}


def _words(text: str) -> tuple[list[str], list[tuple[int, int]]]:
    """The page's words and the (start, end) of each in the text. It walks forward, so
    repeated words keep their own positions.

    A word hyphenated at a line end ("la-" then "beling" on the next line) is joined into one,
    spanning both parts. Only before a lowercase letter, so "BLIP-" + "2" stays as it is.
    shortcut: a compound broken at its own hyphen ("state-of-the-" + "art") is joined too.
    """
    words, spans, cursor = [], [], 0
    for word in text.split():
        start = text.index(word, cursor)
        cursor = start + len(word)
        previous = words[-1] if words else ""
        if previous.endswith("-") and previous[:-1][-1:].isalpha() and word[0].islower() and (
            "\n" in text[spans[-1][1] : start]
        ):
            words[-1], spans[-1] = previous[:-1] + word, (spans[-1][0], cursor)
        else:
            words.append(word)
            spans.append((start, cursor))
    return words, spans


@cache
def _punkt():
    """NLTK's English Punkt sentence splitter. The image downloads its punkt_tab data."""
    from nltk.tokenize import PunktTokenizer  # here, so the server tests run without NLTK

    tokenizer = PunktTokenizer("english")
    # The English model is trained on news, so it splits after these, which papers use a lot.
    tokenizer._params.abbrev_types.update(PAPER_ABBREVIATIONS)
    return tokenizer


def _sentence_ends(text: str, starts: list[int]) -> list[int]:
    """Word positions a passage can end before: the first word after each sentence."""
    return [bisect_left(starts, end) for _, end in _punkt().span_tokenize(text)]


def _is_bibliography(words: list[str]) -> bool:
    """Whether a passage reads like reference-list entries: almost no prose words and many
    years. Tables have few prose words too, but no years, so they stay.

    The thresholds come from six arXiv papers (#476): 114 of 134 reference passages fall
    under them, and 4 of 208 appendix passages (JSON with dates, a licence list).
    """
    prose = sum(word.lower().strip(".,;:()") in PROSE_WORDS for word in words) / len(words)
    years = len(YEAR.findall(" ".join(words))) / len(words)
    return prose < 0.03 and years >= 0.015


def _windows(start: int, stop: int, ends: list[int]) -> list[tuple[int, int]]:
    """(first, end) word positions of the passages over [start, stop).

    Each passage ends at the last sentence end from word 40 to word 120, else at the first one
    up to word 159, else at word 120. Ending before word 120 keeps a sentence that crosses it
    whole at the start of the next passage: run past it, and on ColBERT's paper the abstract's
    "ColBERT introduces a late interaction architecture" joined the title and author list, and
    fell to rank 13, out of the passages the judge reads. A piece of 159 words or fewer stays
    whole, and no cut leaves fewer than MIN_TAIL_WORDS after it.

    Each passage after the first in the piece also starts with the last sentence before its
    cut, when that sentence has at most OVERLAP_WORDS words and the passage stays within 159.
    """
    cuts = [start]
    while stop - cuts[-1] > MAX_WORDS_PER_PASSAGE:
        first = cuts[-1]
        usable = [end for end in ends if first + MIN_TAIL_WORDS <= end <= stop - MIN_TAIL_WORDS]
        before = [end for end in usable if end <= first + WORDS_PER_PASSAGE]
        after = [end for end in usable if first + WORDS_PER_PASSAGE < end <= first + MAX_WORDS_PER_PASSAGE]
        cuts.append(before[-1] if before else after[0] if after else first + WORDS_PER_PASSAGE)
    windows = []
    for first, end in pairwise([*cuts, stop]):
        earlier = [e for e in ends if start <= e < first and first - e <= OVERLAP_WORDS]
        if first != start and earlier and end - earlier[-1] <= MAX_WORDS_PER_PASSAGE:
            first = earlier[-1]
        windows.append((first, end))
    return windows


def pdf_passages(path: Path) -> list[dict]:
    """PDF -> ~120-word passages. Each one knows its page and where on that page it sits.
    We chunk per page: a passage that crossed a page break could not name one page.

    After the References heading, passages that read like reference entries are left out.
    They matched claims full of model names and took the evidence slots from the body text
    (#476). An appendix after the references is still indexed.

    A figure or table caption starts a new passage, so a caption is never split between two
    passages and its passage begins with the label (#491).

    A passage ends at a sentence end where one is near, so the judge does not get a claim's
    evidence cut in half.
    """
    passages = []
    in_references = False
    for number, page in enumerate(PdfReader(path).pages, start=1):
        # Spaces of the same length, so start and end still index the page's text.
        text = PAGE_NUMBER.sub(lambda match: " " * len(match[0]), page.extract_text() or "")
        words, spans = _words(text)
        starts = [start for start, _ in spans]
        references_from = len(words)  # the first word of the reference list on this page
        if in_references:
            references_from = 0
        elif heading := REFERENCES_HEADING.search(text):
            in_references, references_from = True, bisect_left(starts, heading.end())
        # A passage starts at the heading, so none holds both body text and reference entries,
        # and at every caption. Each piece between two breaks is cut into ~120-word passages.
        captions = [bisect_left(starts, match.start()) for match in CAPTION.finditer(text)]
        breaks = sorted({0, references_from, len(words), *captions})
        ends = _sentence_ends(text, starts)
        pieces = [window for start, stop in pairwise(breaks) for window in _windows(start, stop, ends)]
        for i, stop in pieces:
            chunk = words[i:stop]
            if i >= references_from and _is_bibliography(chunk):
                continue
            passages.append(
                {
                    "text": " ".join(chunk),
                    "page": number,
                    "start": spans[i][0],
                    "end": spans[i + len(chunk) - 1][1],
                }
            )
    return passages


class Store:
    def __init__(self, device: str | None = None):
        self.encoder = Encoder(device)
        self.files = PaperFiles(os.getenv("VECTOR_STORE", "./vectors"), "colbert")

    def add_pdf(self, path: str | Path) -> int:
        """Index one PDF. Returns the number of passages added.

        Skips the encode-and-write (the expensive part) when the store already has this
        exact content under this source name — a restart, or a second gateway process,
        re-asking to index a paper it (or another process) already put here. The
        gateway's own dedup (app/pipeline/verify.py's `_indexed` set) only holds for one
        process's lifetime; this check is against the store itself, so it holds
        regardless of which process asks.
        """
        path = Path(path)
        # DOC_LEN is in the hash so a change to it re-encodes papers already in the store
        versions = f"{PASSAGES_VERSION}:{DOC_LEN}".encode()
        content_hash = hashlib.sha256(versions + path.read_bytes()).hexdigest()
        stored_hash, stored_count = self.files.stored_hash(path.name)
        if stored_hash == content_hash:
            return stored_count

        passages = pdf_passages(path)
        vectors = self.encoder.docs([passage["text"] for passage in passages])
        rows, kept_vectors = [], []
        for passage, vector in zip(passages, vectors, strict=True):
            if len(vector):  # skip passages with no tokens left
                rows.append({**passage, "title": path.stem, "source": path.name})
                kept_vectors.append(vector)
        self.files.write(path.name, rows, kept_vectors, content_hash)
        return len(rows)

    def search(
        self,
        query: str,
        k: int = 10,
        source: str | None = None,
        sources: list[str] | None = None,
    ) -> list[dict]:
        """Top-k passages by MaxSim, optionally restricted to one paper or a list of them.

        `sources` empty, or a `source` that is not in `sources`, searches nothing: the caller
        named a scope that contains no paper, and the alternative would be the whole index.
        Each query token finds its best-matching doc token, and the scores are added up.
        """
        if sources is not None and source is not None:
            names = [source] if source in sources else []
        elif sources is not None:
            names = list(sources)
        elif source is not None:
            names = [source]
        else:
            names = self.files.sources()
        if not names:
            return []

        vector = self.encoder.query(query)

        scored = []
        for name in names:
            paper = self.files.load(name)
            if paper is None or not paper.rows:
                continue
            scores = maxsim(vector, paper)
            for row, score in zip(paper.rows, scores.tolist(), strict=True):
                scored.append((score, row))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            {
                "rank": i + 1, "score": round(score, 4),
                "text": row["text"], "title": row["title"],
                "source": row["source"], "page": row["page"],
                "start": row["start"], "end": row["end"],
            }
            for i, (score, row) in enumerate(scored[:k])
        ]

    def __len__(self) -> int:
        return len(self.files.sources())


if __name__ == "__main__":
    # Accept files, globs ("papers/*.pdf") and folders; PowerShell does not expand globs itself.
    pdfs = []
    for arg in sys.argv[1:]:
        pdf_path = Path(arg)
        pdfs += sorted(pdf_path.glob("*.pdf")) if pdf_path.is_dir() else sorted(Path().glob(arg))
    if not pdfs:
        sys.exit("no PDFs found")
    store = Store()
    for pdf in pdfs:
        print(f"{pdf}: +{store.add_pdf(pdf)} passages ({len(store)} total)")
