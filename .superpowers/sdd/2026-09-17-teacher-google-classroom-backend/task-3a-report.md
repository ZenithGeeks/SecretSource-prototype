# Task 3A report: Google Classroom/Drive client

## Scope

Implemented only `backend/app/teacher/google_client.py`. The existing client test uses fakes; `backend/tests/test_teacher_sync.py` was not changed.

## RED evidence

Before implementation, ran:

```text
py -m pytest tests/test_teacher_google_client.py -q -p no:cacheprovider
```

Result: 9 failed. Each failure was `ModuleNotFoundError: No module named 'app.teacher.google_client'`, confirming the missing client boundary.

## Implementation

- Injected Classroom and Drive services, with a refresh-token constructor that accepts an injectable Google service builder.
- Added bounded exponential retry with injectable sleep, and stable `GoogleApiError` normalization for 401, 403, 404, 429, and 5xx responses.
- Added complete pagination for all required Classroom collections.
- Added Drive metadata/download/export and submission grade/return operations.
- Added deterministic attachment selection: PDFs first, then Google Docs exported to PDF.

## GREEN evidence

The first implementation run exposed request recreation during retries and a missing submission ID on the return operation. Both were corrected before the final focused run:

```text
py -m pytest tests/test_teacher_google_client.py -q -p no:cacheprovider
9 passed in 0.29s
```
