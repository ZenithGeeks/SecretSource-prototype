"""Read tools for the Labeler and Author screen agents (app/agents/screen.py, SCRUM-444), and
saved_labels for coding agents over MCP (app/mcp_server.py).

Each tool wraps the route function the role's own page calls, so it keeps that route's owner
check: another person's paper or draft answers an error, the same as a missing one. Only
saved_labels writes, one reviews row. The Labeler's tools never return a verdict, so the agent
cannot nudge the labels the thesis is scored on.
"""

import asyncio

from fastapi import HTTPException
from google.adk.tools import ToolContext

from app.author import logic
from app.author import router as author
from app.labeling import identity
from app.labeling import router as labeling

LISTED = 30  # papers or drafts per list: enough to find one, few enough for the model to read
PASSAGES = 8  # passages per claim, as the labeling page lists them first (labeling.NEXT_PASSAGES)
ISSUES = 20  # open citations and warnings per draft


def _user(tool_context: ToolContext) -> str | None:
    return tool_context.state.get("user") or None  # the session keeps "" for a signed-out person


def _error(message: str) -> dict:
    return {"status": "error", "message": message}


async def labeling_papers(tool_context: ToolContext) -> dict:
    """The papers shared with the labeling team, and how far the person is on each: id, title,
    topic, how many claims it has, and how many the person has saved."""
    user = _user(tool_context)
    who = await asyncio.to_thread(identity.annotator_for, user)
    state = await labeling.pool_state(who=who, user=user, me=user or who)
    return {
        "papers": [
            {
                "id": paper["analysis_id"],
                "title": paper["title"],
                "topic": paper.get("topic") or "",
                "claims": paper["claims"],
                "saved": paper["judged"],
            }
            for paper in state["papers"][:LISTED]
        ]
    }


async def claim_passages(analysis_id: str, claim_number: int, tool_context: ToolContext) -> dict:
    """One claim of a paper being labeled, with the passages retrieval found for it: the cited
    paper, the page and the text, best first. Only passages: say nothing about whether a passage
    backs the claim, because the person decides that.

    Args:
        analysis_id: the paper's id, from labeling_papers.
        claim_number: the claim's number on the labeling page, from 1.
    """
    try:
        analysis = await labeling.owned_analysis(analysis_id, _user(tool_context))
    except HTTPException as error:
        return _error(str(error.detail))
    built = labeling.build_session(analysis)
    claims = built["claims"]
    if not 1 <= claim_number <= len(claims):
        return _error(f"this paper has claims 1 to {len(claims)}, not {claim_number}")
    claim = claims[claim_number - 1]
    names = {reference["reference_id"]: reference["label"] for reference in built["references"]}
    return {
        "claim": claim["claim"],
        "sentence": claim["sentence"],
        "passages": [
            {"paper": names[c["reference_id"]], "page": c["page"], "rank": c["rank"], "text": c["passage"]}
            for c in claim["candidates"][:PASSAGES]
        ],
    }


async def saved_labels(analysis_id: str, claim_number: int, tool_context: ToolContext) -> dict:
    """What the person saved for one claim, so you can review it: the claim as they kept it, a
    level per cited paper (1 no support, 2 weak, 3 clear, 4 strong) with their rationale and
    confidence, and each passage they marked relevant or rejected. Compare the levels with
    claim_passages and say where you read a passage differently. Never tell the person which level
    to pick; point at the passage and say why. Works only on a claim the person has saved, and it
    marks the claim as AI-reviewed.

    Args:
        analysis_id: the paper's id, from labeling_papers.
        claim_number: the claim's number on the labeling page, from 1.
    """
    try:
        return await labeling.labels_for(analysis_id, claim_number, _user(tool_context))
    except HTTPException as error:
        return _error(str(error.detail))


async def list_drafts(tool_context: ToolContext) -> dict:
    """The person's drafts, the most recently changed first: id, title, when the last check
    finished, and whether a check is running now."""
    drafts = await author.list_drafts(user=_user(tool_context))
    return {
        "drafts": [
            {
                "id": draft["id"],
                "title": draft.get("title", ""),
                "last_checked": draft.get("lastCheckedAt"),
                "checking_now": draft.get("runningCheckId") is not None,
            }
            for draft in drafts[:LISTED]
        ]
    }


async def draft_issues(draft_id: str, tool_context: ToolContext) -> dict:
    """What needs work in a draft: the citations its last check did not back (missing keys,
    refuted or unsupported sentences) and the problems in its .bib and \\cite commands.

    Args:
        draft_id: the draft's id, from list_drafts.
    """
    user = _user(tool_context)
    try:
        draft = await author.get_draft(draft_id, user=user)
        parsed = await author.parse_draft(draft_id, user=user)
        check = await author.get_check(draft["lastCheckId"], user=user) if draft["lastCheckId"] else None
    except HTTPException as error:
        return _error(str(error.detail))
    citations = check["citations"] if check else []
    open_issues = [
        citation for citation in citations
        if logic.is_open_issue(citation) or citation.get("reason") == "missing-key"
    ]  # fmt: skip
    return {
        "checked": check is not None,
        "citations": [
            {
                "key": citation.get("key", ""),
                "file": citation.get("file", ""),
                "line": citation.get("line"),
                "sentence": citation.get("sentence", ""),
                "verdict": citation.get("verdict", ""),
                "why": logic.short_message(citation.get("message")) or citation.get("explanation") or "",
            }
            for citation in open_issues[:ISSUES]
        ],
        "warnings": parsed["warnings"][:ISSUES],
    }


LABELER_TOOLS = [labeling_papers, claim_passages]
MCP_LABELER_TOOLS = [*LABELER_TOOLS, saved_labels]  # the in-app labeler agent never reads labels
AUTHOR_TOOLS = [list_drafts, draft_issues]
