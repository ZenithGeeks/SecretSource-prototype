"""Data tools for the screen agent and the MCP server: read the person's analyses and library,
check text against it, and start an analysis.

Each tool is an async function that takes ADK's tool_context and reads the person from
tool_context.state["user"], like list_papers in app/agents/screen.py. The MCP server calls the
same functions with a stand-in context (app/mcp_server.py). The docstrings are what the model
reads; docs/agent-tools.md lists every tool for people. A tool that cannot answer returns
{"status": "error", "message"} so the model can read why, as verify_claim does.
"""

import asyncio
import re

from fastapi import HTTPException
from google.adk.tools import ToolContext

from app import assistant, researcher
from app.labeling import router as labeling
from app.pipeline.claims import locate

MAX_SENTENCES = assistant.MAX_STATEMENTS  # one judge call each, so the same cap as an answer
MIN_SENTENCE = 20  # characters; shorter pieces are headings or list stubs, not claims
SEARCH_RESULTS = 10
LISTED = 10  # entries per list in get_gaps


def _user(tool_context: ToolContext) -> str | None:
    """The person the tool works for. The session keeps "" for a signed-out person."""
    return tool_context.state.get("user") or None


def _error(message: str) -> dict:
    return {"status": "error", "message": message}


async def _analysis(analysis_id: str, user: str | None) -> dict | None:
    """The analysis if `user` owns it, else None: an id that is not theirs reads as missing."""
    from app import main  # main imports the agent routes, so not at the top

    try:
        return await asyncio.to_thread(main._owned, analysis_id, user)
    except HTTPException:
        return None


def _missing(analysis_id: str) -> dict:
    return _error(f"no analysis {analysis_id!r} among your papers; list_papers gives the ids")


async def get_analysis(analysis_id: str, tool_context: ToolContext) -> dict:
    """One analysis: its status and, if it failed, why; how many claims are backed, silent,
    contradicted or unchecked; and each claim with its number and standing. Use get_claim for the
    evidence behind one claim.

    Args:
        analysis_id: the id list_papers gives for the paper.
    """
    analysis = await _analysis(analysis_id, _user(tool_context))
    if analysis is None:
        return _missing(analysis_id)
    last = (analysis.get("stages") or [{}])[-1]
    return {
        "id": analysis["id"],
        "title": researcher.title_of(analysis),
        "status": analysis.get("status", ""),
        "stage": last.get("stage", ""),
        "message": analysis.get("message") or last.get("message", ""),
        "standing": researcher.tally([analysis]),
        "claims": [
            {
                "number": number,
                "claim": claim.get("claim", ""),
                "section": claim.get("section", ""),
                "standing": researcher.standing(claim),
            }
            for number, claim in enumerate(analysis.get("claims", []), 1)
        ],
    }


async def get_claim(analysis_id: str, claim_number: int, tool_context: ToolContext) -> dict:
    """The evidence behind one claim: the sentence it came from, and for each cited paper the
    verdict (supports, refutes or insufficient), the quote the judge relied on and its reasoning.
    Citations that could not be checked are listed with the reason.

    Args:
        analysis_id: the id list_papers gives for the paper.
        claim_number: the claim's number in get_analysis, from 1.
    """
    analysis = await _analysis(analysis_id, _user(tool_context))
    if analysis is None:
        return _missing(analysis_id)
    claims = analysis.get("claims", [])
    if not 1 <= claim_number <= len(claims):
        return _error(f"this paper has claims 1 to {len(claims)}, not {claim_number}")
    claim = claims[claim_number - 1]
    return {
        "number": claim_number,
        "claim": claim.get("claim", ""),
        "sentence": claim.get("sentence", ""),
        "section": claim.get("section", ""),
        "standing": researcher.standing(claim),
        "verdicts": [
            {key: verdict.get(key, "") for key in ("cited", "verdict", "quote", "reasoning")}
            for verdict in claim.get("verdicts", [])
        ],
        "unchecked": claim.get("unchecked", []),
    }


async def search_claims(query: str, tool_context: ToolContext) -> dict:
    """Find claims in the person's analysed papers by their words, best match first, at most 10.
    Matches words in the claim, not meaning; use find_support to search the cited papers.

    Args:
        query: a few words, such as "index size".
    """
    from app import main

    words = set(re.findall(r"\w{3,}", query.lower()))
    rows = await asyncio.to_thread(main.visible_to, _user(tool_context))
    found = []
    for paper in researcher.library_papers(rows):
        for number, claim in enumerate(paper.get("claims", []), 1):
            hits = len(words & set(re.findall(r"\w{3,}", claim.get("claim", "").lower())))
            if hits:
                found.append((hits, paper, number, claim))
    found.sort(key=lambda item: -item[0])  # stable: the newest paper stays first among equals
    return {
        "claims": [
            {
                "analysis_id": paper["id"],
                "title": researcher.title_of(paper),
                "number": number,
                "claim": claim["claim"],
                "standing": researcher.standing(claim),
            }
            for _, paper, number, claim in found[:SEARCH_RESULTS]
        ]
    }


async def find_in_paper(analysis_id: str, text: str, tool_context: ToolContext) -> dict:
    """Find where some text sits in an analysed paper's PDF: the page, or no page if it is not
    there. Runs on the server; to show it to the person, open the paper and point at it.

    Args:
        analysis_id: the id list_papers gives for the paper.
        text: the words to look for, as the paper prints them.
    """
    from pathlib import Path

    from app import main

    user = _user(tool_context)
    analysis = await _analysis(analysis_id, user)
    if analysis is None:
        return _missing(analysis_id)
    if not analysis.get("file"):
        return _error("this analysis has no paper yet; wait for it to finish")
    path = await asyncio.to_thread(main._paper, Path(analysis["file"]).name, user)
    found = await asyncio.to_thread(locate, path.as_posix(), text, None)
    return {"page": (found or {}).get("page")}


async def find_support(claim: str, tool_context: ToolContext) -> dict:
    """Find passages in the person's papers that bear on a claim, best first: the paper, the page
    and the text. It only searches. check_text also judges them.

    Args:
        claim: one statement, such as "ColBERT cuts the index size by 10x".
    """
    from app import main

    papers = await asyncio.to_thread(main.papers_of, _user(tool_context))
    hits = await asyncio.to_thread(assistant.library_passages, claim, papers)
    return {
        "passages": [
            {"paper": hit["source"], "page": hit.get("page"), "text": hit["text"]} for hit in hits
        ]
    }


async def check_text(text: str, tool_context: ToolContext) -> dict:
    """Check a piece of writing against the person's papers: for each sentence, the paper with the
    passage that fits it best and the judge's verdict (supports, refutes or insufficient) with its
    quote. A sentence with no fitting passage is "unchecked". Checks the first 6 sentences, and
    takes a minute or more.

    Args:
        text: the writing to check, such as a paragraph of a draft.
    """
    from app import main

    pieces = re.split(r"(?<=[.!?])\s+", text.strip())
    sentences = [piece for piece in pieces if len(piece) >= MIN_SENTENCE]
    papers = await asyncio.to_thread(main.papers_of, _user(tool_context))
    results = await assistant.check_text(sentences[:MAX_SENTENCES], papers)
    return {"results": results, "not_checked": max(0, len(sentences) - MAX_SENTENCES)}


async def ask_library(question: str, tool_context: ToolContext) -> dict:
    """Answer a question from the person's papers, as the Ask panel does: short statements, each
    naming its paper and page, with the judge's verdict on it. Takes a minute or more.

    Args:
        question: the question, such as "Who proposed late interaction?".
    """
    from app import main

    papers = await asyncio.to_thread(main.papers_of, _user(tool_context))
    statements: dict[int, dict] = {}
    async for event in assistant.answer(question, papers=papers):
        if event["type"] == "statement":
            statements[event["index"]] = {
                key: event[key] for key in ("text", "source", "page")
            }
        elif event["type"] == "verdict":
            statements[event["index"]] |= {
                key: event[key] for key in ("verdict", "quote", "reasoning")
            }
    return {"statements": [statements[index] for index in sorted(statements)]}


async def get_gaps(tool_context: ToolContext) -> dict:
    """What the person's library leaves open: claims no cited work backs, claims a cited work
    contradicts, and works the library keeps citing but does not hold. Up to 10 of each."""
    from app import main

    rows = await asyncio.to_thread(main.visible_to, _user(tool_context))
    found = researcher.gaps(rows)
    return {name: entries[:LISTED] for name, entries in found.items()}


async def bibtex(analysis_id: str, tool_context: ToolContext) -> dict:
    """BibTeX entries for a paper and the works its claims cite, for pasting into a .bib file.
    A work whose citation lists no authors or year gets an entry with what is known.

    Args:
        analysis_id: the id list_papers gives for the paper.
    """
    analysis = await _analysis(analysis_id, _user(tool_context))
    if analysis is None:
        return _missing(analysis_id)
    works = {
        _entry_key(analysis.get("authors", []), analysis.get("year", ""), analysis.get("title", "")): (
            analysis.get("title", ""), analysis.get("authors", []), analysis.get("year", "")
        )
    }
    for claim in analysis.get("claims", []):
        for verdict in claim.get("verdicts", []):
            cited = researcher.find_citation(claim, verdict) or {}
            title, authors, year = cited.get("title", ""), cited.get("authors", []), cited.get("year", "")
            if title:
                works.setdefault(_entry_key(authors, year, title), (title, authors, year))
    return {
        "bibtex": "\n\n".join(
            _entry(key, title, authors, year) for key, (title, authors, year) in works.items()
        )
    }


def _entry_key(authors: list[str], year: str, title: str) -> str:
    """Surname of the first author, the year and the title's first word: "khattab2020colbert"."""
    surname = authors[0].split()[-1] if authors else "anon"
    first_word = (re.findall(r"[A-Za-z]+", title) or ["untitled"])[0]
    return re.sub(r"[^a-z0-9]", "", f"{surname}{year}{first_word}".lower())


def _entry(key: str, title: str, authors: list[str], year: str) -> str:
    fields = [("title", title), ("author", " and ".join(authors)), ("year", str(year))]
    body = ",\n".join(f"  {name} = {{{value}}}" for name, value in fields if value)
    return f"@misc{{{key},\n{body}\n}}"


async def submit_analysis(paper: str, tool_context: ToolContext) -> dict:
    """Start checking a paper: its claims against the works it cites. Runs in the background and
    takes minutes. Poll get_analysis with the returned id until its status is "done" or "error".

    Args:
        paper: a DOI, an arXiv ID or a URL.
    """
    from app import main

    started = main._start(paper, True, _user(tool_context))
    return {"id": started["id"], "status": started["status"]}


async def labeling_progress(analysis_id: str, tool_context: ToolContext) -> dict:
    """Where the person stands on one paper in the labeler: how many claims they saved and had
    reviewed, and the first claim they have not saved, with the passages found for it. It only
    reads; it never changes a label.

    Args:
        analysis_id: the id list_papers gives for the paper.
    """
    try:
        return await labeling.progress_for(analysis_id, _user(tool_context))
    except HTTPException as error:
        return _error(str(error.detail))


# The tools above, for the screen agent and for the MCP server's call_tool.
DATA_TOOLS = [
    get_analysis,
    get_claim,
    search_claims,
    find_in_paper,
    find_support,
    check_text,
    ask_library,
    get_gaps,
    bibtex,
    submit_analysis,
    labeling_progress,
]
