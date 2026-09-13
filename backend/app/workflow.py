"""The analysis pipeline as an ADK Workflow graph.

    START -> read_paper -+- ok ----> plan_checks -> prepare_sources -> plan_judging
                         |                -> check_sources -> assemble
                         \\- error -> report_error

prepare_sources downloads and indexes each cited work once, several at a time.
check_sources then judges each claim against its prepared work, several at a time.

The same steps the gateway runs in app/main.py, as nodes. This lets `adk web` draw the
graph and list the events of a run (docker compose --profile dev up adk-web). The message is
the paper: a DOI, arXiv ID, URL or a PDF path. Session state `verify` (default true) set
to false stops after the claims, the quick way to try it.
"""

import asyncio
import copy
from pathlib import Path

from google.adk import Event
from google.adk.agents.context import Context
from google.adk.workflow import START, Workflow, node

from app.config import PARALLEL_CHECKS, PARALLEL_SOURCES
from app.pipeline.claims import extract_claims_with_citations
from app.pipeline.sources import lookup_key
from app.pipeline.verify import check_prepared, prepare_source, unchecked_reason


@node
async def read_paper(ctx: Context, node_input: str) -> Event:
    """Fetch the paper if it is not a local file. Then extract its claims and the works
    each one cites. Routes to `error` when the paper cannot be read. The pipeline call
    blocks for minutes (GROBID, Docling, the model). It runs in a thread so the loop
    stays free."""
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
            # Both counts: a cap that quietly cut the claims in half would look like a short paper.
            "extracted": extracted.get("extracted", len(extracted["claims"])),
            "windows": extracted.get("windows", 1),
        },
    )


@node
def plan_checks(ctx: Context, claims: list[dict], verify: bool = True) -> list[str]:
    """Plan one job per claim and cited work we can look up, and save the jobs in state.

    Returns each cited work once, for prepare_sources. Empty when verification is off, or
    when nothing the paper cites has a DOI, arXiv ID, title or URL.
    """
    jobs = []
    if verify:
        for index, claim in enumerate(claims):
            for citation in claim["citations"]:
                if source := lookup_key(citation):
                    url = citation.get("url", "")
                    jobs.append({"claim": index, "text": claim["claim"], "source": source, "url": url})
    ctx.state["jobs"] = jobs
    return list(dict.fromkeys(job["source"] for job in jobs))


async def prepare_one_source(node_input: str) -> dict:
    """Download and index one cited work. In a thread, because it blocks.

    No @node: the node is built below so it can carry the worker settings.
    """
    prepared = await asyncio.to_thread(prepare_source, node_input)
    return {"source": node_input, **prepared}


prepare_sources = node(
    prepare_one_source, name="prepare_sources", parallel_worker=True, max_parallel_workers=PARALLEL_SOURCES
)


def pair_with_sources(jobs: list[dict], prepared: list[dict]) -> list[dict]:
    """Each job together with its prepared source. A plain function so it can be tested."""
    by_source = {item["source"]: item for item in prepared}
    return [{**job, "prepared": by_source[job["source"]]} for job in jobs]


@node
def plan_judging(node_input: list[dict], jobs: list[dict]) -> list[dict]:
    """Attach each prepared source to the jobs that cite it."""
    return pair_with_sources(jobs, node_input)


async def check_source(node_input: dict) -> dict:
    """Judge one claim against its prepared cited work. In a thread, because it blocks.

    No @node: the node is built below so it can carry the worker settings.
    """
    job = {key: value for key, value in node_input.items() if key != "prepared"}
    prepared = node_input["prepared"]
    if prepared["status"] == "error":
        verdict = {**prepared, "claim": job["text"], "source": job["source"]}
    else:
        verdict = await asyncio.to_thread(check_prepared, job["text"], job["source"], Path(prepared["path"]))
    return {**job, "verdict": verdict}


check_sources = node(
    check_source, name="check_sources", parallel_worker=True, max_parallel_workers=PARALLEL_CHECKS
)


def fold_checks(claims: list[dict], checks: list[dict]) -> list[dict]:
    """The checks folded back into their claims, as new claims: a verdict under `verdicts`,
    stored under the key used to look up the source. A failure goes under `unchecked`,
    since a claim nobody could check must not look like one nobody tried.

    Deep copy, not dict(): the in-memory session hands the same claims list to whoever
    runs the graph. A shallow copy shares each claim's verdicts and unchecked lists. So
    setdefault().append() would fold into the caller's data as well. Folding twice then
    doubles every verdict. A plain function so it can be tested without a run.
    """
    claims = copy.deepcopy(claims)
    for check in checks:
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
    return claims


def finished_analysis(checks: list[dict], claims: list[dict], paper: str, file: str) -> dict:
    """The finished analysis, with the checks folded onto the claims.

    It has a "status" like report_error's answer, so a caller can check one field either
    way. A plain function so it can be tested without a run.
    """
    return {"status": "ok", "paper": paper, "file": file,
            "claims": fold_checks(claims, checks), "checked": len(checks)}


@node
def assemble(node_input: list[dict], claims: list[dict], paper: str, file: str) -> dict:
    """Fold the checks onto the claims and answer with the finished analysis."""
    return finished_analysis(node_input, claims, paper, file)


@node
def report_error(node_input: dict) -> dict:
    """The paper could not be read: say why and stop."""
    return {"status": "error", **node_input}


analysis_workflow = Workflow(
    name="analysis",
    description="Read a paper, extract its claims, check each claim against the works it cites.",
    edges=[
        (START, read_paper),
        (read_paper, {"ok": plan_checks, "error": report_error}),
        (plan_checks, prepare_sources, plan_judging, check_sources, assemble),
    ],
)
