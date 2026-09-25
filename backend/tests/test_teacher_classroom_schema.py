"""Contract checks for the server-only Teacher Google Classroom migration."""

import re
from pathlib import Path

MIGRATION = Path(__file__).parents[2] / "supabase" / "migrations" / "20260917120000_teacher_classroom.sql"
FEEDBACK_CITATIONS_MIGRATION = Path(__file__).parents[2] / "supabase" / "migrations" / "20260921120000_teacher_feedback_citation_ids.sql"
COMPOSITE_REVIEWS_MIGRATION = Path(__file__).parents[2] / "supabase" / "migrations" / "20260925120000_teacher_review_composite_ids.sql"
TABLES = (
    "teacher_google_connections",
    "teacher_google_oauth_states",
    "teacher_courses",
    "teacher_coursework",
    "teacher_submissions",
    "teacher_professor_reviews",
    "teacher_feedback",
)


def _has(sql, pattern):
    return re.search(pattern, sql, re.IGNORECASE | re.DOTALL) is not None


def test_teacher_classroom_tables_are_server_only_and_owner_scoped():
    assert MIGRATION.exists(), f"missing migration: {MIGRATION}"
    sql = MIGRATION.read_text(encoding="utf-8")

    for table in TABLES:
        assert _has(sql, rf"create\s+table\s+(?:if\s+not\s+exists\s+)?public\.{table}\b")
        assert _has(sql, rf"alter\s+table\s+public\.{table}\s+enable\s+row\s+level\s+security")
        assert _has(sql, rf"{table}.*?\bowner\s+text\b")

    assert "create policy" not in sql.lower()
    assert _has(sql, r"refresh_token_ciphertext\s+text\s+not\s+null")
    assert not _has(sql, r"\brefresh_token\s+text\b")
    assert _has(sql, r"teacher_google_oauth_states_expires_idx.*?expires_at")


def test_teacher_classroom_resources_have_owner_scoped_identity_constraints():
    sql = MIGRATION.read_text(encoding="utf-8")

    for columns in (
        "owner, course_id",
        "owner, course_id, coursework_id",
        "owner, course_id, coursework_id, submission_id",
        "owner, submission_id",
    ):
        assert _has(sql, rf"unique\s*\(\s*{columns.replace(', ', r'\s*,\s*')}\s*\)")

    assert _has(sql, r"teacher_google_oauth_states.*?state_hash\s+text.*?unique")
    assert _has(sql, r"teacher_submissions.*?analysis_id\s+text")
    assert _has(sql, r"teacher_submissions.*?attachments\s+jsonb")


def test_teacher_feedback_persists_selected_citation_ids():
    assert FEEDBACK_CITATIONS_MIGRATION.exists(), f"missing migration: {FEEDBACK_CITATIONS_MIGRATION}"
    sql = FEEDBACK_CITATIONS_MIGRATION.read_text(encoding="utf-8")

    assert _has(sql, r"alter\s+table\s+public\.teacher_feedback.*?add\s+column.*?citation_ids\s+text\[\]")


def test_reviews_and_feedback_are_unique_within_their_coursework():
    assert COMPOSITE_REVIEWS_MIGRATION.exists(), f"missing migration: {COMPOSITE_REVIEWS_MIGRATION}"
    sql = COMPOSITE_REVIEWS_MIGRATION.read_text(encoding="utf-8")

    assert _has(
        sql,
        r"create\s+unique\s+index\s+if\s+not\s+exists\s+teacher_professor_reviews_owner_coursework_review_idx\s+on\s+public\.teacher_professor_reviews\s*\(\s*owner\s*,\s*course_id\s*,\s*coursework_id\s*,\s*submission_id\s*,\s*review_id\s*\)",
    )
    assert _has(
        sql,
        r"create\s+unique\s+index\s+if\s+not\s+exists\s+teacher_feedback_owner_coursework_submission_idx\s+on\s+public\.teacher_feedback\s*\(\s*owner\s*,\s*course_id\s*,\s*coursework_id\s*,\s*submission_id\s*\)",
    )
