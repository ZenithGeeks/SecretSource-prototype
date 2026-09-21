"""Authenticated HTTP boundary for the Teacher Google Classroom workspace."""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app import config
from app.auth import current_user
from app.teacher.analysis import TeacherEssayAnalysisService
from app.teacher.crypto import RefreshTokenCipher
from app.teacher.google_client import GoogleApiError, GoogleClassroomClient
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


class ReviewUpdate(BaseModel):
    student_id: str = Field(alias="studentId")
    outcome: str
    note: str = ""

    model_config = {"populate_by_name": True}


class FeedbackUpdate(BaseModel):
    student_id: str = Field(alias="studentId")
    body: str = ""
    citation_ids: list[str] = Field(default_factory=list, alias="citationIds")

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


def _essay_or_error(service: TeacherEssayAnalysisService, owner: str, course_id: str, assignment_id: str, student_id: str) -> dict[str, Any]:
    submission_id = _submission_id(service, owner, course_id, assignment_id, student_id)
    try:
        return service.essay_check(owner, course_id, assignment_id, submission_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/google/connect")
def google_connect(
    owner: str = Depends(require_teacher_user),
    service: TeacherGoogleOAuthService = Depends(get_oauth_service),
) -> dict[str, str]:
    try:
        authorization = service.start_authorization(owner)
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
    return RedirectResponse(os.getenv("TEACHER_GOOGLE_SUCCESS_REDIRECT", "/"), status_code=303)


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
    delete_owner_data: Callable[[str], None] | None = getattr(repository, "delete_owner_data", None)
    if delete_owner_data is not None:
        delete_owner_data(owner)
    else:
        repository.disconnect(owner)
    return {"connected": False, "deleted": True}


@router.get("/home")
def teacher_home(
    owner: str = Depends(require_teacher_user),
    repository: TeacherGoogleRepository = Depends(get_repository),
) -> dict[str, Any]:
    courses = repository.list_courses(owner)
    course = courses[0] if courses else None
    coursework = repository.list_coursework(owner, course.course_id) if course else []
    assignments = [item for item in coursework if item.resource_type == "coursework"]
    submissions = repository.list_submissions(owner, course.course_id) if course else []
    checked = sum(bool(item.analysis_id) for item in submissions)
    selected_assignment = assignments[0] if assignments else None
    selected_submissions = [item for item in submissions if selected_assignment and item.coursework_id == selected_assignment.coursework_id]
    return {
        "user": owner,
        "course": course.name if course else "",
        "courseId": course.course_id if course else "",
        "checkedEssays": checked,
        "totalEssays": len(submissions),
        "citationsNeedingAttention": checked,
        "assignment": selected_assignment.title if selected_assignment else "",
        "assignmentId": selected_assignment.coursework_id if selected_assignment else "",
        "submissions": [
            {
                **_submission_view(item),
                "initial": _initials(item.student_name or item.student_id),
                "summary": "Ready for review" if item.analysis_id else "Not checked yet",
                "standing": "unchecked",
            }
            for item in selected_submissions
        ],
        "library": {"paperCount": checked, "visibility": "Private to this teacher", "papers": []},
        "mostMisusedSource": None,
    }


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
def analyze_submission(
    course_id: str,
    assignment_id: str,
    student_id: str,
    verify: bool = Query(True),
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_service),
) -> dict[str, Any]:
    submission_id = student_id
    try:
        # Classroom's submission id is the durable identifier, while the Teacher URL uses
        # the student id. This accepts the common one-submission-per-student shape and gives
        # the route a stable lookup without exposing another public identifier.
        submission_id = _submission_id(service, owner, course_id, assignment_id, student_id)
        return service.start(owner, course_id, assignment_id, submission_id, verify=verify)
    except HTTPException:
        raise
    except ValueError as error:
        detail = str(error)
        raise HTTPException(status_code=409 if "supported Drive" in detail else 404, detail=detail) from error
    except Exception as error:
        raise _map_google_error(error) from error


@router.get("/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/essay-check")
def essay_check(
    course_id: str,
    assignment_id: str,
    student_id: str,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_read_service),
) -> dict[str, Any]:
    return _essay_or_error(service, owner, course_id, assignment_id, student_id)


@router.patch("/classes/{course_id}/assignments/{assignment_id}/essay-check/reviews/{review_id:path}")
def update_review(
    course_id: str,
    assignment_id: str,
    review_id: str,
    request: ReviewUpdate,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_read_service),
) -> dict[str, Any]:
    essay = _essay_or_error(service, owner, course_id, assignment_id, request.student_id)
    if review_id not in {review["id"] for review in essay.get("reviews", [])}:
        raise HTTPException(status_code=404, detail="review not found")
    if request.outcome not in {"not-reviewed", "supports", "contradicts", "inconclusive"}:
        raise HTTPException(status_code=422, detail="invalid professor review outcome")
    try:
        service.save_review(owner, course_id, assignment_id, _submission_id(service, owner, course_id, assignment_id, request.student_id), request.outcome, request.note, review_id=review_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return _essay_or_error(service, owner, course_id, assignment_id, request.student_id)


@router.put("/classes/{course_id}/assignments/{assignment_id}/essay-check/feedback")
def save_feedback(
    course_id: str,
    assignment_id: str,
    request: FeedbackUpdate,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_read_service),
) -> dict[str, Any]:
    essay = _essay_or_error(service, owner, course_id, assignment_id, request.student_id)
    allowed = {review["id"] for review in essay.get("reviews", [])}
    if not set(request.citation_ids).issubset(allowed):
        raise HTTPException(status_code=422, detail="feedback contains an unknown citation")
    try:
        service.save_feedback(owner, course_id, assignment_id, _submission_id(service, owner, course_id, assignment_id, request.student_id), request.body, request.citation_ids)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return _essay_or_error(service, owner, course_id, assignment_id, request.student_id)


@router.post("/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/essay-check/feedback/send")
def send_feedback(
    course_id: str,
    assignment_id: str,
    student_id: str,
    request: FeedbackUpdate | None = None,
    owner: str = Depends(require_teacher_user),
    service: TeacherEssayAnalysisService = Depends(get_analysis_read_service),
) -> dict[str, Any]:
    if request is not None:
        essay = _essay_or_error(service, owner, course_id, assignment_id, student_id)
        allowed = {review["id"] for review in essay.get("reviews", [])}
        if not set(request.citation_ids).issubset(allowed):
            raise HTTPException(status_code=422, detail="feedback contains an unknown citation")
        try:
            service.save_feedback(owner, course_id, assignment_id, _submission_id(service, owner, course_id, assignment_id, student_id), request.body, request.citation_ids)
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
    try:
        sent = service.send_feedback(owner, course_id, assignment_id, _submission_id(service, owner, course_id, assignment_id, student_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
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
    return {"submissionId": submission.submission_id, "studentId": student_id, "grade": request.grade, "status": "returned"}
