"""Small, injectable boundary around Google Classroom and Drive APIs."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from time import sleep as default_sleep
from typing import Any


GOOGLE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document"
PDF_MIME_TYPE = "application/pdf"


class GoogleApiError(RuntimeError):
    """A stable error exposed by the Google client boundary."""

    def __init__(self, status_code: int | None, message: str, cause: Exception | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.__cause__ = cause


def _status_code(error: Exception) -> int | None:
    response = getattr(error, "resp", None)
    status = getattr(response, "status", None)
    if status is None:
        status = getattr(error, "status_code", None)
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None


def _message_for_status(status: int | None) -> str:
    return {
        401: "authentication failed",
        403: "permission denied",
        404: "resource not found",
    }.get(status, "temporarily unavailable" if status in (429,) or (status is not None and status >= 500) else "Google API request failed")


def execute_google_request(
    request: Any | Callable[[], Any],
    *,
    attempts: int = 3,
    backoff_seconds: float = 0.5,
    sleep: Callable[[float], None] = default_sleep,
) -> Any:
    """Execute a Google request, retrying only rate-limit and server failures."""
    attempts = max(1, attempts)
    for attempt in range(attempts):
        try:
            current_request = request() if callable(request) else request
            return current_request.execute()
        except Exception as error:
            status = _status_code(error)
            transient = status == 429 or (status is not None and 500 <= status <= 599)
            if transient and attempt < attempts - 1:
                sleep(backoff_seconds * (2**attempt))
                continue
            raise GoogleApiError(status, _message_for_status(status), error) from error
    raise AssertionError("unreachable")


def list_all_pages(
    resource: Any,
    item_key: str,
    *,
    execute: Callable[[Any], Any] = execute_google_request,
    **params: Any,
) -> list[dict[str, Any]]:
    """List all pages returned by a Google collection resource."""
    items: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        page = execute(lambda: resource.list(**params, pageToken=page_token))
        items.extend(page.get(item_key, []))
        page_token = page.get("nextPageToken")
        if not page_token:
            return items


class GoogleClassroomClient:
    def __init__(
        self,
        classroom: Any,
        drive: Any,
        *,
        attempts: int = 3,
        backoff_seconds: float = 0.5,
        sleep: Callable[[float], None] = default_sleep,
    ):
        self.classroom = classroom
        self.drive = drive
        self.attempts = attempts
        self.backoff_seconds = backoff_seconds
        self.sleep = sleep

    @classmethod
    def from_refresh_token(
        cls,
        refresh_token: str,
        *,
        client_id: str,
        client_secret: str,
        scopes: Iterable[str],
        service_builder: Callable[..., Any] | None = None,
        **kwargs: Any,
    ) -> "GoogleClassroomClient":
        from google.oauth2.credentials import Credentials

        if service_builder is None:
            from googleapiclient.discovery import build

            service_builder = build
        credentials = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=list(scopes),
        )
        return cls(
            service_builder("classroom", "v1", credentials=credentials),
            service_builder("drive", "v3", credentials=credentials),
            **kwargs,
        )

    def _execute(self, request: Any | Callable[[], Any]) -> Any:
        return execute_google_request(request, attempts=self.attempts, backoff_seconds=self.backoff_seconds, sleep=self.sleep)

    def _list(self, resource: Any, key: str, **params: Any) -> list[dict[str, Any]]:
        return list_all_pages(resource, key, execute=self._execute, **params)

    def list_courses(self): return self._list(self.classroom.courses(), "courses")
    def list_teachers(self, course_id: str): return self._list(self.classroom.courses().teachers(), "teachers", courseId=course_id)
    def list_students(self, course_id: str): return self._list(self.classroom.courses().students(), "students", courseId=course_id)
    def list_coursework(self, course_id: str): return self._list(self.classroom.courses().courseWork(), "courseWork", courseId=course_id)
    def list_coursework_materials(self, course_id: str): return self._list(self.classroom.courses().courseWorkMaterials(), "courseWorkMaterial", courseId=course_id)
    def list_announcements(self, course_id: str): return self._list(self.classroom.courses().announcements(), "announcements", courseId=course_id)
    def list_topics(self, course_id: str): return self._list(self.classroom.courses().topics(), "topic", courseId=course_id)
    def list_student_submissions(self, course_id: str, coursework_id: str): return self._list(self.classroom.courses().courseWork().studentSubmissions(), "studentSubmissions", courseId=course_id, courseWorkId=coursework_id)

    def get_drive_metadata(self, file_id: str): return self._execute(lambda: self.drive.files().get(fileId=file_id))
    def download_drive_file(self, file_id: str): return self._execute(lambda: self.drive.files().get_media(fileId=file_id))
    def export_google_doc_as_pdf(self, file_id: str): return self._execute(lambda: self.drive.files().export_media(fileId=file_id, mimeType=PDF_MIME_TYPE))
    def patch_assigned_grade(self, course_id: str, coursework_id: str, submission_id: str, grade: float):
        return self._execute(lambda: self.classroom.courses().courseWork().studentSubmissions().patch(courseId=course_id, courseWorkId=coursework_id, id=submission_id, updateMask="assignedGrade", body={"assignedGrade": float(grade)}))

    def return_submission(self, course_id: str, coursework_id: str, submission_id: str):
        return self._execute(lambda: self.classroom.courses().courseWork().studentSubmissions().return_(courseId=course_id, courseWorkId=coursework_id, id=submission_id))


def select_supported_attachments(attachments: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return PDFs followed by Google Docs, ordered predictably within each type."""
    selected: list[dict[str, Any]] = []
    for attachment in attachments:
        item = dict(attachment)
        shared_drive_file = item.get("driveFile")
        if isinstance(shared_drive_file, dict):
            drive_file = shared_drive_file.get("driveFile")
            if isinstance(drive_file, dict):
                item.update(shared_drive_file)
                item.update(drive_file)
            else:
                item = dict(shared_drive_file)
        mime_type = item.get("mimeType")
        if mime_type == PDF_MIME_TYPE:
            item["download_strategy"] = "download"
        elif mime_type == GOOGLE_DOCUMENT_MIME_TYPE:
            item["download_strategy"] = "export_pdf"
        else:
            continue
        selected.append(item)
    return sorted(selected, key=lambda item: (item["download_strategy"] != "download", item.get("name") or item.get("title", ""), item.get("id", "")))
