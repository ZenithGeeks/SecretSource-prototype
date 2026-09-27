# Teacher Sign-in Classroom Sync Design

## Goal

Keep the Teacher workspace current by synchronizing imported Google Classroom data as part of the teacher's app sign-in flow. A returning teacher should use one app login; the backend silently reuses the saved Google refresh token. A first-time teacher connects Google Classroom once from the existing Connect Google Classroom flow.

## User-approved behavior

- For a returning account with a saved Google Classroom connection, start a sync when Supabase authenticates the user, before role selection. Do not wait until the user opens the Teacher role or visits a particular page.
- Determine teacher eligibility from the saved Google Classroom connection. Accounts without one receive a no-op result and are not sent through Google OAuth.
- Sync every previously imported class. Do not run a periodic background scheduler or sync on every navigation.
- For a first-time connection, start the initial sync after the Google OAuth callback succeeds. If no class has been imported yet, the sync has no class work; importing the first class performs its initial Classroom import.
- Reuse the saved token for subsequent sign-ins. Ask for Google reauthorization only if the token has been revoked or permissions are insufficient.
- Preserve the local Classroom snapshot when sync fails and make the failure visible.

## Existing system

- Supabase authentication completes before onboarding/role selection. The selected role is encoded in the current route, not stored as a user profile role. The saved Google Classroom connection is therefore the reliable backend eligibility check at sign-in.
- Google OAuth stores an encrypted refresh token in `teacher_google_connections`. The backend decrypts it to create Google API credentials; the token is not stored in the browser.
- `POST /teacher/classes/{course_id}/refresh` already refreshes one imported class through `TeacherGoogleSyncService.refresh_course`.
- The current frontend class-workspace Refresh button only invalidates a React Query cache key. It does not call the backend refresh endpoint, so it does not fetch fresh Classroom data.
- `TeacherGoogleSyncService` imports course, roster, coursework, submissions, materials, announcements, and topics and persists them in the owner-scoped repository.

## Proposed architecture and flow

1. The shared auth lifecycle observes Supabase `SIGNED_IN` once. It makes one authenticated request to the sign-in sync operation. Keep this listener outside role screens so role navigation cannot start a second sync; token-refresh events and page navigation do not trigger sync.
2. The backend derives the owner from the existing authenticated request dependency and checks `teacher_google_connections`.
   - If there is no saved Classroom connection, return a successful `skipped/not_connected` result without starting OAuth or accessing Google.
   - If connected, decrypt and use the saved refresh token. Load the imported course IDs for that owner and refresh them sequentially, reusing the existing per-course sync service.
   - If no courses have been imported, return `skipped/no_imported_classes`.
3. Return an aggregate result plus a per-course success/failure list. Continue to later courses after an individual course failure. Record the overall sync status and time using the existing connection status fields; do not add a scheduler or a new credential store.
4. The frontend keeps the authenticated app usable while sync runs, then invalidates teacher home, class, workspace, assignment, and essay-check queries so the next reads reflect the new snapshot. Show a concise sync-in-progress/result notice in the Teacher experience, including partial failures and a reconnect action when Google authorization is no longer valid.
5. After first-time Google OAuth completes, invoke the same sync operation. The existing class import flow remains responsible for the first imported class and already fetches its current data.
6. Change the existing class-workspace Refresh control to call the real per-class backend refresh endpoint, then refresh dependent teacher queries. Keep this as an explicit manual action rather than adding Sync buttons to every screen.

## API and data contract

- Add a protected `POST /teacher/sync-on-login` operation for login-triggered synchronization. It must be a no-op for accounts without a saved Classroom connection and must not return token material. The frontend sends one request per `SIGNED_IN` event; repeated calls must not corrupt data, and an in-progress batch for the same owner must not be run concurrently.
- Add a protected frontend API operation and query/mutation hook for that endpoint. Add a per-class refresh operation to the remote `teacherApi` and wire the existing Refresh control to it.
- Login sync response should distinguish `synced`, `partial`, `skipped`, and `failed`, include imported/succeeded/failed counts, and include course identity plus a safe error message for each failed class.
- Do not expose encrypted or decrypted Google tokens in responses or browser storage.

## Failure handling and safety

- A missing Classroom connection is an expected no-op, not a login error.
- Google 401/403, revoked refresh token, or missing required scopes must not trigger repeated sign-in prompts. Preserve cached class data, record the error, and show the existing Google connect/reconnect path when the Teacher UI is opened.
- A single class failure must not prevent other imported classes from syncing. Report partial success accurately; never label a partial batch fully synced.
- A backend/network failure must not block Supabase sign-in or prevent role selection. Keep using the last local snapshot and show the sync failure when available.
- Synchronization remains owner-scoped and uses the existing server-side service-role repository and encrypted refresh-token mechanism.

## Testing

- Backend tests: no connection returns a no-op without Google API calls; connected account refreshes every imported class; course failures are isolated and reflected as partial; revoked/invalid credentials preserve stored snapshots and report failure; owner scoping is enforced.
- Frontend tests: one sync request per Supabase sign-in session; no duplicate call on StrictMode replay; no Classroom sync for an account without a connection; status is visible and query caches refresh after completion; the existing Refresh control calls real refresh rather than only invalidating cache.
- Regression checks: first-time OAuth completion invokes initial sync; the import flow still imports the first class; existing mock mode remains offline and does not claim a real Classroom sync.

## Out of scope

- Scheduled/background sync while the user is away.
- Sync on every Teacher page navigation.
- Persisting a general user-role profile or changing how Supabase roles are selected.
- Changing the encrypted refresh-token format or adding browser-side token storage.
