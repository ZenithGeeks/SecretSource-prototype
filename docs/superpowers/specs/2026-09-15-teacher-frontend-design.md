# Teacher Role Frontend Design Specification

**Status:** Approved design

**Date:** 2026-09-15

**Working branch:** `SCRUM-161-teacher-page-reading-question`

All specification, frontend, test, and documentation changes for this work stay on the working branch above. Do not switch branches, merge this work into another branch, or create a parallel branch while executing the plan.

**Goal:** Turn the updated teacher-role frames in the SecretSource Figma file into a complete, interactive frontend using deterministic mock data, while keeping a clean boundary for later backend and Google Classroom integration.

**Source of truth:** [SecretSource Prototype Figma file](https://www.figma.com/design/aKD7sSdQpQFfwMP199KmkM/SecretSource-Prototype?node-id=0-1&t=zrHQjmdJeeACt65D-1)

## Scope

The implementation covers these updated Figma frames:

| Figma frame | Node | Frontend destination |
| --- | --- | --- |
| Home (Teacher) | `20:864` | Teacher home dashboard |
| Essay check (Teacher) | `23:1137` | Student essay review |
| Send confirm (Teacher) | `39:1536` | Feedback confirmation dialog |
| Reading questions (Teacher) | `22:934` | Reading-question worksheet |
| Classes (Teacher) | `349:2417` | Class list |
| Add class — Connect Google | `349:2520` | Add-class step 1 |
| Add class — Choose course | `349:2605` | Add-class step 2 |
| Add class — Review import | `349:2698` | Add-class step 3 |
| Class workspace — Overview | `349:2825` | Class overview tab |
| Class workspace — Classwork and grades | `349:2960` | Classwork tab |
| Class workspace — People | `349:3085` | People tab |
| Class workspace — Assignment detail | `459:3037` | Assignment submissions |
| Settings (Teacher) | `279:2358` | Teacher settings |

The teacher shell's Library and Graph items are visible in the Figma navigation, but this file does not contain updated standalone teacher frames for either destination. Reading Questions is the scoped Library destination because its frame marks Library active. A standalone teacher Graph page, standalone Class Library page, and standalone Class Note editor are excluded; the Home cards may link only to scoped destinations or remain informational until those designs exist.

## Product behavior

This phase is frontend-only. The browser must feel complete when run locally, but it must not claim to perform external operations.

Included:

- deterministic teacher, class, assignment, roster, submission, essay-review, reading-question, and settings fixtures;
- stateful interactions for one browser session;
- URL-persisted teacher destinations and class/assignment/student context;
- loading, empty, error, selected, success, and confirmation states where the Figma flow requires them;
- external-link behavior for the explicitly labelled Classroom, Drive, paper, and supporting-source links;
- export/copy actions implemented in the browser using the existing frontend utilities or browser APIs.

Excluded:

- Google OAuth and Google Classroom API calls;
- Drive permission requests or file retrieval;
- backend routes, database migrations, Supabase writes, grades, roster changes, or email delivery;
- real essay analysis or new analysis pipeline work;
- a new routing library or a second design-system/CSS system.

Mock actions must be labelled or documented as local behavior where the UI could otherwise imply an external write. Importing a class, analysing selected assignments, editing professor results, sending feedback, and regenerating questions update the mock store only.

## Architecture

Keep the existing application entry points and shared design system:

```text
Root.tsx
  └─ TeacherApp.tsx             route state + teacher navigation
      └─ AppShell                shared sidebar, role chip, settings entry
          └─ teacher screen       page-specific UI
              └─ useTeacher hook  query/mutation boundary
                  └─ teacherApi   typed mock adapter
                      └─ teacherStore / mocks
```

`TeacherApp.tsx` remains the only owner of teacher navigation. It should use explicit route values for each scoped page and carry context in query parameters (`courseId`, `assignmentId`, and `studentId`). Existing query-parameter deep-linking should remain compatible with `Root.tsx`'s `?role=teacher` handling.

`assignmentId` is the page-level name used by the new route model. If legacy teacher fixtures or helper functions still expose Google Classroom's `courseWorkId`, the adapter may translate it at the data boundary; both names must not be mixed in route state.

Screens must read data through `useTeacher` hooks. They must not import fixtures or mutate store objects directly. The `teacherApi` method signatures should model the data the UI needs now; replacing its implementation with HTTP later must not require rewriting the screen components.

Use TanStack Query for page reads and mutations. Query keys must include the entity context so changing class, assignment, or student cannot display stale data. Mutations update or invalidate the affected query and expose pending/error states to the page.

Reuse `AppShell`, `Brand`, the existing CSS tokens in `index.css`, and the primitives in `components/ui.tsx`. Add a shared primitive only when it has a clear cross-page use; keep teacher-specific cards, tabs, steppers, status pills, roster rows, and dialogs under `roles/teacher/`.

The mock store is authoritative for the current browser session. Its state may reset on a full reload; existing account settings and theme behavior continue to use the current settings store and local storage.

## Route model

The teacher router will support these screen values:

| Screen | Context | Entry/exit behavior |
| --- | --- | --- |
| `home` | none | Default teacher destination. Quick actions open scoped teacher flows. |
| `classes` | none | Lists searchable active classes; Add class starts `add-class-connect`. |
| `add-class-connect` | none | Continue with Google advances to `add-class-course`; back returns to Classes. |
| `add-class-course` | selected course | Search/select a course; Review import advances to `add-class-review`. |
| `add-class-review` | `courseId` | Back returns to course selection; Import class stores the mock class and opens `class-overview`. |
| `class-overview` | `courseId` | Overview tab; class tabs navigate among overview, classwork, and people. |
| `classwork` | `courseId` | Assignment list and local analyse-selection controls. |
| `people` | `courseId` | Searchable roster. |
| `assignment-detail` | `courseId`, `assignmentId` | Submission list; essay links open `essay-check`. |
| `essay-check` | `courseId`, `assignmentId`, `studentId` | Citation review; previous/next changes only the student context. |
| `reading-questions` | optional `paperId` | Library-active worksheet; filters, regeneration, editing, export, and answer-key actions are local. |
| `settings` | none | Profile-menu destination; saves frontend settings locally. |

The navigation mapping is Home → `home`, Classes → `classes`, Library → `reading-questions`, and Settings → `settings`. Graph remains outside this scope because the updated Figma file has no teacher Graph page. Class detail screens keep Classes highlighted, and Reading Questions keeps Library highlighted.

## Page requirements

### Home

Match the Figma dashboard hierarchy: greeting and class summary, three quick-action cards, Essays to review, Class library, and Most misused source. Use the mock dashboard payload rather than embedding content in JSX. Student rows and relevant source badges must be interactive where a scoped destination exists. The quick actions map to essay review/class workspace, reading questions, and the scoped library destination without creating an un-designed page.

### Essay Check and send confirmation

Render the breadcrumb, student heading, previous/next student controls, citation review cards, professor-result controls, supporting URLs, Show in the paper, Add to feedback, feedback editor, Copy, and Send to student actions shown by the Figma frame.

Professor-result changes and feedback edits update local query/store state. Send opens the confirmation dialog from node `39:1536`; Keep editing closes it, Send records a local success state, and the dialog must support keyboard focus, Escape, and focus restoration. The page must disable duplicate submission while the local mutation is pending.

### Reading Questions

Render the paper header, level/type filters, regenerate action, worksheet export, question cards, answer key, edit/remove/show-in-paper actions, and answer-key copy action. Filtering must be derived from the selected level and question types without mutating the source collection. Edit must use a controlled form with save/cancel; remove requires a confirmation step; regenerate replaces the visible question set using the selected options and exposes pending/error feedback.

### Classes and Add Class

Classes must support course search, active-course cards, Add class, and Open class. The Add Class flow is a three-step local state machine matching the Figma progress indicator:

1. Connect Google: show requested Classroom/Drive access and the read-only promise; Continue simulates a successful connection.
2. Choose a course: search available courses, select one, show its summary, and enable Review import only when a course is selected.
3. Review import: show course details, classwork, people, and linked Drive-file resource cards with counts/statuses; Back returns to step 2 and Import class creates the local class workspace.

### Class Workspace and Assignment Detail

The workspace header must share the course identity, Open in Classroom, Refresh, and the Overview/Classwork/People tabs. Overview renders the summary metrics, recent classwork with Check essays, announcement, people preview, materials, topics, and read-only grades/submissions summary. Classwork renders assignment statistics, assignment cards, status indicators, selection checkboxes, and the Add to Essay Check panel. People renders a searchable roster and the Classroom/account-visibility notes. Assignment Detail renders assignment metrics, submissions with attachment/status data, materials, Classroom status, and the Essay Check call to action.

Refresh re-reads the selected mock entity and displays the same loading/error boundary used by other teacher queries. Open in Classroom and attachment/material links open their configured external URLs in a new tab.

### Settings

Match the teacher settings sections: Account, Role and home screen, Checking defaults, Class and marking, Notifications, Appearance, and Your data. Controlled inputs/selects/toggles must save to the existing frontend settings mechanism or a teacher-specific extension of it. Export class results produces a browser download; Delete all uploaded essays requires confirmation and clears only mock teacher essay data. Shared researcher/writer settings must remain compatible.

## Visual and responsive requirements

- Use the Figma warm canvas/surface/border/accent tokens already defined in `index.css`.
- Use the existing Fraunces/serif heading and quote conventions plus the existing sans interface typography.
- Preserve the desktop proportions represented by the 1200px and 1400px Figma frames.
- Keep the 256px sidebar and content spacing consistent with `AppShell`; do not create a teacher-only sidebar.
- At narrow widths, stack two-column content, allow tables/rosters to scroll or reflow, keep action buttons reachable, and preserve the active navigation state.
- Use semantic headings, labelled inputs, real buttons/links, visible focus styles, keyboard-operable tabs/toggles/dialogs, and status text that is announced for asynchronous actions.

## Verification strategy

Each page slice is complete only when its route, mock data, interactions, and state boundaries work together. Verification will include:

- `npm run build` for TypeScript and production bundling;
- `npm run lint` for frontend linting;
- the existing `npm test` command plus focused tests for route transitions, store immutability, filters, regeneration, edit/delete, import, and settings/export helpers;
- a manual browser smoke pass for every route in the route table, including back/forward, refresh, missing context, loading, empty, error, and confirmation states;
- visual comparison at the Figma frame sizes for Home, Essay Check, Reading Questions, Classes, each Add Class step, each Workspace tab, Assignment Detail, and Settings;
- keyboard and responsive checks for the send-confirmation, question-edit/remove, add-class, and settings controls.

## Implementation order

1. Establish the teacher route model, Figma-shaped types, mock query/mutation boundary, and shared teacher-specific primitives.
2. Implement Classes and the three-step Add Class flow.
3. Implement Class Workspace tabs and Assignment Detail.
4. Implement Home using the same class/assignment/essay data.
5. Implement Essay Check and its send-confirmation dialog.
6. Implement Reading Questions and its local worksheet actions.
7. Implement Settings and browser-only export/delete behavior.
8. Run visual/accessibility/responsive polish and the full verification matrix.

This sequence keeps the class/assignment context stable before implementing the dashboard and essay-review shortcuts that depend on it.
