"""Claim extraction from research paper PDFs.

Docling reads the PDF, the LLM (with DSPy) extracts claims, and GROBID parses references.
Each claim keeps the sentence it came from, located back in the PDF (page and boxes) so the
UI can show the place instead of telling the reader to go looking.
"""

import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import pydantic
from pydantic import Field

from app.config import CLAIM_LIMIT, GROBID_URL
from app.pipeline.sources import local_pdf

TEI_NAMESPACE = {"tei": "http://www.tei-c.org/ns/1.0"}
TEI_TAG = "{http://www.tei-c.org/ns/1.0}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
MAX_CHARS = 12_000  # ~3k tokens per window, fits an 8k context with room for output
NEAR_DUPLICATE = 0.8  # word-level ratio above which two claims are one assertion, reworded
# Windows extracted at once. Each one is a full LLM round trip and they do not depend on
# each other. The cap keeps a long paper from opening a connection per window.
EXTRACT_WORKERS = 3

_converter = None  # lazy: loading docling's models takes seconds
_claim_extractor = None  # lazy: needs dspy and a running LM
_cited_claim_extractor = None


def _windows(text: str, size: int = MAX_CHARS) -> list[str]:
    """The whole paper in model-sized pieces, split at paragraph breaks.

    We read every piece, not only the first one, because the results section (where most
    claims worth checking are) is usually far into the paper.
    """
    windows: list[str] = []
    current = ""
    for paragraph in text.split("\n\n"):
        if current and len(current) + len(paragraph) + 2 > size:
            windows.append(current)
            current = ""
        current = f"{current}\n\n{paragraph}" if current else paragraph
        while len(current) > size:
            windows.append(current[:size])
            current = current[size:]
    if current.strip():
        windows.append(current)
    return windows or [""]


def _normalised_claim(claim: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", claim.lower()).strip()


def _pdf_to_text(pdf_path: str) -> str:
    global _converter
    if _converter is None:
        from docling.document_converter import DocumentConverter

        _converter = DocumentConverter()
    return _converter.convert(pdf_path).document.export_to_markdown()


# --- where a sentence sits on a page -------------------------------------------------

# What the PDF and the extracted sentence disagree on most: ligatures, dashes, quotes.
_FOLD = str.maketrans(
    {
        "ﬁ": "fi",
        "ﬂ": "fl",
        "ﬀ": "ff",
        "ﬃ": "ffi",
        "ﬄ": "ffl",
        "–": "-",
        "—": "-",
        "‐": "-",
        "’": "'",
        "‘": "'",
        "“": '"',
        "”": '"',
        "­": "",
    }
)
MIN_COVERAGE = 0.8  # of the sentence's words must be found in order; below that, no box
MAX_GAP = 3  # page words allowed between two matched words on their own: a footnote mark, "[12]"
LONG_GAP = 14  # ... when the sentence word after also follows: "(Xin et al., 2021; Xiong et al., 2020)"
MAX_MISSES = 4  # sentence words in a row that may be missing before we decide it is not here
MAX_STRETCH = 2.5  # a relaxed match may span at most this many page words per sentence word
# Short words a relaxed match may not jump to on their own: too common to be evidence.
STOPWORDS = frozenset(
    "that with from this than which their these those have been into also more when where "
    "what while such each both same only over some most many very much".split()
)


def _token(word: str) -> str:
    """A word reduced to lower case letters and digits only."""
    return re.sub(r"[^a-z0-9]+", "", word.translate(_FOLD).lower())


def _tokens(text: str) -> list[str]:
    return [token for token in (_token(word) for word in text.split()) if token]


class _Word:
    """One word on the page: its box, its token, and any line-break hyphen at its end."""

    __slots__ = ("rect", "token", "line", "hyphen")

    def __init__(self, word_entry, next_word_entry):
        x0, y0, x1, y1, raw, block, line, _ = word_entry
        self.rect = (x0, y0, x1, y1)
        self.token = _token(raw)
        self.line = (block, line)
        # "trans-" at a line end continues as "duction" on the next line. We read it as one word.
        self.hyphen = (
            raw.endswith("-") and next_word_entry is not None and (block, line) != tuple(next_word_entry[5:7])
        )


def _page_words(page) -> list[_Word]:
    entries = page.get_text("words")  # x0, y0, x1, y1, word, block, line, word-in-line
    words = [
        _Word(word_entry, entries[i + 1] if i + 1 < len(entries) else None)
        for i, word_entry in enumerate(entries)
    ]
    return [word for word in words if word.token]


def _match_at(words: list[_Word], wanted: list[str], i: int, k: int) -> tuple[list[int], int] | None:
    """If sentence word i matches page word k, the page words it takes and the sentence
    words it covers.

    Beyond the plain match: a word hyphenated at a line end, two of ours the PDF glued
    ("state-of-the-art"), one of ours the PDF split.
    """
    word = words[k]
    if word.token == wanted[i]:
        return [k], 1
    if word.hyphen and k + 1 < len(words) and word.token + words[k + 1].token == wanted[i]:
        return [k, k + 1], 1
    if i + 1 < len(wanted) and word.token == wanted[i] + wanted[i + 1]:
        return [k], 2
    if k + 1 < len(words) and word.token + words[k + 1].token == wanted[i]:
        return [k, k + 1], 1
    return None


def _content_word(token: str) -> bool:
    return len(token) >= 4 and token not in STOPWORDS


def _align(words: list[_Word], wanted: list[str], start: int, relaxed: bool = False) -> tuple[list[int], int]:
    """Match the sentence's words in order, starting at page word `start`.

    Page words between matches (citation markers, parenthetical references) and sentence
    words that never turn up are allowed. Returns the indices of the page words matched
    and how many sentence words they cover.

    A far hit counts only with the next sentence word right behind it. On its own, a "the"
    fourteen words away would drag the highlight off course. `relaxed` also lets a content
    word stand on its own, for a sentence that lists cited systems with a reference after
    every one of them ("ColBERT (Khattab and Zaharia, 2020), DPR (Xin et al., 2021), ...").
    """
    matched: list[int] = []
    accounted = 0
    i, j, misses = 0, start, 0
    while i < len(wanted) and j < len(words):
        hit = None
        for k in range(j, min(j + LONG_GAP + 1, len(words))):
            found = _match_at(words, wanted, i, k)
            if not found:
                continue
            if k - j > MAX_GAP:
                indices, consumed = found
                after, next_k = i + consumed, indices[-1] + 1
                confirmed = after >= len(wanted) or (
                    next_k < len(words) and _match_at(words, wanted, after, next_k)
                )
                if not confirmed and not (relaxed and _content_word(wanted[i])):
                    continue
            hit = found
            break
        if hit:
            indices, consumed = hit
            matched += indices
            accounted += consumed
            i += consumed
            j = indices[-1] + 1
            misses = 0
        else:
            i += 1  # this sentence word is not on the page as written; carry on
            misses += 1
            if misses > MAX_MISSES:
                break
    return matched, accounted


def _best_span(words: list[_Word], wanted: list[str]) -> tuple[list[int], float]:
    """The alignment with the best coverage.

    It starts at any page word that matches one of the sentence's first three words, since
    the very first word may be the one the PDF lost.
    """
    best: tuple[list[int], float] = ([], 0.0)
    for relaxed in (False, True):
        for lead in wanted[:3]:
            for start, word in enumerate(words):
                if word.token != lead:
                    continue
                matched, accounted = _align(words, wanted, start, relaxed)
                coverage = accounted / len(wanted)
                if relaxed and matched and matched[-1] - matched[0] + 1 > MAX_STRETCH * len(wanted):
                    continue  # wandered too far to be one sentence
                # Ties go to the tighter span: the same words found with less in between.
                if coverage > best[1] or (coverage == best[1] and matched and len(matched) < len(best[0])):
                    best = (matched, coverage)
            if best[1] >= 1.0:
                break
        if best[1] >= MIN_COVERAGE:
            break  # the strict pass found it; the relaxed one is only for what it could not
    return best


def _line_boxes(words: list[_Word], indices: list[int]) -> list[dict]:
    """One box per line, from the first matched word on it to the last.

    A citation marker the sentence skipped sits inside the box, not a hole in the highlight.
    """
    lines: dict[tuple, dict] = {}
    for index in indices:
        word = words[index]
        x0, y0, x1, y1 = word.rect
        box = lines.setdefault(word.line, {"x0": x0, "y0": y0, "x1": x1, "y1": y1})
        box["x0"], box["y0"] = min(box["x0"], x0), min(box["y0"], y0)
        box["x1"], box["y1"] = max(box["x1"], x1), max(box["y1"], y1)
    keys = sorted(lines, key=lambda line_key: (lines[line_key]["y0"], lines[line_key]["x0"]))
    return [lines[key] for key in keys]


def locate(pdf_path: str, sentence: str, page: int | None = None) -> dict | None:
    """Where a sentence sits in a PDF: 1-based page, one box per line, the page size to
    scale by, and how much of the sentence the boxes cover.

    The sentence is what the model copied out of the paper, so it differs from the PDF's own
    text in small ways: a word hyphenated at a line end, a ligature, a citation marker, a
    dash. Matching word by word, in order, with room for those differences, finds the whole
    sentence where a verbatim search found only the fragments that happened to survive.
    It returns nothing instead of a box that is nearly right. A wrong highlight is worse
    than none in a tool built for checking sources.
    """
    import pymupdf

    wanted = _tokens(sentence)
    if not wanted:
        return None
    with pymupdf.open(pdf_path) as document:
        numbers = [page] if page else range(1, document.page_count + 1)
        best: tuple[float, int, list[dict], object] | None = None
        for number in numbers:
            if not 1 <= number <= document.page_count:
                return None
            found_page = document[number - 1]
            words = _page_words(found_page)
            indices, coverage = _best_span(words, wanted)
            if coverage >= MIN_COVERAGE and (best is None or coverage > best[0]):
                best = (coverage, number, _line_boxes(words, indices), found_page.rect)
                if coverage >= 1.0:
                    break
        if best is None:
            return None
        coverage, number, boxes, rect = best
        return {
            "page": number,
            "boxes": boxes,
            "page_width": rect.width,  # PyMuPDF is top-left origin, like CSS
            "page_height": rect.height,
            "coverage": round(coverage, 2),
        }


def _build_claim_extractor():
    import dspy

    from app.llm import dspy_lm

    language_model = dspy_lm()

    class ExtractClaims(dspy.Signature):
        """List the main factual claims and contributions this part of a paper asserts."""

        paper: str = dspy.InputField(desc="Part of a paper, in markdown")
        claims: list[str] = dspy.OutputField(
            desc="3-6 short standalone claims this part asserts, one sentence each"
        )

    extract = dspy.ChainOfThought(ExtractClaims)

    def run(paper_text: str) -> list[str]:
        # JSONAdapter: without it the model splits the list across lines and only one claim parses
        with dspy.context(lm=language_model, adapter=dspy.JSONAdapter()):
            return extract(paper=paper_text).claims

    return run


def extract_claims(pdf_path: str) -> dict:
    """Extract the main claims / contributions from a research paper PDF.

    Args:
        pdf_path: a local PDF path, or a DOI, arXiv ID, PMID, or URL to download,
            for example "data/papers/colbertv2.pdf" or "2112.01488".
    """
    global _claim_extractor
    try:
        pdf_path = local_pdf(pdf_path)
        if _claim_extractor is None:
            _claim_extractor = _build_claim_extractor()
        windows = _windows(_pdf_to_text(pdf_path))
        with ThreadPoolExecutor(max_workers=EXTRACT_WORKERS) as pool:
            per_window = list(pool.map(_claim_extractor, windows))
        # The abstract and the conclusion repeat each other across windows: keep first wording.
        claims: dict[str, str] = {}
        for window_claims in per_window:
            for claim in window_claims:
                claims.setdefault(_normalised_claim(claim), claim)
        return {"status": "ok", "file": pdf_path, "claims": list(claims.values()), "windows": len(windows)}
    except Exception as error:
        return {"status": "error", "message": str(error)}


def _grobid_pdf(endpoint: str, pdf_path: str, coordinates: tuple[str, ...] = ()) -> ET.Element:
    """GROBID's TEI for a PDF. `coordinates` names the elements that should get a `coords`
    attribute with their place on the page, for example ("ref",)."""
    import requests

    from app.clients.service_auth import auth_headers

    with open(pdf_path, "rb") as pdf_file:
        response = requests.post(
            f"{GROBID_URL}/api/{endpoint}",
            files={"input": pdf_file},
            data={"teiCoordinates": list(coordinates)},
            headers=auth_headers(GROBID_URL),
            timeout=300,
        )
    response.raise_for_status()
    return ET.fromstring(response.text)


def _full_name(person) -> str:
    names = person.findall("tei:forename", TEI_NAMESPACE) + person.findall("tei:surname", TEI_NAMESPACE)
    return " ".join(name.text for name in names if name.text)


TITLE_PATHS = (
    "tei:analytic/tei:title[@level='a']",  # the article's own title
    "tei:monogr/tei:title[@level='m']",  # a book or proceedings, cited whole
    "tei:monogr/tei:title[@level='j']",  # a journal, when nothing finer was parsed
)
NAME_TOKEN = re.compile(r"^[^\W\d_](?:[^\W\d_]|['’-])*\.?$")  # any alphabet, so "Stéphane" counts


def _looks_like_authors(text: str) -> bool:
    """Whether this "title" is really an author list GROBID mis-parsed.

    The test: two or more comma- or "and"-separated groups, each two or three name-shaped
    words.
    """
    groups = [group.split() for group in re.split(r",|\band\b", text) if group.strip()]
    return len(groups) >= 2 and all(
        2 <= len(group) <= 3 and all(NAME_TOKEN.match(word) and word[0].isupper() for word in group)
        for group in groups
    )


YEAR_PREFIX = re.compile(r"^(?:19|20)\d{2}[a-z]?\.\s*")
AUTHORS_PREFIX = re.compile(r"^(?:[^.,]+,\s*)+(?:and\s+)?[^.,]+\.\s+")


def _without_the_authors(title: str) -> str:
    """Cut a leading author list and year off a loosely parsed title.

    A title-only lookup can then still match. Only a prefix that looks like authors is cut.
    """
    trimmed = YEAR_PREFIX.sub("", title).strip()
    prefix = AUTHORS_PREFIX.match(trimmed)
    if prefix and _looks_like_authors(prefix.group().rstrip(". ")):
        trimmed = trimmed[prefix.end() :]
    return YEAR_PREFIX.sub("", trimmed).strip()


def _title_of(reference) -> str:
    for path in TITLE_PATHS:
        found = reference.find(path, TEI_NAMESPACE)
        title = (found.text or "").strip() if found is not None else ""
        if title and not _looks_like_authors(title):
            return _without_the_authors(title)
    return ""


ARXIV_IN_URL = re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})")


def _url_of(reference) -> str:
    pointer = reference.find(".//tei:ptr[@target]", TEI_NAMESPACE)
    return (pointer.get("target") or "").strip() if pointer is not None else ""


def _identifier(reference, kind: str) -> str:
    found = reference.find(f".//tei:idno[@type='{kind}']", TEI_NAMESPACE)
    return (found.text or "").strip() if found is not None else ""


def _parse_reference(reference) -> dict:
    date = reference.find(".//tei:date[@when]", TEI_NAMESPACE)
    url = _url_of(reference)
    in_url = ARXIV_IN_URL.search(url)
    return {
        "title": _title_of(reference),
        "authors": [_full_name(person) for person in reference.findall(".//tei:persName", TEI_NAMESPACE)],
        "year": date.get("when", "")[:4] if date is not None else "",
        "doi": _identifier(reference, "DOI"),
        # GROBID tags an arXiv id only sometimes. Where it did not, the link often says so
        "arxiv": _identifier(reference, "arXiv").replace("arXiv:", "") or (in_url.group(1) if in_url else ""),
        "url": url,
    }


def _paper_header(tei) -> dict:
    """The analysed paper's own title, authors and year, from GROBID's teiHeader. Empty values
    when GROBID could not read them."""
    header = tei.find(".//tei:teiHeader", TEI_NAMESPACE)
    if header is None:
        return {"title": "", "authors": [], "year": ""}
    title = header.find(".//tei:titleStmt/tei:title", TEI_NAMESPACE)
    source = header.find(".//tei:sourceDesc/tei:biblStruct", TEI_NAMESPACE)
    date = header.find(".//tei:publicationStmt/tei:date[@when]", TEI_NAMESPACE)
    if date is None and source is not None:
        date = source.find(".//tei:date[@when]", TEI_NAMESPACE)
    people = source.findall(".//tei:author/tei:persName", TEI_NAMESPACE) if source is not None else []
    authors = [name for name in (_full_name(person) for person in people) if name]
    return {
        "title": " ".join((title.text or "").split()) if title is not None else "",
        "authors": authors,
        "year": date.get("when", "")[:4] if date is not None else "",
    }


def _printed_title(pdf_path: str) -> str:
    """The title as printed on page 1: the largest horizontal text in the top half of the page.

    Only horizontal lines count, so the sideways "arXiv:2112.01488v3 [cs.IR]" stamp on arXiv
    PDFs is skipped although its font is bigger. Empty when the PDF cannot be read.
    """
    import pymupdf

    try:
        with pymupdf.open(pdf_path) as document:
            page = document[0]
            half = page.rect.height / 2
            spans = [
                (span["size"], span["bbox"][1], span["bbox"][0], span["text"])
                for block in page.get_text("dict")["blocks"]
                for line in block.get("lines", [])
                if line["dir"] == (1.0, 0.0)
                for span in line["spans"]
                if span["text"].strip() and span["bbox"][3] < half
            ]
    except Exception:
        return ""
    if not spans:
        return ""
    largest = max(size for size, *_ in spans)
    words = [text for size, _, _, text in sorted(spans, key=lambda s: (s[1], s[2])) if size >= largest - 0.5]
    return " ".join(unicodedata.normalize("NFKC", " ".join(words)).split())


def _comparable(text: str) -> str:
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", text).lower()))


def paper_title(pdf_path: str, grobid_title: str = "", given: str = "") -> str:
    """The analysed paper's title (#140).

    GROBID's header can drop the first line of a title: for 2112.01488 it gives "Effective and
    Efficient Retrieval via Lightweight Late Interaction", without "ColBERTv2:". So, in order:
    the title the source lookup found for what the user gave (a DOI resolved through Semantic
    Scholar has one); the title printed on page 1, when GROBID found none or the printed one
    contains GROBID's, so a different heading is never taken for the title; GROBID's.
    """
    from app.pipeline.sources import known_title

    if given and (known := known_title(given)):
        return known
    printed = _printed_title(pdf_path)
    words = printed.split()
    if 2 <= len(words) <= 40 and (not grobid_title or _comparable(grobid_title) in _comparable(printed)):
        return printed
    return grobid_title


def _findable(citation: dict) -> bool:
    """A reference with no title, id, or URL is a lookup that cannot succeed. Drop it counted."""
    return bool(citation["title"] or citation["doi"] or citation["arxiv"] or citation["url"])


def _findable_references(tei) -> tuple[list[dict], int]:
    parsed = [_parse_reference(ref) for ref in tei.iter(TEI_TAG + "biblStruct")]
    findable = [citation for citation in parsed if _findable(citation)]
    return findable, len(parsed) - len(findable)


def extract_citations(pdf_path: str) -> dict:
    """Extract the bibliography (cited works) from a research paper PDF with GROBID.

    Args:
        pdf_path: a local PDF path, or a DOI, arXiv ID, PMID, or URL to download,
            for example "data/papers/colbertv2.pdf" or "2112.01488".
    """
    try:
        pdf_path = local_pdf(pdf_path)
        tei = _grobid_pdf("processReferences", pdf_path)
        citations, dropped = _findable_references(tei)
        return {
            "status": "ok",
            "file": pdf_path,
            "count": len(citations),
            "dropped": dropped,
            "citations": citations,
        }
    except Exception as error:
        return {"status": "error", "message": str(error)}


# --- Claims linked to the references they cite ----------------------------------


# An author-year citation as printed: "Ren et al., 2021b", "Gao and Callan, 2021", "Lee et al. (2021b)".
AUTHOR_YEAR = re.compile(
    r"([A-Z][\w'\-]+)(?:\s+(?:and|&)\s+([A-Z][\w'\-]+))?(\s+et\s+al\.?)?[,\s]*\(?((?:19|20)\d\d)([a-z]?)\)?"
)


def _plain(text: str) -> str:
    """Lower case without accents, so "Stéphane" and "Stephane" compare equal."""
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def _link_author_year_citations(tei) -> int:
    """Give a target to author-year citations GROBID could not link to the reference list.

    GROBID tags "(Ren et al., 2021b)" as a citation but, when it cannot match it, leaves out
    the target, and then the claim looks like it cites nothing. We match the first author's
    surname and the year ourselves. A letter after the year ("2021a", "2021b") picks between
    works by the same first author in the same year: the reference whose text carries that
    year and letter, or else the one at that place in the list. An unclear match stays
    unlinked. Returns how many citations were linked.
    """
    body = tei.find(".//tei:body", TEI_NAMESPACE)
    if body is None:
        return 0
    entries = []  # (id, author surnames, full text of the entry, year from its date)
    for bibl in tei.iter(TEI_TAG + "biblStruct"):
        ref_id = bibl.get(XML_ID)
        names = bibl.findall(".//tei:author//tei:surname", TEI_NAMESPACE)
        surnames = [_plain(name.text) for name in names if name.text]
        if not ref_id or not surnames:
            continue
        date = bibl.find(".//tei:date[@when]", TEI_NAMESPACE)
        entries.append((ref_id, surnames, " ".join(bibl.itertext()),
                        date.get("when", "")[:4] if date is not None else ""))

    linked = 0
    for ref in body.iter(TEI_TAG + "ref"):
        if ref.get("type") != "bibr" or ref.get("target"):
            continue
        found = AUTHOR_YEAR.search("".join(ref.itertext()))
        if not found:
            continue
        name, second, et_al, year, letter = found.groups()
        name = _plain(name)
        candidates = [
            e for e in entries if e[1][0] == name and (e[3] == year or re.search(rf"\b{year}", e[2]))
        ]
        # "Gao and Callan" has exactly two authors with Callan second; "Gao et al." has three or more.
        if len(candidates) > 1 and not letter:
            if second:
                candidates = [e for e in candidates if len(e[1]) == 2 and e[1][1] == _plain(second)]
            elif et_al:
                candidates = [e for e in candidates if len(e[1]) >= 3]
        chosen = None
        if letter:
            exact = [e for e in candidates if re.search(rf"\b{year}{letter}\b", e[2])]
            index = ord(letter) - ord("a")
            if len(exact) == 1:
                chosen = exact[0]
            elif len(candidates) > index:
                chosen = candidates[index]
        elif len(candidates) == 1:
            chosen = candidates[0]
        if chosen:
            ref.set("target", "#" + chosen[0])
            linked += 1
    return linked


def _references_by_id(tei) -> tuple[dict, int]:
    """({"b12": parsed reference, ...}, how many were dropped) from the TEI bibliography.

    Each reference also gets `ref`, its id, and `label`, the number the paper prints for
    it ("13"), so a reader can find it in the PDF. GROBID's ids start at b0 and are not
    those numbers.
    """
    labels = _printed_labels(tei)
    references, dropped = {}, 0
    for bibl in tei.iter(TEI_TAG + "biblStruct"):
        ref_id = bibl.get(XML_ID)
        if not ref_id:
            continue
        citation = _parse_reference(bibl)
        if _findable(citation):
            references[ref_id] = {**citation, "ref": ref_id, "label": labels.get(ref_id, "")}
        else:
            dropped += 1
    return references, dropped


def _marker_text(ref) -> str:
    """A citation marker as printed, without the punctuation of a list: "[5," is "5"."""
    return "".join(ref.itertext()).strip().strip("[](),;").strip()


def _printed_labels(tei) -> dict[str, str]:
    """{"b12": "13", ...}: how the paper's body cites each reference.

    GROBID's bibliography has no label, so we read the markers in the body. The same
    reference can be printed a little differently ("5," and "[5]"), so the most common
    form wins.
    """
    body = tei.find(".//tei:body", TEI_NAMESPACE)
    if body is None:
        return {}
    seen: dict[str, Counter] = {}
    for ref in body.iter(TEI_TAG + "ref"):
        ref_id = (ref.get("target") or "").lstrip("#")
        text = _marker_text(ref)
        if ref.get("type") == "bibr" and ref_id and text:
            seen.setdefault(ref_id, Counter())[text] += 1
    return {ref_id: counts.most_common(1)[0][0] for ref_id, counts in seen.items()}


def _boxes(coords: str) -> list[dict]:
    """GROBID's "page,x,y,width,height;..." as boxes in PDF points, top-left origin.

    A marker that breaks across two lines has two boxes.
    """
    boxes = []
    for part in (coords or "").split(";"):
        values = part.split(",")
        if len(values) != 5:
            continue
        page, x, y, width, height = values
        x0, y0 = float(x), float(y)
        boxes.append({"page": int(float(page)), "x0": x0, "y0": y0,
                      "x1": x0 + float(width), "y1": y0 + float(height)})
    return boxes


def _page_sizes(tei) -> dict[int, tuple[float, float]]:
    """{page number: (width, height)} in PDF points, from GROBID's <surface> elements."""
    sizes = {}
    for surface in tei.iter(TEI_TAG + "surface"):
        try:
            sizes[int(surface.get("n"))] = (float(surface.get("lrx")), float(surface.get("lry")))
        except (TypeError, ValueError):
            continue
    return sizes


def _citation_markers(tei, references: dict) -> list[dict]:
    """Where each citation marker ("[13]") is on its page, and which reference it points to.

    Only markers of references we kept. The web app draws a click area on each box and
    scales it by the page size.
    """
    body = tei.find(".//tei:body", TEI_NAMESPACE)
    if body is None:
        return []
    sizes = _page_sizes(tei)
    markers = []
    for ref in body.iter(TEI_TAG + "ref"):
        ref_id = (ref.get("target") or "").lstrip("#")
        if ref.get("type") != "bibr" or ref_id not in references:
            continue
        text = _marker_text(ref)
        for box in _boxes(ref.get("coords", "")):
            if box["page"] not in sizes:
                continue
            width, height = sizes[box["page"]]
            markers.append({"ref": ref_id, "text": text, **box,
                            "page_width": width, "page_height": height})
    return markers


def _outline(tei, pdf_path: str | None = None) -> list[dict]:
    """The paper's numbered sections in document order, each with where its heading is:
    {"n": "3.1", "title": "Architecture", "page": 4, "y": 158.93, "boxes": [...]}.

    GROBID gives a section heading as <head n="3.1"> directly inside a <div> of the body. A head
    without a number is a figure caption or a stray fragment, and is left out; so is a heading
    GROBID gave no position (it needs `head` in teiCoordinates). GROBID can drop the letters of
    a ligature ("ery & Document Encoders"), so when the PDF can be read, each title is read back
    from its box on the page (#152).
    """
    body = tei.find(".//tei:body", TEI_NAMESPACE)
    if body is None:
        return []
    headings = []
    for div in body.iter(TEI_TAG + "div"):
        head = div.find("tei:head", TEI_NAMESPACE)
        number = (head.get("n") or "").strip() if head is not None else ""
        boxes = _boxes(head.get("coords", "")) if number else []
        if not boxes:
            continue
        title = " ".join("".join(head.itertext()).split())
        headings.append({"n": number, "title": title, "page": boxes[0]["page"], "y": round(boxes[0]["y0"], 2),
                         "boxes": boxes})
    if pdf_path:
        _read_titles_back(headings, pdf_path)
        if headings and not any(heading["n"].split(".")[0] == "1" for heading in headings):
            headings[:0] = _first_section_from_pdf(headings[0], pdf_path)
    return headings


def _first_section_from_pdf(first: dict, pdf_path: str) -> list[dict]:
    """GROBID can miss the first heading ("1 INTRODUCTION" in ColBERT, SIGIR 2020), which leaves
    every claim before section 2 without a section. Look for it on the page: a line before the
    first heading GROBID found, set in the same font and size, that reads "1 <title>"."""
    import pymupdf

    try:
        document = pymupdf.open(pdf_path)
    except Exception:
        return []
    with document:
        if not 1 <= first["page"] <= document.page_count:
            return []

        def spans(page_number: int) -> list[dict]:
            page = document[page_number - 1]
            return [
                span
                for block in page.get_text("dict")["blocks"]
                for line in block.get("lines", [])
                if line["dir"] == (1.0, 0.0)
                for span in line["spans"]
                if span["text"].strip()
            ]

        box = first["boxes"][0]
        style = next(
            (
                (span["font"], span["size"])
                for span in spans(first["page"])
                if abs(span["bbox"][1] - box["y0"]) < 3 and span["bbox"][0] <= box["x1"]
            ),
            None,
        )
        if style is None:
            return []
        for page_number in range(1, first["page"] + 1):
            rows: dict[int, list[dict]] = {}
            for span in spans(page_number):
                if span["font"] == style[0] and abs(span["size"] - style[1]) < 0.3:
                    rows.setdefault(round(span["bbox"][1]), []).append(span)
            for y, row in sorted(rows.items()):
                if page_number == first["page"] and y >= box["y0"] - 1:
                    break
                row = sorted(row, key=lambda span: span["bbox"][0])
                text = " ".join(" ".join(span["text"] for span in row).split())
                if found := re.fullmatch(r"1\.?\s+([A-Z][^.]{2,60})", text):
                    (left, top, _, _), (_, _, right, bottom) = row[0]["bbox"], row[-1]["bbox"]
                    box = {"page": page_number, "x0": left, "y0": top, "x1": right, "y1": bottom}
                    heading = {"n": "1", "title": found.group(1), "page": page_number, "y": round(top, 2)}
                    return [{**heading, "boxes": [box]}]
        return []


def _read_titles_back(headings: list[dict], pdf_path: str) -> None:
    """Replace each GROBID title with the text printed in its box, when that text contains
    GROBID's: "ery & Document Encoders" becomes "Query & Document Encoders". A heading whose box
    reads as something else keeps GROBID's title."""
    import pymupdf

    try:
        document = pymupdf.open(pdf_path)
    except Exception:
        return
    with document:
        for heading in headings:
            on_page = [box for box in heading["boxes"] if box["page"] == heading["page"]]
            if not 1 <= heading["page"] <= document.page_count:
                continue
            area = pymupdf.Rect(
                min(b["x0"] for b in on_page) - 2, min(b["y0"] for b in on_page) - 1,
                max(b["x1"] for b in on_page) + 2, max(b["y1"] for b in on_page) + 1,
            )
            text = document[heading["page"] - 1].get_textbox(area)
            printed = " ".join(unicodedata.normalize("NFKC", text).split())
            printed = re.sub(rf"^{re.escape(heading['n'])}\.?\s+", "", printed)
            fits = len(printed) <= 2 * len(heading["title"]) + 10
            if printed and fits and _comparable(heading["title"]) in _comparable(printed):
                heading["title"] = printed


def _reading_position(page: int, x: float, y: float, page_width: float) -> tuple[int, int, float]:
    """(page, column, y): the order a reader meets text in, on one- and two-column pages alike.
    Text starting in the right half of the page is in the second column."""
    return page, int(bool(page_width) and x >= page_width / 2), y


def _section_of(source: dict | None, headings: list[dict], sizes: dict[int, tuple[float, float]]) -> str:
    """The number of the section a claim's sentence is in: the last heading at or before where
    the sentence starts, in reading order. Empty when the sentence was not found in the PDF, or
    when it comes before the first heading."""
    if not source or not source.get("boxes"):
        return ""
    width = source.get("page_width") or sizes.get(source["page"], (0, 0))[0]
    start = min(_reading_position(source["page"], box["x0"], box["y0"], width) for box in source["boxes"])
    before = [
        (_reading_position(h["page"], h["boxes"][0]["x0"], h["y"], sizes.get(h["page"], (0, 0))[0]), h["n"])
        for h in headings
    ]
    earlier = [entry for entry in before if entry[0] <= start]
    return max(earlier)[1] if earlier else ""


def _paragraph_text(paragraph) -> str:
    """Paragraph text with each citation <ref target="#b12"> rendered as [b12]."""
    parts = [paragraph.text or ""]
    for child in paragraph:
        if child.tag == TEI_TAG + "ref" and child.get("type") == "bibr" and child.get("target"):
            parts.append("[" + child.get("target").lstrip("#") + "]")
        else:
            parts.append("".join(child.itertext()))
        parts.append(child.tail or "")
    return "".join(parts)


def _body_text(tei) -> str:
    body = tei.find(".//tei:body", TEI_NAMESPACE)
    if body is None:
        return ""
    return "\n\n".join(_paragraph_text(p) for p in body.iter(TEI_TAG + "p"))


MARKER = re.compile(r"\[(b\d+)\]")
SENTENCE_MATCH = 0.6  # loose: the model paraphrases whitespace and drops the markers


def _cited_sentences(paper_text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", paper_text) if MARKER.search(s)]


def _citing_windows(paper_text: str) -> list[str]:
    """Windows built only from paragraphs that cite something.

    Asked over the whole paper, the model picks citing sentences at the rate they occur,
    which is rare. Restricting its input means every sentence it can pick cites, and a
    four-window paper takes one.
    """
    citing = [p for p in paper_text.split("\n\n") if MARKER.search(p)]
    return _windows("\n\n".join(citing)) if citing else []


def _markers_for(claim: str, sentence: str, cited: list[str]) -> list[str]:
    """The [bN] markers this claim belongs to.

    Taken from the claim if the model kept them. Otherwise recovered from the paper's own
    copy of the sentence: the text is the source we trust, the model's output only points at it.
    """
    from difflib import SequenceMatcher

    if found := list(dict.fromkeys(MARKER.findall(claim))):
        return found
    if not sentence or not cited:
        return []
    wanted = MARKER.sub("", sentence).lower()
    best = max(cited, key=lambda c: SequenceMatcher(None, wanted, MARKER.sub("", c).lower()).ratio())
    ratio = SequenceMatcher(None, wanted, MARKER.sub("", best).lower()).ratio()
    return list(dict.fromkeys(MARKER.findall(best))) if ratio >= SENTENCE_MATCH else []


def _build_cited_claim_extractor():
    import dspy

    from app.llm import dspy_lm

    language_model = dspy_lm()

    class CitedClaim(pydantic.BaseModel):
        claim: str = Field(description="One sentence, keeping its [bN] markers")
        sentence: str = Field(description="The sentence from the paper, copied word for word")

    class ExtractCitedClaims(dspy.Signature):
        """Extract the paper's main factual claims that cite other work.
        Copy each claim's citation markers (like [b12]) into the claim verbatim, and copy the
        paper's own sentence exactly as written so it can be found in the original."""

        paper: str = dspy.InputField(desc="Paper text; [b12]-style markers point at cited references")
        claims: list[CitedClaim] = dspy.OutputField(
            desc="3-6 claims from this part, with the sentence each came from"
        )

    extract = dspy.ChainOfThought(ExtractCitedClaims)

    def run(paper_text: str) -> list:
        with dspy.context(lm=language_model, adapter=dspy.JSONAdapter()):
            return extract(paper=paper_text).claims

    return run


def _cited_claim(extracted, references: dict, cited: list[str], pdf_path: str) -> dict:
    raw_claim, sentence = extracted.claim, extracted.sentence
    marker_ids = _markers_for(raw_claim, sentence, cited)
    source = locate(pdf_path, re.sub(r"\s*\[b\d+\]", "", sentence).strip()) if sentence else None
    return {
        "claim": re.sub(r"\s*\[b\d+\]", "", raw_claim).strip(),
        "citations": [references[i] for i in marker_ids if i in references],
        "sentence": sentence,
        "source": source,  # None when the sentence could not be found in the PDF
    }


def _provenance(claim: dict) -> tuple[int, int]:
    """How far a claim can be followed: to where it came from first, then to its page."""
    return len(claim["citations"]), int(bool(claim["source"]))


NUMBER = re.compile(r"\d+(?:\.\d+)?")
ABOUT_ITSELF = re.compile(
    r"^\W*(this|the present|our)\s+(paper|work|study|article|survey|section)\s+"
    r"(also\s+|further\s+)?(explores?|examines?|investigates?|describes?|discusses?|presents?"
    r"|introduces?|reviews?|surveys?|outlines?|addresses|focuses|aims?|seeks?)\b",
    re.I,
)


def _asserts_nothing(claim: str) -> bool:
    """ "This paper explores X" cannot be true or false against a cited work.

    The rule is deliberately narrow: a wrong drop is a claim nobody ever sees.
    """
    return bool(ABOUT_ITSELF.match(claim))


def _same_assertion(one: str, other: str) -> bool:
    """Whether two normalised claims say the same thing in different words.

    Numbers must agree first: "improves by 5%" vs "15%" is a different claim in a
    near-identical string.
    """
    from difflib import SequenceMatcher

    if NUMBER.findall(one) != NUMBER.findall(other):
        return False
    return SequenceMatcher(None, one.split(), other.split()).ratio() >= NEAR_DUPLICATE


def _deduplicated(claims: list[dict]) -> list[dict]:
    """Remove repeated claims and keep the paper's order.

    When a claim appears twice, keep the copy with more source information: first the one
    with cited works, then the one we could find in the PDF.
    """
    kept: list[dict] = []
    keys: list[str] = []
    for claim in claims:
        key = _normalised_claim(claim["claim"])
        same = next((i for i, seen in enumerate(keys) if _same_assertion(key, seen)), None)
        if same is None:
            kept.append(claim)
            keys.append(key)
        elif _provenance(claim) > _provenance(kept[same]):
            kept[same], keys[same] = claim, key
    return kept


def _most_checkable(claims: list[dict], limit: int) -> list[dict]:
    """At most `limit` claims, ranked by source information, restored to the paper's order.

    CLAIM_LIMIT=0 keeps everything (what the benchmark wants).
    """
    if limit <= 0 or len(claims) <= limit:
        return claims
    ranked = sorted(range(len(claims)), key=lambda index: _provenance(claims[index]), reverse=True)
    return [claims[index] for index in sorted(ranked[:limit])]


def extract_claims_with_citations(pdf_path: str) -> dict:
    """Extract the main claims from a research paper PDF, each linked to the references it cites.

    Args:
        pdf_path: a local PDF path, or a DOI, arXiv ID, PMID, or URL to download,
            for example "data/papers/colbertv2.pdf" or "2112.01488".
    """
    global _cited_claim_extractor
    given = pdf_path
    try:
        pdf_path = local_pdf(pdf_path)
        tei = _grobid_pdf("processFulltextDocument", pdf_path, coordinates=("ref", "head"))
        _link_author_year_citations(tei)
        references, dropped = _references_by_id(tei)
        markers = _citation_markers(tei, references)
        paper_text = _body_text(tei)
        if _cited_claim_extractor is None:
            _cited_claim_extractor = _build_cited_claim_extractor()

        # Markers are matched against the whole paper, not the window a claim came from.
        cited = _cited_sentences(paper_text)
        windows = _citing_windows(paper_text)  # a paper that cites nothing has no windows
        with ThreadPoolExecutor(max_workers=EXTRACT_WORKERS) as pool:
            per_window = list(pool.map(_cited_claim_extractor, windows))
        found = [
            _cited_claim(extracted, references, cited, pdf_path)
            for window_claims in per_window
            for extracted in window_claims
        ]
        claims = _most_checkable(
            _deduplicated([claim for claim in found if not _asserts_nothing(claim["claim"])]), CLAIM_LIMIT
        )
        header = _paper_header(tei)
        header["title"] = paper_title(pdf_path, header["title"], given)
        headings, sizes = _outline(tei, pdf_path), _page_sizes(tei)
        for claim in claims:
            if section := _section_of(claim["source"], headings, sizes):
                claim["section"] = section
        return {
            "status": "ok",
            "file": pdf_path,
            **header,
            "claims": claims,
            # The numbered sections and where their headings are, for a table of contents.
            "outline": [{key: heading[key] for key in ("n", "title", "page", "y")} for heading in headings],
            "extracted": len(found),  # before repeats, announcements and the cap
            "dropped": dropped,
            "windows": len(windows),
            # Every kept reference by id, and where the paper cites it, for the page viewer.
            "references": {ref_id: references[ref_id] for ref_id in {m["ref"] for m in markers}},
            "markers": markers,
        }
    except Exception as error:
        return {"status": "error", "message": str(error)}
