# Teacher Google Classroom Backend Implementation Plan

Design reference: `docs/superpowers/specs/2026-09-17-teacher-google-classroom-backend-design.md`

## Task 1: Add the Supabase schema, configuration, and dependency contract

### Scope

Create the owner-scoped Classroom tables and indexes with RLS enabled and no public policies. Add typed settings for Google OAuth, callback configuration, encryption key, retry behavior, and the feature flag. Add the Google client dependencies and document required environment variables and OAuth setup.

### Files

- `supabase/migrations/20260917120000_teacher_classroom.sql`
- `backend/app/config.py`
- `backend/requirements.txt`
- `backend/.env.example` or the existing backend env documentation
- `backend/README.md` and/or root README setup section
- tests for migration/config contracts where the repository has an established pattern

### Acceptance criteria

- Tables and indexes support owner/course/coursework/submission/review/feedback lookup and one-time OAuth state cleanup.
- Refresh tokens are represented as encrypted server-only data; no client-readable policy is introduced.
- Settings fail clearly for production OAuth misconfiguration but preserve local mock/test operation.
- Existing backend tests remain green.

## Task 2: Implement secure OAuth connection management

### Scope

Add `backend/app/teacher/crypto.py`, `oauth.py`, and repository primitives for encrypted refresh-token storage, one-time state/PKCE validation, authorization URL creation, callback exchange, connection status, and disconnect. Add unit tests with mocked Google token transport.

### Files

- `backend/app/teacher/__init__.py`
- `backend/app/teacher/models.py`
- `backend/app/teacher/repository.py`
- `backend/app/teacher/crypto.py`
- `backend/app/teacher/oauth.py`
- `backend/tests/test_teacher_oauth.py`
- `backend/tests/test_teacher_repository.py`

### Acceptance criteria

- OAuth state is random, owner-bound, single-use, short-lived, and PKCE-protected.
- Refresh tokens are never returned in API responses or logs.
- Callback handles first authorization and subsequent refresh-token omissions safely.
- Repository methods enforce owner scoping.

## Task 3: Implement the Google Classroom/Drive client and synchronization

### Scope

Add a small Google API wrapper with pagination, bounded retries, normalized errors, and methods for courses, rosters, coursework/materials/announcements/topics, submissions, Drive metadata/download/export, grade patch, and return. Add explicit sync orchestration and import/preview/workspace repository operations.

### Files

- `backend/app/teacher/google_client.py`
- `backend/app/teacher/sync.py`
- `backend/tests/test_teacher_google_client.py`
- `backend/tests/test_teacher_sync.py`

### Acceptance criteria

- All paginated Classroom collections are fully traversed.
- Sync upserts raw Google JSON with typed identity/ownership and does not cross owners.
- Transient Google failures retry with a bounded policy; auth and permission failures stay actionable.
- Imported course/workspace responses can represent the current Teacher page data.

## Task 4: Integrate essay analysis and build the teacher API router

### Scope

Add the essay attachment/analysis adapter and all `/api/teacher` routes, including async job status, review/feedback persistence, feedback send, and grade-and-return. Wire the router into the existing FastAPI gateway without disrupting current auth or startup restore behavior.

### Files

- `backend/app/teacher/analysis.py`
- `backend/app/teacher/router.py`
- `backend/app/main.py`
- `backend/tests/test_teacher_routes.py`
- `backend/tests/test_teacher_analysis.py`

### Acceptance criteria

- Teacher routes use the existing Supabase user identity and enforce owner/course/resource checks.
- Essay check downloads a supported Drive attachment and delegates to the existing analysis pipeline.
- Review/feedback writes persist only internal data; grade-and-return patches then returns in Classroom and exposes partial failure.
- Existing `/api/analyses`, researcher, and auth behavior remains unchanged.

## Task 5: Add the opt-in remote frontend adapter and thin Teacher-page wiring

### Scope

Keep the current mock adapter as default, add HTTP implementations for the teacher API, and add the smallest UI controls needed for Google connection, refresh, analysis status, review/feedback persistence, and grade-and-return. Preserve existing screen/type contracts and test coverage.

### Files

- `frontend/src/lib/teacherHttp.ts`
- `frontend/src/lib/teacher.ts`
- `frontend/src/lib/useTeacher.ts`
- `frontend/src/roles/teacher/AddClass.tsx`
- `frontend/src/roles/teacher/Classwork.tsx`
- `frontend/src/roles/teacher/EssayCheck.tsx`
- `frontend/src/roles/teacher/AssignmentDetail.tsx`
- `frontend/src/roles/teacher/TeacherApp.tsx` if routing changes are needed
- frontend tests for adapter and affected screens

### Acceptance criteria

- `VITE_TEACHER_BACKEND=mock` preserves existing tests and local behavior.
- `VITE_TEACHER_BACKEND=remote` reaches the FastAPI routes and does not invent a second persistence layer.
- Connection, refresh, analyze, save/send feedback, and grade-and-return controls show loading/errors and invalidate relevant queries.

## Task 6: Verify, document, and review the integrated implementation

### Scope

Add end-to-end setup documentation, run the full backend/frontend verification suite, inspect migration/API consistency, and resolve review findings.

### Acceptance criteria

- Backend pytest, frontend tests, build, and lint are run with recorded output.
- Documentation explains Google Cloud consent-screen/scopes/redirect setup, encryption key generation, Supabase migration, and remote feature flag.
- No refresh token or sensitive OAuth state is exposed to client responses or logs.
