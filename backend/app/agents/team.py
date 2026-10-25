"""Multi-agent tree (Google ADK).

A coordinator sends requests to three specialists: rag_agent (answers from indexed
papers, adds new PDFs), paper_agent (claims, citations, fetching cited papers), and
verify_agent (checks whether a cited paper supports a claim). rag_agent answers and
searches only the papers the caller may open. ColBERT's own MCP endpoint does not know
who is calling, so the agent does not use it: an unscoped search there would return
other people's passages.

A request that one specialist owns is handed over whole with transfer_to_agent. A claim to
check against several papers is not: the coordinator calls check_claim once per paper in
the same turn, ADK runs the calls at the same time, and the coordinator combines the
verdicts into one answer (SCRUM-171).

A question about earlier work goes to load_memory, which searches the saved analyses
through the runner's memory service, app/memory.py (SCRUM-172).
"""

import asyncio
import functools

from google.adk.agents import LlmAgent
from google.adk.tools import load_memory
from pydantic import BaseModel, Field

from app.llm import adk_model
from app.pipeline import claims, rag, sources, verify


def off_the_loop(function):
    """The same tool, run in a worker thread. ADK calls a plain function tool on its event loop,
    and these block for seconds to minutes, so parallel calls would take turns and hold up
    every other request. The name, docstring and signature stay, so the model sees the same tool."""

    @functools.wraps(function)
    async def run(*args, **kwargs):
        return await asyncio.to_thread(function, *args, **kwargs)

    return run


extract_citations = off_the_loop(claims.extract_citations)
extract_claims = off_the_loop(claims.extract_claims)
extract_claims_with_citations = off_the_loop(claims.extract_claims_with_citations)
add_paper = off_the_loop(rag.add_paper)
answer_from_docs = off_the_loop(rag.answer_from_docs)
search_passages = off_the_loop(rag.search_passages)
fetch_source = off_the_loop(sources.fetch_source)
verify_claim = off_the_loop(verify.verify_claim)

rag_agent = LlmAgent(
    name="rag_agent",
    description="Answers questions from indexed research papers; can add new PDF papers to the index.",
    model=adk_model(),
    instruction=(
        "For questions: use answer_from_docs, reply with its answer in 1-2 sentences.\n"
        "It reads only this person's papers. If sources is empty, say their papers do not answer.\n"
        "To inspect raw passages: use search_passages. It searches only this person's papers "
        "and returns short snippets; pass full_text true only when you need a whole passage.\n"
        "If low_confidence is true, the best match is weak: say so, and do not quote it as support.\n"
        "To add a paper: use add_paper with the PDF path, then confirm how many passages were added.\n"
        "If status is error, say so briefly."
    ),
    tools=[answer_from_docs, add_paper, search_passages],
)

paper_agent = LlmAgent(
    name="paper_agent",
    description="Analyzes a research paper PDF: claims, bibliography, and fetching cited papers.",
    model=adk_model(),
    instruction=(
        "For claims: use extract_claims with the PDF path, then list the claims as bullets.\n"
        "For citations / references: use extract_citations, then list them as 'Authors (year). Title.'\n"
        "For claims linked to their sources: use extract_claims_with_citations, then show each claim\n"
        "as a bullet with its cited works ('Authors (year). Title.') indented under it.\n"
        "To download a cited paper: use fetch_source with its DOI, arXiv ID, PMID, or URL,\n"
        "then report the saved path.\n"
        "For a full analysis: call both extract_claims and extract_citations.\n"
        "If status is error, say so briefly."
    ),
    tools=[extract_claims, extract_citations, extract_claims_with_citations, fetch_source],
)

VERIFY_INSTRUCTION = (
    "Use verify_claim with the claim and the cited paper's PDF path.\n"
    "Report the verdict (supports / refutes / insufficient), then the quote it relies on,\n"
    "then the one-sentence reason. Never judge the claim yourself.\n"
    "If status is error, say so briefly."
)

verify_agent = LlmAgent(
    name="verify_agent",
    description="Checks whether a cited paper actually supports a claim made about it.",
    model=adk_model(),
    instruction=VERIFY_INSTRUCTION,
    tools=[verify_claim],
)


class ClaimAndSource(BaseModel):
    claim: str = Field(description="The claim to check, in the user's words")
    source: str = Field(description="One cited paper: a PDF path, DOI, arXiv ID, PMID or URL")


# The same specialist as a tool. An agent has one parent and one mode, so routing to
# verify_agent and calling it as a tool need two agents. single_turn is ADK's recommended
# way to do what AgentTool did: the coordinator gets the result back instead of handing the
# conversation over, and can call it several times in one turn.
check_claim = LlmAgent(
    name="check_claim",
    description=(
        "Checks one claim against one cited paper and returns the verdict, the quote and the reason. "
        "To check a claim against several papers, call this once per paper in the same turn."
    ),
    model=adk_model(),
    instruction=VERIFY_INSTRUCTION,
    tools=[verify_claim],
    mode="single_turn",
    input_schema=ClaimAndSource,
)

root_agent = LlmAgent(
    name="coordinator",
    description="Routes user requests to the right specialist, and combines checks against several papers.",
    model=adk_model(),
    instruction=(
        "You route requests. Never judge a claim or answer from your own knowledge.\n"
        "- what an EARLIER analysis found ('did we already check ...', 'what did we find for ...')\n"
        "  -> call load_memory with the claim or the paper's title. Answer from what it returns:\n"
        "  the analysis id, the cited paper, the verdict and the quote. If it returns nothing,\n"
        "  say no earlier analysis matched, and offer to check the claim now.\n"
        "- a claim to check against TWO OR MORE papers -> call check_claim once for each paper,\n"
        "  all in the same turn. Then answer with one line per paper: the paper, the verdict\n"
        "  and the quote. End with one sentence on whether the papers agree.\n"
        "- whether ONE paper supports / backs / contradicts a claim, or any other request to\n"
        "  verify, check or fact-check a claim -> transfer_to_agent(verify_agent)\n"
        "- list the claims or the citations found in a paper -> transfer_to_agent(paper_agent)\n"
        "- download / fetch a paper by DOI, arXiv ID, PMID or URL -> transfer_to_agent(paper_agent)\n"
        "- questions about the indexed documents / knowledge base -> transfer_to_agent(rag_agent)\n"
        "If the request fits none, say so briefly."
    ),
    # Searches past analyses (app/memory.py) when the runner has a memory service.
    tools=[load_memory],
    sub_agents=[rag_agent, paper_agent, verify_agent, check_claim],
)
