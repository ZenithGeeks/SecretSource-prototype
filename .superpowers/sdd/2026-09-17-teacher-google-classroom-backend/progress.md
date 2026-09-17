# Execution Ledger: Teacher Google Classroom Backend

Plan: `docs/superpowers/plans/2026-09-17-teacher-google-classroom-backend.md`

## Rulings

- Ruling: The existing `SCRUM-161-backend` checkout is already a dedicated feature branch and is clean; implement in place rather than create another checkout — cost if wrong: changes would not be isolated from another feature branch.
- Ruling: Supabase remains the production persistence boundary. There is no SQLite fallback for Classroom connection/sync data because the feature requires Supabase-authenticated owners and server-side secrets — cost if wrong: local-only Classroom development would need a later test double or fallback.
- Ruling: Use typed owner/resource identity columns plus raw Google JSONB, matching existing project/blob storage conventions — cost if wrong: future Google fields may require migration work instead of being preserved.
- Ruling: Use `google-api-python-client`/Google auth primitives behind a small wrapper so tests can inject a fake client and production can handle pagination/retries centrally — cost if wrong: dependency/API behavior could be more complex than a raw REST client.
- Ruling: Use the existing in-process `asyncio.create_task` pattern for analysis jobs; persist job linkage/status through the existing analysis snapshots instead of introducing a worker service — cost if wrong: jobs can be lost on process restart, as existing analyses already are marked interrupted.
- Ruling: “Grade + return” means patch `assignedGrade`, then call Classroom’s explicit return operation. Do not create a separate local returned-state record; feedback text remains internal Supabase data — cost if wrong: local UI cannot show a durable return event until the next Classroom sync.
- Ruling: The mock Teacher adapter stays the default; remote HTTP behavior is opt-in via `VITE_TEACHER_BACKEND=remote` — cost if wrong: production users could remain on local data unless deployment explicitly enables the flag.

## Progress

- [ ] Task 1: schema/config/dependency contract
- [ ] Task 2: OAuth connection management
- [ ] Task 3: Google client and synchronization
- [ ] Task 4: analysis integration and API router
- [ ] Task 5: remote frontend adapter and thin UI wiring
- [ ] Task 6: verification, docs, and review

Task 1: fix round 1/5 (1 Important addressed, 0 open — Fernet key validation and valid-key tests; commits 360d055..8d2bd0d)
Task 1: complete (commits 42471d2..8d2bd0d, review clean after one fix round)

Task 2 review findings: Important — authorization URL omitted `prompt=consent`; omitted refresh tokens were preserved across a changed Google subject; repository lacked safe connection status/disconnect primitives. Minor — the tracked Task 1 report appeared in the Task 2 diff because it was committed after the Task 2 review base. Fix round 1 will address the three Important findings; the report-artifact minor is deferred as process bookkeeping.
Task 2: fix round 1/5 (3 Important addressed, 0 open — consent prompt, subject-safe token preservation, status/disconnect; commits 748786f..d85cc59)
Task 2: complete (commits 8d2bd0d..d85cc59, review clean after one fix round; one minor report-artifact note deferred)

Ruling: Split Task 3 into client (3A) and sync (3B) slices at the natural `google_client.py` interface because the first combined worker produced no implementation before hanging — cost if wrong: two task reviews and commits add process overhead, but keeping the broad slice combined would increase integration risk and delay all downstream work.
Task 3A review findings: Important — `select_supported_attachments` reads the wrong Classroom nesting and drops native `driveFile.driveFile` materials; Important — the client test file was not included in the Task 3A commit. Fix round 1 will correct the native shape and commit the focused tests with a regression case.
Task 3A: fix round 1/5 (2 Important addressed, 0 open — native attachment unwrapping and committed client regression tests; commits d847cdb..1b5c4bf)
Task 3A: complete (commits d85cc59..1b5c4bf, review clean after one fix round)
Ruling: Extend Task 3B's write scope to add only owner-scoped repository list/read methods because the approved workspace/import-preview responses require reading persisted courses, coursework, and submissions; cost if wrong: a later router task would otherwise need duplicate Supabase queries or violate the repository boundary.
Task 3B review findings: Critical — repository list methods splat Supabase `id`/timestamp columns into dataclasses and fail on real rows. Important — non-Drive sync failures do not persist connection sync status; Important — refresh writes `analysis_id=None` and erases local analysis linkage. Minor — multiple Drive metadata errors overwrite each other. Fix round 1 will address all four with regression tests.
Task 3B: fix round 1/5 (1 Critical, 2 Important, 1 Minor addressed, 0 open — row parsing, sync status, analysis linkage, error aggregation; commits 3ce38b1..dec843b)
Task 3B: complete (commits 1b5c4bf..dec843b, review clean after one fix round)
Ruling: Split Task 4 into analysis/persistence (4A) and FastAPI router (4B) so the analysis adapter can be tested independently from gateway wiring; allow 4A to add a forward-only repository/migration field for feedback citation IDs because the existing Teacher contract persists selected citations — cost if wrong: the migration/repository surface grows before route wiring, but omitting it would lose teacher feedback selections on reload.

## Verification evidence

Preflight scan (shared files/interfaces and self-consistency):

| Scope | Shared file/interface | Check | Ruling |
| --- | --- | --- | --- |
| Task 1 -> Task 2 | migration tables, config values, Google dependencies | OAuth/repository consumes the schema and settings; no conflicting file ownership | Clean; Task 2 must not weaken RLS or expose secrets. |
| Task 1 -> Task 3 | config values, Google dependencies, course/resource table shapes | Google client/sync consumes retry/scopes and upserts the typed/raw schema | Clean; Task 3 may add only compatible repository methods. |
| Task 1 -> Task 4 | Supabase tables/config, backend dependency contract | Router/analysis consumes repository/config without editing Task 1-owned files beyond documented interfaces | Clean; service-role access stays server-side. |
| Task 1 -> Task 5 | remote feature flag and documented env vars | Frontend adapter consumes the flag while mock remains default | Clean; Vite env is public and must contain no secrets. |
| Task 2 -> Task 3 | `teacher.models`, `teacher.repository`, connection/token interface | Sync obtains a usable Google client from the connection layer and persists owner-scoped resources | Clean; Task 3 must use owner-scoped methods. |
| Task 2 -> Task 4 | repository identity/connection methods | Routes and analysis resolve the same owner-bound connection/resource records | Clean; cross-owner resources remain 404/forbidden. |
| Task 3 -> Task 4 | Google client, sync, attachment/submission interfaces | Router calls sync/client for reads and mutations; analysis uses Drive download | Clean; grade and return remain separate Google operations. |
| Task 4 -> Task 5 | `/api/teacher` response shapes and mutation routes | Frontend adapter maps existing Teacher types to HTTP responses | Clean; HTTP adapter must preserve mock type contracts. |
| Task 6 -> all | test/docs/verification outputs | Final task verifies the complete branch and records any deferred findings | Clean; no implementation interface conflict found. |

Per-task self-consistency scan:

| Task | Files vs. later touches | Tests vs. specified behavior | Result |
| --- | --- | --- | --- |
| 1 | Config/schema/docs are inputs to later tasks and are not claimed by them | Migration/config contract tests cover table/settings shape | Consistent |
| 2 | OAuth/repository files are consumed by Tasks 3–4 and not rewritten by them | Tests cover state, PKCE, encryption, owner scope, and callback refresh-token behavior | Consistent |
| 3 | Client/sync files are consumed by Task 4 and not rewritten by Task 5 | Tests cover pagination, retries, Drive attachment, upsert ownership, and Classroom mutations | Consistent |
| 4 | Router/analysis/main are the gateway boundary consumed by Task 5 | Route tests cover auth/scope/job/review/feedback/grade-return/partial failure | Consistent |
| 5 | Frontend adapter/screens are final consumers and are not backend-owned | Adapter/UI tests cover mock default, remote calls, loading/errors, and invalidation | Consistent |
| 6 | Documentation/tests inspect all prior files without owning product code | Full backend/frontend checks plus migration/API consistency review | Consistent |

Baseline: `py -m pytest -x -vv` from `backend` collected 123 tests, reached 32 passed, then hit a pre-existing Windows `PermissionError` creating pytest's default temp root (`C:\Users\julia\AppData\Local\Temp\pytest-of-julia`) in `tests/test_figures.py`; pytest cache/temp paths were also denied. Subsequent verification uses a writable repository-local temp directory.

Task 4A review: the delegated reviewer hit the platform usage cap before returning; local diff inspection and the focused suite found no open findings. The adapter uses the actual stored Classroom Drive attachment shape, the existing lazy pipeline boundary, explicit owner-scoped persistence, and the forward-only citation-ID migration.
Task 4A: complete (commit adcf553, focused tests 5 passed; local review clean).
Task 4B: complete (commit 529a478, focused route/integration tests 39 passed across the Teacher backend slice).
Task 5: complete for the approved opt-in remote Teacher adapter (commit 274bd4e; TypeScript build passes). Existing reading-question/legacy classwork methods remain mock-backed because no corresponding backend routes were in the approved Classroom API surface.
Task 6: backend verification complete; frontend Vite/Vitest execution is environment-blocked by Windows `EPERM` and a missing Tailwind native binary, while `npx tsc -b --pretty false` passes.

Task 1 review finding: the enabled configuration accepted any non-empty encryption key instead of validating Fernet format; the reviewer confirmed this as Important. The original worker also did not capture RED evidence because it hung in pytest cleanup; the fix round will add the missing validation test and record a new RED/GREEN run.
