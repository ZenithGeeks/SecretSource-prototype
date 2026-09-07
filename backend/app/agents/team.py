"""Multi-agent tree (Google ADK):

    coordinator (root, routes via transfer_to_agent)
    ├── rag_agent       tools: answer_from_docs, add_paper (DSPy + ColBERT service)
    ├── paper_agent     tools: claims, citations, fetch_source (Docling + GROBID)
    ├── verify_agent    tool: verify_claim (retrieval over the cited paper + LLM judge)
    └── retrieval MCP   the ColBERT/ColPali services also speak MCP at /mcp, attached to
                        rag_agent so external MCP clients and this tree share one contract
"""

from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import (
    McpToolset,
    StreamableHTTPConnectionParams,
)

from app.config import COLBERT_URL
from app.llm import adk_model
from app.pipeline.claims import extract_citations, extract_claims, extract_claims_with_citations
from app.pipeline.rag import add_paper, answer_from_docs
from app.pipeline.sources import fetch_source
from app.pipeline.verify import verify_claim

# The retrieval service's own MCP endpoint. Same tools the HTTP client wraps; letting the
# agent call them directly keeps one contract for both agent and external MCP clients.
colbert_mcp = McpToolset(
    connection_params=StreamableHTTPConnectionParams(url=f"{COLBERT_URL}/mcp"),
    tool_filter=["search_passages"],
)

rag_agent = LlmAgent(
    name="rag_agent",
    description="Answers questions from indexed research papers; can add new PDF papers to the index.",
    model=adk_model(),
    instruction=(
        "For questions: use answer_from_docs, reply with its answer in 1-2 sentences.\n"
        "To inspect raw passages: use search_passages.\n"
        "To add a paper: use add_paper with the PDF path, then confirm how many passages were added.\n"
        "If status is error, say so briefly."
    ),
    tools=[answer_from_docs, add_paper, colbert_mcp],
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

verify_agent = LlmAgent(
    name="verify_agent",
    description="Checks whether a cited paper actually supports a claim made about it.",
    model=adk_model(),
    instruction=(
        "Use verify_claim with the claim and the cited paper's PDF path.\n"
        "Report the verdict (supports / refutes / insufficient), then the quote it relies on,\n"
        "then the one-sentence reason. Never judge the claim yourself.\n"
        "If status is error, say so briefly."
    ),
    tools=[verify_claim],
)

root_agent = LlmAgent(
    name="coordinator",
    description="Routes user requests to the right specialist.",
    model=adk_model(),
    instruction=(
        "You are a router. Do not answer yourself.\n"
        "- whether a paper supports / backs / contradicts a given claim, or any request to\n"
        "  verify, check or fact-check a claim -> transfer_to_agent(verify_agent)\n"
        "- list the claims or the citations found in a paper -> transfer_to_agent(paper_agent)\n"
        "- download / fetch a paper by DOI, arXiv ID, PMID or URL -> transfer_to_agent(paper_agent)\n"
        "- questions about the indexed documents / knowledge base -> transfer_to_agent(rag_agent)\n"
        "If the request fits none, say so briefly."
    ),
    sub_agents=[rag_agent, paper_agent, verify_agent],
)
