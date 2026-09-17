# Task 4A report: teacher essay analysis adapter

## Scope

- `backend/app/teacher/analysis.py`
- `backend/app/teacher/models.py`
- `backend/app/teacher/repository.py`
- `supabase/migrations/20260917150000_teacher_feedback_citations.sql`
- `backend/tests/test_teacher_analysis.py`

No router, `main.py`, frontend, or Task 3 implementation files are included.

## RED baseline

The supplied suite was described as RED, but the current partial checkout already
contained the Task 4A implementation and test file before this task began. The
required baseline command therefore returned green rather than a missing-feature
failure:

```text
$ py -m pytest tests/test_teacher_analysis.py -q -p no:cacheprovider
.....                                                                    [100%]
5 passed in 0.18s
```

No artificial failure was introduced. The existing tests exercise PDF preference,
Google Doc export fallback, owner-scoped absence and unsupported attachments,
analysis-to-EssayCheck mapping, persisted citation IDs, and internal-only feedback
send behavior.

## GREEN verification

The same prescribed focused command was rerun after the scope and diff inspection.
Its final result is recorded below:

```text
$ py -m pytest tests/test_teacher_analysis.py -q -p no:cacheprovider
.....                                                                    [100%]
5 passed in 0.17s
```

## Diff inspection

- The adapter delegates attachment ranking to the existing PDF-first selector.
- Pipeline upload/start/snapshot access uses lazy imports and accepts injected
  fakes for tests.
- Analysis linkage, review lookup, and feedback lookup are owner/course/coursework/
  submission scoped.
- Feedback writes persist `citation_ids`; the forward migration adds the required
  non-null `text[]` column with an empty-array default.
- Sending feedback changes only internal persistence because Classroom has no
  per-student feedback-text API.
