# SDD ledger — plan: docs/superpowers/plans/2026-09-25-teacher-login-classroom-sync.md

Workspace: existing feature branch `25-SEP-2026-add-backend-for-check-essay-page-in-teacher-role`; execute in the current checkout to preserve the user's uncommitted baseline.

Setup: the bundled Bash scripts could not launch (`Bash/Service/CreateInstance/E_ACCESSDENIED`); created this plan-scoped ledger manually. The workspace is not a linked git worktree; current branch is a feature branch, not main/master.

Pre-flight: Task 1 produces `sync_imported_courses(owner)` with status/counts/per-course results; Task 2 consumes it in `/teacher/sync-on-login` and OAuth callback; Task 3 consumes both backend routes and produces `teacherApi.syncOnLogin()` plus `TeacherLoginSyncResult`; Task 4 consumes those API types in Root and TeacherApp. The contracts align, with one clarification that Task 1's empty-course result includes `reason: no_imported_classes`, while Task 2 disconnected response uses `reason: not_connected`.

Ruling: Task 1 brief says “both new cases” although it specifies three tests; run all three RED checks (empty, partial, same-owner serialization) — covers the brief's complete test list — cost if wrong: the concurrency case may have a setup-related failure that needs adjustment.

Ruling: use per-owner in-process locking as planned — current service/container architecture is a single FastAPI process and the app does not have a distributed-lock table/RPC — cost if wrong: simultaneous requests routed to separate backend processes could overlap; deployment scaling would require a database-backed lock.

Baseline verification: `py -3 -m pytest -q` reported 177 passed, 6 failed, 22 errors. Failures: `tests/test_sessions.py::test_a_database_url_builds_a_database_service_without_connecting` and five tests in the pre-existing untracked `tests/test_teacher_analysis.py` (`test_submission_with_multiple_pdf_attachments_is_rejected_instead_of_analyzing_the_first`, `test_student_pdf_is_selected_over_non_pdf_attachment`, `test_same_pdf_version_reuses_its_existing_pipeline_analysis`, `test_changed_pdf_version_starts_a_new_pipeline_analysis`, `test_failed_analysis_for_the_same_pdf_can_be_retried`). The 22 errors came from denied access to Python/pytest temp paths. Rerunning with temp redirected under the repo still ended with pytest cleanup `PermissionError`; no product source was modified during baseline verification.
