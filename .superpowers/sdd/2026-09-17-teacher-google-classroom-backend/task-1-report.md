# Task 1 report

## Status

Completed after the first implementer hung during pytest's Windows temp cleanup. A fresh worker was also closed after the same environment stall; the controller verified the diff, ran the focused contract tests, and committed the already-present Task 1 implementation as `360d055` (`feat(teacher): add Classroom schema and configuration`).

## Implemented

- Added the server-only Supabase migration for owner-scoped Google connection, OAuth state, course, coursework, submission, review, and feedback tables, indexes, uniqueness constraints, and RLS with no browser policies.
- Added optional, validated Google Classroom settings and retry/timeout parsing to `backend/app/config.py`.
- Added Google auth/API and Fernet dependencies.
- Documented environment variables, Google Cloud consent/scopes/callback setup, encryption-key generation, migration, and the opt-in remote frontend flag in `.env.example`, `README.md`, and `backend/README.md`.
- Added migration/config contract tests.

## TDD evidence

- RED: the implementer did not return a captured pre-implementation test run before the worker hang, so no exact RED output is available.
- GREEN: `py -m pytest tests/test_teacher_config.py tests/test_teacher_classroom_schema.py -q -p no:cacheprovider` -> `5 passed in 0.18s`.

## Verification

- `git diff --check` passed; Git emitted only the repository's normal LF-to-CRLF warnings.
- The broader existing suite is environment-limited: pytest cannot scan/clean its managed Windows temporary roots in this checkout, producing `PermissionError: [WinError 5]`; this is recorded in `progress.md`.

## Files

`.env.example`, `README.md`, `backend/README.md`, `backend/app/config.py`, `backend/requirements.txt`, `backend/tests/test_teacher_classroom_schema.py`, `backend/tests/test_teacher_config.py`, `supabase/migrations/20260917120000_teacher_classroom.sql`.

## Concerns

The migration is contract-tested as SQL text but has not been applied against a live Supabase project in this environment. The service-role-only access model is intentional and must be preserved by later repository work.

## Fernet startup-validation fix (2026-09-17)

### Changed files

- `backend/app/config.py`: validate the configured encryption key by constructing `cryptography.fernet.Fernet` when the Google Classroom integration is enabled; invalid keys now fail during config import/startup with a setting-specific `ValueError`.
- `backend/tests/test_teacher_config.py`: generate valid Fernet keys for enabled-success cases and cover rejection of a nonempty invalid key.

### TDD commands and output

- RED: `py -m pytest tests/test_teacher_config.py --basetemp=.pytest-tmp-task1-fernet-red`
  - Result: `1 failed, 3 passed`; `test_enabled_google_classroom_rejects_an_invalid_fernet_key` failed with `Failed: DID NOT RAISE ValueError`.
- GREEN: `py -m pytest tests/test_teacher_config.py --basetemp=.pytest-tmp-task1-fernet-green -p no:cacheprovider`
  - Result: `4 passed in 0.22s`.
- Diff check: `git diff --check`
  - Result: exit 0; Git printed only the repository's LF-to-CRLF conversion warnings.

### Self-review

- Validation is enabled-only, preserving local/mock operation without Google settings.
- The check uses the real Fernet constructor, matching the later token-encryption consumer's key contract.
- No migration, documentation, or unrelated application code was changed.

## Review-finding follow-up (2026-09-17)

- `backend/app/config.py` imports `Fernet` and validates the nonempty encryption key only after enabled-mode required-setting checks. An invalid key raises `ValueError: TEACHER_GOOGLE_ENCRYPTION_KEY must be a valid Fernet key`.
- `backend/tests/test_teacher_config.py` retains invalid-key coverage and uses generated valid Fernet keys for enabled configuration cases.
- Targeted verification: `py -m pytest tests/test_teacher_config.py tests/test_teacher_classroom_schema.py -q -p no:cacheprovider`
  - Output: `6 passed in 0.21s`.
