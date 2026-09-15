# Teacher Role Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every updated teacher-role Figma frame as an interactive React frontend backed by deterministic in-browser mock data.

**Architecture:** Keep `Root.tsx`, `AppShell`, the existing design tokens, and TanStack Query. Replace the legacy teacher screen assumptions with a Figma-shaped teacher data boundary, explicit URL-backed route state, focused teacher components, and a stateful mock store that can later be replaced by HTTP without rewriting screens.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query 5, lucide-react, existing `node:test`/`jiti` frontend tests, browser Clipboard/Blob APIs.

**Spec:** `docs/superpowers/specs/2026-09-15-teacher-frontend-design.md`

## Global Constraints

- All specification, frontend, test, and documentation changes for this work stay on `SCRUM-161-teacher-page-reading-question`. Do not switch branches, merge this work into another branch, or create a parallel branch.
- This phase is frontend-only; Google OAuth, Classroom/Drive API calls, backend routes, database writes, grades, roster changes, email delivery, and real essay analysis remain excluded.
- The browser uses deterministic mock data and local session state; it must not claim that an external Classroom, Drive, or student operation occurred.
- Reuse `AppShell`, `Brand`, the existing CSS tokens in `index.css`, and the primitives in `components/ui.tsx`; do not add a second sidebar, CSS system, or routing library.
- Route context uses `courseId`, `assignmentId`, `studentId`, and `paperId`; legacy `courseWorkId` is translated only inside the data adapter.
- No scoped page may import mock fixtures or mutate store objects directly; all page data flows through `useTeacher` hooks.
- Graph, standalone teacher Class Library, and standalone Class Note pages are outside this implementation because the updated Figma file has no standalone frames for them.
- Every task ends with its focused test/verification and a commit on the current branch.

---

## File map

Create or modify only the following frontend areas unless a compiler error proves a shared additive change is required:

- `frontend/src/lib/teacherRoutes.ts` — typed teacher route values, query parsing, serialization, and navigation targets.
- `frontend/src/lib/teacher.ts` — Figma-shaped teacher domain types, query keys, and the mock-adapter interface.
- `frontend/src/lib/teacherStore.ts` — session-scoped mutable mock database and all local mutations.
- `frontend/src/lib/teacherSelectors.ts` — pure filtering, derived counts, labels, and export/feedback helpers.
- `frontend/src/lib/useTeacher.ts` — TanStack Query reads and mutations for teacher screens.
- `frontend/src/mocks/teacher.ts` — deterministic fixtures matching the updated Figma copy and states.
- `frontend/src/lib/teacherPreferences.ts` — teacher-only settings persistence, separate from shared researcher/writer settings.
- `frontend/src/components/AppShell.tsx` — additive optional profile-menu behavior so Teacher can match the Figma shell without changing other roles.
- `frontend/src/roles/teacher/TeacherApp.tsx` — teacher route owner and Figma navigation mapping.
- `frontend/src/roles/teacher/components/TeacherUi.tsx` — role-local status pills, avatars, breadcrumbs, tabs, and import stepper.
- `frontend/src/roles/teacher/components/TeacherDialog.tsx` — reusable accessible confirmation/edit dialog behavior.
- `frontend/src/roles/teacher/components/ClassWorkspaceHeader.tsx` — course heading, Classroom/Refresh actions, and workspace tabs.
- `frontend/src/roles/teacher/screens/Home.tsx` — updated teacher dashboard.
- `frontend/src/roles/teacher/screens/Classes.tsx` — active class list and search.
- `frontend/src/roles/teacher/screens/AddClass.tsx` — Connect Google, Choose course, and Review import states.
- `frontend/src/roles/teacher/screens/ClassWorkspace.tsx` — shared workspace shell and Overview tab.
- `frontend/src/roles/teacher/screens/Classwork.tsx` — Classwork and grades tab.
- `frontend/src/roles/teacher/screens/People.tsx` — People tab and roster search.
- `frontend/src/roles/teacher/screens/AssignmentDetail.tsx` — assignment submissions and materials.
- `frontend/src/roles/teacher/screens/EssayCheck.tsx` — citation review and feedback editor.
- `frontend/src/roles/teacher/screens/FeedbackDialog.tsx` — send-feedback confirmation state.
- `frontend/src/roles/teacher/screens/ReadingQuestions.tsx` — worksheet, filters, edit/remove, export, and answer key.
- `frontend/src/roles/teacher/screens/Settings.tsx` — teacher account, checking, class, notification, appearance, and data settings.
- `frontend/tests/teacher-routes.test.ts` — route parsing and navigation rules.
- `frontend/tests/teacher-store.test.ts` — mock store immutability and mutations.
- `frontend/tests/teacher-selectors.test.ts` — filters, derived counts, feedback, and worksheet exports.
- `frontend/tests/teacher-preferences.test.ts` — teacher preference persistence and defaults.
- `frontend/tests/index.test.ts` — import the focused teacher test files into the existing test entry point.
- `frontend/documentations/COMPONENTS.md` — update the teacher-role inventory and data-flow documentation after implementation.

---

### Task 1: Establish Figma-shaped routes and mock data boundary

**Files:**
- Create: `frontend/src/lib/teacherRoutes.ts`
- Create: `frontend/src/lib/teacherSelectors.ts`
- Modify: `frontend/src/lib/teacher.ts`
- Modify: `frontend/src/lib/teacherStore.ts`
- Modify: `frontend/src/lib/useTeacher.ts`
- Replace fixtures in: `frontend/src/mocks/teacher.ts`
- Create: `frontend/tests/teacher-routes.test.ts`
- Create: `frontend/tests/teacher-store.test.ts`
- Create: `frontend/tests/teacher-selectors.test.ts`
- Modify: `frontend/tests/index.test.ts`

**Interfaces:**
- `TeacherScreen` is the union `home | classes | add-class-connect | add-class-course | add-class-review | class-overview | classwork | people | assignment-detail | essay-check | reading-questions | settings | graph`.
- `TeacherNavKey` is `home | classes | library | graph | settings`.
- `TeacherRoute` is `{ screen: TeacherScreen; courseId?: string; assignmentId?: string; studentId?: string; paperId?: string }`.
- `parseTeacherRoute(search: string): TeacherRoute` defaults invalid or missing routes to `{ screen: 'home' }` and rejects stale context for routes that do not consume it.
- `serializeTeacherRoute(route: TeacherRoute, search?: string): string` preserves `role=teacher`, writes the route context, and removes stale `courseId`, `assignmentId`, `studentId`, and `paperId` values.
- `teacherRouteForNav(key: TeacherNavKey): TeacherRoute` maps Library to `reading-questions`; Graph maps to the existing out-of-scope `graph` placeholder.
- `filterTeacherClasses(classes: TeacherClass[], query: string): TeacherClass[]`, `filterTeacherPeople(people: TeacherRosterMember[], query: string): TeacherRosterMember[]`, and `filterReadingQuestions(questions: TeacherReadingQuestion[], level: ReadingQuestionLevel, types: ReadingQuestionType[]): TeacherReadingQuestion[]` are pure functions.
- `feedbackPreview(body: string, citedPages: string[]): string`, `worksheetText(page: TeacherReadingQuestionsPage, includeAnswers: boolean): string`, and `classResultsCsv(workspace: TeacherWorkspace): string` are pure browser-facing helpers.

**Data contracts to add in `teacher.ts`:**

```ts
export type TeacherClass = {
  id: string
  name: string
  section: string
  subject: string
  status: 'active'
  teacherName: string
  studentCount: number
  assignmentCount: number
  topicCount: number
  announcementCount: number
  linkedFileCount: number
  lastSyncedAt: string
}

export type TeacherSubmission = {
  id: string
  assignmentId: string
  studentId: string
  studentName: string
  fileName: string
  state: 'submitted' | 'missing' | 'returned'
  submittedAt?: string
  attachments: ClassroomAttachment[]
}

export type TeacherAssignment = {
  id: string
  courseId: string
  title: string
  dueAt: string
  enrolledCount: number
  submittedCount: number
  missingCount: number
  returnedCount: number
  pendingReviewCount: number
  status: 'returned' | 'pending' | 'not-started'
  materials: ClassroomMaterial[]
}

export type TeacherAssignmentDetail = {
  assignment: TeacherAssignment
  submissions: TeacherSubmission[]
}

export type TeacherRosterMember = {
  id: string
  name: string
  initials: string
  role: 'Teacher' | 'Student'
  isCourseOwner: boolean
}

export type TeacherWorkspace = {
  course: TeacherClass
  description: string
  assignments: TeacherAssignment[]
  submissions: TeacherSubmission[]
  people: TeacherRosterMember[]
  latestAnnouncement: { title: string; postedBy: string; postedAt: string; body: string } | null
  materials: { id: string; title: string; kind: 'drive-file' | 'link'; accessible: boolean }[]
  topics: { id: string; name: string; assignmentCount: number }[]
}

export type TeacherClassImportPreview = {
  course: TeacherClass
  resources: { key: 'course' | 'classwork' | 'people' | 'drive'; label: string; count: number; detail: string; warning?: boolean }[]
}
```

- [ ] **Step 1: Write failing route tests.** Add tests that prove parsing, stale-context removal, and nav mapping.

```ts
test('parses an assignment route with all context', () => {
  assert.deepEqual(
    parseTeacherRoute('?role=teacher&screen=assignment-detail&courseId=class-2b&assignmentId=essay&studentId=anan'),
    { screen: 'assignment-detail', courseId: 'class-2b', assignmentId: 'essay', studentId: 'anan' },
  )
})

test('serializing Home removes detail context but keeps the teacher role', () => {
  assert.equal(
    serializeTeacherRoute(
      { screen: 'home' },
      '?role=teacher&screen=essay-check&courseId=class-2b&assignmentId=essay&studentId=anan',
    ),
    '?role=teacher&screen=home',
  )
})

test('Library navigation opens the scoped reading-question page', () => {
  assert.deepEqual(teacherRouteForNav('library'), { screen: 'reading-questions' })
})
```

- [ ] **Step 2: Run the focused test entry and verify the route tests fail for missing exports.**

Run from `frontend`:

```bash
npm test
```

Expected: FAIL with module/export errors for `teacherRoutes.ts`; the existing tests may continue to pass.

- [ ] **Step 3: Implement the route helpers.** Create the typed union and parse/serialize functions. Use `URLSearchParams`, accept only the route values in the union, preserve `role=teacher`, and serialize only the context keys consumed by each route.

- [ ] **Step 4: Write failing store and selector tests.** Add tests for clone safety, class import, selected-assignment counts, people/question filtering, feedback preview, and CSV escaping.

```ts
test('importing a class makes its workspace available without exposing mutable state', async () => {
  resetTeacherStore()
  const imported = await teacherApi.importClass('class-literary-2b')
  imported.name = 'caller mutation'

  const workspace = await teacherApi.getWorkspace('class-literary-2b')
  assert.equal(workspace?.course.name, 'Literary Analysis')
})

test('class search matches course name and section case-insensitively', () => {
  const matches = filterTeacherClasses(MOCK_TEACHER_CLASSES, '2b')
  assert.deepEqual(matches.map((course) => course.id), ['class-literary-2b'])
})

test('worksheet export includes answers only when requested', () => {
  const page = MOCK_TEACHER_READING_QUESTIONS
  assert.match(worksheetText(page, false), /What is “late interaction”/)
  assert.doesNotMatch(worksheetText(page, false), /MaxSim over token embeddings/)
  assert.match(worksheetText(page, true), /MaxSim over token embeddings/)
})
```

- [ ] **Step 5: Run tests to verify the new store/selector tests fail for missing contracts.**

Run: `npm test`

Expected: FAIL on the new imports or methods, not on a syntax error in the test.

- [ ] **Step 6: Implement the new type contracts and fixtures.** Replace legacy CPE 401/old Classroom-shaped values with the updated Figma examples: Literary Analysis · 2B, Modern Writing · 1A, 25/22 students, assignment counts, 12 linked files, roster names, announcement, submissions, and the four scoped essay/review records. Keep the ColBERT reading-question fixture and add `paperUrl` for the browser-only Show in the paper action.

- [ ] **Step 7: Implement the store and typed adapter.** Add clone-safe store methods for classes, import preview/import, workspace, assignment detail, essay check/review/feedback, reading questions, and local reset. Update `useTeacher.ts` with context-specific query keys and mutation hooks. Keep all legacy `courseWorkId` translation inside `teacherApi` or fixture conversion.

The adapter methods used by later tasks are `getHome()`, `getClasses()`, `getClassImportPreview(courseId)`, `importClass(courseId)`, `getWorkspace(courseId)`, `getAssignmentDetail(courseId, assignmentId)`, `getEssayCheck(assignmentId, studentId)`, `updateProfessorReview(input)`, `sendFeedback(input)`, `getReadingQuestions(paperId?)`, `regenerateReadingQuestions(input)`, `updateReadingQuestion(input)`, `deleteReadingQuestion(questionId)`, and `resetMockTeacherData()`.

- [ ] **Step 8: Run the full frontend tests to verify the boundary is green.**

Run: `npm test`

Expected: PASS for all existing and new tests with zero failures.

- [ ] **Step 9: Commit the foundation.**

```bash
git add frontend/src/lib frontend/src/mocks/teacher.ts frontend/tests
git commit -m "feat: add teacher frontend routes and mock contracts"
```

### Task 2: Match the teacher shell and shared page primitives

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/roles/teacher/TeacherApp.tsx`
- Create: `frontend/src/roles/teacher/components/TeacherUi.tsx`
- Create: `frontend/src/roles/teacher/components/TeacherDialog.tsx`
- Create: `frontend/src/roles/teacher/components/ClassWorkspaceHeader.tsx`
- Modify: `frontend/tests/teacher-routes.test.ts`

**Interfaces:**
- `AppShell` gains `showProfileMenu?: boolean` with default `true`; when `false`, the bottom teacher chip/change control remains but the profile button is omitted. Existing researcher/writer callers do not change.
- `TeacherUi.tsx` exports `StatusPill({ label, tone })`, `InitialAvatar({ initials })`, `Breadcrumbs({ items })`, `StepProgress({ steps, active })`, and `WorkspaceTabs({ active, onChange })`.
- `TeacherDialog` accepts `{ open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode }`, traps focus while open, closes on Escape, and restores focus to the opener.
- `ClassWorkspaceHeader` accepts `{ workspace: TeacherWorkspace; activeTab: 'overview' | 'classwork' | 'people'; onTabChange; onRefresh; }` and emits tab changes without owning route state.

- [ ] **Step 1: Add a failing route assertion for the complete nav map.** Assert that Teacher navigation contains Home, Classes, Library, Graph, and Settings and that detail pages highlight Classes while Reading Questions highlights Library.

- [ ] **Step 2: Run `npm test` and verify the new assertion fails against the four-item legacy nav.**

- [ ] **Step 3: Add the optional `showProfileMenu` prop to `AppShell` and wire Teacher to pass `false`.** Keep all other role call sites on the default behavior. Add Settings to the teacher nav and route it through `teacherRouteForNav`.

- [ ] **Step 4: Implement `TeacherUi.tsx` using existing tokens and native semantics.** Status pills use the existing verdict/status color tokens, avatars use `bg-accent-soft`, breadcrumbs are a list of links/buttons, tabs use `role="tablist"`/`role="tab"`, and the stepper marks completed/current steps without inventing new colors.

- [ ] **Step 5: Implement `TeacherDialog` with an actual focusable close/action region.** Use the existing accessible-dialog behavior from the legacy Essay Check only as a behavioral reference; the new dialog must be independently owned and must not mutate global state.

- [ ] **Step 6: Implement `ClassWorkspaceHeader` with the Figma course heading, Open in Classroom link, Refresh button, and three tabs.** It must render a loading-disabled Refresh state when `refreshing` is true and preserve the active tab styling.

- [ ] **Step 7: Run tests, build, and lint.**

Run from `frontend`:

```bash
npm test
npm run build
npm run lint
```

Expected: all commands exit with code 0.

- [ ] **Step 8: Commit the shell/primitives.**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/roles/teacher frontend/tests/teacher-routes.test.ts
git commit -m "feat: add teacher shell and shared page primitives"
```

### Task 3: Implement Classes and the three-step Add Class flow

**Files:**
- Modify: `frontend/src/roles/teacher/TeacherApp.tsx`
- Replace: `frontend/src/roles/teacher/screens/Classes.tsx`
- Create: `frontend/src/roles/teacher/screens/AddClass.tsx`
- Modify: `frontend/src/lib/useTeacher.ts`
- Modify: `frontend/src/lib/teacherStore.ts`
- Modify: `frontend/tests/teacher-store.test.ts`

**Interfaces:**
- `Classes({ onOpenClass, onAddClass }: { onOpenClass: (courseId: string) => void; onAddClass: () => void })`.
- `AddClass({ step, selectedCourseId, onBack, onContinue, onSelectCourse, onImport }: { step: 'connect' | 'course' | 'review'; selectedCourseId?: string; onBack: () => void; onContinue: () => void; onSelectCourse: (courseId: string) => void; onImport: (courseId: string) => void })`.
- `useTeacherClassImportPreview(courseId: string)` reads `teacherApi.getClassImportPreview` only when `courseId` exists.
- `useImportTeacherClass()` calls `teacherApi.importClass` and invalidates `['teacher', 'classes']` and `['teacher', 'workspace', courseId]`.

- [ ] **Step 1: Add failing store tests for import preview, course selection, and import.** Cover a missing course error and assert the imported course is returned by the class list.

- [ ] **Step 2: Run `npm test` and verify those tests fail because the methods do not exist.**

- [ ] **Step 3: Implement the store/adapter import methods and hooks.** Importing a known course marks it as available in the session store and returns its workspace-ready class record; it must not call `fetch` or imply a Google operation.

- [ ] **Step 4: Implement the Classes page.** Match node `349:2417`: breadcrumb, heading, Add class button, ACTIVE CLASSES label, search input, count, two-column course cards, status/sync/count rows, Open class action, and read-only Classroom note. Filter the loaded list with `filterTeacherClasses`.

- [ ] **Step 5: Implement AddClass step `connect`.** Match node `349:2520`: three-step progress, Classroom and Drive access cards, read-only promise, Continue with Google button, and back breadcrumb. Continue changes only the local route to `add-class-course`.

- [ ] **Step 6: Implement AddClass step `course`.** Match node `349:2605`: searchable course cards, selected border/background, selected-course summary, read-only pill, and Review import disabled until a course is selected. Keep selection in `TeacherApp` route state.

- [ ] **Step 7: Implement AddClass step `review`.** Match node `349:2698`: selected course header, four resource cards, counts/warnings, read-only import note, Back, and Import class. Import invokes the local mutation and navigates to `class-overview` with the selected `courseId`.

- [ ] **Step 8: Wire the routes and missing-context states in `TeacherApp`.** Invalid/missing course context returns to Classes with a clear empty state; back buttons preserve the intended previous step.

- [ ] **Step 9: Run tests, build, and lint.**

Run: `npm test`, `npm run build`, `npm run lint`

Expected: all commands pass.

- [ ] **Step 10: Commit Classes/Add Class.**

```bash
git add frontend/src/roles/teacher frontend/src/lib/useTeacher.ts frontend/src/lib/teacherStore.ts frontend/tests/teacher-store.test.ts
git commit -m "feat: implement teacher classes and add-class flow"
```

### Task 4: Implement Class Workspace tabs and Assignment Detail

**Files:**
- Modify: `frontend/src/roles/teacher/TeacherApp.tsx`
- Create: `frontend/src/roles/teacher/screens/ClassWorkspace.tsx`
- Replace: `frontend/src/roles/teacher/screens/Classwork.tsx`
- Create: `frontend/src/roles/teacher/screens/People.tsx`
- Replace: `frontend/src/roles/teacher/screens/AssignmentDetail.tsx`
- Modify: `frontend/src/lib/teacherSelectors.ts`
- Modify: `frontend/tests/teacher-selectors.test.ts`

**Interfaces:**
- `ClassWorkspace({ courseId, tab, onNavigate, onRefresh }: { courseId: string; tab: 'overview' | 'classwork' | 'people'; onNavigate: (route: TeacherRoute) => void; onRefresh: () => void })`.
- `Classwork({ workspace, onOpenAssignment, onCheckEssays }: { workspace: TeacherWorkspace; onOpenAssignment: (assignmentId: string) => void; onCheckEssays: (assignmentId: string) => void })`.
- `People({ workspace }: { workspace: TeacherWorkspace })`.
- `AssignmentDetail({ courseId, assignmentId, onOpenEssay }: { courseId: string; assignmentId: string; onOpenEssay: (studentId: string) => void })`.
- `workspaceStats(workspace: TeacherWorkspace): { classworkCount: number; submissions: number; returned: number }` and `assignmentCanBeChecked(assignment: TeacherAssignment): boolean` are pure selectors.

- [ ] **Step 1: Add failing selector tests for workspace statistics, pending counts, and assignment eligibility.** Use the Figma fixture values: 4 classwork items, 66 submissions, and 8 returned.

- [ ] **Step 2: Run `npm test` and verify the new selector tests fail because the helpers are absent.**

- [ ] **Step 3: Implement the selectors and workspace query hook.** `useTeacherWorkspace(courseId)` must return one context-keyed query and an explicit `null` result for an unknown class.

- [ ] **Step 4: Implement the shared ClassWorkspace shell and Overview tab.** Match node `349:2825`: course heading, Classroom/Refresh actions, Overview/Classwork/People tabs, Course overview metrics, recent classwork, announcement, People preview, Materials, Topics, and Grades & submissions cards. Use `ClassWorkspaceHeader` and route tab changes in `TeacherApp`.

- [ ] **Step 5: Implement Classwork and grades.** Match node `349:2960`: three metrics, four assignment cards with submission/status counts, checkboxes, status pills, and the Add to Essay Check panel. Selection is session-local; the Analyze selected button updates selected assignments to `queued` and shows skipped/no-attachment feedback when relevant.

- [ ] **Step 6: Implement People.** Match node `349:3085`: search input, roster table/card, initials avatars, course-owner/Teacher labels, remaining-student row, People from Classroom card, and Account visibility note.

- [ ] **Step 7: Implement Assignment Detail.** Match node `459:3037`: assignment header/breadcrumb, Classwork/People tabs, enrolled/submitted/missing metrics, submission cards, attachment/status rows, Assignment materials, and Essay Check CTA. Open an eligible essay with `assignmentId` and `studentId`; external Classroom/Drive links use `target="_blank"` and `rel="noreferrer"`.

- [ ] **Step 8: Add missing-course/assignment empty states and refresh behavior.** A missing `courseId` or `assignmentId` renders `Empty` with a route-safe recovery action. Refresh invalidates the workspace query and exposes the shared loading state without losing the active tab.

- [ ] **Step 9: Run tests, build, and lint.**

Run: `npm test`, `npm run build`, `npm run lint`

Expected: all commands pass.

- [ ] **Step 10: Commit the workspace flow.**

```bash
git add frontend/src/roles/teacher frontend/src/lib frontend/tests/teacher-selectors.test.ts
git commit -m "feat: implement teacher class workspace and assignment detail"
```

### Task 5: Implement the updated Home dashboard

**Files:**
- Replace: `frontend/src/roles/teacher/screens/Home.tsx`
- Modify: `frontend/src/roles/teacher/TeacherApp.tsx`
- Modify: `frontend/src/lib/teacher.ts`
- Modify: `frontend/src/mocks/teacher.ts`
- Modify: `frontend/src/lib/teacherSelectors.ts`
- Modify: `frontend/tests/teacher-selectors.test.ts`

**Interfaces:**
- `Home({ onOpen }: { onOpen: (route: TeacherRoute) => void })`.
- Dashboard submission rows carry `courseId`, `assignmentId`, and `studentId` so a row can open the correct scoped Assignment Detail or Essay Check route.
- `homeRouteForAction(action: 'check-essays' | 'reading-questions'): TeacherRoute` returns a scoped classwork/assignment route for the demo course or the reading-question route.

- [ ] **Step 1: Add failing tests for Home action route mapping and empty dashboard data.** Assert Check student essays opens the demo classwork context and Make reading questions opens `reading-questions`.

- [ ] **Step 2: Run `npm test` and verify the new tests fail for the absent helper.**

- [ ] **Step 3: Implement the action mapping and update the Home fixture to match node `20:864`.** Use the Figma copy: Good morning, Vitawat; CPE 401 summary; three quick-action cards; Essays to review rows; Class library; Most misused source.

- [ ] **Step 4: Render the dashboard hierarchy and visual proportions.** Use a three-card quick-action row, two-column content below, status pills, file rows, empty states, and the existing `Card`/`Button` primitives. The Class library card remains informational because no standalone Class Library frame exists.

- [ ] **Step 5: Wire scoped Home interactions.** The assignment header/essay rows open the corresponding class workspace or essay review route. The reading-question action opens the worksheet. The un-designed “Turn into a class note” control remains informational and does not create an un-designed page.

- [ ] **Step 6: Run tests, build, and lint.**

Run: `npm test`, `npm run build`, `npm run lint`

Expected: all commands pass.

- [ ] **Step 7: Commit Home.**

```bash
git add frontend/src/roles/teacher frontend/src/lib/teacher.ts frontend/src/mocks/teacher.ts frontend/tests/teacher-selectors.test.ts
git commit -m "feat: implement teacher home dashboard"
```

### Task 6: Implement Essay Check and the send-feedback dialog

**Files:**
- Replace: `frontend/src/roles/teacher/screens/EssayCheck.tsx`
- Create: `frontend/src/roles/teacher/screens/FeedbackDialog.tsx`
- Modify: `frontend/src/lib/teacher.ts`
- Modify: `frontend/src/lib/teacherStore.ts`
- Modify: `frontend/src/lib/useTeacher.ts`
- Modify: `frontend/src/lib/teacherSelectors.ts`
- Modify: `frontend/tests/teacher-store.test.ts`
- Modify: `frontend/tests/teacher-selectors.test.ts`

**Interfaces:**
- `EssayCheck({ courseId, assignmentId, studentId, onNavigate, onBack }: { courseId: string; assignmentId: string; studentId: string; onNavigate: (studentId: string) => void; onBack: () => void })`.
- `FeedbackDialog({ open, studentName, preview, onClose, onSend }: { open: boolean; studentName: string; preview: string; onClose: () => void; onSend: () => Promise<void> })`.
- `toggleFeedbackReview(ids: string[], reviewId: string): string[]` keeps citation IDs unique and toggles one review.
- `feedbackPreview(body: string, citedPages: string[]): string` returns the first sentence plus `— N lines, cites ...` using actual line count.

- [ ] **Step 1: Add failing tests for review updates, feedback citation toggling, preview text, and duplicate-send protection state.**

```ts
test('updating a professor result changes only the selected review', async () => {
  resetTeacherStore()
  const updated = await teacherApi.updateProfessorReview({
    assignmentId: 'assignment-essay',
    studentId: 'student-anan',
    reviewId: 'review-colbert',
    outcome: 'contradicts',
    note: 'Verified against page 7.',
  })
  assert.equal(updated.reviews.find((review) => review.id === 'review-colbert')?.professorReview.outcome, 'contradicts')
  assert.equal(updated.reviews.find((review) => review.id === 'review-dpr')?.professorReview.outcome, 'not-reviewed')
})

test('feedback preview reports the real line count and cited pages', () => {
  assert.equal(
    feedbackPreview('First line.\nSecond line.', ['p.7', 'p.6']),
    '“First line.” — 2 lines, cites p.7, p.6',
  )
})
```

- [ ] **Step 2: Run `npm test` and verify the new tests fail against the legacy `courseWorkId` contract or absent helpers.**

- [ ] **Step 3: Update the essay-review adapter/store contract to use `assignmentId` at the screen boundary.** Keep the four Figma review records, professor result state, supporting URL, source quote/location, and next/previous student navigation.

- [ ] **Step 4: Implement the selector helpers and mutation hooks.** Update the query cache for the exact assignment/student pair after a professor result mutation; feedback send returns a local delivery record and never calls a backend.

- [ ] **Step 5: Implement the Essay Check page to match node `23:1137`.** Render breadcrumbs, previous/next controls, citation cards, verdict pills, claim/source quote/explanation, Show in the paper, Add to feedback, professor-result select, supporting URL, Feedback panel, editable textarea, Copy, and Send to student.

- [ ] **Step 6: Implement `FeedbackDialog` to match node `39:1536`.** Render the scrim, summary, Keep editing, and Send actions. While sending, disable both actions, show progress text, close on successful local delivery, and keep the dialog open with an alert on failure. Ensure focus trapping, Escape, and restoration work.

- [ ] **Step 7: Wire student navigation and missing-context recovery in `TeacherApp`.** Previous/next changes only `studentId`; Back returns to Assignment Detail with the same `courseId`/`assignmentId`.

- [ ] **Step 8: Run tests, build, and lint.**

Run: `npm test`, `npm run build`, `npm run lint`

Expected: all commands pass.

- [ ] **Step 9: Commit Essay Check.**

```bash
git add frontend/src/roles/teacher frontend/src/lib frontend/tests
git commit -m "feat: implement teacher essay review and feedback dialog"
```

### Task 7: Implement Reading Questions worksheet actions

**Files:**
- Replace: `frontend/src/roles/teacher/screens/ReadingQuestions.tsx`
- Modify: `frontend/src/lib/teacher.ts`
- Modify: `frontend/src/lib/teacherStore.ts`
- Modify: `frontend/src/lib/useTeacher.ts`
- Modify: `frontend/src/mocks/teacher.ts`
- Modify: `frontend/tests/teacher-selectors.test.ts`
- Modify: `frontend/tests/teacher-store.test.ts`

**Interfaces:**
- `ReadingQuestions({ paperId }: { paperId?: string })`.
- `useTeacherReadingQuestions(paperId?: string)` uses `['teacher', 'reading-questions', paperId]`.
- `createQuestionDraft(question: TeacherReadingQuestion): { prompt: string; answer: string }` returns controlled editable values.
- `worksheetText(page: TeacherReadingQuestionsPage, includeAnswers: boolean): string` returns a UTF-8 plain-text worksheet suitable for `downloadText`.

- [ ] **Step 1: Add failing tests for combined level/type filtering, regeneration, edit/delete, and worksheet export.** Confirm the source collection remains unchanged when a filtered result is derived.

- [ ] **Step 2: Run `npm test` and verify the new tests fail for the missing/new signatures.**

- [ ] **Step 3: Update reading-question types and store methods.** Preserve the five Figma questions, answers/anchors/excerpts, selected paper, and deterministic undergrad/graduate generation. Updates change only prompt/answer; delete removes one question; regeneration replaces the set using selected filters.

- [ ] **Step 4: Implement the page to match node `22:934`.** Render Library-active shell, heading/paper summary, Level and Type filter chips, Regenerate, Export worksheet, five question cards, Question Type badges, anchor/excerpt, Edit, Show in the paper, Remove, and Answer key card with Copy answer key.

- [ ] **Step 5: Implement local interactions.**

  - Level/type filters derive visible questions without changing stored data.
  - Regenerate shows a pending state and replaces the list on success.
  - Edit opens a controlled dialog/form with Save and Cancel.
  - Remove opens `TeacherDialog`, then deletes on confirmation.
  - Show in the paper opens the fixture paper URL with `#page=N` in a new tab.
  - Export worksheet and Copy answer key use browser APIs and show a local success/error message.

- [ ] **Step 6: Add loading, error, empty, and no-answer-key states.** Do not render an empty answer key as if a source answer exists.

- [ ] **Step 7: Run tests, build, and lint.**

Run: `npm test`, `npm run build`, `npm run lint`

Expected: all commands pass.

- [ ] **Step 8: Commit Reading Questions.**

```bash
git add frontend/src/roles/teacher frontend/src/lib frontend/src/mocks/teacher.ts frontend/tests
git commit -m "feat: implement teacher reading questions worksheet"
```

### Task 8: Implement Teacher Settings and local preferences

**Files:**
- Create: `frontend/src/lib/teacherPreferences.ts`
- Create: `frontend/src/roles/teacher/screens/Settings.tsx`
- Modify: `frontend/src/roles/teacher/TeacherApp.tsx`
- Modify: `frontend/src/lib/teacherStore.ts`
- Modify: `frontend/src/lib/useTeacher.ts`
- Create: `frontend/tests/teacher-preferences.test.ts`
- Modify: `frontend/tests/index.test.ts`

**Interfaces:**
- `TeacherPreferences` is `{ citationStyle: string; matchStrictness: string; checkOnSubmit: boolean; flagQuotes: boolean; defaultClassId: string; hideStudentNames: boolean; studentReportVisibility: boolean; sendReportsAs: string; weeklyDigest: boolean; digestDay: string; batchFinishedNotification: boolean }`.
- `getTeacherPreferences(): TeacherPreferences`, `updateTeacherPreferences(patch: Partial<TeacherPreferences>): TeacherPreferences`, and `resetTeacherPreferences(): void` live in `teacherPreferences.ts` and use the key `secretsource.teacher-settings`.
- `Settings()` reads shared account/theme fields from `useSettings()` and teacher-specific fields from `useTeacherPreferences()`.

- [ ] **Step 1: Add failing preference tests.** Cover default values, partial updates, malformed storage fallback, reset, and preservation of shared settings.

```ts
test('teacher preferences merge updates without dropping defaults', () => {
  resetTeacherPreferences()
  updateTeacherPreferences({ hideStudentNames: true })
  assert.equal(getTeacherPreferences().hideStudentNames, true)
  assert.equal(getTeacherPreferences().citationStyle, 'APA 7th')
})
```

- [ ] **Step 2: Run `npm test` and verify the new tests fail because the module is absent.**

- [ ] **Step 3: Implement the preference store and hook.** Keep it isolated from researcher/writer-specific preference fields and notify React subscribers after updates.

- [ ] **Step 4: Implement Settings to match node `279:2358`.** Render Account, Role and home screen, Checking defaults, Class and marking, Notifications, Appearance, and Your data sections using the existing card/row spacing. Use native labelled inputs, selects, and buttons; use shared `useSettings` for display name, email, theme, and verdict colors.

- [ ] **Step 5: Wire local actions.** Display name/theme/toggles/selects update their stores immediately. Account Change/Change password show a local informational notice that authentication changes are outside this frontend-only phase. Export class results calls `downloadText` with `classResultsCsv`; Delete all uploaded essays opens a confirmation dialog and resets only mock teacher essay data.

- [ ] **Step 6: Add Settings to the teacher route and nav active state.** Opening Settings from the sidebar preserves `?role=teacher`, and changing role still returns to onboarding.

- [ ] **Step 7: Run tests, build, and lint.**

Run: `npm test`, `npm run build`, `npm run lint`

Expected: all commands pass.

- [ ] **Step 8: Commit Settings.**

```bash
git add frontend/src/lib/teacherPreferences.ts frontend/src/roles/teacher frontend/src/lib frontend/tests
git commit -m "feat: implement teacher settings"
```

### Task 9: Documentation, visual QA, responsive polish, and final verification

**Files:**
- Modify: `frontend/documentations/COMPONENTS.md`
- Modify: `docs/superpowers/plans/2026-09-15-teacher-frontend.md` to mark completed steps only after verification.

- [ ] **Step 1: Update the component guide.** Replace the old “TeacherApp + Home, EssayCheck” inventory with the complete teacher route/page list, mock boundary, route context, shell exception, and frontend-only behavior.

- [ ] **Step 2: Run the complete automated verification.**

From `frontend`:

```bash
npm test
npm run build
npm run lint
```

Expected: all commands exit 0; record the actual test count and build/lint result before claiming completion.

- [ ] **Step 3: Run the browser smoke matrix on the current branch.** Start `npm run dev` and verify these URLs and transitions:

| Route | Required check |
| --- | --- |
| `/?role=teacher&screen=home` | Dashboard cards, review rows, empty/error rendering |
| `/?role=teacher&screen=classes` | Search, Open class, Add class |
| `/?role=teacher&screen=add-class-connect` | Continue/back and stepper |
| `/?role=teacher&screen=add-class-course` | Search, select, disabled/enabled Review import |
| `/?role=teacher&screen=add-class-review&courseId=class-literary-2b` | Resource cards, Back, Import class |
| `/?role=teacher&screen=class-overview&courseId=class-literary-2b` | Workspace overview, tab navigation, Refresh |
| `/?role=teacher&screen=classwork&courseId=class-literary-2b` | Assignment selection and Analyze selected |
| `/?role=teacher&screen=people&courseId=class-literary-2b` | Roster search and visibility notes |
| `/?role=teacher&screen=assignment-detail&courseId=class-literary-2b&assignmentId=assignment-essay` | Submissions, attachments, Essay Check entry |
| `/?role=teacher&screen=essay-check&courseId=class-literary-2b&assignmentId=assignment-essay&studentId=student-anan` | Review actions, feedback editing, confirmation dialog |
| `/?role=teacher&screen=reading-questions` | Filters, edit/remove/regenerate, export/copy |
| `/?role=teacher&screen=settings` | All sections, persistence, export/delete confirmation |

- [ ] **Step 4: Compare each scoped route to the corresponding Figma node.** Check the 1200px Home/Settings frames and 1400px teacher workflow frames for sidebar width, heading hierarchy, card boundaries, spacing, status colors, text wrapping, and active navigation.

- [ ] **Step 5: Check responsive and keyboard behavior.** Verify the AppShell drawer below `lg`, stacked cards at narrow widths, tab/checkbox/toggle keyboard use, visible focus, Escape dialog close, focus restoration, and no horizontal clipping of assignment/roster content.

- [ ] **Step 6: Fix only implementation defects found by the verification matrix, rerun all three automated commands, and inspect `git diff` for unrelated changes.**

- [ ] **Step 7: Commit documentation and final polish on `SCRUM-161-teacher-page-reading-question`.**

```bash
git add frontend/documentations/COMPONENTS.md docs/superpowers/plans/2026-09-15-teacher-frontend.md
git commit -m "docs: complete teacher frontend verification notes"
```

The final handoff must report the current branch, the commits made on it, the exact verification commands/results, and the explicitly excluded Graph/Class Library/Class Note destinations.
