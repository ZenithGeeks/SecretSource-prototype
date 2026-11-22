"""Memory over past analyses, for the chat agents' `load_memory` tool (SCRUM-172).

The gateway already saves every analysis (app/store.py, Supabase or SQLite). So this memory
service writes nothing: `search_memory` asks the store for the user's analyses that match the
question (Postgres full-text search on Supabase), then returns the verdicts whose claim, cited
paper or quote share the most words with it. The coordinator calls
`load_memory` only when a question is about earlier work, such as "did we already check this
citation?".

Whose analyses it may read: only the ones owned by the user_id ADK passes to search_memory,
the same rule as the gateway's visible_to. A runner for signed-in users passes the Supabase
user id, and one with login off passes SIGNED_OUT, which reads only analyses without an owner.
A Supabase user id is never empty, so a signed-in user never reads the ownerless ones.
cli.py has no login and uses SIGNED_OUT. a2a_server.py has none either, and ADK names its
callers A2A_USER_<context id>, so it builds the service with as_user=SIGNED_OUT.

AssistantMemory (SPEC.md) also reads what the assistant remembers about the user, the facts
in store.load_facts, and returns those first. Ask's Answer mode has no load_memory tool, so
remembered_for gives it the same matching facts.
"""

import asyncio
import os
from datetime import UTC, datetime

from google.adk.memory import BaseMemoryService
from google.adk.memory.base_memory_service import SearchMemoryResponse
from google.adk.memory.memory_entry import MemoryEntry
from google.genai import types

from app import store
from app.sessions import SIGNED_OUT
from app.text import WORD, search_terms

RESULTS = 5  # findings returned per search: enough to answer, few enough for the model to read
# Analyses the store ranks first and hands back for the findings to be scored. Each holds up to
# 20 claims, so the best RESULTS findings are almost always among the top few analyses.
CANDIDATES = 20
# Words that say nothing about which claim or paper is meant, on top of English stopwords.
ABOUT_THE_TASK = search_terms("claim paper check find found earlier already analysis source cited")


def _words(text: str) -> set[str]:
    return search_terms(text or "") - ABOUT_THE_TASK


def _readable(analysis: dict) -> tuple[str, str]:
    """The paper's name and the date the analysis started, as the model should see them."""
    paper = analysis.get("title") or os.path.basename(analysis.get("file") or analysis.get("paper") or "")
    started = next((stage["at"] for stage in analysis.get("stages", []) if stage.get("at")), None)
    when = datetime.fromtimestamp(started, UTC).date().isoformat() if started else ""
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


def _matching_analyses(query: str, owner: str | None) -> list[dict]:
    """The owner's analyses the store finds for the query, oldest first. The words go to the
    store unstemmed, because Postgres stems them with its own dictionary."""
    words = [word for word in dict.fromkeys(WORD.findall(query.lower())) if _words(word)]
    if not words:
        return []
    return store.search_owned(owner, words, CANDIDATES)


def owner_of(user_id: str) -> str | None:
    """The analysis owner an ADK user id stands for: None for SIGNED_OUT, else the id itself."""
    return None if user_id == SIGNED_OUT else user_id


def search(query: str, analyses, user_id: str, limit: int = RESULTS) -> list[MemoryEntry]:
    """The findings in `user_id`'s own analyses that share the most words with the query, best
    first. Ties keep the newest analysis first. Nothing is returned when no word matches."""
    owner = owner_of(user_id)
    wanted = _words(query)
    scored = []
    for order, analysis in enumerate(analyses):
        if analysis.get("owner") != owner:
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
    """ADK memory backed by the saved analyses. Read-only. With `as_user`, every search reads
    as that user, whatever user id the runner passes."""

    def __init__(self, as_user: str | None = None):
        self.as_user = as_user

    async def add_session_to_memory(self, session) -> None:
        return None  # the gateway saves analyses itself; a chat session adds nothing to them

    async def search_memory(self, *, app_name: str, user_id: str, query: str) -> SearchMemoryResponse:
        if self.as_user is not None:
            user_id = self.as_user
        # Only this user's matching rows are read, not the whole table (#314) or history (#1027).
        analyses = await asyncio.to_thread(_matching_analyses, query, owner_of(user_id))
        return SearchMemoryResponse(memories=search(query, analyses, user_id))


def search_facts(query: str, facts: list[dict], limit: int = RESULTS) -> list[MemoryEntry]:
    """The remembered facts that share the most words with the query, best first. Ties keep
    the order of `facts`, which load_facts gives newest first. Nothing is returned when no word
    matches."""
    wanted = _words(query)
    scored = []
    for order, fact in enumerate(facts):
        score = len(wanted & _words(f"{fact['subject']} {fact['summary']}"))
        if score:
            scored.append((-score, order, fact))
    scored.sort(key=lambda item: item[:2])
    return [
        MemoryEntry(
            content=types.Content(
                role="model",
                parts=[types.Part(text=f"Remembered {fact['kind']}, {fact['subject']}: {fact['summary']}")],
            ),
            author="secretsource",
            timestamp=fact["updated_at"][:10],
            custom_metadata={"fact": fact["id"]},
        )
        for _, _, fact in scored[:limit]
    ]


def remembered_for(question: str, owner: str | None) -> list[str]:
    """The owner's remembered facts that share words with the question, as Ask's answer step
    reads them (app/assistant.py). Empty for a signed-out caller, who has no facts."""
    if owner is None:
        return []
    found = search_facts(question, store.load_facts(owner))
    return [entry.content.parts[0].text for entry in found]


class AssistantMemory(BaseMemoryService):
    """ADK memory for the signed-in assistant: the user's remembered facts first, then findings
    from their own analyses, RESULTS in all. A signed-out user has no facts."""

    async def add_session_to_memory(self, session) -> None:
        return None  # facts come from the distill job (SPEC.md "Distilling"), not from a request

    async def search_memory(self, *, app_name: str, user_id: str, query: str) -> SearchMemoryResponse:
        owner = owner_of(user_id)
        facts = await asyncio.to_thread(store.load_facts, owner) if owner else []
        found = search_facts(query, facts)
        if len(found) < RESULTS:
            analyses = await asyncio.to_thread(_matching_analyses, query, owner)
            found += search(query, analyses, user_id, limit=RESULTS - len(found))
        return SearchMemoryResponse(memories=found)
