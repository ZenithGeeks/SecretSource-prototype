# Draft-check: first real slice

Status: in progress. Kept updated as work lands — this is not a point-in-time proposal.

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

## Frontend (not started yet — backend lands and is reviewed first)

`writer.ts`'s existing `TODO gateway:` comments don't anticipate a *submit* action (they're
all `GET`s against a pre-existing draft). Adding two **new** methods rather than replacing
one of the TODO-marked ones: `checkClaim(claim, source) -> {id}` and `getCheck(id)`, plus a
hook that follows `/checks/{id}/events`. `getDraftCheck` and the rest of the mock stay
exactly as they are.

`api.ts`'s `onStages`/`readEvents` SSE loop is generalized into a `followEvents(path,
onEvent, onOpen)` helper; `api.onStages` becomes a thin wrapper over it. One SSE
implementation, two callers (`/analyses/{id}/events` and `/checks/{id}/events`) — not a
second progress mechanism.

`DraftCheck.tsx` gets a small submit card (claim textarea + citation-key input, adapted
from `SubmitForm.tsx`'s mutation pattern) above the existing, untouched mocked draft view.
Real verdict/quote/reasoning render in a panel reusing `StandingBadge`. `suggestion` and
`quoteLocation` are already optional on the `Issue`/`Claim` type, so a real result with
neither degrades through the existing `issue.quote &&` / `issue.suggestion &&` guards
without any type change.

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
