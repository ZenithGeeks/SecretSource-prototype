"""Service-role Supabase persistence, with owner scoping on every lookup."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app import store
from app.teacher.models import (
    ConnectedTeacher,
    OAuthState,
    TeacherCourse,
    TeacherCoursework,
    TeacherFeedback,
    TeacherGoogleConnection,
    TeacherProfessorReview,
    TeacherSubmission,
)


class TeacherGoogleRepository:
    """Tables are server-only: the default client comes from ``store._supabase()``."""

    def __init__(self, client: Any | None = None):
        self._client = client if client is not None else store._supabase()

    def save_oauth_state(self, state: OAuthState) -> None:
        self._client.table("teacher_google_oauth_states").insert(state.to_row()).execute()

    def consume_oauth_state(self, state_hash: str, now: datetime) -> OAuthState | None:
        rows = (
            self._client.table("teacher_google_oauth_states")
            .select("*")
            .eq("state_hash", state_hash)
            .is_("consumed_at", "null")
            .limit(1)
            .execute()
            .data
        )
        if not rows:
            return None
        state = OAuthState.from_row(rows[0])
        if state.expires_at <= now:
            return None
        updated = (
            self._client.table("teacher_google_oauth_states")
            .update({"consumed_at": now})
            .eq("state_hash", state_hash)
            .is_("consumed_at", "null")
            .gt("expires_at", now)
            .execute()
            .data
        )
        return state if updated else None

    def get_connection(self, owner: str) -> TeacherGoogleConnection | None:
        rows = (
            self._client.table("teacher_google_connections")
            .select("*")
            .eq("owner", owner)
            .limit(1)
            .execute()
            .data
        )
        return TeacherGoogleConnection.from_row(rows[0]) if rows else None

    def save_connection(self, connection: TeacherGoogleConnection) -> None:
        self._client.table("teacher_google_connections").upsert(
            connection.to_row(), on_conflict="owner"
        ).execute()

    def get_connection_status(self, owner: str) -> ConnectedTeacher | None:
        rows = (
            self._client.table("teacher_google_connections")
            .select("owner, google_subject, google_email, scopes")
            .eq("owner", owner)
            .limit(1)
            .execute()
            .data
        )
        if not rows:
            return None
        row = rows[0]
        return ConnectedTeacher(
            owner=row["owner"],
            google_subject=row["google_subject"],
            google_email=row.get("google_email"),
            scopes=tuple(row.get("scopes") or ()),
        )

    def disconnect(self, owner: str) -> bool:
        deleted = (
            self._client.table("teacher_google_connections").delete().eq("owner", owner).execute().data
        )
        return bool(deleted)

    def save_course(self, course: TeacherCourse) -> None:
        self._upsert("teacher_courses", course.to_row(), "owner,course_id")

    def save_coursework(self, coursework: TeacherCoursework) -> None:
        self._upsert("teacher_coursework", coursework.to_row(), "owner,course_id,coursework_id")

    def save_submission(self, submission: TeacherSubmission) -> None:
        self._upsert(
            "teacher_submissions", submission.to_row(), "owner,course_id,coursework_id,submission_id"
        )

    def save_professor_review(self, review: TeacherProfessorReview) -> None:
        self._upsert("teacher_professor_reviews", review.to_row(), "owner,submission_id")

    def save_feedback(self, feedback: TeacherFeedback) -> None:
        self._upsert("teacher_feedback", feedback.to_row(), "owner,submission_id")

    def _upsert(self, table: str, row: dict[str, Any], conflict_keys: str) -> None:
        self._client.table(table).upsert(row, on_conflict=conflict_keys).execute()
