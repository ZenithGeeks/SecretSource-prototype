# Task 3B report: owner-scoped Classroom synchronization

## Scope

- Added `TeacherGoogleSyncService` for explicit import preview, course import,
  refresh, and owner-scoped workspace reads.
- Added only the repository list/read methods needed by workspace responses.
- Preserved the supplied injectable Google and Supabase fakes in the focused
  synchronization suite.

## RED

Command run from `backend`:

```text
py -m pytest tests/test_teacher_sync.py -q -p no:cacheprovider
FFFFF                                                                    [100%]
5 failed in 0.33s
```

The failures were expected: `app.teacher.sync` did not exist and the
repository did not expose `list_courses`.

## GREEN

Command run from `backend`:

```text
py -m pytest tests/test_teacher_sync.py -q -p no:cacheprovider
.....                                                                    [100%]
5 passed in 0.17s
```

The service persists typed, owner-scoped course/coursework/submission rows,
includes roster data, keeps Drive metadata failures on the affected submission,
and applies the existing deterministic PDF-first attachment selector.

## Fix round 1

### RED

Command run from `backend` after adding the review regressions:

```text
py -m pytest tests/test_teacher_sync.py -q -p no:cacheprovider
F..FFFF                                                                  [100%]
5 failed, 2 passed in 0.57s
```

The failures showed that database-managed columns were passed to typed row
constructors, connection sync status was never recorded, Drive errors were
overwritten, and refresh erased an existing `analysis_id`.

### GREEN

```text
py -m pytest tests/test_teacher_sync.py -q -p no:cacheprovider
.......                                                                  [100%]
7 passed in 0.21s
```

Repository reads now construct each typed row from explicit application fields
and parse database timestamps/numerics. Import and refresh update the scoped
connection status, preserve a scoped submission's local `analysis_id`, and
join all Drive metadata errors while retaining partial writes and re-raising
non-Drive failures.
