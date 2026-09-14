"""Memory over past analyses, for the chat agents' `load_memory` tool (SCRUM-172).

The gateway already saves every analysis (app/store.py, Supabase or SQLite). So this memory
service writes nothing: `search_memory` reads the saved verdicts and returns the ones whose
claim, cited paper or quote share the most words with the question. The coordinator calls
`load_memory` only when a question is about earlier work, such as "did we already check this
citation?".

Whose analyses it may read: the chat agents do not know who is asking (A2A has no login, and
cli.py uses a fixed user id). So it never follows the caller's user id. It reads the analyses
without an owner, which is every analysis when login is off, and the ones owned by
MEMORY_OWNER, a Supabase user id the operator sets for this process.
"""

import asyncio
import os
import re
from datetime import datetime, timezone

from google.adk.memory import BaseMemoryService
from google.adk.memory.base_memory_service import SearchMemoryResponse
from google.adk.memory.memory_entry import MemoryEntry
from google.genai import types

from app import store

RESULTS = 5  # findings returned per search: enough to answer, few enough for the model to read
WORD = re.compile(r"[a-z0-9]+")
# Words that say nothing about which claim or paper is meant.
STOP = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "did", "does",
    "what", "which", "about", "claim", "paper", "papers", "check", "checked", "find", "found",
    "earlier", "already", "analysis", "analyses", "source", "sources", "cited", "our", "has",
    "have", "not", "can", "its", "their", "than", "into", "been", "any",
}  # fmt: skip


def _words(text: str) -> set[str]:
    return {word for word in WORD.findall((text or "").lower()) if len(word) > 2 and word not in STOP}


def _readable(analysis: dict) -> tuple[str, str]:
    """The paper's name and the date the analysis started, as the model should see them."""
    paper = analysis.get("title") or os.path.basename(analysis.get("file") or analysis.get("paper") or "")
    started = next((stage["at"] for stage in analysis.get("stages", []) if stage.get("at")), None)
    when = datetime.fromtimestamp(started, timezone.utc).date().isoformat() if started else ""
    return paper, when


def _findings(analysis: dict):
    """Each verdict and each unchecked source in one analysis, as (text to show, text to match)."""
    paper, when = _readable(analysis)
    heading = f'Analysis {analysis["id"]} of "{paper}"' + (f" ({when})" if when else "")
    for claim in analysis.get("claims", []):
        said = claim.get("claim", "")
        for verdict in claim.get("verdicts", []):
            shown = (
                f'{heading}: the claim "{said}" was checked against {verdict.get("cited", "")}. '
                f'Verdict: {verdict.get("verdict", "")}. Quote: "{verdict.get("quote", "")}". '
                f"Reason: {verdict.get('reasoning', '')}"
            )
            yield shown, f"{said} {verdict.get('cited', '')} {verdict.get('quote', '')} {paper}"
        for unchecked in claim.get("unchecked", []):
            shown = (
                f'{heading}: the claim "{said}" could not be checked against '
                f"{unchecked.get('source', '')} ({unchecked.get('reason', '')})."
            )
            yield shown, f"{said} {unchecked.get('source', '')} {paper}"


def readable_by(analysis: dict, owner: str) -> bool:
    return analysis.get("owner") is None or (bool(owner) and analysis.get("owner") == owner)


def search(query: str, analyses, owner: str = "", limit: int = RESULTS) -> list[MemoryEntry]:
    """The findings that share the most words with the query, best first. Ties keep the newest
    analysis first. Nothing is returned when no word matches."""
    wanted = _words(query)
    scored = []
    for order, analysis in enumerate(analyses):
        if not readable_by(analysis, owner):
            continue
        for shown, matched in _findings(analysis):
            score = len(wanted & _words(matched))
            if score:
                scored.append((score, order, shown, analysis))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [
        MemoryEntry(
            content=types.Content(role="model", parts=[types.Part(text=shown)]),
            author="secretsource",
            timestamp=_readable(analysis)[1] or None,
            custom_metadata={"analysis": analysis["id"]},
        )
        for _, _, shown, analysis in scored[:limit]
    ]


class AnalysisMemory(BaseMemoryService):
    """ADK memory backed by the saved analyses. Read-only."""

    def __init__(self, owner: str | None = None):
        self.owner = os.getenv("MEMORY_OWNER", "") if owner is None else owner

    async def add_session_to_memory(self, session) -> None:
        return None  # the gateway saves analyses itself; a chat session adds nothing to them

    async def search_memory(self, *, app_name: str, user_id: str, query: str) -> SearchMemoryResponse:
        analyses = await asyncio.to_thread(store.load_all)  # oldest first
        memories = search(query, list(analyses.values()), self.owner)
        return SearchMemoryResponse(memories=memories)
