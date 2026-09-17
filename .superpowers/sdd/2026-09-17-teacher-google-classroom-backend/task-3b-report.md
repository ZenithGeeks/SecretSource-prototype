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
