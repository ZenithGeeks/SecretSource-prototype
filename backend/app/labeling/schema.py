"""The three tabs the labeling page writes, and the rules a saved row must follow.

Rows are only ever appended. A later row for the same key replaces an earlier one when the page
reads the tab back (`current`), so nobody overwrites anybody and the Sheet keeps its history.
Every tab starts with `ts` and `annotator`, which the server fills in: the browser never says
who it is.
"""

from typing import Literal, get_args

from pydantic import BaseModel, Field

TABS: dict[str, list[str]] = {
    # One row per claim a person judged: kept as extracted, edited, rejected, or added by hand.
    "claims": [
        "ts",
        "annotator",
        "paper_id",
        "claim_id",
        "origin",
        "status",
        "claim",
        "claim_edited",
        "sentence",
        "page",
        "section",
    ],
    # One row per retrieved passage (or hand-picked one) a person judged.
    "candidates": [
        "ts",
        "annotator",
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
    ],
    # One row per (claim, reference paper): the 1-4 label. Same columns as evidence_labels.csv
    # (minus the paper text, which would not fit a cell, and the split, which split_dataset.py
    # adds) plus the reference paper.
    "labels": [
        "ts",
        "annotator",
        "paper_id",
        "claim_id",
        "reference_id",
        "claim",
        "evidence",
        "rationale",
        "spans",
        "confidence",
    ],
}

# Who labels which topic, and which analyses are shared with the labeling team. Not in TABS: its
# rows have no paper_id, and the labeling flow reads every tab in TABS per paper.
ASSIGNMENTS = ["ts", "annotator", "kind", "key", "topic", "owner"]
ALL_TABS = {**TABS, "assignments": ASSIGNMENTS}

# What makes two rows "the same" for the purpose of replacing one with a later one.
KEYS: dict[str, tuple[str, ...]] = {
    "claims": ("claim_id", "annotator"),
    "candidates": ("cand_id", "annotator"),
    "labels": ("claim_id", "reference_id", "annotator"),
    "assignments": ("kind", "key"),  # kind: "person" (key: name) or "paper" (key: analysis id)
}

Topic = Literal["NLP", "HPC", "Software Engineering", ""]  # "" takes the topic back
TOPICS = [t for t in get_args(Topic) if t]


class TopicIn(BaseModel):
    topic: Topic


class PersonTopicIn(TopicIn):
    name: str = Field(min_length=1, max_length=80)


CLAIM_ID = r"^(?:[A-Za-z0-9._-]+#\d{1,4}|[A-Za-z0-9._-]+#h-[a-z0-9]{6,12})$"
TEXT = 4000  # a Sheets cell holds 50 000 characters; nothing a person types needs 4 000


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
    cand_id: str = Field(default="", max_length=20)  # retrieved: from the session. human_added: left empty
    origin: Literal["retrieved", "human_added"]
    status: Literal["relevant", "rejected"]
    page: int | None = None  # human_added only: retrieved rows are filled in from the analysis
    passage: str = Field(default="", max_length=TEXT)


class LabelIn(BaseModel):
    claim_id: str = Field(pattern=CLAIM_ID)
    reference_id: str = Field(max_length=200)
    evidence: int = Field(ge=1, le=4)
    rationale: str = Field(default="", max_length=2000)
    spans: list[str] = Field(default_factory=list, max_length=10)
    confidence: Literal["low", "medium", "high"] = "medium"


class SaveIn(BaseModel):
    claims: list[ClaimIn] = Field(default_factory=list, max_length=300)
    candidates: list[CandidateIn] = Field(default_factory=list, max_length=600)
    labels: list[LabelIn] = Field(default_factory=list, max_length=300)


def current(tab: str, rows: list[dict]) -> list[dict]:
    """The latest row for each key, in the order each key first appeared."""
    latest: dict[tuple, dict] = {}
    for row in rows:
        latest[tuple(row.get(k, "") for k in KEYS[tab])] = row
    return list(latest.values())
