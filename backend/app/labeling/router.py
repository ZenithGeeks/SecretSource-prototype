"""The labeling page's API (browser: /api/labeling).

A person opens one of their finished analyses. The page lists its claims, and for each claim the
passages retrieval found in the cited papers, and the person judges every one of them: keep,
edit or reject a claim; relevant or not for a passage; add what the system missed; give each
(claim, reference paper) a 1-4 label. Saving appends rows to the labeling table in Supabase. Nothing here
decides anything: the AI's output is only what the page shows first. A person can ask the AI to
review a claim they saved (review.py); it suggests changes, and later saves of that claim are marked
`ai_reviewed`.

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
from typing import Literal

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from app import auth, config
from app.auth import current_user
from app.labeling import compare, dspy_export, identity, ledger, pool, review, scopus
from app.labeling.identity import annotator, is_lead
from app.labeling.schema import (
    TABS,
    TOPICS,
    AddedClaimIn,
    AskIn,
    BlindCheckIn,
    CompareNoteIn,
    PersonTopicIn,
    ReviewIn,
    SaveIn,
    ScopusAddIn,
    TopicIn,
    UploadShareIn,
    VenueRank,
    current,
)
from app.pipeline import verify
from app.pipeline.sources import lookup_key
from app.researcher import find_citation

log = logging.getLogger(__name__)
# current_user runs the team check (TEAM_EMAILS); annotator alone reads the token without it.
router = APIRouter(prefix="/labeling", tags=["labeling"], dependencies=[Depends(current_user)])

ExportScope = Literal["mine", "team"]
NEXT_PASSAGES = 8  # passages listed for the next unsaved claim
# Papers analysed for the team keep every claim, not CLAIM_LIMIT's 20: 93 of 118 finished
# analyses stopped at 20 (14 Nov). Only new or failed papers start here, so the claim ids of
# labeled papers (paper_id#index) never shift.
LABELING_CLAIM_LIMIT = 0


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
            row = main.lookup(analysis_id)
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


def _candidates(claim_id: str, reference_id: str, file: str, hits: list[dict]) -> list[dict]:
    """Retrieved passages as the labeling page shows them, ranked from 1 in the order given."""
    return [
        {
            "cand_id": _candidate_id(claim_id, reference_id, rank, hit.get("text", "")),
            "reference_id": reference_id,
            "reference_file": file,
            "rank": rank,
            "score": hit.get("score"),
            "page": hit.get("page"),
            "passage": hit.get("text", ""),
        }
        for rank, hit in enumerate(hits, 1)
    ]


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
            candidates += _candidates(claim_id, reference_id, file, verdict.get("evidence") or [])
        claims.append(
            {
                "claim_id": claim_id,
                "claim": claim.get("claim", ""),
                "sentence": claim.get("sentence", ""),
                "section": claim.get("section", ""),
                "source": claim.get("source"),
                "candidates": candidates,
                "unchecked": _unchecked(claim),
                # The "b23"s this claim cites, in the order it cites them, so the labeler opens
                # one of its own references and never another claim's.
                "cited": [ref for citation in claim.get("citations") or [] if (ref := citation.get("ref"))],
            }
        )
    return {
        "analysis_id": analysis["id"],
        "paper_id": paper_id,
        "paper_file": Path(analysis["file"]).name,
        "title": analysis.get("title") or Path(analysis["file"]).name,
        "claims": claims,
        "references": list(references.values()),
        "unread": _unread_references(analysis, list(references.values())),
        # Where the paper cites each reference, so a click on "[12]" can open that reference.
        "markers": analysis.get("markers") or [],
    }


def _unchecked(claim: dict) -> list[dict]:
    """The claim's citations the analysis did not check, each with why, so a reference with no
    passages is not taken for a search that found nothing (#836). "named" is a work the paper only
    names, a method or dataset it uses; the rest are verify.unchecked_reason values. `url`, `doi`
    and `year` are the citation's own, "" when the reference list had none, so the labeler can
    still open a work that has no PDF here."""
    named = set(claim.get("named") or [])
    failed = {row["source"]: row for row in claim.get("unchecked") or []}
    rows = []
    for citation in claim.get("citations") or []:
        source = lookup_key(citation)
        failed_row = failed.get(source)
        if not source:
            reason = "unresolvable"
            source_outcome = {
                "source_kind": "unknown", "outcome": "not-attempted",
                "retryable": False, "attempts": [],
            }
        elif source in named:
            reason = "named"
            source_outcome = {
                "source_kind": "unknown", "outcome": "named-only",
                "retryable": False, "attempts": [],
            }
        elif failed_row:
            reason = failed_row["reason"]
            source_outcome = failed_row.get("source_outcome")
        else:
            continue
        row = {
            "ref": citation.get("ref", ""),
            "label": citation.get("title") or source or f"Reference [{citation.get('ref') or ''}]",
            "reason": reason,
            "url": citation.get("url") or "",
            "doi": citation.get("doi") or "",
            "year": str(citation.get("year") or ""),
        }
        if source_outcome is not None:
            row["source_outcome"] = source_outcome
        rows.append(row)
    return rows


def _extracted_claim(analysis: dict, paper_id: str, claim_id: str) -> dict | None:
    """The analysis claim behind an id like "<paper_id>#3", or None."""
    index = claim_id.removeprefix(f"{paper_id}#")
    claims = analysis.get("claims", [])
    return claims[int(index)] if index.isdigit() and int(index) < len(claims) else None


def _unread_references(analysis: dict, read: list[dict]) -> list[dict]:
    """The works the claims cite that have no PDF (#824), so a person can still add a passage
    from one and give it a level. They have no file: retrieval and the reference viewer skip them.
    """
    read_refs = {r["ref"] for r in read if r["ref"]}
    read_titles = {r["label"].casefold() for r in read}
    unread: dict[str, dict] = {}
    for claim in analysis.get("claims", []):
        for citation in claim.get("citations") or []:
            ref = citation.get("ref", "")
            title = citation.get("title") or _by_venue(citation) or citation.get("label") or ref
            if not ref or ref in read_refs or title.casefold() in read_titles:
                continue
            unread.setdefault(
                f"unread-{ref}",
                {
                    "reference_id": f"unread-{ref}",
                    "file": "",
                    "label": title,
                    "ref": ref,
                    "authors": citation.get("authors", []),
                    "year": citation.get("year", ""),
                },
            )
    return list(unread.values())


def _by_venue(citation: dict) -> str:
    """ "Velho et al., ACM Transactions on Modeling and Computer Simulation" for a work whose
    reference list gave no title (#937), or "" when it names no journal either."""
    venue = citation.get("venue") or ""
    surnames = [name.split()[-1] for name in citation.get("authors") or [] if name.split()]
    if len(surnames) > 2:
        people = f"{surnames[0]} et al."
    else:
        people = " and ".join(surnames)
    return ", ".join(part for part in (people, venue) if part) if venue else ""


async def labeler_id(who: str = Depends(annotator), user: str | None = Depends(current_user)) -> str:
    """The account a person's rows are kept under. With login off there is one shared space, so
    it is the shared name."""
    return user or who


def _mine_and_others(rows: dict[str, list[dict]], me: str, paper_id: str, blind: bool = False) -> dict:
    """What the account `me` already saved for this paper, and who else labeled which pair.
    On a blind check nobody else is named: knowing who labeled a pair is a hint (#867)."""
    mine = {
        tab: [r for r in current(tab, rows[tab]) if r["paper_id"] == paper_id and r["annotator_id"] == me]
        for tab in TABS
    }
    others: dict[str, list[str]] = {}
    for row in current("labels", rows["labels"]) if not blind else []:
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
    blind = await _is_blind(analysis["id"], who)
    return {**built, "annotator": who, "blind": blind, **_mine_and_others(rows, me, paper_id, blind)}


async def _compare_rows(store: ledger.Store, paper_id: str, me: str, lead: bool) -> dict[str, list[dict]]:
    """This paper's `claims`, `labels` and `compare_notes` rows, or 403 for someone who may not
    compare it yet."""
    tabs = ("claims", "labels", "compare_notes")
    rows = {tab: await asyncio.to_thread(store.read, tab, paper_id) for tab in tabs}
    if not compare.may_compare(me, lead, rows["claims"], rows["labels"]):
        raise HTTPException(403, "label this paper before comparing it with the other labelers")
    return rows


async def _leads_paper(analysis_id: str, who: str, lead: bool) -> bool:
    """Whether the caller compares this paper as a lead. Not on their own blind check: there a
    lead sees only the pairs they judged, like anyone else."""
    return lead and not await _is_blind(analysis_id, who)


@router.get("/compare/{analysis_id}")
async def compare_labels(
    analysis: dict = Depends(owned_analysis),
    who: str = Depends(annotator),
    me: str = Depends(labeler_id),
    lead: bool = Depends(is_lead),
):
    """Every labeler's verdict on each pair of this paper, next to the caller's (compare.py)."""
    built = build_session(analysis)
    lead = await _leads_paper(analysis["id"], who, lead)
    rows = await _compare_rows(_store(), built["paper_id"], me, lead)
    found = compare.verdicts(rows["claims"], rows["labels"])
    return compare.view(built, found, rows["compare_notes"], me, lead)


@router.post("/compare/{analysis_id}/notes")
async def add_compare_note(
    body: CompareNoteIn,
    analysis: dict = Depends(owned_analysis),
    who: str = Depends(annotator),
    me: str = Depends(labeler_id),
    lead: bool = Depends(is_lead),
):
    """A note on one pair, for the labelers to talk a disagreement through. Only on a pair the
    caller can see on the Compare screen."""
    paper_id = _paper_id(analysis)
    store = _store()
    lead = await _leads_paper(analysis["id"], who, lead)
    rows = await _compare_rows(store, paper_id, me, lead)
    by_account = compare.verdicts(rows["claims"], rows["labels"]).get((body.claim_id, body.reference_id))
    if by_account is None or not (lead or me in by_account):
        raise HTTPException(404, "no such pair on your Compare screen")
    row = {**_stamp(who, me, paper_id), **body.model_dump()}
    await asyncio.to_thread(store.append, "compare_notes", [row])
    return {"author": who, "ts": row["ts"], "note": body.note}


async def _is_blind(analysis_id: str, who: str) -> bool:
    """Whether `who` checks this paper blind."""
    return analysis_id in await asyncio.to_thread(pool.blind_for, who)


async def _refuse_on_blind(analysis_id: str, who: str, what: str) -> None:
    """403 when `who` checks this paper blind: the judge's opinion would sway the label."""
    if await _is_blind(analysis_id, who):
        raise HTTPException(403, f"{what} is off on a blind check, so the judge cannot sway your label")


@router.post("/sessions/{analysis_id}/candidates")
async def added_claim_candidates(
    body: AddedClaimIn, analysis: dict = Depends(owned_analysis), _who: str = Depends(annotator)
):
    """Passages retrieval finds for a claim the analysis has none for.

    A claim added by hand (#404) is searched in every reference paper. An extracted claim is
    searched in the papers it cites that have a PDF: one that only names a work was never checked,
    though another claim may have downloaded that work (#836). The same search the analysis ran
    for its own claims, so the labeler has passages to judge instead of reading every reference.
    The references are already in the ColBERT index from the analysis, and are searched at once.
    """
    built = build_session(analysis)
    paper_id = built["paper_id"]
    if body.claim_id.startswith(f"{paper_id}#h-"):
        references = built["references"]
    elif (claim := _extracted_claim(analysis, paper_id, body.claim_id)) is not None:
        cited = {citation.get("ref") for citation in claim.get("citations") or []} - {"", None}
        references = [r for r in built["references"] if r["ref"] in cited]
    else:
        raise HTTPException(422, f"{body.claim_id} is not a claim of this paper")
    try:
        found = await asyncio.gather(
            *(asyncio.to_thread(verify.evidence_from, body.claim, r["file"]) for r in references)
        )
    except requests.RequestException as error:  # ColBERT down, or still waking up past the timeout
        raise HTTPException(502, "retrieval did not answer") from error
    return {
        "candidates": [
            cand
            for reference, hits in zip(references, found, strict=True)
            for cand in _candidates(body.claim_id, reference["reference_id"], reference["file"], hits)
        ]
    }


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
    lead: bool = Depends(is_lead),
):
    """Topics, who has which, the papers shared with the team, and the caller's blind checks.
    A lead also gets every blind check, to manage them."""
    from app import main

    def build() -> dict:
        topics = pool.people()
        names = sorted({*_team(), *topics, who})
        # paper_id -> account -> extracted claims judged. A claim someone added by hand makes them
        # a labeler of the paper but is not one of the claims the paper is counted in.
        by_paper: dict[str, dict[str, int]] = {}
        # paper_id -> extracted claims anyone has judged. Two people on one claim count once.
        team_decided: dict[str, set[str]] = {}
        name_of = {me: who}  # account -> the name on its latest row; the viewer by their name now
        for r in _claim_rows():
            paper_id = r.get("paper_id", "")
            counts = by_paper.setdefault(paper_id, {})
            account = r.get("annotator_id", "")
            extracted = r.get("origin") != "human_added"
            counts[account] = counts.get(account, 0) + extracted
            if extracted:
                team_decided.setdefault(paper_id, set()).add(r.get("claim_id", ""))
            if account != me:
                name_of[account] = r.get("annotator", "")
        shared = []
        doi_of: dict[str, str] = {}  # analysis id -> DOI, for the subject and keywords below
        uploaded = pool.uploaded_dois()
        sharers = pool.shared_by()
        ranks = pool.venue_ranks()
        for analysis_id, topic in pool.pooled().items():
            row = main.lookup(analysis_id)
            if not row:
                continue
            status = row.get("status")
            if status == "done" and not row.get("claims"):
                continue  # nothing to label
            stages = row.get("stages") or []
            reason = next((s.get("message", "") for s in reversed(stages) if s.get("stage") == "error"), "")
            paper_id = Path(row["file"]).stem if row.get("file") else ""
            counts = by_paper.get(paper_id, {}) if paper_id else {}
            # A paper added from Scopus was started from its DOI; an uploaded one may have one
            # on its assignment.
            if doi := uploaded.get(analysis_id) or scopus.doi_in(str(row.get("paper", ""))):
                doi_of[analysis_id] = doi.lower()
            shared.append(
                {
                    "analysis_id": analysis_id,
                    "title": row.get("title") or row.get("paper") or analysis_id,
                    "topic": topic,
                    "claims": len(row.get("claims") or []),
                    "judged": counts.get(me, 0),
                    "team_judged": len(team_decided.get(paper_id, ())) if paper_id else 0,
                    "labelers": sorted({name_of[account] for account in counts}),
                    "status": status,
                    "reason": reason if status == "error" else "",
                    "mine": row.get("owner") == user,
                    "added_by": sharers.get(analysis_id, ""),
                    "venue_rank": ranks.get(analysis_id, ("", ""))[0],
                    "venue_rank_source": ranks.get(analysis_id, ("", ""))[1],
                }
            )
        subjects = scopus.subjects_of(list(doi_of.values()))
        for paper in shared:
            paper.update(subjects.get(doi_of.get(paper["analysis_id"], ""), {"subject": "", "keywords": []}))
        checks = pool.blind_checks()
        return {
            "topics": TOPICS,
            "me": who,
            "lead": lead,
            "people": [{"name": n, "topic": topics.get(n, "")} for n in names],
            "papers": shared,
            "blind": sorted(analysis_id for person, analysis_id in checks if person == who),
            "blind_checks": [{"name": n, "analysis_id": a} for n, a in checks] if lead else [],
        }

    return await asyncio.to_thread(build)


@router.put("/people")
async def set_person_topic(body: PersonTopicIn, who: str = Depends(annotator)):
    if body.name != who and body.name not in await asyncio.to_thread(_team):
        raise HTTPException(422, f"{body.name} is not on the team")
    _store()
    await asyncio.to_thread(pool.assign, who, "person", body.name, body.topic)
    return {"name": body.name, "topic": body.topic}


@router.put("/blind")
async def set_blind_check(body: BlindCheckIn, who: str = Depends(annotator), lead: bool = Depends(is_lead)):
    """Give a person a shared paper to label blind, or take it back. Leads only."""
    if not lead:
        raise HTTPException(403, "only a labeling lead can assign blind checks")
    if body.name not in await asyncio.to_thread(_team):
        raise HTTPException(422, f"{body.name} is not on the team")
    if body.analysis_id not in await asyncio.to_thread(pool.pooled):
        raise HTTPException(422, "that paper is not shared with the team")
    _store()
    key = pool.blind_key(body.name, body.analysis_id)
    await asyncio.to_thread(pool.assign, who, pool.BLIND, key, pool.BLIND if body.on else "")
    return {"name": body.name, "analysis_id": body.analysis_id, "on": body.on}


@router.put("/papers/{analysis_id}/topic")
async def set_paper_topic(
    body: TopicIn, analysis: dict = Depends(mine_analysis), who: str = Depends(annotator)
):
    """Share one of your own analyses with the team under a topic, or take it back with ""."""
    # Only sharing needs the paper. A paper that failed to download has none, and must still
    # come off the list (#576).
    if body.topic:
        _paper_id(analysis)
    _store()
    rank = None  # keeps the rank it was listed with before
    doi = scopus.doi_in(str(analysis.get("paper", "")))
    if body.topic and doi and analysis["id"] not in await asyncio.to_thread(pool.venue_ranks):
        rank = await asyncio.to_thread(_venue_rank, doi)
    await asyncio.to_thread(
        pool.assign, who, "paper", analysis["id"], body.topic, analysis.get("owner") or "", "", rank
    )
    return {"analysis_id": analysis["id"], "topic": body.topic}


@router.post("/papers/{analysis_id}/retry")
async def retry_paper(
    analysis: dict = Depends(mine_analysis),
    user: str | None = Depends(current_user),
    who: str = Depends(annotator),
):
    """Read one of your shared papers again after it failed: a new analysis of the same DOI
    takes its place on the team's list, under the same topic."""
    from app import main

    if analysis.get("status") != "error":
        raise HTTPException(409, "only a paper that could not be read can be tried again")
    topic = (await asyncio.to_thread(pool.pooled)).get(analysis["id"])
    if not topic:
        raise HTTPException(404, "this paper is not on the team's list")
    _store()
    # On the event loop, as scopus_add does: _start schedules its save with create_task (#397).
    started = main._start(analysis["paper"], True, user, LABELING_CLAIM_LIMIT)
    # An uploaded paper's analysis only knows its file, so its DOI moves to the new one.
    doi = (await asyncio.to_thread(pool.uploaded_dois)).get(analysis["id"], "")
    venue_rank, source = (await asyncio.to_thread(pool.venue_ranks)).get(analysis["id"], ("", ""))
    rank = {"venue_rank": venue_rank, "venue_rank_source": source}
    # The new analysis is listed before the failed one leaves, so the paper never disappears.
    await asyncio.to_thread(pool.assign, who, "paper", started["id"], topic, user or "", doi, rank)
    await asyncio.to_thread(pool.assign, who, "paper", analysis["id"], "", analysis.get("owner") or "")
    return {"id": started["id"]}


@router.post("/papers/{analysis_id}/share-upload")
async def share_upload(
    body: UploadShareIn,
    analysis: dict = Depends(mine_analysis),
    user: str | None = Depends(current_user),
    who: str = Depends(annotator),
):
    """List one of your analyses of an uploaded PDF for the team.

    For a paper whose PDF the analysis cannot download. The browser uploads the PDF and starts
    the analysis as the Researcher role does (POST /analyses/upload, or the papers bucket where
    the web proxy would refuse a large file), then calls this. `doi` links the paper to its
    Scopus record, so it shows as added there and gets its keywords. `replaces` is one of your
    listed papers that could not be read: it leaves the list, and this one takes its topic and,
    when no DOI is given, its DOI.
    """
    from app import main

    pooled = await asyncio.to_thread(pool.pooled)
    if analysis["id"] in pooled:
        raise HTTPException(409, "that analysis is already on the list")
    doi = (scopus.doi_in(body.doi) or "").lower()
    topic = body.topic
    if body.replaces:
        failed = await asyncio.to_thread(main.lookup, body.replaces)
        topic = pooled.get(body.replaces, "")
        if not failed or failed.get("owner") != user or not topic:
            raise HTTPException(404, "you have no listed paper with that id")
        if failed.get("status") != "error":
            raise HTTPException(409, "only a paper that could not be read can be replaced")
        doi = doi or await asyncio.to_thread(lambda: _paper_doi(main, body.replaces, pool.uploaded_dois()))
    if not topic:
        raise HTTPException(422, "pick a topic for the paper")
    listed = doi and await asyncio.to_thread(_doi_in_pool, main, doi)
    if listed and listed != body.replaces:
        raise HTTPException(409, "that paper is already on the list; upload its PDF from its row there")
    _store()
    rank = await asyncio.to_thread(_venue_rank, doi) if doi else None
    await asyncio.to_thread(pool.assign, who, "paper", analysis["id"], topic, user or "", doi, rank)
    if body.replaces:
        await asyncio.to_thread(pool.assign, who, "paper", body.replaces, "", user or "")
    return {"id": analysis["id"]}


def _paper_doi(main, analysis_id: str, uploaded: dict[str, str]) -> str:
    """The analysis's DOI, lower-case: the one its PDF was uploaded with (`uploaded`, from
    pool.uploaded_dois), or the DOI it was started from; "" for neither. Looks the analysis up,
    which can read the store, so callers run this off the event loop."""
    paper = str((main.lookup(analysis_id) or {}).get("paper", ""))
    return (uploaded.get(analysis_id) or scopus.doi_in(paper) or "").lower()


def _venue_rank(doi: str) -> dict[str, str]:
    """The rank columns of a paper being listed; empty when Scopus is not set up or fails, so a
    missing rank never stops a paper being listed."""
    try:
        return pool.rank_columns(scopus.rank_of(doi))
    except (scopus.NotConfigured, requests.RequestException) as error:
        log.warning("no venue rank for %s: %s", doi, type(error).__name__)
        return pool.rank_columns(None)


def _doi_in_pool(main, doi: str) -> str | None:
    """The pooled analysis of this DOI. Runs off the event loop, like _paper_doi."""
    uploaded = pool.uploaded_dois()
    return next((a for a in pool.pooled() if _paper_doi(main, a, uploaded) == doi.lower()), None)


def _pooled_dois(main) -> set[str]:
    """DOIs already in the labeling pool. Runs off the event loop, like _paper_doi."""
    uploaded = pool.uploaded_dois()
    return {doi for analysis_id in pool.pooled() if (doi := _paper_doi(main, analysis_id, uploaded))}


@router.get("/scopus/search")
async def scopus_search(
    topic: str,
    q: str = "",
    since: int = 2020,
    until: int | None = None,
    sort: str = "cited",
    page: int = 0,
    scope: scopus.Scope = "topic",
    rank: list[VenueRank] = Query([]),
    _who: str = Depends(annotator),
):
    """One page of open-access papers from Scopus, with the total and each abstract.

    `scope` is "topic" for the topic's venues or "all" for every venue; a DOI or paper link in
    `q` finds that paper. The topic is still checked: an added paper is filed under it. Each
    paper says whether it is already listed, whether its PDF can be downloaded (true, false, or
    null when that could not be checked) and its venue `rank` (null when that could not be looked
    up). `rank`, given once or more, keeps only papers with one of those venue ranks; `hidden`
    is how many on this page it left out. A failure says why: the page shows it.
    """
    from app import main

    if topic not in TOPICS:
        raise HTTPException(422, f"no such topic: {topic}")
    if sort not in scopus.SORTS:
        raise HTTPException(422, f"sort must be one of {', '.join(scopus.SORTS)}")
    try:
        start = max(page, 0) * scopus.PAGE
        found = await asyncio.to_thread(
            scopus.search, topic, q, since, until, sort, start, scope, frozenset(rank)
        )
    except scopus.NotConfigured as error:
        raise HTTPException(503, f"Scopus is not set up: {error}") from error
    except requests.Timeout as error:
        log.warning("Scopus search timed out twice: %s", error)
        raise HTTPException(504, "Scopus took too long to answer") from error
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else 0
        log.warning("Scopus search refused: HTTP %s", status)
        if status == 429:
            raise HTTPException(429, "the Scopus key has used its quota for now") from error
        if status in (401, 403):
            raise HTTPException(502, "Scopus refused the API key") from error
        raise HTTPException(502, f"Scopus answered HTTP {status}") from error
    except requests.RequestException as error:
        log.warning("Scopus search failed: %s", error)
        raise HTTPException(502, "Scopus could not be reached") from error
    listed, copies = await asyncio.gather(
        asyncio.to_thread(_pooled_dois, main),
        asyncio.to_thread(scopus.downloadable, [paper["doi"] for paper in found["results"]]),
    )
    papers = [
        {
            **paper,
            "added": paper["doi"].lower() in listed,
            "downloadable": copies.get(paper["doi"].lower()),
        }
        for paper in found["results"]
    ]
    return {"total": found["total"], "results": papers, "hidden": found["hidden"]}


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
    rank = await asyncio.to_thread(_venue_rank, body.doi)
    # On the event loop, as POST /analyses does: _start schedules its save with create_task (#397).
    started = main._start(body.doi, True, user, LABELING_CLAIM_LIMIT)
    await asyncio.to_thread(pool.assign, who, "paper", started["id"], body.topic, user or "", "", rank)
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
    unread = {r["reference_id"] for r in built["unread"]}
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
        elif item.origin == "retrieved_added":
            # Found live, so not in the analysis to check against. The id is rebuilt here from
            # what is stored, as the candidates route built it.
            if item.reference_id not in references:
                raise HTTPException(422, f"unknown passage for {item.claim_id}")
            row["cand_id"] = _candidate_id(item.claim_id, item.reference_id, item.rank or 0, item.passage)
        else:
            if item.reference_id not in references | unread:
                raise HTTPException(422, f"{item.reference_id} is not a paper this analysis cites")
            row["cand_id"] = _candidate_id(item.claim_id, item.reference_id, 0, item.passage)
        candidates.append({**stamp, **row})

    claim_text = {c["claim_id"]: c["claim_edited"] or c["claim"] for c in claims} | {
        cid: c["claim"] for cid, c in extracted.items() if cid not in {x["claim_id"] for x in claims}
    }
    for item in body.labels:
        if item.reference_id not in references | unread:
            raise HTTPException(422, f"{item.reference_id} is not a paper this analysis cites")
        if not claim_known(item.claim_id, "human_added" if "#h-" in item.claim_id else "extracted"):
            raise HTTPException(422, f"unknown claim {item.claim_id}")
        row = item.model_dump()
        row["spans"] = json.dumps(item.spans, ensure_ascii=False)
        row["claim"] = claim_text.get(item.claim_id, "")
        labels.append({**stamp, **row})

    store = _store()
    reviewed = await asyncio.to_thread(_reviewed_claims, store, paper_id, me)
    for row in (*claims, *candidates, *labels):
        row["ai_reviewed"] = "1" if row["claim_id"] in reviewed else ""
    for tab, rows in (("claims", claims), ("candidates", candidates), ("labels", labels)):
        await asyncio.to_thread(store.append, tab, rows)
    return {"claims": len(claims), "candidates": len(candidates), "labels": len(labels)}


def _reviewed_claims(store, paper_id: str, me: str) -> set[str]:
    """The claims of this paper `me` has had a finished AI review of (one left halfway is not kept)."""
    return {row["claim_id"] for row in store.read("reviews", paper_id) if row.get("annotator_id") == me}


@router.post("/sessions/{analysis_id}/review")
async def review_claim(
    body: ReviewIn,
    analysis: dict = Depends(owned_analysis),
    who: str = Depends(annotator),
    me: str = Depends(labeler_id),
):
    """The AI's review of one claim the caller has saved, as server-sent events.

    Each event is `{"type": "finding", "target", "tone", "text"}`, then
    `{"type": "done", "findings": n}`. What it said is kept in the reviews tab. Only a saved claim
    is reviewed: the person's own decision comes first (docs/labeling.md). Off on a blind check.
    """
    await _refuse_on_blind(analysis["id"], who, "Review")
    store = _store()
    built = build_session(analysis)
    paper_id = built["paper_id"]
    saved = await asyncio.to_thread(_saved_claim, store, paper_id, me, body.claim_id)
    if saved is None:
        raise HTTPException(409, "save this claim before asking for a review")
    extracted = {c["claim_id"]: c for c in built["claims"]}
    # A claim added by hand is not in the analysis: it has no retrieved passages to check.
    claim = extracted.get(body.claim_id) or {
        "claim_id": body.claim_id,
        "claim": saved.claim_row.get("claim", ""),
        "candidates": [],
    }
    stamp = {**_stamp(who, me, paper_id), "claim_id": body.claim_id}
    from app import main

    # The judges can take a while; the heartbeats keep a proxy from closing a quiet stream.
    events = main._keep_alive(_review_events(store, stamp, claim, saved))
    return StreamingResponse(events, media_type="text/event-stream")


async def review_for(analysis_id: str, claim_number: int, user: str | None) -> list[dict]:
    """The AI's review of claim `claim_number` (1-based, as in the claim bar) for `user`, all at
    once, for the MCP server. The same rules as the page's review: only a claim the caller saved,
    labels stay as they are, and what it found goes to the reviews tab.

    Raises:
        HTTPException: 404 for an analysis the caller may not label or a claim number it does not
            have, 409 for a claim the caller has not saved.
    """
    analysis = await owned_analysis(analysis_id, user)
    built = build_session(analysis)
    claims = built["claims"]
    if not 1 <= claim_number <= len(claims):
        raise HTTPException(404, f"this paper has claims 1 to {len(claims)}, not {claim_number}")
    claim = claims[claim_number - 1]
    who = await asyncio.to_thread(identity.annotator_for, user)
    me = user or who  # as labeler_id: with login off there is one shared space
    store = _store()
    saved = await asyncio.to_thread(_saved_claim, store, built["paper_id"], me, claim["claim_id"])
    if saved is None:
        raise HTTPException(409, "save this claim in the labeler before asking for a review")
    findings = [finding.model_dump() async for finding in review.review(claim, saved)]
    row = {**_stamp(who, me, built["paper_id"]), "claim_id": claim["claim_id"]}
    row["findings"] = json.dumps(findings, ensure_ascii=False)
    await asyncio.to_thread(store.append, "reviews", [row])
    return findings


async def labels_for(analysis_id: str, claim_number: int, user: str | None) -> dict:
    """What `user` saved for claim `claim_number` (1-based), for a coding agent to review over MCP.

    Reading them counts as an AI review: a row goes to the reviews tab, so the next save of this
    claim is marked ai_reviewed and an eval can keep labels the agent may have swayed apart.

    Raises:
        HTTPException: 404 for an analysis the caller may not label or a claim number it does not
            have, 409 for a claim the caller has not saved.
    """
    analysis = await owned_analysis(analysis_id, user)
    built = build_session(analysis)
    claims = built["claims"]
    if not 1 <= claim_number <= len(claims):
        raise HTTPException(404, f"this paper has claims 1 to {len(claims)}, not {claim_number}")
    claim_id = claims[claim_number - 1]["claim_id"]
    who = await asyncio.to_thread(identity.annotator_for, user)
    me = user or who  # as labeler_id: with login off there is one shared space
    store = _store()
    saved = await asyncio.to_thread(_saved_claim, store, built["paper_id"], me, claim_id)
    if saved is None:
        raise HTTPException(409, "save this claim in the labeler before an agent reviews it")
    note = review.Finding(
        target=review.Target(kind="claim", id=claim_id),
        tone="asks",
        text="A coding agent read these labels over MCP. Check what it said before you change them.",
    )
    row = {**_stamp(who, me, built["paper_id"]), "claim_id": claim_id}
    row["findings"] = json.dumps([note.model_dump()], ensure_ascii=False)
    await asyncio.to_thread(store.append, "reviews", [row])
    names = {r["reference_id"]: r["label"] for r in [*built["references"], *built["unread"]]}
    return {
        "claim": saved.claim_row["claim"],
        "labels": [
            {
                "paper": names.get(label["reference_id"], label["reference_id"]),
                "level": int(label["evidence"]),  # the tabs keep every cell as text
                "rationale": label["rationale"],
                "confidence": label["confidence"],
            }
            for label in saved.labels
        ],
        "passages": [
            {
                "paper": names.get(passage["reference_id"], passage["reference_id"]),
                "page": passage["page"],
                "status": passage["status"],
                "text": passage["passage"],
            }
            for passage in saved.candidates
        ],
    }


async def progress_for(analysis_id: str, user: str | None) -> dict:
    """Where `user` stands on one paper in the labeler, for the MCP server and the screen agent:
    how many claims they saved and had reviewed, and the first claim they have not saved, with
    the passages found for it. Reads only.

    Raises:
        HTTPException: 404 for an analysis the caller may not label.
    """
    analysis = await owned_analysis(analysis_id, user)
    built = build_session(analysis)
    who = await asyncio.to_thread(identity.annotator_for, user)
    me = user or who  # as labeler_id: with login off there is one shared space
    store = _store()
    rows = await asyncio.to_thread(store.read, "claims", built["paper_id"])
    saved = {row["claim_id"] for row in current("claims", rows) if row["annotator_id"] == me}
    reviewed = await asyncio.to_thread(_reviewed_claims, store, built["paper_id"], me)
    labels = {reference["reference_id"]: reference["label"] for reference in built["references"]}
    next_claim = None
    for number, claim in enumerate(built["claims"], 1):
        if claim["claim_id"] not in saved:
            next_claim = {
                "number": number,
                "claim": claim["claim"],
                "sentence": claim["sentence"],
                "section": claim["section"],
                "passages": [
                    {"paper": labels[c["reference_id"]], "page": c["page"], "text": c["passage"]}
                    for c in claim["candidates"][:NEXT_PASSAGES]
                ],
            }
            break
    return {
        "claims": len(built["claims"]),
        "saved": len(saved & {c["claim_id"] for c in built["claims"]}),
        "reviewed": len(reviewed & saved),
        "next_unsaved": next_claim,
    }


def _saved_claim(store, paper_id: str, me: str, claim_id: str) -> review.Saved | None:
    """`me`'s current rows for one claim, or None when they have not saved a decision on it."""
    mine = {
        tab: [
            row
            for row in current(tab, store.read(tab, paper_id))
            if row["annotator_id"] == me and row["claim_id"] == claim_id
        ]
        for tab in TABS
    }
    if not mine["claims"]:
        return None
    return review.Saved(claim_row=mine["claims"][0], candidates=mine["candidates"], labels=mine["labels"])


async def _review_events(store, stamp: dict, claim: dict, saved: review.Saved):
    """The review as server-sent events; once it ends, what it found goes to the reviews tab.
    A failure is an error event, so the page does not show a half review as a finished one."""
    findings = []
    try:
        async for finding in review.review(claim, saved):
            findings.append(finding.model_dump())
            yield f"data: {json.dumps({'type': 'finding', **findings[-1]})}\n\n"
    except Exception:
        log.exception("the review of %s failed", stamp["claim_id"])
        yield f"data: {json.dumps({'type': 'error', 'message': 'the review stopped partway; try again'})}\n\n"
        return
    row = {**stamp, "findings": json.dumps(findings, ensure_ascii=False)}
    await asyncio.to_thread(store.append, "reviews", [row])
    yield f"data: {json.dumps({'type': 'done', 'findings': len(findings)})}\n\n"


@router.post("/sessions/{analysis_id}/ask")
async def ask(body: AskIn, analysis: dict = Depends(owned_analysis), who: str = Depends(annotator)):
    """Answer a question from the paper under review, from one of its references, or from one
    passage of a reference. A claim sent with the question is added to it, so the answer reads
    the passage with the claim as the labeler worded it.

    The same answer as the other roles' Ask (assistant.answer): short statements, each checked by
    the judge, as server-sent events.
    """
    await _refuse_on_blind(analysis["id"], who, "Ask")
    if body.passage and not body.reference_id:
        raise HTTPException(422, "a passage needs reference_id, the paper it is from")
    if not body.reference_id:
        pdf = analysis["file"]
    elif (pdf := _reference_path(analysis, body.reference_id)) is None:
        raise HTTPException(422, f"{body.reference_id} is not a paper this analysis read")
    question = f'{body.question}\nThe claim: "{body.claim}"' if body.claim else body.question
    passages = [body.passage] if body.passage else None
    from app import main

    events = main._keep_alive(_answer_events(question, pdf, passages))
    return StreamingResponse(events, media_type="text/event-stream")


def _reference_path(analysis: dict, reference_id: str) -> str | None:
    """Where the analysis found a reference's PDF, by the id build_session gave it."""
    for claim in analysis.get("claims", []):
        for verdict in claim.get("verdicts") or []:
            if verdict.get("source") and Path(verdict["source"]).stem == reference_id:
                # A verdict names the file only; local_pdf reads a bare name as a title to search.
                return (config.PAPERS_DIR / Path(verdict["source"]).name).as_posix()
    return None


async def _answer_events(question: str, pdf: str, passages: list[str] | None = None):
    """assistant.answer's events for one PDF, after making sure the PDF is indexed."""
    from app import assistant  # imports dspy, about 0.6 s, so not at start-up

    prepared = await asyncio.to_thread(verify.prepare_source, pdf)
    if prepared["status"] != "ok":
        yield f"data: {json.dumps({'type': 'error', 'message': 'this paper could not be read'})}\n\n"
        return
    try:
        events = assistant.answer(question, paper=Path(prepared["path"]), passages=passages)
        async for event in events:
            yield f"data: {json.dumps(event)}\n\n"
    except Exception:
        log.exception("answering a labeler's question failed")
        yield f"data: {json.dumps({'type': 'error', 'message': 'the answer stopped partway; try again'})}\n\n"


def _scoped(tab: str, rows: list[dict], scope: ExportScope, me: str) -> list[dict]:
    """The current rows of a tab: the account `me`'s own, or everyone's grouped by account and paper."""
    return _in_scope(current(tab, rows), scope, me)


def _in_scope(rows: list[dict], scope: ExportScope, me: str) -> list[dict]:
    """The rows `scope` covers, in their saved order within each account and paper (a stable sort),
    so current() still finds the latest row per key."""
    if scope == "mine":
        return [r for r in rows if _account(r) == me]
    return sorted(rows, key=lambda r: (_account(r), r["paper_id"]))


def _account(row: dict) -> str:
    """Whose row it is. A row from before rows carried annotator_id is the person's by name,
    as in current()."""
    return row.get("annotator_id") or row.get("annotator", "")


def _by_paper[T](by_analysis: dict[str, T]) -> dict[str, T]:
    """The same values keyed by paper_id (the PDF's stem), which is what label rows carry."""
    from app import main

    found = {}
    for analysis_id, value in by_analysis.items():
        row = main.lookup(analysis_id)
        if row and row.get("file"):
            found[Path(row["file"]).stem] = value
    return found


@router.get("/export")
async def export(
    tab: str = "labels",
    scope: ExportScope = "mine",
    me: str = Depends(labeler_id),
    lead: bool = Depends(is_lead),
):
    """The current rows of one tab as CSV: the latest row per key, without what a person later
    took back (a rejected claim's labels and passages, a passage they added and then removed).
    `dspy_claims` and `dspy_verdicts` give the same rows as DSPy examples (dspy_export.py), as JSONL.

    `scope=mine` gives only the caller's rows, so people labeling different papers do not get each
    other's (#585). `scope=team` gives everyone's, for building the dataset, and only to a lead:
    with it a blind check would not be blind (#867)."""
    if scope == "team" and not lead:
        raise HTTPException(403, "only a labeling lead can download the whole team's labels")
    store = _store()
    if tab in ("dspy_claims", "dspy_verdicts"):
        # Every saved row, not only the current ones: dspy_export reads a label's level from
        # before the AI review out of the history.
        rows = {name: _in_scope(await asyncio.to_thread(store.read, name), scope, me) for name in TABS}
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
    rows = _scoped(tab, await asyncio.to_thread(store.read, tab), scope, me)
    if tab != "claims":
        claims = await asyncio.to_thread(store.read, "claims")
        rejected = {
            (r["claim_id"], r["annotator_id"]) for r in current("claims", claims) if r["status"] == "rejected"
        }
        rows = [r for r in rows if (r["claim_id"], r["annotator_id"]) not in rejected]
    if tab == "candidates":
        rows = [r for r in rows if not (r["origin"] == "human_added" and r["status"] == "rejected")]
    columns = TABS[tab]
    if tab == "labels":
        # The paper's venue rank from when it was listed, for the thesis table (SCRUM-445), and its
        # topic, which split_dataset.py balances the splits on.
        ranks = await asyncio.to_thread(lambda: _by_paper(pool.venue_ranks()))
        topics = await asyncio.to_thread(lambda: _by_paper(pool.pooled()))
        columns = [*columns, "venue_rank", "venue_rank_source", "topic"]
        rows = [
            {
                **r,
                **dict(zip(columns[-3:-1], ranks.get(r["paper_id"], ("", "")), strict=True)),
                "topic": topics.get(r["paper_id"], ""),
            }
            for r in rows
        ]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        out.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={tab}.csv"},
    )
