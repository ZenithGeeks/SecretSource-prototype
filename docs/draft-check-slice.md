# Draft-check: first real slice

Status: backend and frontend both done and green. Backend reviewed and approved
(139/139 in Docker). Frontend not yet committed — stopping here for review per SCRUM-236.

## Scope boundary

One claim + one citation. The user pastes a claim sentence and a citation key (DOI, arXiv
id, or paper title); the backend resolves the source and runs the existing verification
pipeline; the UI shows the real verdict, quote, and reasoning.

Explicitly **not** in this slice:
- No claim extraction from a draft.
- No draft parsing (LaTeX, PDF, or otherwise).
- No `drafts` table, no multi-claim draft view wired to real data.
- No alternate-citation suggestion (no source for that anywhere in the pipeline — see #204).

This is the narrowest path to a real (non-mocked) verdict on screen, so the shape of the
rest of draft-check (extraction, drafts, suggestions) can be designed against something
real instead of guessed.

## Prior art this slice builds on

- Spike results and the four questions (A-D) they answer: issue #204.
- `verify_claim` is already decoupled from any Analysis object (#204, finding A). No
  wrapper or schema needed to call it standalone.
- Citations need a resolvable key (DOI/arXiv id/title) separate from the display label
  (#204, finding B) — a free-text author-year label like "Khattab & Zaharia, 2020" is not
  enough for `sources.py` to resolve.
- ~12s/claim end to end, ColBERT must be a standing service (#204 finding D, infra
  question tracked separately in #205) — this rules out a synchronous request/response;
  the route has to be async with progress events, reusing the same mechanism the
  researcher analysis flow already has (`Stage`/SSE via `useAnalysis.ts`).
- `POST /verify` already exists (`main.py:644`) and does something adjacent (claim+source
  -> verdict) but is unauthenticated, unscoped to a user, not persisted, and synchronous.
  **Deliberately left alone** — not reused, not modified, not removed here. Tracked
  separately as its own issue (unauthenticated + burns quota).

## Backend

New routes, mirroring `/analyses`'s shape:

- `POST /checks` — `{claim: str, source: str}` -> `{id}`. Scoped to `current_user`, same
  as `_start`. Kicks off a background task.
- `GET /checks/{id}` — one check + its result. `_owned`-gated like `/analyses/{id}`.
- `GET /checks/{id}/events` — SSE, reusing the same `streams` dict + `_publish` machinery
  `_run` already uses for paper analyses.
- `DELETE /checks/{id}` — parity with `/analyses`.
- No `GET /checks` list route — no history UI for checks in this slice.

Background task (`_run_check`): calls `verify_claim(claim, source)` as a single
`asyncio.to_thread` call — not the `prepare_source`/`check_prepared` split `_run` uses for
papers (that split exists to parallelize many claims/sources per paper; irrelevant for one
claim, and calling `verify_claim` whole is the more literal "reuse as-is").

**Coarse-progress limitation:** because `verify_claim` is one blocking call and the
pipeline modules are not being modified, there is no mid-call stage. Progress is exactly
two events: `resolving` (before the call) and `done`/`error` (after). No `checking`
stage in between — the client sees a gap, not intermediate progress, while the ~12s call
runs.

**ColBERT down:** no pre-flight health check added (out of scope; `dependencies.report()`
already exists for `/health` if wanted later). The route surfaces whatever `verify_claim`
returns as-is — `status: "error"`, `reason`, `message` — never a fabricated verdict.

## Persistence

Same `analyses` table, **no schema change** — it's a blob column (`store.py`'s `save` /
`load_all` don't care about shape). A check row carries `"kind": "check"` inside its JSON.

`GET /analyses` (the researcher list, `main.py:346`) gets a one-line filter:
`a.get("kind", "paper") == "paper"` — old rows with no `kind` field default to `"paper"`
so nothing already stored changes behavior; new check rows never show up in the
researcher's list.

Auth/ownership: zero new code. `_owned`, `visible_to`, `current_user` are already generic
over the `analyses` dict; a check row with an `owner` field works through the existing
checks unchanged.

## Implementation notes (backend)

Landed as planned, with two small additions made while implementing:

- `_forget(item_id)` factors the pop/pop/wait/delete sequence `delete_analysis` already
  had, now shared with `delete_check` — avoids a second copy of that sequence rather than
  duplicating it onto the new route.
- `_event_stream(item_id)` factors the SSE replay-then-follow generator out of
  `analysis_events` the same way, shared with `check_events`. Both refactors are
  behavior-preserving (existing `/analyses` tests still pass unchanged); done so the new
  `/checks` routes reuse the same stream/delete code path instead of a second copy.

## Frontend

Landed as planned:

- `api.ts`: `onStages`/`readEvents`'s SSE loop is generalized into an exported
  `followEvents<T>(path, onEvent, onOpen)`; `api.onStages` is now a thin wrapper over it
  (`followEvents<Stage>('/analyses/${id}/events', ...)`). One SSE implementation, two
  callers.
- `writer.ts`: two **new** methods, not a replacement of an existing `TODO gateway:` one —
  those all anticipate a `GET` against a pre-existing draft, and nothing in the mock ever
  modeled a *submit* action. Added `CheckStage`/`CheckResult` types, `checkClaim(claim,
  source) -> {id}`, `getCheck(id)`, and `onCheckStages(id, onStage, onOpen)` (built on
  `followEvents`). `getDraftCheck` and the rest of the mock are untouched.
- `useWriter.ts`: `useCheckClaim()` (mutation) and `useCheck(id)` (query + SSE-follow,
  mirroring `useAnalysis.ts`'s replay/resync logic — a check only ever has two stages, so
  it skips the refetch-batching `useAnalysis` needs for a paper's many rapid-fire stages).
- `DraftCheck.tsx`: a new `ClaimCheckCard` component (claim + citation-key inputs, adapted
  from `SubmitForm.tsx`'s mutation pattern) renders unconditionally above the existing
  mocked draft view — the component's three early-return branches (`isPending`/`isError`/
  `data`) became inline conditional blocks so the card shows regardless of the mock's
  state. Real verdict/quote/reasoning render through `StandingBadge`, reused as-is.
  `suggestion` and `quoteLocation` are never referenced by the new card — nothing to
  degrade, since nothing tries to show them.

Tests: `frontend/tests/checks.test.tsx` — `followEvents`'s path + JSON parsing, `api.onStages`
still targeting `/analyses/{id}/events` post-refactor, `checkClaim`/`getCheck`'s request
shapes, and `useCheck`/`useCheckClaim` including one test of the full running-to-done
replay flow (a real backend replays every already-recorded stage before new ones, which the
test's mock SSE stream has to reproduce or the hook's replay-dedup misreads a live event as
a replay — hit this as a real bug in the test's first draft, not the hook).

## Tests

- Backend: `test_checks.py`, following `test_ownership.py`'s `TestClient` +
  monkeypatched-store pattern and `test_upload.py`'s trick of stubbing the starter
  function so no live colbert/network is needed in CI. Covers: scoping (someone else's
  check 404s), the `kind` filter keeping `/analyses` clean, and the error path (stubbed
  `verify_claim` returning `status: "error"` surfaces honestly).
- Frontend: `tests/checks.test.ts(x)`, following `account-settings.test.tsx`'s
  `vi.stubGlobal('fetch', ...)` + `renderHook` pattern.

## Explicitly not touched

`pipeline/sources.py`, `pipeline/verify.py` — reused as-is, zero modifications.

## Tracking

- Spike findings: #204
- ColBERT infra (standing-service question): #205
- `POST /verify` auth/quota issue: #206
- This slice's tracking issue: #207
- Jira: SCRUM-236
