"""The labeling page's API (browser: /api/labeling).

A person opens one of their finished analyses. The page lists its claims, and for each claim the
passages retrieval found in the cited papers, and the person judges every one of them: keep,
edit or reject a claim; relevant or not for a passage; add what the system missed; give each
(claim, reference paper) a 1-4 label. Saving appends rows to the labeling table in Supabase. Nothing here
decides anything: the AI's output is only what the page shows first.

What the browser sends is checked against the analysis, so the saved rows can be trusted as a gold
set: a retrieved passage's rank, score and text are copied from the analysis, not from the
request.
"""

import asyncio
import csv
import hashlib
import io
import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app import auth, config
from app.auth import current_user
from app.labeling import dspy_export, ledger, pool, scopus
from app.labeling.identity import annotator
from app.labeling.schema import TABS, TOPICS, PersonTopicIn, SaveIn, ScopusAddIn, TopicIn, current
from app.researcher import find_citation

log = logging.getLogger(__name__)
router = APIRouter(prefix="/labeling", tags=["labeling"])


async def mine_analysis(analysis_id: str, user: str | None = Depends(current_user)) -> dict:
    """The caller's own analysis. Imported late: main imports this router."""
    from app import main

    return await asyncio.to_thread(main._owned, analysis_id, user)


async def owned_analysis(analysis_id: str, user: str | None = Depends(current_user)) -> dict:
    """The caller's own analysis, or one its owner shared with the labeling team."""
    from app import main

    def load() -> dict:
        try:
            return main._owned(analysis_id, user)
        except HTTPException:
            row = main.analyses.get(analysis_id)
            if row and row.get("kind", "paper") == "paper" and analysis_id in pool.pooled():
                return row
            raise

    return await asyncio.to_thread(load)


def _store() -> ledger.Store:
    try:
        return ledger.get_store()
    except ledger.NotConfigured as error:
        raise HTTPException(503, f"labels cannot be saved yet: {error}") from error


def _paper_id(analysis: dict) -> str:
    if not analysis.get("file"):
        raise HTTPException(409, "this analysis has no paper yet; wait for it to finish")
    return Path(analysis["file"]).stem


def _candidate_id(claim_id: str, reference_id: str, rank: int, passage: str) -> str:
    return hashlib.sha1(f"{claim_id}|{reference_id}|{rank}|{passage[:120]}".encode()).hexdigest()[:10]


def build_session(analysis: dict) -> dict:
    """The claims of an analysis, each with the passages retrieval found for it."""
    paper_id = _paper_id(analysis)
    references: dict[str, dict] = {}
    claims = []
    for index, claim in enumerate(analysis.get("claims", [])):
        claim_id = f"{paper_id}#{index}"
        candidates = []
        for verdict in claim.get("verdicts") or []:
            if not verdict.get("source"):
                continue
            file = Path(verdict["source"]).name
            reference_id = Path(file).stem
            citation = find_citation(claim, verdict) or {}
            references.setdefault(
                reference_id,
                {
                    "reference_id": reference_id,
                    "file": file,
                    # The title, so a labeler knows which paper this is; the arXiv id or DOI it
                    # was looked up by only when the citation list had no title for it.
                    "label": citation.get("title") or verdict.get("cited") or file,
                    # GROBID's id for the citation: the "[b47]" in the claim's sentence.
                    "ref": citation.get("ref", ""),
                    "authors": citation.get("authors", []),
                    "year": citation.get("year", ""),
                },
            )
            for rank, hit in enumerate(verdict.get("evidence") or [], 1):
                candidates.append(
                    {
                        "cand_id": _candidate_id(claim_id, reference_id, rank, hit.get("text", "")),
                        "reference_id": reference_id,
                        "reference_file": file,
                        "rank": rank,
                        "score": hit.get("score"),
                        "page": hit.get("page"),
                        "passage": hit.get("text", ""),
                    }
                )
        claims.append(
            {
                "claim_id": claim_id,
                "claim": claim.get("claim", ""),
                "sentence": claim.get("sentence", ""),
                "section": claim.get("section", ""),
                "source": claim.get("source"),
                "candidates": candidates,
            }
        )
    return {
        "analysis_id": analysis["id"],
        "paper_id": paper_id,
        "paper_file": Path(analysis["file"]).name,
        "title": analysis.get("title") or Path(analysis["file"]).name,
        "claims": claims,
        "references": list(references.values()),
    }


async def labeler_id(who: str = Depends(annotator), user: str | None = Depends(current_user)) -> str:
    """The account a person's rows are kept under. With login off there is one shared space, so
    it is the shared name."""
    return user or who


def _mine_and_others(rows: dict[str, list[dict]], me: str, paper_id: str) -> dict:
    """What the account `me` already saved for this paper, and who else labeled which pair."""
    mine = {
        tab: [r for r in current(tab, rows[tab]) if r["paper_id"] == paper_id and r["annotator_id"] == me]
        for tab in TABS
    }
    others: dict[str, list[str]] = {}
    for row in current("labels", rows["labels"]):
        if row["paper_id"] == paper_id and row["annotator_id"] != me:
            others.setdefault(f"{row['claim_id']}|{row['reference_id']}", []).append(row["annotator"])
    return {"saved": mine, "others": others}


@router.get("/status")
async def status(who: str = Depends(annotator)):
    return {
        "annotator": who,
        "configured": auth._supabase_configured(),
        "scopus": bool(config.SCOPUS_API_KEY),
    }


@router.get("/sessions/{analysis_id}")
async def session(
    analysis: dict = Depends(owned_analysis), who: str = Depends(annotator), me: str = Depends(labeler_id)
):
    store = _store()
    built = build_session(analysis)
    paper_id = built["paper_id"]
    rows = {tab: await asyncio.to_thread(store.read, tab, paper_id) for tab in TABS}
    return {**built, "annotator": who, **_mine_and_others(rows, me, built["paper_id"])}


def _claim_rows() -> list[dict]:
    """The current `claims` rows of everyone. Empty when Supabase is not set up or cannot be read."""
    try:
        return current("claims", ledger.get_store().read("claims"))
    except ledger.NotConfigured:
        return []
    except Exception:  # progress is a convenience; the paper list still works without it
        log.exception("could not read the claims for the paper list")
        return []


def _team() -> list[str]:
    """Everyone with an account, by the name their rows are written under."""
    if not auth._supabase_configured():
        return []
    from app import store

    try:
        users = store._supabase().auth.admin.list_users()
    except Exception:  # the list is a convenience; the page still works without it
        return []
    names = set()
    for user in users:
        meta = getattr(user, "user_metadata", None) or {}
        name = str(meta.get("full_name") or "").strip() or str(user.email or "").split("@")[0]
        if name:
            names.add(name)
    return sorted(names)


@router.get("/pool")
async def pool_state(
    who: str = Depends(annotator),
    user: str | None = Depends(current_user),
    me: str = Depends(labeler_id),
):
    """Topics, who has which, and the papers shared with the team."""
    from app import main

    def build() -> dict:
        topics = pool.people()
        names = sorted({*_team(), *topics, who})
        # paper_id -> account -> extracted claims judged. A claim someone added by hand makes them
        # a labeler of the paper but is not one of the claims the paper is counted in.
        by_paper: dict[str, dict[str, int]] = {}
        name_of = {me: who}  # account -> the name on its latest row; the viewer by their name now
        for r in _claim_rows():
            counts = by_paper.setdefault(r.get("paper_id", ""), {})
            account = r.get("annotator_id", "")
            counts[account] = counts.get(account, 0) + (r.get("origin") != "human_added")
            if account != me:
                name_of[account] = r.get("annotator", "")
        shared = []
        for analysis_id, topic in pool.pooled().items():
            row = main.analyses.get(analysis_id)
            if not row:
                continue
            status = row.get("status")
            if status == "done" and not row.get("claims"):
                continue  # nothing to label
            stages = row.get("stages") or []
            reason = next((s.get("message", "") for s in reversed(stages) if s.get("stage") == "error"), "")
            counts = by_paper.get(Path(row["file"]).stem, {}) if row.get("file") else {}
            shared.append(
                {
                    "analysis_id": analysis_id,
                    "title": row.get("title") or row.get("paper") or analysis_id,
                    "topic": topic,
                    "claims": len(row.get("claims") or []),
                    "judged": counts.get(me, 0),
                    "labelers": sorted({name_of[account] for account in counts}),
                    "status": status,
                    "reason": reason if status == "error" else "",
                    "mine": row.get("owner") == user,
                }
            )
        return {
            "topics": TOPICS,
            "me": who,
            "people": [{"name": n, "topic": topics.get(n, "")} for n in names],
            "papers": shared,
        }

    return await asyncio.to_thread(build)


@router.put("/people")
async def set_person_topic(body: PersonTopicIn, who: str = Depends(annotator)):
    if body.name != who and body.name not in await asyncio.to_thread(_team):
        raise HTTPException(422, f"{body.name} is not on the team")
    _store()
    await asyncio.to_thread(pool.assign, who, "person", body.name, body.topic)
    return {"name": body.name, "topic": body.topic}


@router.put("/papers/{analysis_id}/topic")
async def set_paper_topic(
    body: TopicIn, analysis: dict = Depends(mine_analysis), who: str = Depends(annotator)
):
    """Share one of your own analyses with the team under a topic, or take it back with ""."""
    _paper_id(analysis)
    _store()
    await asyncio.to_thread(
        pool.assign, who, "paper", analysis["id"], body.topic, analysis.get("owner") or ""
    )
    return {"analysis_id": analysis["id"], "topic": body.topic}


def _doi_in_pool(main, doi: str) -> str | None:
    for analysis_id in pool.pooled():
        row = main.analyses.get(analysis_id)
        if row and str(row.get("paper", "")).lower() == doi.lower():
            return analysis_id
    return None


@router.get("/scopus/search")
async def scopus_search(
    topic: str, q: str = "", since: int = 2020, page: int = 0, _who: str = Depends(annotator)
):
    """Open-access papers of a topic's venues, from Scopus. Each says whether it is already listed."""
    from app import main

    if topic not in TOPICS:
        raise HTTPException(422, f"no such topic: {topic}")
    try:
        found = await asyncio.to_thread(scopus.search, topic, q, since, max(page, 0) * scopus.PAGE)
    except scopus.NotConfigured as error:
        raise HTTPException(503, f"Scopus is not set up: {error}") from error
    except Exception as error:  # a refused key, a timeout, Scopus being down
        raise HTTPException(502, "Scopus did not answer") from error
    listed = {str(main.analyses.get(i, {}).get("paper", "")).lower() for i in pool.pooled()}
    return {"results": [{**paper, "added": paper["doi"].lower() in listed} for paper in found]}


@router.post("/scopus/add")
async def scopus_add(
    body: ScopusAddIn, user: str | None = Depends(current_user), who: str = Depends(annotator)
):
    """Analyse a paper found in Scopus and list it for the team under a topic."""
    from app import main

    _store()
    existing = await asyncio.to_thread(_doi_in_pool, main, body.doi)
    if existing:
        return {"id": existing, "existing": True}
    started = await asyncio.to_thread(main._start, body.doi, True, user)
    await asyncio.to_thread(pool.assign, who, "paper", started["id"], body.topic, user or "")
    return {"id": started["id"], "existing": False}


def _stamp(who: str, account: str, paper_id: str) -> dict:
    return {
        "ts": datetime.now(UTC).isoformat(timespec="seconds"),
        "annotator": who,
        "annotator_id": account,
        "paper_id": paper_id,
    }


@router.post("/sessions/{analysis_id}/save")
async def save(
    body: SaveIn,
    analysis: dict = Depends(owned_analysis),
    who: str = Depends(annotator),
    me: str = Depends(labeler_id),
):
    built = build_session(analysis)
    paper_id = built["paper_id"]
    extracted = {c["claim_id"]: c for c in built["claims"]}
    retrieved = {cand["cand_id"]: (c["claim_id"], cand) for c in built["claims"] for cand in c["candidates"]}
    references = {r["reference_id"] for r in built["references"]}
    stamp = _stamp(who, me, paper_id)

    def claim_known(claim_id: str, origin: str) -> bool:
        # A hand-added claim only has to belong to this paper; an extracted one must exist.
        return claim_id.startswith(f"{paper_id}#") and (origin == "human_added" or claim_id in extracted)

    claims, candidates, labels = [], [], []
    for item in body.claims:
        if not claim_known(item.claim_id, item.origin):
            raise HTTPException(422, f"unknown claim {item.claim_id}")
        row = item.model_dump()
        if item.origin == "extracted":  # the page cannot rewrite what extraction found
            row.update(
                claim=extracted[item.claim_id]["claim"],
                sentence=extracted[item.claim_id]["sentence"],
                section=extracted[item.claim_id]["section"],
            )
        claims.append({**stamp, **row})

    for item in body.candidates:
        if not claim_known(item.claim_id, "human_added" if "#h-" in item.claim_id else "extracted"):
            raise HTTPException(422, f"unknown claim {item.claim_id}")
        row = item.model_dump()
        if item.origin == "retrieved":
            known = retrieved.get(item.cand_id)
            if known is None or known[0] != item.claim_id:
                raise HTTPException(422, f"unknown passage {item.cand_id}")
            hit = known[1]
            row.update(
                reference_id=hit["reference_id"],
                rank=hit["rank"],
                score=hit["score"],
                page=hit["page"],
                passage=hit["passage"],
            )
        else:
            if item.reference_id not in references:
                raise HTTPException(422, f"{item.reference_id} is not a paper this analysis read")
            row["cand_id"] = _candidate_id(item.claim_id, item.reference_id, 0, item.passage)
        candidates.append({**stamp, **row})

    claim_text = {c["claim_id"]: c["claim_edited"] or c["claim"] for c in claims} | {
        cid: c["claim"] for cid, c in extracted.items() if cid not in {x["claim_id"] for x in claims}
    }
    for item in body.labels:
        if item.reference_id not in references:
            raise HTTPException(422, f"{item.reference_id} is not a paper this analysis read")
        if not claim_known(item.claim_id, "human_added" if "#h-" in item.claim_id else "extracted"):
            raise HTTPException(422, f"unknown claim {item.claim_id}")
        row = item.model_dump()
        row["spans"] = json.dumps(item.spans, ensure_ascii=False)
        row["claim"] = claim_text.get(item.claim_id, "")
        labels.append({**stamp, **row})

    store = _store()
    for tab, rows in (("claims", claims), ("candidates", candidates), ("labels", labels)):
        await asyncio.to_thread(store.append, tab, rows)
    return {"claims": len(claims), "candidates": len(candidates), "labels": len(labels)}


@router.get("/export")
async def export(tab: str = "labels", _who: str = Depends(annotator)):
    """The current rows of one tab as CSV: the latest row per key, without what a person later
    took back (a rejected claim's labels and passages, a passage they added and then removed).
    `dspy_claims` and `dspy_verdicts` give the same rows as DSPy examples (dspy_export.py), as JSONL."""
    store = _store()
    if tab in ("dspy_claims", "dspy_verdicts"):
        rows = {name: await asyncio.to_thread(store.read, name) for name in TABS}
        build = dspy_export.claims_examples if tab == "dspy_claims" else dspy_export.verdict_examples
        found = await asyncio.to_thread(build, rows)
        body = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in found)
        return Response(
            body,
            media_type="application/x-ndjson",
            headers={"Content-Disposition": f"attachment; filename={tab}.jsonl"},
        )
    if tab not in TABS:
        raise HTTPException(404, f"no such tab: {tab}")
    rows = current(tab, await asyncio.to_thread(store.read, tab))
    if tab != "claims":
        claims = await asyncio.to_thread(store.read, "claims")
        rejected = {
            (r["claim_id"], r["annotator_id"]) for r in current("claims", claims) if r["status"] == "rejected"
        }
        rows = [r for r in rows if (r["claim_id"], r["annotator_id"]) not in rejected]
    if tab == "candidates":
        rows = [r for r in rows if not (r["origin"] == "human_added" and r["status"] == "rejected")]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=TABS[tab], extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={tab}.csv"},
    )
