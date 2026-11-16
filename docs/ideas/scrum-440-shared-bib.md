# SCRUM-440: the shared .bib tab writes to the project

Issue: #733 · Jira: SCRUM-440

## Problem Statement
How might we make a draft's shared .bib tab write to the project's .bib, so no draft silently
drifts off it and no edit is silently lost?

## Still a bug? (checked on main at 7be6c03)
- `PUT /author/drafts/{id}/files/{name}` only looks in `draft["files"]`; the project's .bib is
  not there, so the PUT appends a draft-local copy with no `shared` flag.
- `_draft_files` adds the project's .bib only when no draft file has its name, so the copy
  hides it from then on.
- `DELETE` on the shared .bib answers 404 "no such file".
- `PATCH /author/projects/{id}` writes the .bib with no version check.
- The editor and Home's Bibliography fixes send every file through the draft PUT, and the
  editor offers delete on the shared tab.

SCRUM-435 (#737) only made every draft answer carry the project's .bib (#725).

## Recommended Direction
`put_file` checks the name first: if it is the project's .bib and the draft has no local file of
that name, it writes the **project** row under the project's lock and answers with the usual
draft view. One fix point covers the editor's autosave and Home's `putFile`.

Stale writes reuse the pattern draft writes already use: the shared file entry carries the
.bib's own `updated` (the project's moves on a rename or a PDF too), the editor sends it back,
and a mismatch answers 409 "main.bib changed elsewhere since this editor last saved it".
`DELETE` refuses the shared .bib with a clear 400 (no screen offers deleting a file today).

Drafts that already hold a forked copy get a one-time notice in the same PR: the draft answer
flags the fork, and a small route resolves it. "Use project .bib" deletes the local copy;
"Keep this draft's copy" records the choice so the notice does not come back.

## Risks found while stress-testing
- **Lock order.** Not a risk after all: `RowLocks.hold` sorts its keys, project before draft,
  so the shared write holds both like every other route that does.
- **Two version tokens.** The editor sends the draft's `updated`; a shared write is checked
  against the .bib's own `updated`. The editor keeps one per kind of tab, and a refetch under
  unsaved shared-tab edits keeps the old one, so their write is a 409, not an overwrite.
- **Forks look like intent.** A draft file named like the project's .bib may be an old fork or a
  .bib the draft had before it joined the project. The notice asks rather than guesses.

## Key Assumptions to Validate
- [x] No PUT caller means a draft-local copy: the Editor and Home's Bibliography fixes both
      meant the project's .bib. Creating or uploading a draft with a file of that name still
      makes a copy, which the notice then asks about.
- [x] The shared write holds the project's and the draft's locks in the sorted order.
- [x] Another open editor gets a 409 on its next shared write, not a silent overwrite
      (backend and Editor tests).
- [x] "Keep this draft's copy" is a field on the draft row with no migration.

## MVP Scope (failing tests first)
1. An edit to the shared .bib in one draft changes the project's .bib; another draft sees it.
2. Deleting the shared .bib from a draft is refused (400, not 404).
3. A stale shared .bib write answers 409.
4. A forked copy is flagged; both resolve choices work.
5. Backend: PUT redirect, DELETE guard, project `updated` on the shared entry, fork flag,
   resolve route.
6. Front end: per-tab token, the 409 message, the one-time notice (Author files sit outside
   the 100% coverage gate; the Editor tests cover each path).

## Not Doing (and Why)
- **ETag / If-Match headers:** a second conflict mechanism; body `updated` already works.
- **Auto-merging a fork:** ruled out in the issue; BibTeX conflicts are the person's call.
- **Live push to open editors:** 409 + reload is enough; realtime is a separate feature.

## Decided while building
- `PATCH /author/projects/{id}` takes an optional `bibUpdated`, checked the same way. No screen
  writes the .bib through it yet.
- "Keep this draft's copy" is `keptBib` (the .bib name) on the draft row; no migration. Deleting
  that copy forgets it, so a copy made later is asked about again.
- A shared .bib write must carry a version (review finding): a Home upload or a tab added from a
  stale file list would otherwise replace the whole project .bib unchecked. A .bib written before
  versions existed gets one from its content, so every editor has one to send.
- The editor keeps a dirty shared tab's version even when the answer to a write of another file
  carries a newer one; only that file's own write, or the author's choice in a conflict, moves it.
