"""Authenticated HTTP boundary for the Teacher Google Classroom workspace."""

from __future__ import annotations

import logging
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app import config
from app.auth import current_user
from app.teacher.analysis import TeacherEssayAnalysisService
from app.teacher.crypto import RefreshTokenCipher
from app.teacher.google_client import GoogleApiError, GoogleClassroomClient, select_supported_attachments
from app.teacher.models import ConnectedTeacher, TeacherCourse, TeacherCoursework, TeacherSubmission
from app.teacher.oauth import (
    GoogleAuthorizationCodeTransport,
    GoogleOAuthSettings,
    TeacherGoogleOAuthService,
)
from app.teacher.repository import TeacherGoogleRepository
from app.teacher.sync import TeacherGoogleSyncService

# The browser uses /api/teacher; Vite/nginx remove /api before forwarding to FastAPI.
router = APIRouter(prefix="/teacher", tags=["teacher"])
logger = logging.getLogger(__name__)


class ReviewUpdate(BaseModel):
    student_id: str = Field(alias="studentId")
    outcome: str
    note: str = ""

    model_config = {"populate_by_name": True}


class FeedbackUpdate(BaseModel):
    student_id: str = Field(alias="studentId")
    body: str = ""
    citation_ids: list[str] = Field(default_factory=list, alias="citationIds")
    sharing_options: dict[str, dict[str, bool]] = Field(default_factory=dict, alias="sharingOptions")
    report_html: str | None = Field(default=None, alias="reportHtml", max_length=20_000_000)

    model_config = {"populate_by_name": True}


class PrepareEssayChecksRequest(BaseModel):
    assignment_ids: list[str] = Field(min_length=1, max_length=100, alias="assignmentIds")

    model_config = {"populate_by_name": True}


class GradeAndReturnRequest(BaseModel):
    grade: float = Field(ge=0)


def require_teacher_user(user: str | None = Depends(current_user)) -> str:
    """Teacher data is never available in the anonymous/shared gateway space."""
    if not user:
        raise HTTPException(status_code=401, detail="sign in to use Google Classroom")
    return user


def get_repository() -> TeacherGoogleRepository:
    return TeacherGoogleRepository()


def _require_google_enabled() -> None:
    if not config.TEACHER_GOOGLE_ENABLED:
        raise HTTPException(status_code=503, detail="Google Classroom integration is disabled")


def get_oauth_service(repository: TeacherGoogleRepository = Depends(get_repository)) -> TeacherGoogleOAuthService:
    _require_google_enabled()
    return TeacherGoogleOAuthService(
        repository=repository,
        transport=GoogleAuthorizationCodeTransport(
            config.TEACHER_GOOGLE_CLIENT_ID,
            config.TEACHER_GOOGLE_CLIENT_SECRET,
        ),
        encryption_key=config.TEACHER_GOOGLE_ENCRYPTION_KEY,
        settings=GoogleOAuthSettings(
            client_id=config.TEACHER_GOOGLE_CLIENT_ID,
            redirect_uri=config.TEACHER_GOOGLE_REDIRECT_URI,
            scopes=config.TEACHER_GOOGLE_SCOPES,
            state_ttl=timedelta(seconds=config.TEACHER_GOOGLE_STATE_TTL_SECONDS),
        ),
    )


def get_google_client(
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> GoogleClassroomClient:
    _require_google_enabled()
    connection = repository.get_connection(owner)
    if connection is None:
        raise HTTPException(status_code=409, detail="Google Classroom is not connected")
    try:
        refresh_token = RefreshTokenCipher(config.TEACHER_GOOGLE_ENCRYPTION_KEY).decrypt(
            connection.refresh_token_ciphertext
        )
        return GoogleClassroomClient.from_refresh_token(
            refresh_token,
            client_id=config.TEACHER_GOOGLE_CLIENT_ID,
            client_secret=config.TEACHER_GOOGLE_CLIENT_SECRET,
            scopes=connection.scopes or config.TEACHER_GOOGLE_SCOPES,
            attempts=config.TEACHER_GOOGLE_RETRY_ATTEMPTS,
            backoff_seconds=config.TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail="stored Google Classroom credentials are unusable") from error


def get_sync_service(
    client: GoogleClassroomClient = Depends(get_google_client),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> TeacherGoogleSyncService:
    return TeacherGoogleSyncService(client=client, repository=repository)


def get_analysis_service(
    client: GoogleClassroomClient = Depends(get_google_client),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> TeacherEssayAnalysisService:
    return TeacherEssayAnalysisService(client=client, repository=repository)


def get_analysis_read_service(
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> TeacherEssayAnalysisService:
    return TeacherEssayAnalysisService(client=None, repository=repository)


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def _name(profile: Any) -> str:
    if isinstance(profile, dict):
        name = profile.get("name")
        if isinstance(name, dict):
            return str(name.get("fullName") or " ".join(
                part for part in (name.get("givenName"), name.get("familyName")) if part
            )).strip()
        if profile.get("emailAddress"):
            return str(profile["emailAddress"])
    return ""


def _initials(name: str) -> str:
    parts = [part for part in name.split() if part]
    return "".join(part[0] for part in parts[:2]).upper() or "?"


def _drive_material(material: dict[str, Any]) -> dict[str, Any] | None:
    drive_file = material.get("driveFile")
    if isinstance(drive_file, dict) and isinstance(drive_file.get("driveFile"), dict):
        drive_file = drive_file["driveFile"]
    if not isinstance(drive_file, dict):
        return None
    file_id = drive_file.get("id")
    if not file_id:
        return None
    return {
        "id": str(file_id),
        "kind": "driveFile",
        "title": str(drive_file.get("title") or drive_file.get("name") or "Drive file"),
        "url": str(drive_file.get("alternateLink") or drive_file.get("webViewLink") or ""),
    }


def _materials(raw: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, material in enumerate(raw.get("materials") or []):
        if not isinstance(material, dict):
            continue
        drive = _drive_material(material)
        if drive is not None:
            result.append(drive)
            continue
        for kind, field in (("link", "link"), ("youtubeVideo", "youtubeVideo"), ("form", "form")):
            value = material.get(field)
            if isinstance(value, dict):
                result.append({
                    "id": str(value.get("id") or value.get("url") or f"material-{index}"),
                    "kind": kind,
                    "title": str(value.get("title") or value.get("text") or value.get("url") or kind),
                    "url": str(value.get("url") or value.get("alternateLink") or ""),
                })
                break
    return result


def _course_view(course: TeacherCourse, coursework: list[TeacherCoursework] | None = None) -> dict[str, Any]:
    raw = course.raw or {}
    teachers = raw.get("teachers") or []
    students = raw.get("students") or []
    work = coursework or []
    return {
        "id": course.course_id,
        "name": course.name,
        "section": course.section or "",
        "subject": course.description or "",
        "status": "active",
        "teacherName": _name((teachers[0] or {}).get("profile")) if teachers and isinstance(teachers[0], dict) else "",
        "studentCount": len(students),
        "assignmentCount": sum(item.resource_type == "coursework" for item in work),
        "topicCount": sum(item.resource_type == "topic" for item in work),
        "announcementCount": sum(item.resource_type == "announcement" for item in work),
        "linkedFileCount": sum(bool(_materials(item.raw)) for item in work),
        "lastSyncedAt": str(raw.get("_last_synced_at") or ""),
    }


def _raw_course_view(raw: dict[str, Any]) -> dict[str, Any]:
    course = TeacherCourse(
        owner="",
        course_id=str(raw.get("id") or ""),
        name=str(raw.get("name") or ""),
        section=raw.get("section"),
        description=raw.get("description"),
        room=raw.get("room"),
        course_state=raw.get("courseState"),
        raw=raw,
    )
    return _course_view(course)


def _submission_view(submission: TeacherSubmission) -> dict[str, Any]:
    raw = submission.raw or {}
    state = submission.state or ""
    display_state = "returned" if state == "RETURNED" else "submitted" if state in {"TURNED_IN", "RETURNED"} else "missing"
    attachments = [
        {
            "id": str(item.get("id") or ""),
            "title": str(item.get("name") or item.get("title") or "Submission"),
            "mimeType": str(item.get("mimeType") or "application/octet-stream"),
            "url": str(item.get("webViewLink") or item.get("webContentLink") or item.get("alternateLink") or ""),
        }
        for item in submission.attachments
    ]
    return {
        "id": submission.submission_id,
        "assignmentId": submission.coursework_id,
        "studentId": submission.student_id,
        "studentName": submission.student_name or submission.student_id,
        "studentEmail": submission.student_email,
        "fileName": attachments[0]["title"] if attachments else "submission.pdf",
        "state": display_state,
        "submittedAt": raw.get("updateTime") or raw.get("creationTime"),
        "attachments": attachments,
    }


def _assignment_view(
    coursework: TeacherCoursework, submissions: list[TeacherSubmission], course: TeacherCourse | None = None
) -> dict[str, Any]:
    raw = coursework.raw or {}
    enrolled = len((course.raw or {}).get("students") or []) if course is not None else len(submissions)
    submitted = sum(item.state in {"TURNED_IN", "RETURNED"} for item in submissions)
    returned = sum(item.state == "RETURNED" for item in submissions)
    return {
        "id": coursework.coursework_id,
        "courseId": coursework.course_id,
        "title": coursework.title or coursework.coursework_id,
        "dueAt": _iso(coursework.due_at),
        "enrolledCount": enrolled,
        "submittedCount": submitted,
        "missingCount": max(0, enrolled - submitted),
        "returnedCount": returned,
        "pendingReviewCount": max(0, submitted - returned),
        "status": "returned" if submitted and returned == submitted else "pending" if submitted else "not-started",
        "materials": _materials(raw),
    }


def _workspace_view(
    course: TeacherCourse, coursework: list[TeacherCoursework], submissions: list[TeacherSubmission]
) -> dict[str, Any]:
    raw = course.raw or {}
    assignments = [item for item in coursework if item.resource_type == "coursework"]
    announcement = next((item for item in coursework if item.resource_type == "announcement"), None)
    topics = [item for item in coursework if item.resource_type == "topic"]
    materials = [item for item in coursework if item.resource_type == "material"]
    people: list[dict[str, Any]] = []
    for teacher in raw.get("teachers") or []:
        profile = teacher.get("profile") if isinstance(teacher, dict) else None
        display = _name(profile) or str(teacher.get("userId") or "Teacher")
        people.append({"id": teacher.get("userId"), "name": display, "initials": _initials(display), "role": "Teacher", "isCourseOwner": bool(teacher.get("courseOwner"))})
    for student in raw.get("students") or []:
        profile = student.get("profile") if isinstance(student, dict) else None
        display = _name(profile) or str(student.get("userId") or "Student")
        people.append({"id": student.get("userId"), "name": display, "initials": _initials(display), "role": "Student", "isCourseOwner": False})
    return {
        "course": _course_view(course, coursework),
        "description": course.description or "",
        "assignments": [_assignment_view(item, [sub for sub in submissions if sub.coursework_id == item.coursework_id], course) for item in assignments],
        "submissions": [_submission_view(item) for item in submissions],
        "people": people,
        "latestAnnouncement": ({
            "title": announcement.title or "Announcement",
            "postedBy": "",
            "postedAt": str((announcement.raw or {}).get("updateTime") or (announcement.raw or {}).get("creationTime") or ""),
            "body": announcement.description or "",
        } if announcement else None),
        "materials": [
            {"id": item.coursework_id, "title": item.title or item.coursework_id, "kind": "drive-file" if _materials(item.raw) else "link", "accessible": bool(_materials(item.raw))}
            for item in materials
        ],
        "topics": [
            {"id": item.coursework_id, "name": item.title or item.coursework_id, "assignmentCount": sum((assignment.raw or {}).get("topicId") == item.coursework_id for assignment in assignments)}
            for item in topics
        ],
    }


def _owned_course(repository: TeacherGoogleRepository, owner: str, course_id: str) -> TeacherCourse:
    course = next((item for item in repository.list_courses(owner) if item.owner == owner and item.course_id == course_id), None)
    if course is None:
        raise HTTPException(status_code=404, detail="course not found")
    return course


def _owned_assignment(
    repository: TeacherGoogleRepository, owner: str, course_id: str, assignment_id: str
) -> tuple[TeacherCourse, TeacherCoursework]:
    course = _owned_course(repository, owner, course_id)
    assignment = next((item for item in repository.list_coursework(owner, course_id) if item.coursework_id == assignment_id and item.resource_type == "coursework"), None)
    if assignment is None:
        raise HTTPException(status_code=404, detail="assignment not found")
    return course, assignment


def _map_google_error(error: Exception) -> HTTPException:
    if isinstance(error, GoogleApiError):
        return HTTPException(status_code=502, detail=str(error))
    return HTTPException(status_code=502, detail="Google Classroom request failed")


def _submission_id(
    service: TeacherEssayAnalysisService, owner: str, course_id: str, assignment_id: str, student_id: str
) -> str:
    submission = next(
        (
            item
            for item in service.repository.list_submissions(owner, course_id, assignment_id)
            if item.student_id == student_id or item.submission_id == student_id
        ),
        None,
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="submission not found")
    return submission.submission_id


def _essay_or_error(
    service: TeacherEssayAnalysisService, owner: str, course_id: str, assignment_id: str, submission_id: str
) -> dict[str, Any]:
    try:
        return service.essay_check(owner, course_id, assignment_id, submission_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/google/connect")
def google_connect(
    login_hint: str | None = Query(None, alias="loginHint"),
    switch_account: bool = Query(False, alias="switch"),
    owner: str = Depends(require_teacher_user),
    service: TeacherGoogleOAuthService = Depends(get_oauth_service),
) -> dict[str, str]:
    try:
        authorization = service.start_authorization(
            owner, login_hint=login_hint, switch_account=switch_account
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail="could not start Google OAuth") from error
    return {"authorizationUrl": authorization.url}


@router.get("/google/callback")
def google_callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    service: TeacherGoogleOAuthService = Depends(get_oauth_service),
):
    if error:
        raise HTTPException(status_code=400, detail=f"Google OAuth was not completed: {error}")
    if not code:
        raise HTTPException(status_code=400, detail="Google OAuth callback did not include a code")
    try:
        service.complete_callback(state=state, code=code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Google OAuth callback failed") from exc
    return RedirectResponse(config.TEACHER_GOOGLE_SUCCESS_REDIRECT, status_code=303)


@router.get("/google/status")
def google_status(
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    status: ConnectedTeacher | None = repository.get_connection_status(owner)
    if status is None:
        return {"connected": False, "sync": {"status": None, "lastSyncedAt": None, "error": None}}
    return {
        "connected": True,
        "email": status.google_email,
        "scopes": list(status.scopes),
        "sync": {
            "status": status.last_sync_status,
            "lastSyncedAt": _iso(status.last_synced_at) if status.last_synced_at else None,
            "error": status.last_sync_error,
        },
    }


@router.delete("/google")
def google_disconnect(
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    connection_deleted = repository.disconnect(owner)
    return {
        "connected": False,
        "connectionDeleted": connection_deleted,
        "importedDataDeleted": False,
    }


@router.get("/home")
def teacher_home(
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    courses = repository.list_courses(owner)
    now = datetime.now(UTC)
    assignments_by_id: dict[tuple[str, str], tuple[TeacherCourse, TeacherCoursework, list[TeacherSubmission]]] = {}
    submissions: list[tuple[TeacherCourse, TeacherCoursework | None, TeacherSubmission]] = []
    due_soon: list[dict[str, Any]] = []

    for course in courses:
        coursework = repository.list_coursework(owner, course.course_id)
        assignments = [item for item in coursework if item.resource_type == "coursework"]
        assignments_by_coursework_id = {item.coursework_id: item for item in assignments}
        course_submissions = repository.list_submissions(owner, course.course_id)
        by_assignment: dict[str, list[TeacherSubmission]] = {}
        for submission in course_submissions:
            by_assignment.setdefault(submission.coursework_id, []).append(submission)
            assignment = assignments_by_coursework_id.get(submission.coursework_id)
            submissions.append((course, assignment, submission))

        for assignment in assignments:
            assignment_submissions = by_assignment.get(assignment.coursework_id, [])
            assignments_by_id[(course.course_id, assignment.coursework_id)] = (course, assignment, assignment_submissions)
            if assignment.due_at is None:
                continue
            due_at = assignment.due_at if assignment.due_at.tzinfo else assignment.due_at.replace(tzinfo=UTC)
            overdue = due_at < now
            view = _assignment_view(assignment, assignment_submissions, course)
            if (not overdue and due_at <= now + timedelta(days=7)) or (
                overdue and (view["missingCount"] > 0 or view["pendingReviewCount"] > 0)
            ):
                due_soon.append({**view, "courseName": course.name, "overdue": overdue})

    primary_course = courses[0] if courses else None
    primary_assignment = next(
        (assignment for course, assignment, _ in assignments_by_id.values() if course == primary_course),
        None,
    )
    queue = [entry for entry in submissions if entry[2].state == "TURNED_IN"]
    queue.sort(key=lambda entry: str((entry[2].raw or {}).get("updateTime") or (entry[2].raw or {}).get("creationTime") or ""), reverse=True)
    # Keep near-term work visible when older overdue assignments still have missing work.
    due_soon.sort(key=lambda entry: (entry["overdue"], entry["dueAt"]))
    home_submissions = []
    for course, assignment, submission in queue[:8]:
        checked = bool(submission.analysis_id)
        home_submissions.append({
            **_submission_view(submission),
            "courseId": course.course_id,
            "courseName": course.name,
            "assignmentTitle": assignment.title if assignment and assignment.title else submission.coursework_id,
            "initial": _initials(submission.student_name or submission.student_id),
            "summary": "Analysis on file · open to review" if checked else "New submission · not checked",
            "reviewStatus": "analysis-ready" if checked else "not-checked",
        })
    return {
        "user": owner,
        "course": primary_course.name if primary_course else "",
        "courseId": primary_course.course_id if primary_course else None,
        "checkedEssays": sum(bool(entry[2].analysis_id) for entry in submissions),
        "totalEssays": len(submissions),
        "reviewQueueCount": len(queue),
        "assignment": primary_assignment.title if primary_assignment else "",
        "assignmentId": primary_assignment.coursework_id if primary_assignment else None,
        "submissions": home_submissions,
        "dueSoon": due_soon[:8],
    }


def _history_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


@router.get("/history")
def teacher_history(
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> list[dict[str, Any]]:
    """Recent checked Classroom submissions for the authenticated teacher."""
    from app.main import analyses

    courses = repository.list_courses(owner)
    courses_by_id = {course.course_id: course for course in courses}
    assignments_by_key: dict[tuple[str, str], TeacherCoursework] = {}
    submissions: dict[tuple[str, str, str], TeacherSubmission] = {}
    for course in courses:
        for assignment in repository.list_coursework(owner, course.course_id):
            if assignment.resource_type == "coursework":
                assignments_by_key[(course.course_id, assignment.coursework_id)] = assignment
        for submission in repository.list_submissions(owner, course.course_id):
            submissions[(course.course_id, submission.coursework_id, submission.submission_id)] = submission

    review_activity: dict[tuple[str, str, str], list[Any]] = {}
    for review in repository.list_professor_review_activity(owner):
        if review.get("owner") != owner:
            continue
        key = (str(review.get("course_id") or ""), str(review.get("coursework_id") or ""), str(review.get("submission_id") or ""))
        review_activity.setdefault(key, []).extend((review.get("updated_at"), review.get("created_at")))

    feedback_activity: dict[tuple[str, str, str], list[Any]] = {}
    for feedback in repository.list_feedback_activity(owner):
        if feedback.get("owner") != owner or not str(feedback.get("feedback_text") or "").strip():
            continue
        key = (str(feedback.get("course_id") or ""), str(feedback.get("coursework_id") or ""), str(feedback.get("submission_id") or ""))
        feedback_activity.setdefault(key, []).extend((feedback.get("updated_at"), feedback.get("created_at"), feedback.get("sent_at")))

    history: list[tuple[datetime, dict[str, Any]]] = []
    for key, submission in submissions.items():
        course_id, coursework_id, submission_id = key
        course = courses_by_id.get(course_id)
        if course is None:
            continue

        activity: list[str] = []
        timestamps: list[datetime] = []
        analysis_id: str | None = None
        if submission.analysis_id:
            snapshot = analyses.get(submission.analysis_id)
            if snapshot and snapshot.get("owner") == owner and snapshot.get("status") == "done":
                analysis_id = submission.analysis_id
                activity.append("analysis")
                checked = _history_timestamp(snapshot.get("completed") or snapshot.get("started"))
                if checked:
                    timestamps.append(checked)

        review_times = review_activity.get(key, [])
        if review_times:
            activity.append("professor-review")
            timestamps.extend(parsed for value in review_times if (parsed := _history_timestamp(value)))

        feedback_times = feedback_activity.get(key, [])
        if feedback_times:
            activity.append("feedback")
            timestamps.extend(parsed for value in feedback_times if (parsed := _history_timestamp(value)))

        if not activity or not timestamps:
            continue

        assignment = assignments_by_key.get((course_id, coursework_id))
        submission_view = _submission_view(submission)
        latest = max(timestamps)
        entry = {
            "id": f"{course_id}:{coursework_id}:{submission_id}",
            "courseId": course_id,
            "courseName": course.name,
            "assignmentId": coursework_id,
            "assignmentTitle": assignment.title if assignment and assignment.title else coursework_id,
            "submissionId": submission_id,
            "studentId": submission.student_id,
            "studentName": submission.student_name or submission.student_id,
            "fileName": submission_view["fileName"],
            "checkedAt": latest.isoformat(),
            "analysisId": analysis_id,
            "activity": activity,
        }
        history.append((latest, entry))

    history.sort(key=lambda item: item[0], reverse=True)
    return [entry for _, entry in history]


@router.get("/classes")
def teacher_classes(
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> list[dict[str, Any]]:
    return [_course_view(course, repository.list_coursework(owner, course.course_id)) for course in repository.list_courses(owner)]


@router.get("/classes/importable")
def importable_classes(
    owner: str = Depends(require_teacher_user),
    service: TeacherGoogleSyncService = Depends(get_sync_service),
) -> list[dict[str, Any]]:
    try:
        return [_raw_course_view(course) for course in service.import_preview(owner).get("courses", [])]
    except Exception as error:
        raise _map_google_error(error) from error


@router.get("/classes/importable/{course_id}/preview")
def import_preview(
    course_id: str,
    owner: str = Depends(require_teacher_user),
    service: TeacherGoogleSyncService = Depends(get_sync_service),
) -> dict[str, Any]:
    try:
        courses = service.import_preview(owner).get("courses", [])
        raw_course = next((item for item in courses if item.get("id") == course_id), None)
        if raw_course is None:
            raise HTTPException(status_code=404, detail="course not found in Google Classroom")
        client = service.client
        students = client.list_students(course_id)
        teachers = client.list_teachers(course_id)
        assignments = client.list_coursework(course_id)
        materials = client.list_coursework_materials(course_id)
        announcements = client.list_announcements(course_id)
        topics = client.list_topics(course_id)
        raw_course = {**raw_course, "students": students, "teachers": teachers}
        return {
            "course": _raw_course_view(raw_course),
            "resources": [
                {"key": "course", "label": "Course", "count": 1, "detail": "Course details"},
                {"key": "classwork", "label": "Classwork", "count": len(assignments), "detail": "Assignments and student submissions"},
                {"key": "people", "label": "People", "count": len(students) + len(teachers), "detail": "Teachers and students"},
                {"key": "drive", "label": "Materials", "count": len(materials) + len(announcements) + len(topics), "detail": "Classroom resources"},
            ],
        }
    except HTTPException:
        raise
    except Exception as error:
        raise _map_google_error(error) from error


@router.post("/classes/{course_id}/import")
def import_class(
    course_id: str,
    owner: str = Depends(require_teacher_user),
    service: TeacherGoogleSyncService = Depends(get_sync_service),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    try:
        result = service.import_course(owner, course_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise _map_google_error(error) from error
    course = _owned_course(repository, owner, course_id)
    return {"course": _course_view(course, repository.list_coursework(owner, course_id)), "sync": result}


@router.get("/classes/{course_id}/workspace")
def class_workspace(
    course_id: str,
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    course = _owned_course(repository, owner, course_id)
    return _workspace_view(course, repository.list_coursework(owner, course_id), repository.list_submissions(owner, course_id))


@router.post("/classes/{course_id}/refresh")
def refresh_class(
    course_id: str,
    owner: str = Depends(require_teacher_user),
    service: TeacherGoogleSyncService = Depends(get_sync_service),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    try:
        result = service.refresh_course(owner, course_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise _map_google_error(error) from error
    course = _owned_course(repository, owner, course_id)
    return {"workspace": _workspace_view(course, repository.list_coursework(owner, course_id), repository.list_submissions(owner, course_id)), "sync": result}


@router.get("/classes/{course_id}/assignments/{assignment_id}")
def assignment_detail(
    course_id: str,
    assignment_id: str,
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    course, assignment = _owned_assignment(repository, owner, course_id, assignment_id)
    submissions = [item for item in repository.list_submissions(owner, course_id, assignment_id)]
    return {"assignment": _assignment_view(assignment, submissions, course), "submissions": [_submission_view(item) for item in submissions]}


@router.post("/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/analyze")
async def analyze_submission(
    course_id: str,
    assignment_id: str,
    student_id: str,
    verify: bool = Query(True),
    force: bool = Query(False),
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_service),
) -> dict[str, Any]:
    submission_id = student_id
    try:
        # Classroom's submission id is the durable identifier, while the Teacher URL uses
        # the student id. This accepts the common one-submission-per-student shape and gives
        # the route a stable lookup without exposing another public identifier.
        submission_id = _submission_id(service, owner, course_id, assignment_id, student_id)
        return service.start(owner, course_id, assignment_id, submission_id, verify=verify, force=force)
    except HTTPException:
        raise
    except ValueError as error:
        detail = str(error)
        raise HTTPException(status_code=409 if "supported Drive" in detail or "PDF attachment" in detail else 404, detail=detail) from error
    except Exception as error:
        raise _map_google_error(error) from error


@router.post("/classes/{course_id}/essay-checks:prepare")
async def prepare_essay_checks(
    course_id: str,
    request: PrepareEssayChecksRequest,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_service),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    """Start one analysis for each unambiguous submitted PDF in selected assignments."""
    _owned_course(repository, owner, course_id)
    assignments = {item.coursework_id for item in repository.list_coursework(owner, course_id)}
    selected = list(dict.fromkeys(request.assignment_ids))
    unknown = [assignment_id for assignment_id in selected if assignment_id not in assignments]
    if unknown:
        raise HTTPException(status_code=404, detail=f"assignment not found: {unknown[0]}")

    prepared: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for assignment_id in selected:
        submissions = repository.list_submissions(owner, course_id, assignment_id)
        if not submissions:
            skipped.append({"assignmentId": assignment_id, "reason": "no submitted student work"})
            continue
        for submission in submissions:
            item = {
                "assignmentId": assignment_id,
                "submissionId": submission.submission_id,
                "studentId": submission.student_id,
                "studentName": submission.student_name or submission.student_id,
            }
            if submission.state not in {"TURNED_IN", "RETURNED"}:
                skipped.append({**item, "reason": "submission is not turned in"})
                continue
            pdfs = [attachment for attachment in select_supported_attachments(submission.attachments) if attachment.get("mimeType") == "application/pdf"]
            if len(pdfs) != 1:
                skipped.append({**item, "reason": "submission must contain exactly one PDF attachment"})
                continue
            try:
                result = service.start(owner, course_id, assignment_id, submission.submission_id)
                prepared.append({**item, "analysisId": result["id"], "status": result["status"]})
            except ValueError as error:
                skipped.append({**item, "reason": str(error)})
            except Exception as error:
                failed.append({**item, "reason": str(error) or "analysis could not start"})
    return {"prepared": prepared, "skipped": skipped, "failed": failed}


@router.get("/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/essay-check")
def essay_check(
    course_id: str,
    assignment_id: str,
    student_id: str,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_read_service),
) -> dict[str, Any]:
    submission_id = _submission_id(service, owner, course_id, assignment_id, student_id)
    return _essay_or_error(service, owner, course_id, assignment_id, submission_id)


@router.patch("/classes/{course_id}/assignments/{assignment_id}/essay-check/reviews/{review_id:path}")
def update_review(
    course_id: str,
    assignment_id: str,
    review_id: str,
    request: ReviewUpdate,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_read_service),
) -> dict[str, Any]:
    submission_id = _submission_id(service, owner, course_id, assignment_id, request.student_id)
    essay = _essay_or_error(service, owner, course_id, assignment_id, submission_id)
    if review_id not in {review["id"] for review in essay.get("reviews", [])}:
        raise HTTPException(status_code=404, detail="review not found")
    if request.outcome not in {"not-reviewed", "supports", "contradicts", "inconclusive"}:
        raise HTTPException(status_code=422, detail="invalid professor review outcome")
    try:
        service.save_review(owner, course_id, assignment_id, submission_id, request.outcome, request.note, review_id=review_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise _map_google_error(error) from error
    return _essay_or_error(service, owner, course_id, assignment_id, submission_id)


@router.put("/classes/{course_id}/assignments/{assignment_id}/essay-check/feedback")
def save_feedback(
    course_id: str,
    assignment_id: str,
    request: FeedbackUpdate,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_read_service),
) -> dict[str, Any]:
    submission_id = _submission_id(service, owner, course_id, assignment_id, request.student_id)
    essay = _essay_or_error(service, owner, course_id, assignment_id, submission_id)
    allowed = {review["id"] for review in essay.get("reviews", [])}
    if not set(request.citation_ids).issubset(allowed):
        raise HTTPException(status_code=422, detail="feedback contains an unknown citation")
    if not set(request.sharing_options).issubset(allowed):
        raise HTTPException(status_code=422, detail="feedback sharing settings contain an unknown citation")
    try:
        service.save_feedback(owner, course_id, assignment_id, submission_id, request.body, request.citation_ids, request.sharing_options)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return _essay_or_error(service, owner, course_id, assignment_id, submission_id)


@router.post("/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/essay-check/feedback/send")
def send_feedback(
    course_id: str,
    assignment_id: str,
    student_id: str,
    request: FeedbackUpdate | None = None,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_service),
) -> dict[str, Any]:
    try:
        submission_id = _submission_id(service, owner, course_id, assignment_id, student_id)
        if request is not None:
            essay = _essay_or_error(service, owner, course_id, assignment_id, submission_id)
            allowed = {review["id"] for review in essay.get("reviews", [])}
            if not set(request.citation_ids).issubset(allowed):
                raise HTTPException(status_code=422, detail="feedback contains an unknown citation")
            if not set(request.sharing_options).issubset(allowed):
                raise HTTPException(status_code=422, detail="feedback sharing settings contain an unknown citation")
            service.save_feedback(owner, course_id, assignment_id, submission_id, request.body, request.citation_ids, request.sharing_options)
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        logger.exception(
            "Unable to prepare teacher feedback before email delivery",
            extra={"course_id": course_id, "assignment_id": assignment_id},
        )
        raise HTTPException(
            status_code=500,
            detail="Feedback could not be prepared. No email was sent. Please try again.",
        ) from error
    try:
        sent = service.send_feedback(owner, course_id, assignment_id, submission_id, request.report_html if request else None)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise _map_google_error(error) from error
    return {
        "assignmentId": assignment_id,
        "studentId": student_id,
        "status": sent.status,
        "sentAt": _iso(sent.sent_at),
    }


@router.post("/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/grade-and-return")
def grade_and_return(
    course_id: str,
    assignment_id: str,
    student_id: str,
    request: GradeAndReturnRequest,
    owner: str = Depends(require_teacher_user),
    client: GoogleClassroomClient = Depends(get_google_client),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    _owned_assignment(repository, owner, course_id, assignment_id)
    submission = next((item for item in repository.list_submissions(owner, course_id, assignment_id) if item.student_id == student_id or item.submission_id == student_id), None)
    if submission is None:
        raise HTTPException(status_code=404, detail="submission not found")
    try:
        client.patch_assigned_grade(course_id, assignment_id, submission.submission_id, request.grade)
    except Exception as error:
        raise _map_google_error(error) from error
    try:
        client.return_submission(course_id, assignment_id, submission.submission_id)
    except Exception as error:
        raise HTTPException(status_code=502, detail={"message": "grade saved but return failed", "partial": True}) from error
    try:
        repository.save_submission(replace(submission, assigned_grade=request.grade, state="RETURNED"))
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail={"message": "grade returned but local submission update failed", "partial": True},
        ) from error
    return {"submissionId": submission.submission_id, "studentId": student_id, "grade": request.grade, "status": "returned"}
