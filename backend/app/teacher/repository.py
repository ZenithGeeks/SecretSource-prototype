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


def _datetime_or_none(value: datetime | str | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _course_from_row(row: dict[str, Any]) -> TeacherCourse:
    return TeacherCourse(
        owner=row["owner"], course_id=row["course_id"], name=row["name"],
        section=row.get("section"), description=row.get("description"), room=row.get("room"),
        course_state=row.get("course_state"), raw=dict(row.get("raw") or {}),
    )


def _coursework_from_row(row: dict[str, Any]) -> TeacherCoursework:
    return TeacherCoursework(
        owner=row["owner"], course_id=row["course_id"], coursework_id=row["coursework_id"],
        resource_type=row["resource_type"], title=row.get("title"), description=row.get("description"),
        state=row.get("state"), due_at=_datetime_or_none(row.get("due_at")), raw=dict(row.get("raw") or {}),
    )


def _submission_from_row(row: dict[str, Any]) -> TeacherSubmission:
    assigned_grade = row.get("assigned_grade")
    return TeacherSubmission(
        owner=row["owner"], course_id=row["course_id"], coursework_id=row["coursework_id"],
        submission_id=row["submission_id"], student_id=row["student_id"], student_name=row.get("student_name"),
        state=row.get("state"), assigned_grade=float(assigned_grade) if assigned_grade is not None else None,
        attachments=list(row.get("attachments") or []), sync_state=row["sync_state"],
        sync_error=row.get("sync_error"), analysis_id=row.get("analysis_id"), raw=dict(row.get("raw") or {}),
        student_email=row.get("student_email"), analysis_file_id=row.get("analysis_file_id"),
        analysis_file_version=row.get("analysis_file_version"),
    )


def _professor_review_from_row(row: dict[str, Any]) -> TeacherProfessorReview:
    return TeacherProfessorReview(
        owner=row["owner"], course_id=row["course_id"], coursework_id=row["coursework_id"],
        submission_id=row["submission_id"], student_id=row["student_id"],
        analysis_id=row.get("analysis_id"), verdict=row["verdict"], reasoning=row["reasoning"],
        review_id=row.get("review_id") or "",
    )


def _feedback_from_row(row: dict[str, Any]) -> TeacherFeedback:
    return TeacherFeedback(
        owner=row["owner"], course_id=row["course_id"], coursework_id=row["coursework_id"],
        submission_id=row["submission_id"], student_id=row["student_id"],
        feedback_text=row["feedback_text"], status=row["status"], sent_at=_datetime_or_none(row.get("sent_at")),
        citation_ids=tuple(row.get("citation_ids") or ()),
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
            .update({"consumed_at": now.isoformat()})
            .eq("state_hash", state_hash)
            .is_("consumed_at", "null")
            .gt("expires_at", now.isoformat())
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
            .select(
                "owner, google_subject, google_email, scopes, last_synced_at, "
                "last_sync_status, last_sync_error"
            )
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
            last_synced_at=_datetime_or_none(row.get("last_synced_at")),
            last_sync_status=row.get("last_sync_status"),
            last_sync_error=row.get("last_sync_error"),
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

    def record_sync_status(
        self, owner: str, status: str, error: str | None, synced_at: datetime | str | None
    ) -> None:
        values: dict[str, Any] = {"last_sync_status": status, "last_sync_error": error}
        if synced_at is not None:
            values["last_synced_at"] = synced_at.isoformat() if isinstance(synced_at, datetime) else synced_at
        self._client.table("teacher_google_connections").update(values).eq("owner", owner).execute()

    def list_courses(self, owner: str) -> list[TeacherCourse]:
        rows = self._client.table("teacher_courses").select("*").eq("owner", owner).execute().data
        return [_course_from_row(row) for row in rows]

    def list_coursework(self, owner: str, course_id: str) -> list[TeacherCoursework]:
        rows = (
            self._client.table("teacher_coursework")
            .select("*")
            .eq("owner", owner)
            .eq("course_id", course_id)
            .execute()
            .data
        )
        return [_coursework_from_row(row) for row in rows]

    def list_submissions(
        self, owner: str, course_id: str, coursework_id: str | None = None
    ) -> list[TeacherSubmission]:
        query = (
            self._client.table("teacher_submissions")
            .select("*")
            .eq("owner", owner)
            .eq("course_id", course_id)
        )
        if coursework_id is not None:
            query = query.eq("coursework_id", coursework_id)
        return [_submission_from_row(row) for row in query.execute().data]

    def get_submission(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str
    ) -> TeacherSubmission | None:
        rows = (
            self._client.table("teacher_submissions")
            .select("*")
            .eq("owner", owner)
            .eq("course_id", course_id)
            .eq("coursework_id", coursework_id)
            .eq("submission_id", submission_id)
            .limit(1)
            .execute()
            .data
        )
        return _submission_from_row(rows[0]) if rows else None

    def link_submission_analysis(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str, analysis_id: str,
        *, file_id: str | None = None, file_version: str | None = None,
    ) -> None:
        changes = {"analysis_id": analysis_id}
        if file_id is not None:
            changes["analysis_file_id"] = file_id
        if file_version is not None:
            changes["analysis_file_version"] = file_version
        (
            self._client.table("teacher_submissions")
            .update(changes)
            .eq("owner", owner)
            .eq("course_id", course_id)
            .eq("coursework_id", coursework_id)
            .eq("submission_id", submission_id)
            .execute()
        )

    def reset_submission_review(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str
    ) -> None:
        """Remove decisions and drafts tied to an older student PDF version."""
        self._client.table("teacher_professor_reviews").delete().eq("owner", owner).eq("course_id", course_id).eq("coursework_id", coursework_id).eq("submission_id", submission_id).execute()
        self._client.table("teacher_feedback").update({
            "feedback_text": "", "status": "draft", "sent_at": None, "citation_ids": [],
        }).eq("owner", owner).eq("course_id", course_id).eq("coursework_id", coursework_id).eq("submission_id", submission_id).execute()

    def get_professor_reviews(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str
    ) -> list[TeacherProfessorReview]:
        rows = (
            self._client.table("teacher_professor_reviews")
            .select("*")
            .eq("owner", owner)
            .eq("course_id", course_id)
            .eq("coursework_id", coursework_id)
            .eq("submission_id", submission_id)
            .execute()
            .data
        )
        return [_professor_review_from_row(row) for row in rows]

    def get_professor_review(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str
    ) -> TeacherProfessorReview | None:
        reviews = self.get_professor_reviews(owner, course_id, coursework_id, submission_id)
        return reviews[0] if reviews else None

    def save_professor_review(self, review: TeacherProfessorReview) -> None:
        self._upsert(
            "teacher_professor_reviews",
            review.to_row(),
            "owner,course_id,coursework_id,submission_id,review_id",
        )

    def save_feedback(self, feedback: TeacherFeedback) -> None:
        self._upsert(
            "teacher_feedback",
            feedback.to_row(),
            "owner,course_id,coursework_id,submission_id",
        )

    def get_feedback(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str
    ) -> TeacherFeedback | None:
        rows = (
            self._client.table("teacher_feedback")
            .select("*")
            .eq("owner", owner)
            .eq("course_id", course_id)
            .eq("coursework_id", coursework_id)
            .eq("submission_id", submission_id)
            .limit(1)
            .execute()
            .data
        )
        return _feedback_from_row(rows[0]) if rows else None

    def _upsert(self, table: str, row: dict[str, Any], conflict_keys: str) -> None:
        self._client.table(table).upsert(row, on_conflict=conflict_keys).execute()
