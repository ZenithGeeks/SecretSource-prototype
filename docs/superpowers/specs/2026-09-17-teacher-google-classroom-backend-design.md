# Teacher Google Classroom Backend Design

## Goal

Give a teacher an authenticated, persistent Google Classroom view in SecretSource while preserving the existing local teacher mock as the default development experience. The backend owns Google OAuth, Classroom synchronization, Drive downloads, essay-analysis jobs, review persistence, and grade-and-return mutations.

## Existing-system constraints

- FastAPI is the existing gateway under `backend/app/main.py`.
- Supabase is the production persistence/auth boundary. Existing blob-style tables use an owner text column and server-side service-role access; browser clients must not access those tables directly.
- The current analysis pipeline is already asynchronous and persists snapshots through `backend/app/store.py`. Teacher essay checking must enter that pipeline through a narrow adapter, not duplicate it.
- Frontend teacher screens currently use `teacherStore.ts`; the remote adapter must be opt-in so existing tests and local mock development remain stable.

## Google integration decisions

- Use a dedicated Google Classroom OAuth connection, separate from Supabase's Google sign-in session. A Supabase login token is not a durable Classroom refresh token.
- Use direct backend OAuth authorization-code + PKCE with offline access, an encrypted refresh token, one-time state, and an allowlisted callback URI.
- Request the minimum teacher scopes needed for the selected features: course/roster/coursework/material/announcement/topic reads, Drive read access for attached essays, and coursework student scope for grade/return.
- Store raw Google resource JSON alongside typed owner/course/resource identity columns so syncs are lossless while application queries stay explicit.
- Use explicit refresh endpoints/jobs rather than silently syncing every page read. Sync is paginated and retries transient Google failures.
- Grade-and-return is a Google Classroom operation: patch `assignedGrade`, then call the separate submission return endpoint. There is deliberately no separate local “returned” record; the next sync is authoritative. Internal feedback text remains in Supabase because Classroom has no matching per-student feedback-text endpoint.

## Persistence

The migration adds owner-scoped tables for:

- `teacher_google_connections`: one connection per owner, encrypted refresh token, Google subject/email metadata, scope and token timestamps.
- `teacher_google_oauth_states`: one-time short-lived state/PKCE records for callback CSRF and replay protection.
- `teacher_courses`: imported Classroom courses and raw course JSON.
- `teacher_coursework`: assignments/materials/announcements/topics represented as coursework resources and raw JSON.
- `teacher_submissions`: per-student Classroom submissions, attachment metadata, sync state, and analysis linkage.
- `teacher_professor_reviews`: persisted teacher verdict/reasoning for an essay check.
- `teacher_feedback`: internal feedback drafts/sends associated with a submission.

All tables have RLS enabled with no browser policies. The backend accesses them using the configured Supabase service role. Owner columns remain text to match the existing repository and auth boundary.

## API surface

All routes are under `/api/teacher` and require the existing `current_user` dependency except the OAuth callback, which authenticates through a signed/one-time state record and then redirects.

### Connection

- `GET /teacher/google/connect` -> `{ authorizationUrl }`
- `GET /teacher/google/callback` -> completes OAuth, persists the connection, redirects to the teacher UI
- `GET /teacher/google/status` -> connection/sync status
- `DELETE /teacher/google` -> revokes/deletes the stored connection and related local snapshots

### Read/sync

- `GET /teacher/home`
- `GET /teacher/classes`
- `GET /teacher/classes/importable`
- `GET /teacher/classes/importable/{courseId}/preview`
- `POST /teacher/classes/{courseId}/import`
- `GET /teacher/classes/{courseId}/workspace`
- `POST /teacher/classes/{courseId}/refresh`
- `GET /teacher/classes/{courseId}/assignments/{assignmentId}`

### Essay check and mutations

- `POST /teacher/classes/{courseId}/assignments/{assignmentId}/students/{studentId}/analyze`
- `GET /teacher/classes/{courseId}/assignments/{assignmentId}/students/{studentId}/essay-check`
- `PATCH /teacher/classes/{courseId}/assignments/{assignmentId}/essay-check/reviews/{reviewId}`
- `PUT /teacher/classes/{courseId}/assignments/{assignmentId}/essay-check/feedback`
- `POST /teacher/classes/{courseId}/assignments/{assignmentId}/students/{studentId}/essay-check/feedback/send`
- `POST /teacher/classes/{courseId}/assignments/{assignmentId}/students/{studentId}/grade-and-return`

Responses are shaped to the existing `frontend/src/lib/teacher.ts` types where practical, with explicit sync/job status fields for remote-only state.

## Essay-check flow

1. Resolve the owner connection and selected Classroom submission; reject cross-owner/course/resource access.
2. Select the first supported Drive attachment, preferring a PDF and otherwise exporting a Google Doc as PDF.
3. Download the attachment through Drive into the existing content-addressed papers directory.
4. Launch the existing analysis pipeline with the teacher/course/submission owner context and return a job id.
5. Persist the submission's analysis id and expose a normalized EssayCheck response by mapping existing claims/verdicts and the saved teacher review.

## Failure behavior

- OAuth state expiry, missing connection, unsupported attachment, and cross-owner resources are explicit HTTP errors.
- Google 401/403/429/5xx responses are normalized by the client wrapper; transient failures are retried with bounded backoff.
- Grade patch and return are separate calls. If the patch succeeds but return fails, report a partial failure and never pretend the submission was returned locally.
- Async analysis failures are persisted through the existing analysis snapshot path and surfaced by the essay-check status endpoint.

## Compatibility

`VITE_TEACHER_BACKEND=mock` remains the default. `VITE_TEACHER_BACKEND=remote` selects the HTTP adapter and enables the connection/sync/analysis/mutation controls without replacing the existing screen contracts.
