"""The analysis pipeline as an ADK Workflow graph.

    START -> read_paper -+- ok ----> plan_checks -> check_sources -> assemble
                         \\- error -> report_error   (one worker per cited source, in parallel)

The same steps the gateway runs as a loop in app/main.py (_run), as nodes, so `adk web`
draws the graph and lists the events of a run (docker compose --profile dev up adk-web).
Nodes are plain functions over app.pipeline; there are no LLM agent nodes, the DSPy judge
stays inside verify_claim. The gateway runs every POST /analyses through this graph
(app/main.py mirrors the node events as its progress stages), and `adk web` runs it on
its own for a look at the pipeline.

The message is the paper: a DOI, arXiv ID, URL or a PDF path. Session state `verify`
(default true) set to false stops after the claims, which is the quick way to try it.
"""

import asyncio

from google.adk import Event
from google.adk.agents.context import Context
from google.adk.workflow import Workflow, node

from app.pipeline.claims import extract_claims_with_citations
from app.pipeline.sources import lookup_key
from app.pipeline.verify import unchecked_reason, verify_claim

# Cited sources checked at once. Each check indexes a PDF in the retrieval services and asks
# the judge; the services are the bottleneck, so a small number is enough.
PARALLEL_CHECKS = 3


@node
async def read_paper(ctx: Context, node_input: str) -> Event:
    """Fetch the paper if it is not a local file, then extract its claims and the works each
    one cites. Routes to `error` when the paper cannot be read. The pipeline call blocks for
    minutes (GROBID, Docling, the model), so it runs in a thread and the loop stays free."""
    paper = node_input.strip()
    extracted = await asyncio.to_thread(extract_claims_with_citations, paper)
    if extracted["status"] == "error":
        return Event(route="error", output={"paper": paper, "message": extracted["message"]})
    ctx.state["paper"] = paper
    ctx.state["file"] = extracted["file"]
    ctx.state["claims"] = extracted["claims"]
    return Event(
        route="ok",
        output={
            "paper": paper,
            "file": extracted["file"],
            "claims": len(extracted["claims"]),
            # Both counts: a cap that quietly halved the claims would read as a short paper.
            "extracted": extracted.get("extracted", len(extracted["claims"])),
            "windows": extracted.get("windows", 1),
        },
    )


@node
def plan_checks(claims: list[dict], verify: bool = True) -> list[dict]:
    """One job per claim and cited work we can look up. Empty when verification is off, or
    when nothing the paper cites carries a DOI, arXiv ID, title or URL."""
    if not verify:
        return []
    return [
        {"claim": index, "text": claim["claim"], "source": source, "url": citation.get("url", "")}
        for index, claim in enumerate(claims)
        for citation in claim["citations"]
        if (source := lookup_key(citation))
    ]


async def check_source(node_input: dict) -> dict:
    """Check one claim against one cited work: index the source in the retrieval services,
    retrieve the passages that bear on the claim, ask the judge. In a thread, because
    verify_claim blocks and the workers are meant to overlap."""
    job = node_input
    verdict = await asyncio.to_thread(verify_claim, job["text"], job["source"])
    return {**job, "verdict": verdict}


check_sources = node(
    check_source, name="check_sources", parallel_worker=True, max_parallel_workers=PARALLEL_CHECKS
)


def fold_check(claims: list[dict], check: dict) -> None:
    """Record one finished check on its claim: a verdict under `verdicts`, keyed by what the
    source was looked up by; a failure under `unchecked`, since a claim nobody could check
    must not look like one nobody tried. The gateway calls this as each check lands."""
    claim = claims[check["claim"]]
    verdict = check["verdict"]
    if verdict["status"] == "ok":
        claim.setdefault("verdicts", []).append({**verdict, "cited": check["source"]})
    else:
        claim.setdefault("unchecked", []).append(
            {
                "source": check["source"],
                "reason": unchecked_reason(verdict, {"url": check["url"]}),
                "message": verdict.get("message", ""),
            }
        )


@node
def assemble(node_input: list[dict], claims: list[dict], paper: str, file: str) -> dict:
    """Fold every check back into its claim; the graph's final output."""
    claims = [dict(claim) for claim in claims]
    for check in node_input:
        fold_check(claims, check)
    return {"paper": paper, "file": file, "claims": claims, "checked": len(node_input)}


@node
def report_error(node_input: dict) -> dict:
    """The paper could not be read: say why and stop."""
    return {"status": "error", **node_input}


analysis_workflow = Workflow(
    name="analysis",
    description="Read a paper, extract its claims, check each claim against the works it cites.",
    edges=[
        ("START", read_paper),
        (read_paper, {"ok": plan_checks, "error": report_error}),
        (plan_checks, check_sources, assemble),
    ],
)
