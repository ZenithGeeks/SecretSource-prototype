"""HTTP routes for the Author role: drafts, projects, saved sources, draft checks, source
search and the verification report. Mounted under /author by app/main.py.

Storage: projects, drafts and sources are one JSON row each in their own tables
(app/store.py's *_author_row functions), always owner-scoped. A draft check is an `analyses`
row with kind "draft-check" — the same dict, SSE stream, save-soon and restart recovery the
single-claim checks of SCRUM-236 use — so it is reached through app.main's helpers, imported
lazily here (main imports this module first).

Every route requires the same optional login as the rest of the gateway: with Supabase
configured a token is mandatory, without it every caller shares the ownerless space.
"""

import asyncio
import io
import re
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app import store
from app.auth import current_user
from app.author import logic
from app.author.verify import citation_outcome, verify_cached
from app.config import PARALLEL_CHECKS
from app.ownership import require_owner

# The browser uses /api/author; Vite/nginx remove /api before forwarding to FastAPI.
router = APIRouter(prefix="/author", tags=["author"])

PROJECTS, DRAFTS, SOURCES = "author_projects", "author_drafts", "author_sources"
DRAFT_CHECK = "draft-check"
FILE_UPLOAD = File(...)
MAX_TEXT_FILE = 2 * 1024 * 1024  # a chapter, not a scan
MAX_ZIP_FILES = 200
SEARCH_FIELDS = "title,authors,year,venue,externalIds,openAccessPdf,citationCount,abstract"

# PDFs verified from Find a source this process lifetime, per user, so "show in the paper"
# can open them (app.main.papers_of). Draft checks persist their PDFs on the check row.
verified_pdfs: dict[str | None, set[str]] = {}


def _gateway():
    """app.main, imported at call time: it imports this module, so a top-level import would
    be circular."""
    from app import main

    return main


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _kind_of(name: str) -> str:
    return "bib" if name.lower().endswith(".bib") else "tex"


def _safe_name(name: str) -> str:
    """A file name inside a draft: relative, no traversal, tex or bib only."""
    name = name.replace("\\", "/").strip().lstrip("/")
    if (
        not name
        or ".." in name.split("/")
        or not re.fullmatch(r"[A-Za-z0-9._/ -]+\.(tex|bib)", name, flags=re.I)
    ):
        raise HTTPException(400, "a draft file is a .tex or .bib name, without ..")
    return name


# --- rows -----------------------------------------------------------------------------


def _rows(table: str, user: str | None) -> list[dict]:
    return store.load_author_rows(table, user)


def _row(table: str, row_id: str, user: str | None, what: str) -> dict:
    """One of the caller's rows. Someone else's is a 404 like a missing one, so an id never
    tells anyone that it exists (app/ownership.py, the same rule as the gateway's analyses)."""
    return require_owner(store.load_author_row(table, row_id), user, what)


def _save(table: str, row: dict) -> dict:
    row["updated"] = logic.now_iso()
    store.save_author_row(table, row)
    return row


def _public(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("owner", "savedHash")}


# --- drafts and their checks ------------------------------------------------------------


def _checks_by_draft(user: str | None) -> dict[str, list[dict]]:
    """Every check this user ran, grouped by draft, each group oldest first: one pass over
    the gateway's rows for a whole request, however many drafts it lists."""
    by_draft: dict[str, list[dict]] = {}
    for a in _gateway().analyses.values():
        if a.get("kind") == DRAFT_CHECK and a.get("owner") == user:
            by_draft.setdefault(a.get("draftId"), []).append(a)
    for runs in by_draft.values():
        runs.sort(key=lambda a: a.get("startedAt", ""))
    return by_draft


def _checks_of(draft_id: str, user: str | None) -> list[dict]:
    """Every check run on a draft, oldest first. For one draft; a route that lists many uses
    _checks_by_draft once instead of this once per draft."""
    return _checks_by_draft(user).get(draft_id, [])


def _latest_done(runs: list[dict]) -> dict | None:
    done = [r for r in runs if r.get("status") == "done"]
    return done[-1] if done else None


def check_view(run: dict, previous: dict | None = None, full: bool = True) -> dict:
    """A check as the screens read it: counts, the delta since the check before, and (when
    `full`) every citation."""
    citations = run.get("citations", [])
    view = {
        "id": run["id"],
        "draftId": run.get("draftId"),
        "version": run.get("version"),
        "status": run.get("status"),
        "message": run.get("message"),
        "startedAt": run.get("startedAt"),
        "finishedAt": run.get("finishedAt"),
        "summary": logic.summarize(citations),
        "sinceLastCheck": logic.delta(citations, previous.get("citations", []) if previous else None),
        "previousVersion": previous.get("version") if previous else None,
        "previousId": previous.get("id") if previous else None,
        # the same text and bibliography as the check before (a re-check without edits)
        "unchanged": bool(
            previous and run.get("contentHash") and run.get("contentHash") == previous.get("contentHash")
        ),
        "stages": run.get("stages", []),
    }
    if full:
        view["citations"] = citations
    return view


def draft_view(draft: dict, runs: list[dict] | None = None) -> dict:
    """A draft plus what its latest finished check says about it."""
    runs = runs or []
    latest = _latest_done(runs)
    done = [r for r in runs if r.get("status") == "done"]
    previous = done[-2] if len(done) > 1 else None
    running = next((r for r in reversed(runs) if r.get("status") == "running"), None)
    view = _public(draft)
    view["status"] = logic.summarize(latest.get("citations", [])) if latest else logic.summarize([])
    view["lastCheckedAt"] = latest.get("finishedAt") if latest else None
    view["lastCheckId"] = latest["id"] if latest else None
    view["runningCheckId"] = running["id"] if running else None
    view["sinceLastCheck"] = (
        logic.delta(latest.get("citations", []), previous.get("citations", []))
        if latest and previous
        else None
    )
    view["checks"] = len(done)
    return view


def _draft_files(draft: dict, project: dict | None) -> list[dict]:
    """The draft's files plus its project's .bib, which every draft of the project cites."""
    files = list(draft.get("files", []))
    if project and project.get("bib") and not any(f["name"] == project["bib"]["name"] for f in files):
        files.append(
            {
                "name": project["bib"]["name"],
                "kind": "bib",
                "content": project["bib"].get("content", ""),
                "shared": True,
            }
        )
    return files


def _project_of(draft: dict, user: str | None) -> dict | None:
    if not draft.get("projectId"):
        return None
    project = store.load_author_row(PROJECTS, draft["projectId"])
    return project if project and project.get("owner") == user else None


def _pdfs_for(draft: dict, project: dict | None) -> dict[str, str]:
    return {**(project or {}).get("pdfs", {}), **draft.get("pdfs", {})}


class DraftIn(BaseModel):
    title: str | None = None
    projectId: str | None = None
    files: list[dict] | None = None


class FileIn(BaseModel):
    content: str


def _new_draft(user: str | None, title: str, project_id: str | None, files: list[dict]) -> dict:
    now = logic.now_iso()
    draft = {
        "id": _new_id(),
        "owner": user,
        "projectId": project_id,
        "title": title.strip() or "Untitled draft",
        "version": 1,
        "files": files,
        "pdfs": {},
        "created": now,
        "updated": now,
        "savedAt": now,
        "savedHash": logic.content_hash(files),
    }
    store.save_author_row(DRAFTS, draft)
    return draft


def _text_files_from_upload(name: str, content: bytes) -> list[dict]:
    """The .tex and .bib files of an upload: the file itself, or those inside a .zip
    (an Overleaf export). Figures and everything else in the zip are left out."""
    lower = name.lower()
    if lower.endswith(".zip"):
        try:
            archive = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile as error:
            raise HTTPException(400, "not a zip file") from error
        files = []
        for info in archive.infolist()[:MAX_ZIP_FILES]:
            if (
                info.is_dir()
                or not info.filename.lower().endswith((".tex", ".bib"))
                or info.file_size > MAX_TEXT_FILE
            ):
                continue
            base = info.filename.replace("\\", "/")
            if base.startswith("__MACOSX/") or ".." in base.split("/"):
                continue
            text = archive.read(info).decode("utf-8", errors="replace")
            files.append({"name": base, "kind": _kind_of(base), "content": text})
        if not files:
            raise HTTPException(400, "the zip holds no .tex or .bib file")
        # main.tex first, then the rest in archive order, so the editor opens on it
        files.sort(key=lambda f: (f["name"].rsplit("/", 1)[-1] != "main.tex", f["kind"] == "bib"))
        return files
    if not lower.endswith((".tex", ".bib")):
        raise HTTPException(400, "upload a .tex, .bib or .zip file")
    if len(content) > MAX_TEXT_FILE:
        raise HTTPException(413, "a draft file must be under 2MB")
    base = Path(name).name
    return [{"name": base, "kind": _kind_of(base), "content": content.decode("utf-8", errors="replace")}]


@router.get("/drafts")
async def list_drafts(user: str | None = Depends(current_user)):
    drafts = await asyncio.to_thread(_rows, DRAFTS, user)
    runs = _checks_by_draft(user)
    views = [draft_view(d, runs.get(d["id"])) for d in drafts]
    return sorted(views, key=lambda d: d.get("updated", ""), reverse=True)


@router.post("/drafts")
async def create_draft(request: DraftIn, user: str | None = Depends(current_user)):
    if request.projectId:
        await asyncio.to_thread(_row, PROJECTS, request.projectId, user, "project")
    files = [
        {"name": _safe_name(f["name"]), "kind": _kind_of(f["name"]), "content": str(f.get("content", ""))}
        for f in (request.files or [])
    ] or [{"name": "main.tex", "kind": "tex", "content": ""}]
    draft = await asyncio.to_thread(
        _new_draft, user, request.title or "Untitled draft", request.projectId, files
    )
    return draft_view(draft)


@router.post("/drafts/upload")
async def upload_draft(
    file: UploadFile = FILE_UPLOAD, projectId: str | None = None, user: str | None = Depends(current_user)
):
    if projectId:
        await asyncio.to_thread(_row, PROJECTS, projectId, user, "project")
    files = _text_files_from_upload(file.filename or "draft.tex", await file.read())
    title = re.sub(r"\.(tex|bib|zip)$", "", Path(file.filename or "draft").name, flags=re.I)
    draft = await asyncio.to_thread(_new_draft, user, title, projectId, files)
    return draft_view(draft)


@router.get("/drafts/{draft_id}")
async def get_draft(draft_id: str, user: str | None = Depends(current_user)):
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    project = await asyncio.to_thread(_project_of, draft, user)
    view = draft_view(draft, _checks_of(draft_id, user))
    view["files"] = _draft_files(draft, project)
    view["pdfs"] = _pdfs_for(draft, project)
    return view


@router.patch("/drafts/{draft_id}")
async def update_draft(draft_id: str, request: DraftIn, user: str | None = Depends(current_user)):
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    if request.title is not None:
        draft["title"] = request.title.strip() or draft["title"]
    if request.projectId is not None:
        if request.projectId:
            await asyncio.to_thread(_row, PROJECTS, request.projectId, user, "project")
        draft["projectId"] = request.projectId or None
    await asyncio.to_thread(_save, DRAFTS, draft)
    return draft_view(draft, _checks_of(draft_id, user))


@router.delete("/drafts/{draft_id}")
async def delete_draft(draft_id: str, user: str | None = Depends(current_user)):
    await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    gateway = _gateway()
    for run in _checks_of(draft_id, user):
        if run.get("status") != "running":
            await gateway._delete_one(run["id"])
    await asyncio.to_thread(store.delete_author_row, DRAFTS, draft_id)
    return {"deleted": draft_id}


@router.put("/drafts/{draft_id}/files/{name:path}")
async def put_file(draft_id: str, name: str, request: FileIn, user: str | None = Depends(current_user)):
    """Write one file's whole content; a new name adds the file. The version is not bumped
    here — that is what Save does — so typing never makes a v4 out of a v3."""
    name = _safe_name(name)
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    if len(request.content.encode("utf-8")) > MAX_TEXT_FILE:
        raise HTTPException(413, "a draft file must be under 2MB")
    existing = next((f for f in draft["files"] if f["name"] == name), None)
    if existing:
        existing["content"] = request.content
    else:
        draft["files"].append({"name": name, "kind": _kind_of(name), "content": request.content})
    await asyncio.to_thread(_save, DRAFTS, draft)
    return draft_view(draft, _checks_of(draft_id, user))


@router.delete("/drafts/{draft_id}/files/{name:path}")
async def delete_file(draft_id: str, name: str, user: str | None = Depends(current_user)):
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    before = len(draft["files"])
    draft["files"] = [f for f in draft["files"] if f["name"] != name]
    if len(draft["files"]) == before:
        raise HTTPException(404, "no such file")
    if not draft["files"]:
        raise HTTPException(400, "a draft keeps at least one file")
    await asyncio.to_thread(_save, DRAFTS, draft)
    return draft_view(draft, _checks_of(draft_id, user))


@router.post("/drafts/{draft_id}/save")
async def save_draft(draft_id: str, user: str | None = Depends(current_user)):
    """Ctrl/Cmd+S: a new version. The check history shows one row per version checked."""
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    _bump_version(draft)
    await asyncio.to_thread(_save, DRAFTS, draft)
    return draft_view(draft, _checks_of(draft_id, user))


def _bump_version(draft: dict) -> None:
    draft["version"] = int(draft.get("version", 1)) + 1
    draft["savedAt"] = logic.now_iso()
    draft["savedHash"] = logic.content_hash(draft.get("files", []))


def _unsaved(draft: dict) -> bool:
    """Edits written by the editor since the last version was saved (Ctrl+S or a check)."""
    return logic.content_hash(draft.get("files", [])) != draft.get("savedHash")


@router.get("/drafts/{draft_id}/parse")
async def parse_draft(draft_id: str, user: str | None = Depends(current_user)):
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    project = await asyncio.to_thread(_project_of, draft, user)
    return logic.parse_project(_draft_files(draft, project))


class PdfTarget(BaseModel):
    key: str


def _attach_pdf(target: dict, key: str, name: str) -> None:
    target.setdefault("pdfs", {})[key] = name


@router.post("/drafts/{draft_id}/citations/{key}/pdf")
async def upload_citation_pdf(
    draft_id: str, key: str, file: UploadFile = FILE_UPLOAD, user: str | None = Depends(current_user)
):
    """ "Upload source PDF": the paper a bib key cites, when no open-access copy exists. Stored
    like an analysed paper (app.main.save_upload) and used by the next check instead of a
    lookup. Lands on the project when the draft has one, so every draft of the project reads it."""
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    gateway = _gateway()
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(400, "that is not a PDF")
    path = await asyncio.to_thread(gateway.save_upload, content, file.filename)
    project = await asyncio.to_thread(_project_of, draft, user)
    if project:
        _attach_pdf(project, key, path.name)
        await asyncio.to_thread(_save, PROJECTS, project)
    else:
        _attach_pdf(draft, key, path.name)
        await asyncio.to_thread(_save, DRAFTS, draft)
    return {"key": key, "pdf": path.name}


# --- draft checks -----------------------------------------------------------------------


def _spawn(coroutine) -> None:
    """Start the background run. Its own function so tests can run the coroutine themselves."""
    asyncio.create_task(coroutine)


async def _run_draft_check(check_id: str, user: str | None):
    """Every \\cite of the draft against the work its bib entry names. One verification per
    citation, PARALLEL_CHECKS at a time and never more than the gateway-wide limit, each
    read from the cache when the same claim was judged against the same source before."""
    gateway = _gateway()
    run = gateway.analyses[check_id]
    try:
        draft = store.load_author_row(DRAFTS, run["draftId"])
        if draft is None:
            raise RuntimeError("the draft was deleted")
        project = _project_of(draft, user)
        files = _draft_files(draft, project)
        entries = logic.bib_entries(files)
        by_key: dict[str, dict] = {}
        for entry in entries:
            by_key.setdefault(entry["key"], entry)
        pdfs = _pdfs_for(draft, project)
        previous = _latest_done([r for r in _checks_of(draft["id"], user) if r["id"] != check_id])
        carried = {
            (c["key"], c.get("claim")): c["resolution"]
            for c in (previous or {}).get("citations", [])
            if c.get("resolution", {}).get("kind") == "overridden"
        }
        citations = []
        for i, cite in enumerate(logic.find_cites(files)):
            citation = {"id": f"{check_id}-{i + 1}", **cite, "verdict": "unchecked"}
            if (cite["key"], cite["claim"]) in carried:
                citation["resolution"] = carried[(cite["key"], cite["claim"])]
            citations.append(citation)
        run["citations"] = citations
        await gateway._publish(
            check_id, "planned", checks=len(citations), sources=len({c["key"] for c in citations})
        )

        limit = asyncio.Semaphore(PARALLEL_CHECKS)

        async def check_one(index: int, citation: dict) -> None:
            entry = by_key.get(citation["key"])
            if entry is None:
                citation.update(
                    verdict="unchecked",
                    reason="missing-key",
                    message=f"{citation['key']} is not in the bibliography",
                )
                await gateway._publish(
                    check_id,
                    "checked",
                    claim=index,
                    key=citation["key"],
                    verdict="unchecked",
                    reason="missing-key",
                )
                return
            citation["sourceRef"] = logic.source_ref(entry, pdfs)
            identifier = logic.lookup_identifier(entry, pdfs)
            if identifier and pdfs.get(entry["key"]):
                identifier = (gateway.PAPERS_DIR / identifier).as_posix()
            async with limit, gateway.all_checks:
                await gateway._publish(
                    check_id, "checking", claim=index, key=citation["key"], source=identifier
                )
                try:
                    result = await asyncio.to_thread(
                        verify_cached, citation["claim"], identifier, gateway.verify_claim
                    )
                except Exception as error:  # a crash in the pipeline is an honest "unavailable"
                    result = {"status": "error", "reason": "failed", "message": str(error)}
            citation.update(citation_outcome(result))
            await gateway._publish(
                check_id,
                "checked",
                claim=index,
                key=citation["key"],
                verdict=citation["verdict"],
                reason=citation.get("reason"),
            )

        await asyncio.gather(*(check_one(i + 1, c) for i, c in enumerate(citations)))
        run["status"] = "done"
        run["finishedAt"] = logic.now_iso()
        run["summary"] = logic.summarize(citations)
        await gateway._publish(check_id, "done", **run["summary"]["counts"])
    except Exception as error:
        run["status"] = "error"
        run["message"] = str(error)
        run["finishedAt"] = logic.now_iso()
        await gateway._publish(check_id, "error", message=str(error))
    finally:
        await gateway.streams[check_id].put(None)
        await gateway._saved(check_id)


@router.post("/drafts/{draft_id}/check")
async def start_draft_check(draft_id: str, user: str | None = Depends(current_user)):
    """Re-check. One run per draft at a time: a second request while one is running gets a
    409 with the running check's id, rather than a second run the screen would lose."""
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    gateway = _gateway()
    # The guard and the row it guards, with no await between them: the event loop cannot
    # switch to a second request (a double-click on Re-check, a client retry) after this one
    # saw no running check and before its own row is in place, so at most one of them gets
    # past here. The row is filled in below; until then it is a running check to everyone.
    running = next((r for r in _checks_of(draft_id, user) if r.get("status") == "running"), None)
    if running:
        raise HTTPException(409, f"a check is already running: {running['id']}")
    check_id = _new_id()
    run = {
        "id": check_id,
        "kind": DRAFT_CHECK,
        "owner": user,
        "draftId": draft_id,
        "draftTitle": draft["title"],
        "version": draft.get("version", 1),
        "contentHash": None,
        "status": "running",
        "startedAt": logic.now_iso(),
        "stages": [],
        "citations": [],
    }
    gateway.analyses[check_id] = run
    gateway.streams[check_id] = asyncio.Queue()
    try:
        # A check runs on a saved version: unsaved edits are saved first (as Ctrl+S would),
        # so the history's "vN" names exactly the content that was checked.
        if _unsaved(draft):
            _bump_version(draft)
            await asyncio.to_thread(_save, DRAFTS, draft)
        project = await asyncio.to_thread(_project_of, draft, user)
        run["version"] = draft.get("version", 1)
        # the draft's files plus the project's .bib: what "unchanged since the previous check" compares
        run["contentHash"] = logic.content_hash(_draft_files(draft, project))
    except BaseException:
        # A failed or cancelled save must not leave a check that never runs, which would
        # refuse every later Re-check of this draft.
        gateway.analyses.pop(check_id, None)
        gateway.streams.pop(check_id, None)
        raise
    _spawn(_run_draft_check(check_id, user))
    return {"id": check_id}


@router.get("/drafts/{draft_id}/checks")
async def list_draft_checks(draft_id: str, user: str | None = Depends(current_user)):
    """The check history, newest first, each with what changed since the one before."""
    await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    runs = _checks_of(draft_id, user)
    views = []
    done_before: dict | None = None
    for run in runs:
        views.append(check_view(run, done_before if run.get("status") == "done" else None, full=False))
        if run.get("status") == "done":
            done_before = run
    return list(reversed(views))


def _check(check_id: str, user: str | None) -> dict:
    """One of the caller's draft checks; a paper analysis or a Find-a-source check with that
    id is a 404 like a missing one."""
    return require_owner(_gateway().analyses.get(check_id), user, "check", kind=DRAFT_CHECK)


def _previous_of(run: dict, user: str | None) -> dict | None:
    done = [
        r
        for r in _checks_of(run["draftId"], user)
        if r.get("status") == "done" and r.get("startedAt", "") < run.get("startedAt", "")
    ]
    return done[-1] if done else None


@router.get("/checks/{check_id}")
async def get_check(check_id: str, user: str | None = Depends(current_user)):
    run = _check(check_id, user)
    return check_view(run, _previous_of(run, user))


@router.get("/checks/{check_id}/events")
async def check_events(check_id: str, user: str | None = Depends(current_user)):
    _check(check_id, user)
    return StreamingResponse(_gateway()._event_stream(check_id), media_type="text/event-stream")


@router.get("/checks/{check_id}/compare")
async def compare_checks(check_id: str, user: str | None = Depends(current_user)):
    run = _check(check_id, user)
    previous = _previous_of(run, user)
    if previous is None:
        raise HTTPException(404, "nothing earlier to compare with")
    return {
        "current": {"id": run["id"], "version": run.get("version")},
        "previous": {"id": previous["id"], "version": previous.get("version")},
        "rows": logic.compare(run.get("citations", []), previous.get("citations", [])),
    }


@router.delete("/checks/{check_id}")
async def delete_check(check_id: str, user: str | None = Depends(current_user)):
    run = _check(check_id, user)
    if run.get("status") not in _gateway().FINISHED:
        raise HTTPException(409, "the check is still running")
    await _gateway()._delete_one(check_id)
    return {"deleted": check_id}


class CitationPatch(BaseModel):
    resolution: dict | None = None
    key: str | None = None
    sourceRef: dict | None = None
    verdict: str | None = None
    evidence: dict | None = None
    explanation: str | None = None


@router.patch("/checks/{check_id}/citations/{citation_id}")
async def update_citation(
    check_id: str, citation_id: str, request: CitationPatch, user: str | None = Depends(current_user)
):
    """What the author did about an issue: "Replace with …" (a new key, and the verdict the
    replacement was verified with), "Keep mine" / "Override · add note", or reopening it."""
    run = _check(check_id, user)
    citation = next((c for c in run.get("citations", []) if c["id"] == citation_id), None)
    if citation is None:
        raise HTTPException(404, "no such citation")
    if request.verdict is not None and request.verdict not in logic.VERDICTS:
        raise HTTPException(400, f"verdict must be one of {', '.join(logic.VERDICTS)}")
    if request.resolution is not None and request.resolution.get("kind") not in ("replaced", "overridden"):
        raise HTTPException(400, "resolution.kind must be replaced or overridden")
    if "resolution" in request.model_fields_set:
        citation["resolution"] = {**request.resolution, "at": logic.now_iso()} if request.resolution else None
        if request.resolution is None:
            citation.pop("resolution", None)
    if request.key:
        citation["key"] = request.key
    if request.sourceRef is not None:
        citation["sourceRef"] = request.sourceRef
    if request.verdict is not None:
        citation["verdict"] = request.verdict
        citation.pop("reason", None)
        citation.pop("message", None)
    if request.evidence is not None:
        citation["evidence"] = request.evidence
    if request.explanation is not None:
        citation["explanation"] = request.explanation
    run["summary"] = logic.summarize(run.get("citations", []))
    gateway = _gateway()
    gateway._save_soon(check_id)
    await gateway._saved(check_id)
    return check_view(run, _previous_of(run, user))


@router.post("/drafts/{draft_id}/report")
async def draft_report(draft_id: str, user: str | None = Depends(current_user)):
    """The verification report as a PDF: every citation of the latest check, its verdict and
    the passage it rests on."""
    draft = await asyncio.to_thread(_row, DRAFTS, draft_id, user, "draft")
    latest = _latest_done(_checks_of(draft_id, user))
    if latest is None:
        raise HTTPException(409, "check the draft first, then export its report")
    html = logic.report_html(draft, latest)
    pdf = await asyncio.to_thread(_html_to_pdf, html)
    name = re.sub(r"[^a-z0-9]+", "-", draft["title"].lower()).strip("-") or "draft"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}-report.pdf"'},
    )


def _html_to_pdf(html: str) -> bytes:
    import pymupdf

    story = pymupdf.Story(html=html)
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    page = pymupdf.paper_rect("a4")
    box = page + (40, 40, -40, -40)
    more = True
    while more:
        device = writer.begin_page(page)
        more, _ = story.place(box)
        story.draw(device)
        writer.end_page()
    writer.close()
    return buffer.getvalue()


# --- projects ---------------------------------------------------------------------------


class ProjectIn(BaseModel):
    name: str | None = None
    bib: str | None = None
    bibName: str | None = None


def _project_view(project: dict, drafts: list[dict], runs_by_draft: dict[str, list[dict]]) -> dict:
    """A project card: bib size, how many entries its drafts cite, what still needs work."""
    view = _public(project)
    bib = project.get("bib") or {}
    entries = logic.parse_bib(bib.get("content", ""))
    keys = {e["key"] for e in entries}
    mine = [d for d in drafts if d.get("projectId") == project["id"]]
    cited: set[str] = set()
    tally = {v: 0 for v in logic.VERDICTS}
    open_issues = 0
    checked_at = None
    for draft in mine:
        files = _draft_files(draft, project)
        cited.update(c["key"] for c in logic.find_cites(files))
        latest = _latest_done(runs_by_draft.get(draft["id"], []))
        if latest:
            summary = logic.summarize(latest.get("citations", []))
            for v in logic.VERDICTS:
                tally[v] += summary["counts"][v]
            open_issues += summary["open"]
            if not checked_at or latest.get("finishedAt", "") > checked_at:
                checked_at = latest.get("finishedAt")
    view.update(
        {
            "bibName": bib.get("name"),
            "entries": len(entries),
            "cited": len(cited & keys),
            "needWork": open_issues,
            "tally": tally,
            "drafts": len(mine),
            "checkedAt": checked_at,
        }
    )
    view.pop("bib", None)
    return view


def _new_project(user: str | None, name: str, bib_name: str | None, bib: str | None) -> dict:
    now = logic.now_iso()
    project = {
        "id": _new_id(),
        "owner": user,
        "name": name.strip() or "Untitled project",
        "bib": {"name": bib_name or "main.bib", "content": bib or ""},
        "pdfs": {},
        "created": now,
        "updated": now,
    }
    store.save_author_row(PROJECTS, project)
    return project


@router.get("/projects")
async def list_projects(user: str | None = Depends(current_user)):
    projects, drafts = await asyncio.gather(
        asyncio.to_thread(_rows, PROJECTS, user), asyncio.to_thread(_rows, DRAFTS, user)
    )
    runs = _checks_by_draft(user)
    return [_project_view(p, drafts, runs) for p in projects]


@router.post("/projects")
async def create_project(request: ProjectIn, user: str | None = Depends(current_user)):
    if not (request.name or "").strip():
        raise HTTPException(400, "a project needs a name")
    project = await asyncio.to_thread(_new_project, user, request.name, request.bibName, request.bib)
    return _project_view(project, [], {})


@router.post("/projects/import")
async def import_project(file: UploadFile = FILE_UPLOAD, user: str | None = Depends(current_user)):
    """+ New project from a .bib, or an Overleaf .zip: the .bib becomes the project's
    bibliography and the .tex files one draft."""
    files = _text_files_from_upload(file.filename or "project.bib", await file.read())
    name = re.sub(r"\.(bib|zip|tex)$", "", Path(file.filename or "project").name, flags=re.I)
    bibs = [f for f in files if f["kind"] == "bib"]
    tex = [f for f in files if f["kind"] == "tex"]
    bib_content = "\n\n".join(f["content"] for f in bibs)
    project = await asyncio.to_thread(
        _new_project, user, name, bibs[0]["name"] if bibs else None, bib_content
    )
    if tex:
        await asyncio.to_thread(_new_draft, user, name, project["id"], tex)
    drafts = await asyncio.to_thread(_rows, DRAFTS, user)
    return _project_view(project, drafts, {})


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user: str | None = Depends(current_user)):
    """Project detail: the project, its drafts, and every draft's check history."""
    project = await asyncio.to_thread(_row, PROJECTS, project_id, user, "project")
    drafts = [d for d in await asyncio.to_thread(_rows, DRAFTS, user) if d.get("projectId") == project_id]
    runs = _checks_by_draft(user)
    history = {}
    for draft in drafts:
        views, done_before = [], None
        for run in runs.get(draft["id"], []):
            views.append(check_view(run, done_before if run.get("status") == "done" else None, full=False))
            if run.get("status") == "done":
                done_before = run
        history[draft["id"]] = list(reversed(views))
    view = _project_view(project, drafts, runs)
    view["bib"] = project.get("bib")
    view["draftList"] = sorted(
        (draft_view(d, runs.get(d["id"])) for d in drafts), key=lambda d: d.get("updated", ""), reverse=True
    )
    view["history"] = history
    return view


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, request: ProjectIn, user: str | None = Depends(current_user)):
    project = await asyncio.to_thread(_row, PROJECTS, project_id, user, "project")
    if request.name is not None:
        project["name"] = request.name.strip() or project["name"]
    if request.bib is not None:
        project["bib"] = {
            "name": request.bibName or project.get("bib", {}).get("name") or "main.bib",
            "content": request.bib,
        }
    await asyncio.to_thread(_save, PROJECTS, project)
    return _project_view(project, await asyncio.to_thread(_rows, DRAFTS, user), {})


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: str | None = Depends(current_user)):
    """Deletes the project; its drafts stay and become unsorted."""
    await asyncio.to_thread(_row, PROJECTS, project_id, user, "project")
    for draft in await asyncio.to_thread(_rows, DRAFTS, user):
        if draft.get("projectId") == project_id:
            draft["projectId"] = None
            await asyncio.to_thread(_save, DRAFTS, draft)
    await asyncio.to_thread(store.delete_author_row, PROJECTS, project_id)
    return {"deleted": project_id}


@router.delete("/projects/{project_id}/bib/{key}")
async def remove_bib_entry(project_id: str, key: str, user: str | None = Depends(current_user)):
    """ "Remove" on a never-cited entry: drops every entry with that key from the .bib."""
    project = await asyncio.to_thread(_row, PROJECTS, project_id, user, "project")
    bib = project.get("bib") or {"name": "main.bib", "content": ""}
    entries = logic.parse_bib(bib.get("content", ""))
    kept = [e for e in entries if e["key"] != key]
    if len(kept) == len(entries):
        raise HTTPException(404, f"{key} is not in {bib.get('name')}")
    bib["content"] = "\n\n".join(logic.serialize_bib(e) for e in kept) + ("\n" if kept else "")
    project["bib"] = bib
    await asyncio.to_thread(_save, PROJECTS, project)
    return {"removed": key, "entries": len(kept)}


@router.post("/projects/{project_id}/bib/{key}/pdf")
async def upload_project_pdf(
    project_id: str, key: str, file: UploadFile = FILE_UPLOAD, user: str | None = Depends(current_user)
):
    project = await asyncio.to_thread(_row, PROJECTS, project_id, user, "project")
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(400, "that is not a PDF")
    path = await asyncio.to_thread(_gateway().save_upload, content, file.filename)
    _attach_pdf(project, key, path.name)
    await asyncio.to_thread(_save, PROJECTS, project)
    return {"key": key, "pdf": path.name}


# --- the Library screen -----------------------------------------------------------------


def _attention(projects: list[dict], drafts: list[dict], runs_by_draft: dict[str, list[dict]]) -> list[dict]:
    """What the Library's "Needs attention" lists: contradicted citations (Replace), sources
    no check could read — a paywalled work, or an entry with nothing to look it up by
    (Upload PDF) — and entries no draft cites (Remove)."""
    rows: list[dict] = []
    by_project = {p["id"]: p for p in projects}
    cited_by_project: dict[str, set[str]] = {p["id"]: set() for p in projects}
    for draft in drafts:
        project = by_project.get(draft.get("projectId") or "")
        files = _draft_files(draft, project)
        cites = logic.find_cites(files)
        if project:
            cited_by_project[project["id"]].update(c["key"] for c in cites)
        latest = _latest_done(runs_by_draft.get(draft["id"], []))
        pdfs = _pdfs_for(draft, project)
        seen: set[str] = set()
        for c in (latest or {}).get("citations", []):
            if c["key"] in seen or pdfs.get(c["key"]):
                continue
            ref = c.get("sourceRef") or {}
            if c.get("verdict") == "refutes" and logic.is_open_issue(c):
                seen.add(c["key"])
                rows.append(
                    {
                        "kind": "replace",
                        "key": c["key"],
                        "title": (
                            f"{ref.get('authors') or c['key']} ({ref.get('year') or '?'}) · "
                            f"{logic_short(ref.get('title') or c['key'])}"
                        ),
                        "detail": f"\\cite{{{c['key']}}} contradicts a claim in {draft['title']}",
                        "draftId": draft["id"],
                        "checkId": latest["id"],
                        "citationId": c["id"],
                        "projectId": draft.get("projectId"),
                    }
                )
            elif c.get("verdict") == "unavailable":
                seen.add(c["key"])
                rows.append(
                    {
                        "kind": "upload-pdf",
                        "key": c["key"],
                        "title": f"{c['key']} · {c.get('message') or 'no PDF could be read'}",
                        "detail": "Cannot be checked until a source is attached",
                        "draftId": draft["id"],
                        "projectId": draft.get("projectId"),
                    }
                )
        # Not checked yet: an entry with nothing to look it up by will fail the same way.
        entries: dict[str, dict] = {}
        for entry in logic.bib_entries(files):
            entries.setdefault(entry["key"], entry)  # the first definition is the one the check uses
        for key in dict.fromkeys(c["key"] for c in cites):
            entry = entries.get(key)
            if entry and logic.lacks_locator(entry) and not pdfs.get(key) and key not in seen:
                seen.add(key)
                rows.append(
                    {
                        "kind": "upload-pdf",
                        "key": key,
                        "title": f"{key} · no DOI or PDF",
                        "detail": "Cannot be checked until a source is attached",
                        "draftId": draft["id"],
                        "projectId": draft.get("projectId"),
                    }
                )
    for project in projects:
        bib = project.get("bib") or {}
        for key in dict.fromkeys(e["key"] for e in logic.parse_bib(bib.get("content", ""))):
            if key not in cited_by_project[project["id"]]:
                rows.append(
                    {
                        "kind": "remove",
                        "key": key,
                        "title": f"{key} · in {bib.get('name', 'main.bib')}",
                        "detail": "Never cited in any draft",
                        "projectId": project["id"],
                    }
                )
    return rows


def logic_short(title: str) -> str:
    head = title.split(":")[0].strip()
    return head if 0 < len(head) <= 60 else title[:60]


def _source_view(source: dict, projects: dict[str, dict]) -> dict:
    """A saved source with whether its key is in its project's .bib yet."""
    view = _public(source)
    project = projects.get(source.get("projectId") or "")
    keys = (
        {e["key"] for e in logic.parse_bib(((project or {}).get("bib") or {}).get("content", ""))}
        if project
        else set()
    )
    view["inBib"] = source.get("key") in keys
    view["bibName"] = ((project or {}).get("bib") or {}).get("name") if project else None
    return view


@router.get("/library")
async def library(user: str | None = Depends(current_user)):
    projects, drafts, sources = await asyncio.gather(
        asyncio.to_thread(_rows, PROJECTS, user),
        asyncio.to_thread(_rows, DRAFTS, user),
        asyncio.to_thread(_rows, SOURCES, user),
    )
    runs = _checks_by_draft(user)
    by_id = {p["id"]: p for p in projects}
    unsorted = [s for s in sources if not s.get("projectId")]
    unsorted_drafts = [d for d in drafts if not d.get("projectId")]
    return {
        "projects": [_project_view(p, drafts, runs) for p in projects],
        "unsorted": {
            "sources": len(unsorted),
            "pdfs": sum(1 for s in unsorted if s.get("pdf")),
            "drafts": len(unsorted_drafts),
        },
        "attention": _attention(projects, drafts, runs),
        "saved": [_source_view(s, by_id) for s in reversed(sources)],
    }


# --- saved sources ----------------------------------------------------------------------


class SourceIn(BaseModel):
    title: str
    key: str | None = None
    authors: str = ""
    authorsList: list[str] = []
    year: int | None = None
    venue: str = ""
    doi: str = ""
    arxiv: str = ""
    url: str = ""
    identifier: str = ""
    openAccess: bool = False
    citedBy: int | None = None
    bibtex: str | None = None
    projectId: str | None = None
    claim: str | None = None
    verdict: str | None = None
    evidence: dict | None = None


@router.get("/sources")
async def list_sources(project: str | None = None, user: str | None = Depends(current_user)):
    sources, projects = await asyncio.gather(
        asyncio.to_thread(_rows, SOURCES, user), asyncio.to_thread(_rows, PROJECTS, user)
    )
    by_id = {p["id"]: p for p in projects}
    rows = [s for s in sources if project is None or (s.get("projectId") or "") == project]
    return [_source_view(s, by_id) for s in reversed(rows)]


@router.post("/sources")
async def save_source(request: SourceIn, user: str | None = Depends(current_user)):
    """Save a search result into a project or, with no project, into Unsorted sources."""
    if request.projectId:
        await asyncio.to_thread(_row, PROJECTS, request.projectId, user, "project")
    data = request.model_dump()
    taken = {s.get("key") for s in await asyncio.to_thread(_rows, SOURCES, user)}
    data["key"] = data["key"] or logic.bib_key_for(data["authorsList"], data["year"], taken)
    data["bibtex"] = data["bibtex"] or logic.bibtex_for(data, data["key"])
    now = logic.now_iso()
    source = {"id": _new_id(), "owner": user, **data, "savedAt": now, "created": now, "updated": now}
    await asyncio.to_thread(store.save_author_row, SOURCES, source)
    return _source_view(source, {})


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, user: str | None = Depends(current_user)):
    await asyncio.to_thread(_row, SOURCES, source_id, user, "source")
    await asyncio.to_thread(store.delete_author_row, SOURCES, source_id)
    return {"deleted": source_id}


class MoveIn(BaseModel):
    projectId: str | None = None


@router.post("/sources/{source_id}/add-to-bib")
async def add_source_to_bib(source_id: str, request: MoveIn, user: str | None = Depends(current_user)):
    """ "Add to .bib": appends the source's entry to the project's bibliography (and files
    the source under that project when it was unsorted)."""
    source = await asyncio.to_thread(_row, SOURCES, source_id, user, "source")
    project_id = request.projectId or source.get("projectId")
    if not project_id:
        raise HTTPException(400, "pick a project to add the entry to")
    project = await asyncio.to_thread(_row, PROJECTS, project_id, user, "project")
    bib = project.get("bib") or {"name": "main.bib", "content": ""}
    keys = {e["key"] for e in logic.parse_bib(bib.get("content", ""))}
    if source.get("key") in keys:
        raise HTTPException(409, f"{source['key']} is already in {bib['name']}")
    bib["content"] = (bib.get("content", "").rstrip() + "\n\n" + source["bibtex"] + "\n").lstrip()
    project["bib"] = bib
    await asyncio.to_thread(_save, PROJECTS, project)
    if source.get("projectId") != project_id:
        source["projectId"] = project_id
        await asyncio.to_thread(_save, SOURCES, source)
    return _source_view(source, {project_id: project})


@router.post("/sources/{source_id}/pdf")
async def upload_source_pdf(
    source_id: str, file: UploadFile = FILE_UPLOAD, user: str | None = Depends(current_user)
):
    source = await asyncio.to_thread(_row, SOURCES, source_id, user, "source")
    content = await file.read()
    if not content.startswith(b"%PDF"):
        raise HTTPException(400, "that is not a PDF")
    path = await asyncio.to_thread(_gateway().save_upload, content, file.filename)
    source["pdf"] = path.name
    await asyncio.to_thread(_save, SOURCES, source)
    return _source_view(source, {})


# --- Find a source ----------------------------------------------------------------------


def _s2_result(paper: dict, query: str) -> dict:
    ids = paper.get("externalIds") or {}
    authors = [a.get("name", "") for a in paper.get("authors") or [] if a.get("name")]
    doi = ids.get("DOI", "") or ""
    arxiv = ids.get("ArXiv", "") or ""
    pdf = (paper.get("openAccessPdf") or {}).get("url") or ""
    identifier = doi or arxiv or pdf or paper.get("title", "")
    result = {
        "id": paper.get("paperId") or logic.bib_key_for(authors, paper.get("year")),
        "key": logic.bib_key_for(authors, paper.get("year")),
        "title": paper.get("title", ""),
        "authors": logic.short_authors(" and ".join(authors)),
        "authorsList": authors,
        "year": paper.get("year"),
        "venue": paper.get("venue") or "",
        "doi": doi,
        "arxiv": arxiv,
        "url": pdf or (f"https://doi.org/{doi}" if doi else ""),
        "identifier": identifier,
        "openAccess": bool(pdf or arxiv),
        "citedBy": paper.get("citationCount"),
        "similarity": logic.similarity(query, f"{paper.get('title', '')} {paper.get('abstract') or ''}"),
        "similarityBasis": "abstract",
        "inLibrary": False,
    }
    result["bibtex"] = logic.bibtex_for(result, result["key"])
    return result


def _title_key(title: str) -> str:
    """A title reduced to its letters and digits, for matching an index hit against a .bib
    entry that has no DOI ("ColBERT: Efficient..." and "colbert efficient" are one work)."""
    return "".join(logic._WORD.findall((title or "").lower()))


def _cited_keys(projects: list[dict], drafts: list[dict]) -> dict[str, set[str]]:
    """Per project, the bib keys its drafts cite — the "Cited by my drafts" chip."""
    by_id = {p["id"]: p for p in projects}
    cited: dict[str, set[str]] = {p["id"]: set() for p in projects}
    for draft in drafts:
        project = by_id.get(draft.get("projectId") or "")
        if project:
            cited[project["id"]].update(c["key"] for c in logic.find_cites(_draft_files(draft, project)))
    return cited


def _library_row(query: str, project: dict, entry: dict, ref: dict, cited: set[str] | None = None) -> dict:
    bib = project.get("bib") or {}
    identifier = logic.lookup_identifier(entry, project.get("pdfs"))
    return {
        "id": f"bib:{project['id']}:{entry['key']}",
        "key": entry["key"],
        "title": ref["title"],
        "authors": ref["authors"],
        "authorsList": [
            a.strip()
            for a in re.split(r"\s+and\s+", entry["fields"].get("author", ""), flags=re.I)
            if a.strip()
        ],
        "year": ref["year"],
        "venue": ref["venue"],
        "doi": ref["doi"],
        "arxiv": "",
        "url": ref["url"],
        "identifier": identifier or "",
        "openAccess": bool(ref["url"] or ref["doi"]),
        "citedBy": None,
        "similarity": logic.similarity(query, f"{ref['title']} {ref['authors']}"),
        "similarityBasis": "title",
        "inLibrary": True,
        "cited": entry["key"] in (cited or set()),
        "projectId": project["id"] if not project["id"].startswith("draft:") else None,
        "draftId": project["id"][6:] if project["id"].startswith("draft:") else None,
        "bibName": bib.get("name"),
        "bibtex": logic.serialize_bib(entry),
    }


def _bib_holders(projects: list[dict], drafts: list[dict]) -> list[dict]:
    """Everything with a .bib of its own: the projects, and the drafts that carry one
    instead of citing from a project's. A draft holder looks like a project to _library_row
    (an id, a `bib`, its `pdfs`)."""
    holders = list(projects)
    for draft in drafts:
        for f in draft.get("files", []):
            if f.get("kind") == "bib":
                holders.append(
                    {
                        "id": f"draft:{draft['id']}",
                        "bib": {"name": f["name"], "content": f.get("content", "")},
                        "pdfs": draft.get("pdfs", {}),
                    }
                )
    return holders


def _library_entries(holders: list[dict]) -> list[tuple[dict, dict, dict]]:
    """Every distinct work the user's .bib files hold, as (holder, entry, ref). The same work
    in two files (a project's .bib and a draft's copy of it, a key defined twice) is one
    entry: the first holder's, projects before drafts, and a file's first definition."""
    seen: set[str] = set()
    works: list[tuple[dict, dict, dict]] = []
    for project in holders:
        bib = project.get("bib") or {}
        seen_keys: set[str] = set()
        for entry in logic.parse_bib(bib.get("content", "")):
            if entry["key"] in seen_keys:
                continue
            seen_keys.add(entry["key"])
            ref = logic.source_ref(entry, project.get("pdfs"))
            work = f"doi:{ref['doi'].lower()}" if ref["doi"] else "title:" + _title_key(ref["title"])
            if work in seen:
                continue
            seen.add(work)
            works.append((project, entry, ref))
    return works


def _library_results(
    query: str, holders: list[dict], sources: list[dict], cited: dict[str, set[str]]
) -> list[dict]:
    """What the user already has that matches the query's words: the .bib entries of the
    projects and of drafts with their own .bib, and saved sources."""
    results = []
    for project, entry, ref in _library_entries(holders):
        row = _library_row(query, project, entry, ref, cited.get(project["id"]))
        if row["similarity"] > 0:
            results.append(row)
    for source in sources:
        score = logic.similarity(query, f"{source.get('title', '')} {source.get('authors', '')}")
        if score <= 0:
            continue
        results.append(
            {
                **_public(source),
                "similarity": score,
                "similarityBasis": "title",
                "inLibrary": True,
                "saved": True,
            }
        )
    return results


@router.get("/search")
async def search_sources(q: str = "", limit: int = 8, user: str | None = Depends(current_user)):
    """Find a source: what the user's own library already holds (first), then Semantic
    Scholar's answers in its order; every row carries the query's word overlap, and the real
    match comes from verifying a result against the claim. A public-index outage is a 503,
    not an empty list."""
    query = q.strip()
    if not query:
        return {"results": [], "libraryCount": 0}
    from app.pipeline.sources import LookupUnavailable, _semantic_scholar

    projects, sources, drafts = await asyncio.gather(
        asyncio.to_thread(_rows, PROJECTS, user),
        asyncio.to_thread(_rows, SOURCES, user),
        asyncio.to_thread(_rows, DRAFTS, user),
    )
    cited = _cited_keys(projects, drafts)
    for draft in drafts:  # a draft's own .bib: cited keys count for its holder too
        if any(f.get("kind") == "bib" for f in draft.get("files", [])):
            cited[f"draft:{draft['id']}"] = {c["key"] for c in logic.find_cites(draft.get("files", []))}
    holders = _bib_holders(projects, drafts)
    library = _library_results(query, holders, sources, cited)
    try:
        found = await asyncio.to_thread(
            _semantic_scholar,
            "/search",
            {"query": logic.search_terms(query), "limit": max(1, min(limit, 20)), "fields": SEARCH_FIELDS},
        )
    except LookupUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except Exception as error:  # requests errors: the index did not answer
        raise HTTPException(503, f"Semantic Scholar did not answer: {error}") from error
    # A public-index hit that is already in one of the user's .bib files shows once, as the
    # library entry: its own key, flagged in-library, with the index's citation count added.
    in_bib: dict[str, dict] = {}
    works = _library_entries(holders)
    for project, entry, ref in works:
        keys = [f"doi:{ref['doi'].lower()}"] if ref["doi"] else []
        keys.append("title:" + _title_key(ref["title"]))
        for k in keys:
            in_bib.setdefault(k, {"entry": entry, "ref": ref, "project": project})
    by_place = {r["id"]: r for r in library}
    results = list(library)
    for paper in found.get("data") or []:
        result = _s2_result(paper, query)
        match = in_bib.get(f"doi:{result['doi'].lower()}") if result["doi"] else None
        match = match or in_bib.get("title:" + _title_key(result["title"]))
        if match:
            row_id = f"bib:{match['project']['id']}:{match['entry']['key']}"
            row = by_place.get(row_id)
            if row is None:
                row = _library_row(
                    query, match["project"], match["entry"], match["ref"], cited.get(match["project"]["id"])
                )
                row["similarity"] = result["similarity"]
                row["similarityBasis"] = result["similarityBasis"]
                by_place[row_id] = row
                results.append(row)
            row.update({k: v for k, v in result.items() if k in ("citedBy", "openAccess", "arxiv") and v})
            row["identifier"] = row.get("identifier") or result["identifier"]
            continue
        results.append(result)
    # The user's own matching entries first, by how many of the query's words they share;
    # then the index's answers in the order it ranked them. Word overlap is shown on every row
    # but does not reorder the index: its ranking reads the abstract, overlap only counts words.
    results.sort(key=lambda r: (0, -r["similarity"]) if r["inLibrary"] else (1, 0))
    return {"results": results, "libraryCount": len(works) + len(sources)}


class VerifyIn(BaseModel):
    claim: str
    identifier: str


@router.post("/search/verify")
async def verify_result(request: VerifyIn, user: str | None = Depends(current_user)):
    """Does this source actually say it? One verification of the claim against the result's
    paper, read from the cache when the pair was judged before. Runs under the gateway-wide
    check limit like every other verification."""
    claim, identifier = request.claim.strip(), request.identifier.strip()
    if not claim or not identifier:
        raise HTTPException(400, "a claim and a source identifier are needed")
    gateway = _gateway()
    async with gateway.all_checks:
        try:
            result = await asyncio.to_thread(verify_cached, claim, identifier, gateway.verify_claim)
        except Exception as error:
            result = {"status": "error", "reason": "failed", "message": str(error)}
    outcome = citation_outcome(result)
    if outcome.get("evidence", {}).get("pdf"):
        verified_pdfs.setdefault(user, set()).add(Path(outcome["evidence"]["pdf"]).name)
    return {
        **outcome,
        "cached": bool(result.get("cached")),
        "quote": result.get("quote", ""),
        "reasoning": result.get("reasoning", ""),
    }


# --- Your data --------------------------------------------------------------------------


@router.get("/export")
async def export_data(user: str | None = Depends(current_user)):
    """Settings → Your data → Export: every project, draft, saved source and check as JSON."""
    projects, drafts, sources = await asyncio.gather(
        asyncio.to_thread(_rows, PROJECTS, user),
        asyncio.to_thread(_rows, DRAFTS, user),
        asyncio.to_thread(_rows, SOURCES, user),
    )
    runs = _checks_by_draft(user)
    checks = [check_view(r) for d in drafts for r in runs.get(d["id"], [])]
    return {
        "exportedAt": logic.now_iso(),
        "projects": [_public(p) for p in projects],
        "drafts": [_public(d) for d in drafts],
        "sources": [_public(s) for s in sources],
        "checks": checks,
    }


def author_pdfs(user: str | None) -> set[str]:
    """The PDFs this user's Author work may open: uploaded sources, and the papers a draft
    check or a search verification read. app.main.papers_of adds these to its own set."""
    names: set[str] = set(verified_pdfs.get(user, set()))
    for table in (PROJECTS, DRAFTS, SOURCES):
        for row in store.load_author_rows(table, user):
            names.update(Path(p).name for p in row.get("pdfs", {}).values())
            if row.get("pdf"):
                names.add(Path(row["pdf"]).name)
    gateway = _gateway()
    for run in gateway.analyses.values():
        if run.get("kind") == DRAFT_CHECK and run.get("owner") == user:
            for c in run.get("citations", []):
                pdf = (c.get("evidence") or {}).get("pdf")
                if pdf:
                    names.add(Path(pdf).name)
    return names
