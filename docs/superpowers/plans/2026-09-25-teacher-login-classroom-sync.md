# Teacher Sign-in Classroom Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically refresh a returning teacher's imported Google Classroom classes during app sign-in, and perform the initial sync after first-time Google connection, without asking returning teachers to log into Google twice.

**Architecture:** Add an owner-scoped backend operation that uses the existing encrypted Google refresh token and sequentially refreshes every imported course with per-course results. Trigger it from the shared Supabase sign-in lifecycle, run the same sync after Google OAuth callback, refresh teacher query caches afterward, and change the existing class Refresh button from cache invalidation to a real Classroom sync.

**Tech Stack:** FastAPI, Supabase service-role persistence, Google Classroom API client, React 19, TanStack Query, Supabase Auth, Vitest/Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-09-25-teacher-login-classroom-sync-design.md`

## Global Constraints

- “For a returning account with a saved Google Classroom connection, start a sync when Supabase authenticates the user, before role selection.”
- “Use the saved Classroom connection to identify teacher accounts. Accounts without one get a no-op; they aren’t sent through Google OAuth.”
- “Sync all previously imported classes. Don’t sync on every navigation or run a timed background scheduler.”
- “For a first-time connection, start the initial sync after Google OAuth succeeds.”
- “Reuse the saved token on later sign-ins. Ask the teacher to reconnect only if the token is revoked or lacks required permissions.”
- “Preserve cached data if sync fails, and make the failure visible.”
- “The current frontend teacher mock adapter remains offline by default.”
- Google credentials remain encrypted and server-side; never return token material to the browser.
- Preserve all pre-existing worktree edits. Do not stage or commit overlapping modified files wholesale; keep this work uncommitted unless its exact hunks can be isolated safely and the user asks for a commit.

## Review Focus

1. No saved Google connection: login sync returns a no-op and makes no Google API calls (Task 2).
2. Connected account with zero imported classes: sync is a no-op and does not fetch a course list (Task 1).
3. One imported course fails while another succeeds: continue, preserve the previous snapshot, and report partial results (Tasks 1–2).
4. Revoked token or missing Classroom permission: do not block app sign-in or discard cached data; show an actionable reconnect state (Tasks 2 and 4).
5. Duplicate Supabase auth callbacks/React StrictMode replay: do not start concurrent duplicate login syncs for the same session (Task 4).

---

### Task 1: Add sequential multi-class sync results

**Files:**
- Modify: `backend/app/teacher/sync.py`
- Test: `backend/tests/test_teacher_sync.py`

**Interfaces:**
- Consumes: `TeacherGoogleRepository.list_courses(owner)`, `TeacherGoogleSyncService.refresh_course(owner, course_id)`, and `record_sync_status(owner, status, error, synced_at)`.
- Produces: `TeacherGoogleSyncService.sync_imported_courses(owner: str) -> dict[str, Any]`.
- Result contract: `{status, imported_count, synced_count, failed_count, results}`. Each result contains `course_id`, `course_name`, `status` (`synced` or `failed`), and a safe `error` only on failure. Batch status is `skipped` when there are no imported courses, `synced` when all succeed, `partial` when some succeed, and `failed` when all fail.
- Concurrency: serialize batches with a per-owner in-process lock; concurrent requests for the same owner wait for the active batch rather than syncing simultaneously. Protect lock-table creation with a separate mutex.

- [ ] **Step 1: Write failing service tests**

Add tests to `backend/tests/test_teacher_sync.py` using the existing `FakeRepository` and `FakeGoogle` fixtures. Pin the empty and partial cases with literals:

```python
def test_login_sync_skips_google_when_no_courses_are_imported():
    from app.teacher.sync import TeacherGoogleSyncService

    repository = FakeRepository()

    class NoCallGoogle(FakeGoogle):
        def list_courses(self):
            raise AssertionError("no Google call is expected")

    result = TeacherGoogleSyncService(client=NoCallGoogle(), repository=repository).sync_imported_courses("teacher-a")

    assert result == {
        "status": "skipped", "reason": "no_imported_classes",
        "imported_count": 0, "synced_count": 0,
        "failed_count": 0, "results": [],
    }


def test_login_sync_continues_after_a_course_failure_and_reports_partial_results():
    from app.teacher.models import TeacherCourse
    from app.teacher.sync import TeacherGoogleSyncService

    repository = FakeRepository()
    repository.courses = [
        TeacherCourse("teacher-a", "c1", "English", None, None, None, "ACTIVE", {}),
        TeacherCourse("teacher-a", "c2", "Biology", None, None, None, "ACTIVE", {}),
    ]

    class OneCourseFailsGoogle(FakeGoogle):
        def list_courses(self):
            return [{"id": "c1", "name": "English"}, {"id": "c2", "name": "Biology"}]

        def list_coursework(self, course_id):
            if course_id == "c1":
                raise RuntimeError("Classroom unavailable for c1")
            return []

    result = TeacherGoogleSyncService(
        client=OneCourseFailsGoogle(), repository=repository,
    ).sync_imported_courses("teacher-a")

    assert result["status"] == "partial"
    assert (result["imported_count"], result["synced_count"], result["failed_count"]) == (2, 1, 1)
    assert [item["course_id"] for item in result["results"]] == ["c1", "c2"]
    assert result["results"][0]["error"] == "Classroom unavailable for c1"
    assert result["results"][1]["status"] == "synced"
    assert repository.sync_statuses[-1][1] == "partial"


def test_login_sync_serializes_batches_for_the_same_owner():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, Lock
    from app.teacher.models import TeacherCourse
    from app.teacher.sync import TeacherGoogleSyncService

    repository = FakeRepository()
    repository.courses = [TeacherCourse("teacher-a", "c1", "English", None, None, None, "ACTIVE", {})]
    entered, second_entered, release = Event(), Event(), Event()
    calls_lock = Lock()
    active, max_active = 0, 0

    class BlockingGoogle(FakeGoogle):
        def list_coursework(self, course_id):
            nonlocal active, max_active
            with calls_lock:
                active += 1
                max_active = max(max_active, active)
                if active == 1:
                    entered.set()
                else:
                    second_entered.set()
            release.wait(timeout=2)
            with calls_lock:
                active -= 1
            return []

        def list_courses(self): return [{"id": "c1", "name": "English"}]
        def list_teachers(self, course_id): return []
        def list_students(self, course_id): return []

    service = TeacherGoogleSyncService(client=BlockingGoogle(), repository=repository)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.sync_imported_courses, "teacher-a")
        assert entered.wait(timeout=2)
        second = pool.submit(service.sync_imported_courses, "teacher-a")
        assert not second_entered.wait(timeout=0.1)
        release.set()
        assert first.result(timeout=2)["status"] == "synced"
        assert second.result(timeout=2)["status"] == "synced"
    assert max_active == 1
```

- [ ] **Step 2: Run the new tests and confirm they fail because the method is missing**

Run from `backend/`: `py -3 -m pytest tests/test_teacher_sync.py -k login_sync -q`.

Expected: both new cases fail because `sync_imported_courses` does not exist.

- [ ] **Step 3: Implement the minimal batch method**

In `TeacherGoogleSyncService`, list only the owner’s imported courses; return the exact skipped result before touching `self.client` when the list is empty. Iterate courses in repository order, call `refresh_course` once per course, catch each course exception separately, and append one result per course. Never delete local rows on failure. After the loop, compute the aggregate status and call `record_sync_status` once with the batch outcome and completion time so the final course result cannot overwrite a partial batch status. Serialize same-owner batches using the per-owner lock and a lock-table mutex; different owners must be able to sync concurrently. Add `_safe_sync_error(error)` to redact credential-like values and truncate the displayed error to 500 characters, then use it for result and status text so OAuth codes and token values cannot leak.

```python
def sync_imported_courses(self, owner: str) -> dict[str, Any]:
    courses = self.repository.list_courses(owner)
    if not courses:
        return {
            "status": "skipped", "reason": "no_imported_classes",
            "imported_count": 0, "synced_count": 0,
            "failed_count": 0, "results": [],
        }

    results = []
    for course in courses:
        try:
            self.refresh_course(owner, course.course_id)
            results.append({
                "course_id": course.course_id, "course_name": course.name,
                "status": "synced",
            })
        except Exception as error:
            results.append({
                "course_id": course.course_id, "course_name": course.name,
                "status": "failed", "error": _safe_sync_error(error),
            })

    synced = sum(item["status"] == "synced" for item in results)
    failed = len(results) - synced
    status = "synced" if failed == 0 else "failed" if synced == 0 else "partial"
    message = "; ".join(f"{item['course_name']}: {item['error']}" for item in results if item["status"] == "failed") or None
    self.repository.record_sync_status(owner, status, message, datetime.now(UTC))
    return {
        "status": status, "imported_count": len(courses), "synced_count": synced,
        "failed_count": failed, "results": results,
    }
```

- [ ] **Step 4: Run the focused service tests and all sync tests**

Run: `py -3 -m pytest tests/test_teacher_sync.py -q`.

Expected: all tests pass, including existing owner-scoping, refresh, and analysis-link preservation tests.

- [ ] **Step 5: Review only the service/test hunks**

Run `git diff -- backend/app/teacher/sync.py backend/tests/test_teacher_sync.py` and verify the new implementation did not overwrite or stage unrelated edits already present in either file. Leave the worktree uncommitted unless the new hunks can be isolated safely and the user requests a commit.

### Task 2: Expose login sync and run it after OAuth connection

**Files:**
- Modify: `backend/app/teacher/router.py`
- Test: `backend/tests/test_teacher_routes.py`

**Interfaces:**
- Consumes: `TeacherGoogleSyncService.sync_imported_courses(owner)` from Task 1.
- Produces: authenticated `POST /teacher/sync-on-login` and an OAuth callback that invokes the same service after persisting a connection.
- Login route returns `{status: "skipped", reason: "not_connected"}` without constructing a Google client when no saved connection exists. Connected routes return the Task 1 batch result.

- [ ] **Step 1: Write failing route tests**

Extend the route fixture repository with `get_connection(owner)` and `record_sync_status(...)`. Add cases proving no connection returns a no-op without calling Google, and a connected account returns the batch result. Add an OAuth callback test in this same file: its fake OAuth service returns the `ConnectedTeacher` from `complete_callback`; monkeypatch the shared connection-to-sync-service factory and verify callback starts initial sync but still redirects if that sync returns `partial` or `failed`.

```python
def test_login_sync_without_saved_connection_is_a_noop(teacher_client, monkeypatch):
    client, repository, google = teacher_client
    repository.get_connection = lambda owner: None
    monkeypatch.setattr(
        "app.teacher.router.sync_service_for_connection",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Google must not be constructed")),
    )

    response = client.post("/teacher/sync-on-login")

    assert response.status_code == 200
    assert response.json() == {"status": "skipped", "reason": "not_connected"}
    assert google.downloads == []
```

For the connected case, assert `POST /teacher/sync-on-login` returns the exact batch response and uses the authenticated owner, not an owner from request JSON. For callback failure, assert a redirect response and that the repository records a sync failure; OAuth connection success must not be undone by a later Classroom sync failure. Override `get_login_sync_service` to return `None` for the disconnected route case, and separately test its provider checks the saved connection before calling the Google credential factory. The callback invokes the same `sync_service_for_connection(owner, connection, repository)` factory after `complete_callback` returns its `ConnectedTeacher` owner; it must not rely on a request-auth dependency.

- [ ] **Step 2: Run the new route tests and confirm they fail**

Run from `backend/`: `py -3 -m pytest tests/test_teacher_routes.py -k 'login_sync or oauth_callback_sync' -q`.

Expected: the login endpoint is 404 and the callback does not invoke the sync service.

- [ ] **Step 3: Implement the authenticated endpoint and connection-safe client construction**

Refactor the existing Google credential construction into `sync_service_for_connection(owner, connection, repository)`, which accepts a loaded `TeacherGoogleConnection`; keep `get_google_client` behavior unchanged by sharing the credential/client builder. Add `get_login_sync_service(owner=Depends(require_teacher_user), repository=Depends(get_repository)) -> TeacherGoogleSyncService | None`; it checks `repository.get_connection(owner)` before calling that helper and returns `None` when disconnected. Add `POST /sync-on-login`, which returns the specified no-op for `None`, otherwise calls `sync_imported_courses(owner)`. Map Google/API failures through `_map_google_error` and never include token data in the response.

```python
@router.post("/sync-on-login")
def sync_on_login(
    owner: str = Depends(require_teacher_user),
    service: TeacherGoogleSyncService | None = Depends(get_login_sync_service),
) -> dict[str, Any]:
    if service is None:
        return {"status": "skipped", "reason": "not_connected"}
    return service.sync_imported_courses(owner)
```

Capture the `ConnectedTeacher` returned by `complete_callback`. After it persists the connection, load its `TeacherGoogleConnection` and call `sync_service_for_connection(connected.owner, connection, repository)`, then invoke `sync_imported_courses`. Catch post-connect sync failure at the callback boundary, retain the saved connection, record the failure, and always redirect to `TEACHER_GOOGLE_SUCCESS_REDIRECT` so sync failure cannot lose the successful OAuth connection.

- [ ] **Step 4: Run route, OAuth, and service tests**

Run from `backend/`: `py -3 -m pytest tests/test_teacher_routes.py tests/test_teacher_oauth.py tests/test_teacher_sync.py -q`.

Expected: connected and disconnected sign-in paths, first-time callback, partial failures, and existing route behavior pass.

- [ ] **Step 5: Review only the backend route/test hunks**

Inspect `git diff -- backend/app/teacher/router.py backend/tests/test_teacher_routes.py` and ensure existing edits in those shared files are preserved. Leave the worktree uncommitted unless the new hunks can be isolated safely and the user requests a commit.

### Task 3: Add frontend sync APIs and make manual Refresh fetch Classroom data

**Files:**
- Modify: `frontend/src/lib/teacher.ts`
- Modify: `frontend/src/lib/useTeacher.ts`
- Modify: `frontend/src/roles/teacher/screens/ClassWorkspace.tsx`
- Modify: `frontend/src/roles/teacher/components/ClassWorkspaceHeader.tsx`
- Modify: `frontend/src/roles/teacher/TeacherApp.tsx`
- Test: `frontend/tests/teacher.remote.test.tsx`
- Test: `frontend/tests/teacher-pages.test.tsx`

**Interfaces:**
- Consumes: backend routes from Task 2.
- Produces: `teacherApi.syncOnLogin(): Promise<TeacherLoginSyncResult>`, `teacherApi.refreshClass(courseId): Promise<TeacherClassRefreshResponse>`, and `useRefreshTeacherClass()`.
- `useRefreshTeacherClass` updates the workspace cache from the response and invalidates `TEACHER_HOME_KEY`, `teacherAssignmentKey(courseId, ...)`, and `teacherEssayCheckKey(courseId, ...)` using the `['teacher']` prefix.

- [ ] **Step 1: Write failing API contract tests**

In `teacher.remote.test.tsx`, assert exact URL, method, and body for the two operations:

```typescript
it('calls the authenticated sign-in sync endpoint', async () => {
  const api = createRemoteTeacherApi()
  request.mockResolvedValue({ status: 'skipped', reason: 'not_connected' })

  await api.syncOnLogin()

  expect(request).toHaveBeenCalledWith('/teacher/sync-on-login', { method: 'POST' })
})

it('refreshes one class through the real Classroom endpoint', async () => {
  const api = createRemoteTeacherApi()
  request.mockResolvedValue({ workspace: { course: { id: 'c1' } }, sync: { course_id: 'c1' } })

  await api.refreshClass('c1')

  expect(request).toHaveBeenCalledWith('/teacher/classes/c1/refresh', { method: 'POST' })
})
```

- [ ] **Step 2: Run the API tests and confirm the methods are missing**

Run from `frontend/`: `npm run test:vitest -- --run tests/teacher.remote.test.tsx`.

Expected: the API calls fail because `syncOnLogin` and `refreshClass` do not exist.

- [ ] **Step 3: Implement API types, mock-safe methods, and refresh mutation**

Define `TeacherLoginSyncResult` with status (`synced | partial | skipped | failed`), optional reason (`not_connected | no_imported_classes | mock_mode`), counts, and per-course results; define `TeacherClassRefreshResponse` with `{workspace, sync}` matching the existing backend `/classes/{course_id}/refresh` response. Add remote methods to `createRemoteTeacherApi`. Keep mock mode offline: `syncOnLogin` returns `skipped/mock_mode`; `refreshClass` resolves from `store.getWorkspace(courseId)` and throws a clear error if no local workspace exists. Add `useRefreshTeacherClass`; on success set `teacherWorkspaceKey(courseId)` from `response.workspace` and invalidate the `['teacher']` prefix so classes, home, assignments, and essay-check details reload.

- [ ] **Step 4: Wire the existing Refresh control to the mutation**

In `ClassWorkspace`, call `useRefreshTeacherClass`, run `.mutate(courseId)` from the header callback, disable while pending, render the backend error in a `role="alert"`, and render the returned sync result in a `role="status"`. Rename the action to “Sync with Classroom” and its busy label to “Syncing...” so the operation is not confused with a local cache reload. Remove the `onRefresh` prop and `TeacherApp.refreshWorkspace`, which only invalidates one query.

- [ ] **Step 5: Run focused frontend tests**

Run: `npm run test:vitest -- --run tests/teacher.remote.test.tsx tests/teacher-pages.test.tsx`.

Expected: endpoint contract, loading/error state, and manual sync tests pass; mock-mode screens remain offline.

- [ ] **Step 6: Review only the frontend API/manual-refresh hunks**

Inspect the listed frontend file diffs and ensure existing user changes are preserved. Leave the worktree uncommitted unless the new hunks can be isolated safely and the user requests a commit.

### Task 4: Trigger one sync during app sign-in and show its result

**Files:**
- Modify: `frontend/src/Root.tsx`
- Modify: `frontend/src/roles/teacher/TeacherApp.tsx`
- Modify: `frontend/src/lib/teacher.ts`
- Test: `frontend/tests/root-teacher-sync.test.tsx`

**Interfaces:**
- Consumes: `teacherApi.syncOnLogin()` and `TeacherLoginSyncResult` from Task 3.
- Produces: Root-level `TeacherLoginSyncState` (`idle | syncing | complete | failed`) and a Teacher-visible sync notice. Role screens do not own the sign-in trigger. Extend `TeacherGoogleConnection.sync` with `{status: string | null; lastSyncedAt: string | null; error: string | null}` so the successful OAuth redirect can show initial-sync status through the existing status endpoint even if Supabase emits no new `SIGNED_IN` event.

- [ ] **Step 1: Write failing auth lifecycle tests**

Mock Supabase `onAuthStateChange`, `teacherApi.syncOnLogin`, and role screens in a new `root-teacher-sync.test.tsx`. Define helpers in that test: `mockSupabaseAuth()` installs a mock `supabase.auth.onAuthStateChange` that captures its callback and returns `{data:{subscription:{unsubscribe:vi.fn()}}}`; `auth.emit(event, session)` invokes the callback; `sessionFor(id)` returns `{access_token:id,user:{id,email:'teacher@example.edu'}}`. Render `Root` inside a real `QueryClientProvider` with a fresh `QueryClient`. Assert sign-in starts one request before role selection, sign-out clears the state, and non-remote mode does not send the request. Also assert a rejected sync leaves authentication successful and yields a visible failure notice once the user opens Teacher.

```typescript
it('starts one Classroom sync on Supabase sign-in without waiting for role navigation', async () => {
  const auth = mockSupabaseAuth()
  render(<Root />)

  auth.emit('SIGNED_IN', sessionFor('teacher@example.edu'))

  expect(syncOnLogin).toHaveBeenCalledOnce()
  expect(screen.getByTestId('onboarding')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the Root tests and confirm they fail**

Run from `frontend/`: `npm run test:vitest -- --run tests/root-teacher-sync.test.tsx`.

Expected: no sync request is made on `SIGNED_IN` and the Root does not expose sync status.

- [ ] **Step 3: Implement the shared sign-in trigger**

Merge sign-in handling into Root’s existing Supabase auth listener. On `SIGNED_IN` with a session and `teacherRemoteEnabled`, mark state as syncing and schedule the API call with `window.setTimeout(..., 0)` so the Supabase auth callback returns before `request()` calls `supabase.auth.getSession()`. Keep a ref containing the handled session access token to prevent duplicate calls for that sign-in. On response, invalidate `queryClient` keys under `['teacher']` and store the result; on error, store a failure without calling `signOut` or changing the signed-in screen. Clear sync state and the dedupe ref on `SIGNED_OUT`.

- [ ] **Step 4: Show sync status only in the Teacher experience**

Pass the Root sync state/result into `TeacherApp` and render an accessible notice above its page content. Also use `useTeacherGoogleConnection()` in remote mode to show the saved initial-sync result following the OAuth redirect; render this status only when the returned `lastSyncedAt` is non-null:

```tsx
{syncState.status === 'syncing' && <p role="status">Syncing your Google Classroom classes...</p>}
{syncState.status === 'complete' && syncState.result.status === 'partial' && (
  <p role="alert">Some classes could not sync. Your saved class data is still available.</p>
)}
{syncState.status === 'failed' && <p role="alert">Classroom sync failed. Your saved class data is still available.</p>}
```

For `synced` and `skipped`, show a concise success/no-connection status with the counts from the result. Keep the failure state actionable by linking to the existing Add Class / Connect Google Classroom route; do not automatically start another OAuth redirect.

- [ ] **Step 5: Run auth and role regression tests**

Run: `npm run test:vitest -- --run tests/root-teacher-sync.test.tsx tests/teacher-essay-check.test.tsx tests/teacher-pages.test.tsx`.

Expected: one sign-in trigger, no duplicate trigger on repeated handler delivery, no login block on backend failure, and unaffected role routing.

- [ ] **Step 6: Review only the sign-in and notice hunks**

Inspect the Root, TeacherApp, API-type, and auth-test diffs and confirm existing user changes remain intact. Leave the worktree uncommitted unless the new hunks can be isolated safely and the user requests a commit.

### Task 5: Verify the full feature and regression surface

**Files:**
- No additional product files unless a test exposes a concrete regression.

**Interfaces:**
- Consumes: all tasks above.
- Produces: verified sign-in, first-connect, batch refresh, manual refresh, and mock-mode behavior.

- [ ] **Step 1: Run the full backend test suite**

Run from `backend/`: `py -3 -m pytest -q`.

Expected: all backend tests pass, including the added sync, route, and OAuth callback coverage.

- [ ] **Step 2: Run the full frontend suite, production build, and lint**

Run from `frontend/`: `npm test`, `npm run build`, and `npm run lint`.

Expected: all legacy and Vitest tests pass and TypeScript/build complete. Report any pre-existing lint/build warnings by name; do not hide them by broadening this feature.

- [ ] **Step 3: Review the diff for token leakage and unrelated changes**

Run `git diff --check`, inspect the new route response and auth listener, and confirm no refresh token, access token, or OAuth code is written to browser storage or returned in JSON. Keep commits limited to the paths listed per task; preserve the existing unrelated worktree changes.

- [ ] **Step 4: Commit only concrete verification fixes, if any**

If verification required a focused fix, stage only the affected feature/test paths and commit it as `fix: address teacher Classroom sync verification`. If no fix was needed, do not create an empty commit.
