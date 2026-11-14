"""What an analysis claims about itself, checked before a reader sees it.

No model is asked whether the model was right. The key check is the quote: the judge is
told to quote the sentence from the evidence that decides the verdict. Nothing else
checks that sentence was ever in the evidence. A made-up quote reaches the UI looking
exactly like a copied one.

Findings are reported, never applied. A flagged verdict is a signal about the judge.
What to do about it is a separate decision from noticing it.
"""

from app.config import CLAIM_LIMIT
from app.pipeline.claims import _tokens  # the folding claim extraction already uses
from app.pipeline.verify import LABELS

# How much of a quote must stay in a passage before it counts as taken from it.
# An exact match is the usual case. The ratio catches a quote put together from two
# lines or cut off mid-sentence, without failing a verdict over a dropped word.
QUOTE_OVERLAP = 0.6


def _contains(passage: list[str], quote: list[str]) -> bool:
    """Is the quote a run of words inside the passage, once both are turned into tokens?"""
    if not quote or len(quote) > len(passage):
        return False
    first = quote[0]
    return any(
        passage[start : start + len(quote)] == quote
        for start, token in enumerate(passage)
        if token == first
    )


def _overlap(passage: list[str], quote: list[str]) -> float:
    """The share of the quote's words the passage has, ignoring order."""
    if not quote:
        return 0.0
    remaining = list(passage)
    found = 0
    for token in quote:
        if token in remaining:
            remaining.remove(token)
            found += 1
    return found / len(quote)


def _grounded(quote: str, verdict: dict) -> bool:
    """Was this quote in what the judge was given: a passage, or a figure's caption?"""
    quote_tokens = _tokens(quote)
    if not quote_tokens:
        return True  # nothing to check here. The empty-quote checks cover that case
    sources = [item.get("text", "") for item in verdict.get("evidence", [])]
    sources += [hit.get("caption", "") for hit in verdict.get("pages", [])]
    passages = [_tokens(text) for text in sources if text]
    return any(_contains(passage, quote_tokens) for passage in passages) or any(
        _overlap(passage, quote_tokens) >= QUOTE_OVERLAP for passage in passages
    )


def check_verdict(verdict: dict) -> list[dict]:
    """The findings on one verdict alone: its label, and whether its quote is in its evidence.

    Each finding has a `check` and a `detail`. A draft check runs this on every citation;
    audit() runs it on every verdict of an analysis.
    """
    label, quote = verdict.get("verdict"), verdict.get("quote", "")
    findings = []
    if label not in LABELS:
        findings.append(
            {"check": "unknown-verdict", "detail": f"verdict {label!r} is not one of {sorted(LABELS)}"}
        )
    if label in ("supports", "refutes") and not quote.strip():
        findings.append({"check": "decided-without-quote", "detail": f"{label} with no quote to stand on"})
    elif quote.strip() and not _grounded(quote, verdict):
        findings.append(
            {
                "check": "quote-not-in-evidence",
                "detail": f"quote is not in the passages the judge was given: {quote[:120]!r}",
            }
        )
    return findings


def audit(analysis: dict) -> list[dict]:
    """Every way this analysis disagrees with itself. No ordering: the caller shows them
    all. An empty list is the usual result."""
    findings = []
    claims = analysis.get("claims", [])

    # An analysis started for the labeler keeps every claim (claim_limit 0).
    limit = analysis.get("claim_limit", CLAIM_LIMIT)
    if limit and len(claims) > limit:
        findings.append(
            {"check": "claim-limit", "claim": None, "source": None,
             "detail": f"{len(claims)} claims kept, over the limit of {limit}"}
        )

    for index, claim in enumerate(claims):
        verdicts = claim.get("verdicts", [])
        unchecked = claim.get("unchecked", [])

        checked_sources = {verdict.get("cited") for verdict in verdicts}
        for entry in unchecked:
            if not entry.get("reason"):
                findings.append(
                    {"check": "unchecked-without-reason", "claim": index,
                     "source": entry.get("source"), "detail": "no reason code"}
                )
            if entry.get("source") in checked_sources:
                findings.append(
                    {"check": "checked-and-unchecked", "claim": index,
                     "source": entry.get("source"),
                     "detail": "the same source carries a verdict and an unchecked entry"}
                )

        for verdict in verdicts:
            source = verdict.get("cited")
            findings += [{"claim": index, "source": source, **found} for found in check_verdict(verdict)]

    return findings
