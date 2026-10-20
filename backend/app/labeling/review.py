"""A second look at one claim a person has labeled and saved: the Labeler's "Review this claim".

review() checks the saved rows by rule first, then shows the pipeline judge's reading of the
passages behind each level, and yields one Finding per thing worth pointing at. It never changes
a label or proposes one: the judge reads the whole claim, while a level grades only the part the
reference is cited for, and it agreed with 1 of 14 saved levels (20 Oct 2026). Saves after a review
are marked `ai_reviewed`, so an eval can keep labels the AI may have swayed apart.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from typing import Literal, NamedTuple

from pydantic import BaseModel

log = logging.getLogger(__name__)

# The LLM gateway takes at most 3 requests at once per key; leave one for everyone else.
_judges = ThreadPoolExecutor(max_workers=2, thread_name_prefix="labeling-review")
REASONING = 400  # characters of the judge's reasoning shown with a finding

# The levels each verdict agrees with (1 no support, 2 weak, 3 clear, 4 strong).
AGREEING: dict[str, set[str]] = {"supports": {"3", "4"}, "insufficient": {"1", "2"}, "refutes": {"1"}}
READS_AS = {
    "supports": "supporting the claim",
    "insufficient": "not settling the claim",
    "refutes": "contradicting the claim",
}


class Target(BaseModel):
    """The thing on the page a finding is about."""

    kind: Literal["claim", "passage", "reference"]
    id: str  # a claim_id, cand_id or reference_id


class Finding(BaseModel):
    target: Target
    tone: Literal["agrees", "flags", "asks"]
    text: str


class Saved(NamedTuple):
    """One person's current rows for one claim."""

    claim: dict
    candidates: list[dict]
    labels: list[dict]


async def review(claim: dict, saved: Saved) -> AsyncIterator[Finding]:
    """The findings for one saved claim: the rule checks at once, then each judge check as it ends.

    Args:
        claim: the claim as build_session gives it, with its retrieved candidates.
        saved: the person's saved rows for it.
    """
    for finding in rule_findings(claim, saved):
        yield finding
    if saved.claim.get("status") == "rejected":
        return
    text = saved.claim.get("claim_edited") or saved.claim.get("claim") or claim["claim"]
    loop = asyncio.get_running_loop()
    checks = [
        loop.run_in_executor(_judges, judge_finding, text, reference_id, passages, label)
        for reference_id, (passages, label) in _references(saved).items()
        if passages and label
    ]
    for finished in asyncio.as_completed(checks):
        yield await finished


def rule_findings(claim: dict, saved: Saved) -> list[Finding]:
    """What the saved rows themselves get wrong or leave out, with no model."""
    claim_target = Target(kind="claim", id=claim["claim_id"])
    status = saved.claim.get("status")
    if status == "rejected":
        text = "You rejected this claim, so its passages and levels are not checked."
        return [Finding(target=claim_target, tone="agrees", text=text)]
    found = []
    if status == "edited" and not saved.claim.get("claim_edited", "").strip():
        text = "The claim is marked edited, but the new wording is empty."
        found.append(Finding(target=claim_target, tone="flags", text=text))

    judged = {row["cand_id"] for row in saved.candidates}
    unjudged = [cand["cand_id"] for cand in claim["candidates"] if cand["cand_id"] not in judged]
    if unjudged:
        text = f"{len(unjudged)} passage{'s are' if len(unjudged) > 1 else ' is'} not judged yet."
        found.append(Finding(target=Target(kind="passage", id=unjudged[0]), tone="flags", text=text))

    for reference_id, (passages, label) in _references(saved).items():
        target = Target(kind="reference", id=reference_id)
        if passages and not label:
            text = "Passages here are marked relevant, but there is no level."
            found.append(Finding(target=target, tone="flags", text=text))
        elif label and not passages:
            text = "This reference has a level, but none of its passages is marked relevant."
            found.append(Finding(target=target, tone="flags", text=text))
        elif label and label.get("evidence") != "1" and not label.get("rationale", "").strip():
            text = f"Level {label.get('evidence')} has no reason written. Which sentence backs it?"
            found.append(Finding(target=target, tone="asks", text=text))
    return found


def judge_finding(claim_text: str, reference_id: str, passages: list[str], label: dict) -> Finding:
    """The judge's reading of the passages the person marked relevant, next to their level.

    A disagreement is a question, never a flag: the judge reads the whole claim, so a claim that
    cites several papers is "insufficient" from any one of them.
    """
    from app.pipeline import verify

    target = Target(kind="reference", id=reference_id)
    try:
        verdict = verify.judge_passages(claim_text, passages)
    except Exception:  # a down gateway must not end the review; the person checks it themselves
        log.exception("the judge failed on %s", reference_id)
        text = "The judge could not be reached, so check this level yourself."
        return Finding(target=target, tone="asks", text=text)
    level = label.get("evidence", "")
    reasoning = verdict.get("reasoning", "").strip()[:REASONING]
    reads_as = READS_AS[verdict["verdict"]]
    if level in AGREEING[verdict["verdict"]]:
        text = f"Level {level} fits: the judge also reads these passages as {reads_as}. {reasoning}"
        return Finding(target=target, tone="agrees", text=text.strip())
    text = (
        f"The judge reads these passages as {reads_as}, for the whole claim. Does level {level} "
        f"hold for the part this paper is cited for? {reasoning}"
    )
    return Finding(target=target, tone="asks", text=text.strip())


def _references(saved: Saved) -> dict[str, tuple[list[str], dict | None]]:
    """Each reference the person touched: the passages they marked relevant, and their label."""
    passages: dict[str, list[str]] = {}
    for row in saved.candidates:
        if row.get("status") == "relevant":
            passages.setdefault(row["reference_id"], []).append(row.get("passage", ""))
    labels = {row["reference_id"]: row for row in saved.labels}
    return {ref: (passages.get(ref, []), labels.get(ref)) for ref in sorted(passages.keys() | labels.keys())}
