"""Claim extraction: Docling reads the PDF, the LLM (via DSPy) extracts claims, GROBID
parses references. Each claim keeps the sentence it came from, located back in the PDF
(page and boxes) so the UI can show the place instead of telling the reader to go looking.
"""

import re
import xml.etree.ElementTree as ET

import pydantic
from pydantic import Field

from app.config import CLAIM_LIMIT, GROBID_URL
from app.pipeline.sources import local_pdf

TEI_NAMESPACE = {"tei": "http://www.tei-c.org/ns/1.0"}
TEI_TAG = "{http://www.tei-c.org/ns/1.0}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
MAX_CHARS = 12_000  # ~3k tokens per window, fits an 8k context with room for output
FRAGMENT_WORDS = (12, 8)  # fallback window sizes when a whole sentence will not match
NEAR_DUPLICATE = 0.8  # word-level ratio above which two claims are one assertion, reworded

_converter = None  # lazy: loading docling's models takes seconds
_claim_extractor = None  # lazy: needs dspy and a running LM
_cited_claim_extractor = None


def _windows(text: str, size: int = MAX_CHARS) -> list[str]:
    """The whole paper in model-sized pieces, split at paragraph breaks. Reading only the
    first piece would never reach the results section, where claims worth checking live."""
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


def _fragments(sentence: str) -> list[str]:
    """The whole sentence, then overlapping windows of its words, longest first."""
    words = sentence.split()
    fragments = [sentence]
    for size in FRAGMENT_WORDS:
        fragments += [" ".join(words[i : i + size]) for i in range(len(words) - size + 1)]
    return fragments


def _merge(rects: list) -> list[dict]:
    """Fold overlapping rectangles together, so one line is one box rather than a stack."""
    boxes: list[dict] = []
    for rect in sorted(rects, key=lambda r: (round(r.y0), r.x0)):
        same_line = next(
            (b for b in boxes if abs(b["y0"] - rect.y0) < 2 and rect.x0 <= b["x1"] + 2), None
        )
        if same_line:
            same_line["x1"] = max(same_line["x1"], rect.x1)
            same_line["y1"] = max(same_line["y1"], rect.y1)
        else:
            boxes.append({"x0": rect.x0, "y0": rect.y0, "x1": rect.x1, "y1": rect.y1})
    return boxes


def locate(pdf_path: str, sentence: str, page: int | None = None) -> dict | None:
    """Where a sentence sits in a PDF: 1-based page, boxes, and the page size to scale by.

    The sentence is what the model copied out of the paper, so it can differ from the PDF's
    own text (a dropped "(§3.3)", a ligature, a line break). Try the whole sentence, then
    word windows. Return nothing rather than a box that is nearly right — a wrong highlight
    is worse than none in a tool built for checking sources.
    """
    import pymupdf

    fragments = _fragments(sentence)
    with pymupdf.open(pdf_path) as document:
        numbers = [page] if page else range(1, document.page_count + 1)
        for number in numbers:
            if not 1 <= number <= document.page_count:
                return None
            found = document[number - 1]
            rects = [rect for fragment in fragments for rect in found.search_for(fragment)]
            if rects:
                return {
                    "page": number,
                    "boxes": _merge(rects),
                    "page_width": found.rect.width,  # PyMuPDF is top-left origin, like CSS
                    "page_height": found.rect.height,
                }
    return None


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
            e.g. "data/papers/colbertv2.pdf" or "2112.01488".
    """
    global _claim_extractor
    try:
        pdf_path = local_pdf(pdf_path)
        if _claim_extractor is None:
            _claim_extractor = _build_claim_extractor()
        windows = _windows(_pdf_to_text(pdf_path))
        # The abstract and the conclusion repeat each other across windows: keep first wording.
        claims: dict[str, str] = {}
        for window in windows:
            for claim in _claim_extractor(window):
                claims.setdefault(_normalised_claim(claim), claim)
        return {"status": "ok", "file": pdf_path,
                "claims": list(claims.values()), "windows": len(windows)}
    except Exception as error:
        return {"status": "error", "message": str(error)}


def _grobid_pdf(endpoint: str, pdf_path: str) -> ET.Element:
    import requests

    with open(pdf_path, "rb") as pdf_file:
        response = requests.post(f"{GROBID_URL}/api/{endpoint}", files={"input": pdf_file}, timeout=300)
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
NAME_TOKEN = re.compile(r"^[A-Z][A-Za-z'’-]*\.?$")


def _looks_like_authors(text: str) -> bool:
    """Whether this "title" is really an author list GROBID mis-parsed: two or more comma-
    or "and"-separated groups, each two or three name-shaped words."""
    groups = [group.split() for group in re.split(r",|\band\b", text) if group.strip()]
    return len(groups) >= 2 and all(
        2 <= len(group) <= 3 and all(NAME_TOKEN.match(word) for word in group) for group in groups
    )


YEAR_PREFIX = re.compile(r"^(?:19|20)\d{2}[a-z]?\.\s*")
AUTHORS_PREFIX = re.compile(r"^(?:[^.,]+,\s*)+(?:and\s+)?[^.,]+\.\s+")


def _without_the_authors(title: str) -> str:
    """Cut a leading author list and year off a loosely parsed title, so a title-only
    lookup can still match. Only a prefix that looks like authors is cut."""
    trimmed = YEAR_PREFIX.sub("", title).strip()
    prefix = AUTHORS_PREFIX.match(trimmed)
    if prefix and _looks_like_authors(prefix.group().rstrip(". ")):
        trimmed = trimmed[prefix.end():]
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
        # GROBID tags an arXiv id only sometimes; where it did not, the link often says so
        "arxiv": _identifier(reference, "arXiv").replace("arXiv:", "") or (in_url.group(1) if in_url else ""),
        "url": url,
    }


def _findable(citation: dict) -> bool:
    """A reference with no title, id, or URL is a lookup that cannot succeed; drop it counted."""
    return bool(citation["title"] or citation["doi"] or citation["arxiv"] or citation["url"])


def _findable_references(tei) -> tuple[list[dict], int]:
    parsed = [_parse_reference(ref) for ref in tei.iter(TEI_TAG + "biblStruct")]
    findable = [citation for citation in parsed if _findable(citation)]
    return findable, len(parsed) - len(findable)


def extract_citations(pdf_path: str) -> dict:
    """Extract the bibliography (cited works) from a research paper PDF via GROBID.

    Args:
        pdf_path: a local PDF path, or a DOI, arXiv ID, PMID, or URL to download,
            e.g. "data/papers/colbertv2.pdf" or "2112.01488".
    """
    try:
        pdf_path = local_pdf(pdf_path)
        tei = _grobid_pdf("processReferences", pdf_path)
        citations, dropped = _findable_references(tei)
        return {"status": "ok", "file": pdf_path, "count": len(citations),
                "dropped": dropped, "citations": citations}
    except Exception as error:
        return {"status": "error", "message": str(error)}


# --- Claims linked to the references they cite ----------------------------------


def _references_by_id(tei) -> tuple[dict, int]:
    """({"b12": parsed reference, ...}, how many were dropped) from the TEI bibliography."""
    references, dropped = {}, 0
    for bibl in tei.iter(TEI_TAG + "biblStruct"):
        ref_id = bibl.get(XML_ID)
        if not ref_id:
            continue
        citation = _parse_reference(bibl)
        if _findable(citation):
            references[ref_id] = citation
        else:
            dropped += 1
    return references, dropped


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
    """Windows built only from paragraphs that cite something. Asked over the whole paper,
    the model picks citing sentences at the rate they occur — rarely. Restricting its input
    means every sentence it can pick cites, and a four-window paper takes one."""
    citing = [p for p in paper_text.split("\n\n") if MARKER.search(p)]
    return _windows("\n\n".join(citing)) if citing else []


def _markers_for(claim: str, sentence: str, cited: list[str]) -> list[str]:
    """The [bN] markers this claim belongs to. Taken from the claim if the model kept them,
    otherwise recovered from the paper's own copy of the sentence — the text is the
    authority, the model's output only points at it."""
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
    """How far a claim can be followed: to its sources first, then to its page."""
    return len(claim["citations"]), int(bool(claim["source"]))


NUMBER = re.compile(r"\d+(?:\.\d+)?")
ABOUT_ITSELF = re.compile(
    r"^\W*(this|the present|our)\s+(paper|work|study|article|survey|section)\s+"
    r"(also\s+|further\s+)?(explores?|examines?|investigates?|describes?|discusses?|presents?"
    r"|introduces?|reviews?|surveys?|outlines?|addresses|focuses|aims?|seeks?)\b",
    re.I,
)


def _asserts_nothing(claim: str) -> bool:
    """"This paper explores X" cannot be true or false against a cited work. The rule is
    deliberately narrow: a wrong drop is a claim nobody ever sees."""
    return bool(ABOUT_ITSELF.match(claim))


def _same_assertion(one: str, other: str) -> bool:
    """Whether two normalised claims say the same thing in different words. Numbers must
    agree first: "improves by 5%" vs "15%" is a different claim in a near-identical string."""
    from difflib import SequenceMatcher

    if NUMBER.findall(one) != NUMBER.findall(other):
        return False
    return SequenceMatcher(None, one.split(), other.split()).ratio() >= NEAR_DUPLICATE


def _deduplicated(claims: list[dict]) -> list[dict]:
    """One entry per assertion, in the paper's order; a repeat keeps whichever copy carries
    the most provenance (cited works, then a located sentence)."""
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
    """At most `limit` claims, ranked by provenance, restored to the paper's order.
    CLAIM_LIMIT=0 keeps everything (what the benchmark wants)."""
    if limit <= 0 or len(claims) <= limit:
        return claims
    ranked = sorted(range(len(claims)), key=lambda i: _provenance(claims[i]), reverse=True)
    return [claims[i] for i in sorted(ranked[:limit])]


def extract_claims_with_citations(pdf_path: str) -> dict:
    """Extract the main claims from a research paper PDF, each linked to the references it cites.

    Args:
        pdf_path: a local PDF path, or a DOI, arXiv ID, PMID, or URL to download,
            e.g. "data/papers/colbertv2.pdf" or "2112.01488".
    """
    global _cited_claim_extractor
    try:
        pdf_path = local_pdf(pdf_path)
        tei = _grobid_pdf("processFulltextDocument", pdf_path)
        references, dropped = _references_by_id(tei)
        paper_text = _body_text(tei)
        if _cited_claim_extractor is None:
            _cited_claim_extractor = _build_cited_claim_extractor()

        # Markers are matched against the whole paper, not the window a claim came from.
        cited = _cited_sentences(paper_text)
        windows = _citing_windows(paper_text)  # a paper that cites nothing has no windows
        found = [
            _cited_claim(extracted, references, cited, pdf_path)
            for window in windows
            for extracted in _cited_claim_extractor(window)
        ]
        claims = _most_checkable(
            _deduplicated([c for c in found if not _asserts_nothing(c["claim"])]), CLAIM_LIMIT
        )
        return {"status": "ok", "file": pdf_path, "claims": claims,
                "extracted": len(found),  # before repeats, announcements and the cap
                "dropped": dropped, "windows": len(windows)}
    except Exception as error:
        return {"status": "error", "message": str(error)}
