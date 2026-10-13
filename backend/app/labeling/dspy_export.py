"""The labels as examples for the two steps of a DSPy fact-check program:

    find    "article -> claims: list[str]"       one record per (paper, annotator)
    verify  "claim, source -> verdict"            one record per (claim, reference, annotator)

`verdict` is the 1-4 level a person gave: how well the source passages back the claim. Only what a
person kept counts: a rejected claim is listed apart (a hard negative for `find`) and its labels
are left out of `verify`, the same rule as the CSV export. Records keep `paper_id`, so a split
into train, validation and test can keep each paper whole.
"""

import json
from collections.abc import Callable

from app.config import PAPERS_DIR
from app.labeling.schema import current

LEVEL_NAMES = {1: "No support", 2: "Weak", 3: "Clear", 4: "Strong"}


def article_text(paper_id: str) -> str:
    """The text of a paper's PDF, or "" when the PDF is not on this server."""
    path = PAPERS_DIR / f"{paper_id}.pdf"
    if not path.is_file():
        return ""
    import fitz  # PyMuPDF

    with fitz.open(path) as pdf:
        return "\n\n".join(page.get_text() for page in pdf).strip()


def claims_examples(
    rows: dict[str, list[dict]], article_of: Callable[[str], str] | None = None
) -> list[dict]:
    """`find` examples. A paper whose text is unavailable is left out: an example needs its article."""
    article_of = article_of or article_text
    grouped: dict[tuple[str, str], dict] = {}
    for row in current("claims", rows["claims"]):
        group = grouped.setdefault(
            (row["paper_id"], row["annotator_id"]), {"annotator": "", "claims": [], "rejected": []}
        )
        group["annotator"] = row["annotator"]
        edited = row["status"] == "edited" and row["claim_edited"]
        text = row["claim_edited"] if edited else row["claim"]
        group["rejected" if row["status"] == "rejected" else "claims"].append(text)
    texts: dict[str, str] = {}
    examples = []
    for (paper_id, account), group in grouped.items():
        article = texts.setdefault(paper_id, article_of(paper_id))
        if article:
            examples.append({"paper_id": paper_id, "annotator_id": account, "article": article, **group})
    return examples


def verdict_examples(rows: dict[str, list[dict]]) -> list[dict]:
    """`verify` examples. A label with no passage called relevant has no source text, so it is left out."""
    rejected = {
        (row["claim_id"], row["annotator_id"])
        for row in current("claims", rows["claims"])
        if row["status"] == "rejected"
    }
    examples = []
    for row in current("labels", rows["labels"]):
        if (row["claim_id"], row["annotator_id"]) in rejected or row["evidence"] not in {"1", "2", "3", "4"}:
            continue
        try:
            spans = [s for s in json.loads(row["spans"] or "[]") if s]
        except ValueError:
            spans = []
        if not spans:
            continue
        level = int(row["evidence"])
        examples.append(
            {
                "paper_id": row["paper_id"],
                "claim_id": row["claim_id"],
                "reference_id": row["reference_id"],
                "annotator": row["annotator"],
                "annotator_id": row["annotator_id"],
                "claim": row["claim"],
                "source": "\n\n".join(spans),
                "verdict": str(level),
                "verdict_name": LEVEL_NAMES[level],
                "rationale": row["rationale"],
                "confidence": row["confidence"],
            }
        )
    return examples
