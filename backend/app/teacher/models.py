"""Explicit row and transport models for Teacher Google Classroom data."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


def _datetime(value: datetime | str | None) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _timestamp(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


@dataclass(frozen=True)
class OAuthState:
    state_hash: str
    owner: str
    code_verifier: str
    redirect_uri: str
    expires_at: datetime
    consumed_at: datetime | None = None

    def to_row(self) -> dict[str, Any]:
        return {
            "state_hash": self.state_hash,
            "owner": self.owner,
            "code_verifier": self.code_verifier,
            "redirect_uri": self.redirect_uri,
            "expires_at": _timestamp(self.expires_at),
            "consumed_at": _timestamp(self.consumed_at),
        }

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> OAuthState:
        return cls(
            state_hash=row["state_hash"],
            owner=row["owner"],
            code_verifier=row["code_verifier"],
            redirect_uri=row["redirect_uri"],
            expires_at=_datetime(row["expires_at"]),  # type: ignore[arg-type]
            consumed_at=_datetime(row.get("consumed_at")),
        )


@dataclass(frozen=True)
class GoogleTokenResponse:
    """Verified identity and token data returned by the injectable Google transport."""

    refresh_token: str | None
    subject: str
    email: str | None
    scopes: tuple[str, ...]
    access_token_expires_at: datetime | None


@dataclass(frozen=True)
class TeacherGoogleConnection:
    """Internal persistence record; it deliberately holds ciphertext, never a refresh token."""

    owner: str
    google_subject: str
    google_email: str | None
    refresh_token_ciphertext: str
    scopes: tuple[str, ...]
    access_token_expires_at: datetime | None

    def to_row(self) -> dict[str, Any]:
        return {
            "owner": self.owner,
            "google_subject": self.google_subject,
            "google_email": self.google_email,
            "refresh_token_ciphertext": self.refresh_token_ciphertext,
            "scopes": list(self.scopes),
            "access_token_expires_at": _timestamp(self.access_token_expires_at),
        }

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> TeacherGoogleConnection:
        return cls(
            owner=row["owner"],
            google_subject=row["google_subject"],
            google_email=row.get("google_email"),
            refresh_token_ciphertext=row["refresh_token_ciphertext"],
            scopes=tuple(row.get("scopes") or ()),
            access_token_expires_at=_datetime(row.get("access_token_expires_at")),
        )


@dataclass(frozen=True)
class ConnectedTeacher:
    """Safe connection result suitable for a future route response."""

    owner: str
    google_subject: str
    google_email: str | None
    scopes: tuple[str, ...]
    last_synced_at: datetime | None = None
    last_sync_status: str | None = None
    last_sync_error: str | None = None


@dataclass(frozen=True)
class TeacherCourse:
    owner: str
    course_id: str
    name: str
    section: str | None
    description: str | None
    room: str | None
    course_state: str | None
    raw: dict[str, Any]

    def to_row(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass(frozen=True)
class TeacherCoursework:
    owner: str
    course_id: str
    coursework_id: str
    resource_type: str
    title: str | None
    description: str | None
    state: str | None
    due_at: datetime | None
    raw: dict[str, Any]

    def to_row(self) -> dict[str, Any]:
        return {**self.__dict__, "due_at": _timestamp(self.due_at)}


@dataclass(frozen=True)
class TeacherSubmission:
    owner: str
    course_id: str
    coursework_id: str
    submission_id: str
    student_id: str
    student_name: str | None
    state: str | None
    assigned_grade: float | None
    attachments: list[dict[str, Any]]
    sync_state: str
    sync_error: str | None
    analysis_id: str | None
    raw: dict[str, Any]
    student_email: str | None = None
    analysis_file_id: str | None = None
    analysis_file_version: str | None = None

    def to_row(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass(frozen=True)
class TeacherProfessorReview:
    owner: str
    course_id: str
    coursework_id: str
    submission_id: str
    student_id: str
    analysis_id: str | None
    verdict: str
    reasoning: str
    review_id: str = ""

    def to_row(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass(frozen=True)
class TeacherFeedback:
    owner: str
    course_id: str
    coursework_id: str
    submission_id: str
    student_id: str
    feedback_text: str
    status: str
    sent_at: datetime | None
    citation_ids: tuple[str, ...] = ()
    sharing_options: dict[str, Any] | None = None

    def to_row(self) -> dict[str, Any]:
        return {
            **self.__dict__,
            "sent_at": _timestamp(self.sent_at),
            "citation_ids": list(self.citation_ids),
            "sharing_options": self.sharing_options or {},
        }
