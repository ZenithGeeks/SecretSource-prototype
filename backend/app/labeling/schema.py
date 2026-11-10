"""The three tabs the labeling page writes, and the rules a saved row must follow.

Rows are only ever appended. A later row for the same key replaces an earlier one when the page
reads the tab back (`current`), so nobody overwrites anybody and the table keeps its history.
Every tab starts with `ts` and `annotator`, which the server fills in: the browser never says
who it is. `annotator` is the person's name as it was when the row was written, for people to
read; `annotator_id` is their account, which is what tells one person's rows from another's, so
renaming an account or two people sharing a name changes nothing.
"""

from typing import Literal, get_args

from pydantic import BaseModel, Field

TABS: dict[str, list[str]] = {
    # One row per claim a person judged: kept as extracted, edited, rejected, or added by hand.
    "claims": [
        "ts",
        "annotator",
        "annotator_id",
        "paper_id",
        "claim_id",
        "origin",
        "status",
        "claim",
        "claim_edited",
        "sentence",
        "page",
        "section",
        "ai_reviewed",  # "1" once the person ran the AI review on this claim
    ],
    # One row per retrieved passage (or hand-picked one) a person judged.
    "candidates": [
        "ts",
        "annotator",
        "annotator_id",
        "paper_id",
        "claim_id",
        "reference_id",
        "cand_id",
        "origin",
        "status",
        "rank",
        "score",
        "page",
        "passage",
        "ai_reviewed",  # "1" once the person ran the AI review on this claim
    ],
    # One row per (claim, reference paper): the 1-4 label. Same columns as evidence_labels.csv
    # (minus the paper text, which would not fit a cell, and the split, which split_dataset.py
    # adds) plus the reference paper.
    "labels": [
        "ts",
        "annotator",
        "annotator_id",
        "paper_id",
        "claim_id",
        "reference_id",
        "claim",
        "evidence",
        "rationale",
        "spans",
        "confidence",
        "ai_reviewed",  # "1" once the person ran the AI review on this claim
    ],
}

# Who labels which topic, and which analyses are shared with the labeling team. Not in TABS: its
# rows have no paper_id, and the labeling flow reads every tab in TABS per paper. `doi` is set
# for a paper whose PDF was uploaded by hand: its analysis only knows the file. `venue_rank`
# ("Q1", "A*", "unranked") and `venue_rank_source` ("CiteScore 2025", "CORE 2026") are the rank of
# the paper's venue when it was listed, empty when it could not be looked up (SCRUM-445).
ASSIGNMENTS = ["ts", "annotator", "kind", "key", "topic", "owner", "doi", "venue_rank", "venue_rank_source"]
# One row per AI review of a saved claim, with what it said (JSON). Not in TABS: the page never
# shows it again; it is there so an eval can see which labels the AI may have swayed.
REVIEWS = ["ts", "annotator", "annotator_id", "paper_id", "claim_id", "findings"]
ALL_TABS = {**TABS, "assignments": ASSIGNMENTS, "reviews": REVIEWS}

# What makes two rows "the same" for the purpose of replacing one with a later one.
KEYS: dict[str, tuple[str, ...]] = {
    "claims": ("claim_id", "annotator_id"),
    "candidates": ("cand_id", "annotator_id"),
    "labels": ("claim_id", "reference_id", "annotator_id"),
    "assignments": ("kind", "key"),  # kind: "person" (key: name) or "paper" (key: analysis id)
}

Topic = Literal["CV", "NLP", "SE", "HPC", ""]  # "" takes the topic back
# A venue's rank: a journal's CiteScore quartile or a conference's CORE rank (scopus.venue_rank).
VenueRank = Literal["Q1", "Q2", "Q3", "Q4", "A*", "A", "B", "C", "unranked"]
TOPICS = [t for t in get_args(Topic) if t]


class TopicIn(BaseModel):
    topic: Topic


class ScopusAddIn(BaseModel):
    doi: str = Field(pattern=r"^10\.\d{4,9}/\S+$", max_length=200)
    topic: Literal["CV", "NLP", "SE", "HPC"]


class UploadShareIn(BaseModel):
    """An uploaded paper to list: its topic ("" with `replaces`, which gives it), its DOI or
    paper link when known, and the failed paper of yours it takes the place of."""

    topic: Topic = ""
    doi: str = Field("", max_length=300)
    replaces: str = Field("", max_length=64)


class PersonTopicIn(TopicIn):
    name: str = Field(min_length=1, max_length=80)


class BlindCheckIn(BaseModel):
    """A lead giving `name` the paper `analysis_id` to label blind, or taking it back."""

    name: str = Field(min_length=1, max_length=80)
    analysis_id: str = Field(min_length=1, max_length=80)
    on: bool = True


CLAIM_ID = r"^(?:[A-Za-z0-9._-]+#\d{1,4}|[A-Za-z0-9._-]+#h-[a-z0-9]{6,12})$"
TEXT = 4000  # keeps one row small; nothing a person types needs more


class ClaimIn(BaseModel):
    claim_id: str = Field(pattern=CLAIM_ID)
    origin: Literal["extracted", "human_added"]
    status: Literal["accepted", "edited", "rejected"]
    claim: str = Field(max_length=TEXT)  # the text as extracted, or as typed for a human_added claim
    claim_edited: str = Field(default="", max_length=TEXT)
    sentence: str = Field(default="", max_length=TEXT)
    page: int | None = None
    section: str = Field(default="", max_length=40)


class CandidateIn(BaseModel):
    claim_id: str = Field(pattern=CLAIM_ID)
    reference_id: str = Field(max_length=200)
    # retrieved: found by the analysis, for an extracted claim. retrieved_added: found by the live
    # search for a claim added by hand. human_added: a passage the person selected.
    origin: Literal["retrieved", "retrieved_added", "human_added"]
    status: Literal["relevant", "rejected"]
    # A retrieved row sends only cand_id: save copies the rest from the analysis. The other two
    # send the passage itself, and save builds their cand_id from it.
    cand_id: str = Field(default="", max_length=20)
    rank: int | None = Field(default=None, ge=1, le=50)  # retrieved_added only
    score: float | None = None  # retrieved_added only
    page: int | None = None
    passage: str = Field(default="", max_length=TEXT)


class AddedClaimIn(BaseModel):
    """A claim added by hand, to search the reference papers for."""

    claim_id: str = Field(pattern=CLAIM_ID)
    claim: str = Field(min_length=1, max_length=TEXT)


class LabelIn(BaseModel):
    claim_id: str = Field(pattern=CLAIM_ID)
    reference_id: str = Field(max_length=200)
    evidence: int = Field(ge=1, le=4)
    rationale: str = Field(default="", max_length=2000)
    spans: list[str] = Field(default_factory=list, max_length=10)
    # "" is a level the labeler saved before choosing how sure they were. Leaving the field out
    # still stores "medium", which is what a client from before unset confidence sent.
    confidence: Literal["low", "medium", "high", ""] = "medium"


class ReviewIn(BaseModel):
    claim_id: str = Field(pattern=CLAIM_ID)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    reference_id: str = Field(default="", max_length=200)  # "" asks the paper under review
    # Asking about one passage of that reference: the answer reads only it, with the claim (as
    # worded on screen) for context.
    passage: str = Field(default="", max_length=4000)
    claim: str = Field(default="", max_length=2000)


class SaveIn(BaseModel):
    claims: list[ClaimIn] = Field(default_factory=list, max_length=300)
    candidates: list[CandidateIn] = Field(default_factory=list, max_length=600)
    labels: list[LabelIn] = Field(default_factory=list, max_length=300)


def current(tab: str, rows: list[dict]) -> list[dict]:
    """The latest row for each key, in the order each key first appeared.

    A row saved before rows carried `annotator_id` gets its `annotator` name as the id, which is
    what the id was when login was off.
    """
    latest: dict[tuple, dict] = {}
    for row in rows:
        if "annotator_id" in KEYS[tab] and not row.get("annotator_id"):
            row = {**row, "annotator_id": row.get("annotator", "")}
        latest[tuple(row.get(k, "") for k in KEYS[tab])] = row
    return list(latest.values())
