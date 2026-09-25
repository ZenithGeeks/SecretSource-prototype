# Task 4B report: Teacher FastAPI router

## Scope

- `backend/app/teacher/router.py`
- `backend/app/main.py`
- `backend/app/teacher/models.py`
- `backend/app/teacher/repository.py`
- `backend/app/teacher/analysis.py`
- `supabase/migrations/20260917160000_teacher_professor_review_ids.sql`
- `backend/tests/test_teacher_routes.py`

The small model/repository/analysis extension makes the existing review endpoint
per-citation instead of silently applying one professor result to every card.

## GREEN verification

```text
py -m pytest tests/test_teacher_routes.py -q -p no:cacheprovider
...                                                                      [100%]
3 passed in 0.68s

py -m pytest tests/test_teacher_analysis.py tests/test_teacher_oauth.py tests/test_teacher_repository.py tests/test_teacher_google_client.py tests/test_teacher_sync.py tests/test_teacher_routes.py tests/test_teacher_classroom_schema.py -q -p no:cacheprovider
.......................................                                  [100%]
39 passed in 0.95s
```

The route suite covers owner-scoped workspace/detail/essay reads, review and
feedback persistence, Classroom grade-then-return ordering, and the partial
failure response after a successful grade patch.

## Implementation notes

- OAuth callback state remains the only authentication input to the public
  callback; all other Teacher routes require the existing Supabase user.
- Refresh tokens/ciphertext never appear in route responses.
- Local reads use owner-filtered repository methods. Google reads/mutations use
  the decrypted owner connection through the injectable client factory.
- Analysis starts reuse the existing `main.save_upload`/`main._start` boundary
  through the Task 4A service.
- Grade-and-return calls `patch_assigned_grade` before `return_submission` and
  does not write a local returned state.
