"""Owner-scoped synchronization from the Google Classroom client."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.teacher.google_client import select_supported_attachments
from app.teacher.models import TeacherCourse, TeacherCoursework, TeacherSubmission


def _due_at(value: dict[str, Any]) -> datetime | None:
    date = value.get("dueDate")
    if not isinstance(date, dict):
        return None
    try:
        due_time = value.get("dueTime") or {}
        return datetime(
            int(date["year"]), int(date["month"]), int(date["day"]),
            int(due_time.get("hours", 0)), int(due_time.get("minutes", 0)), int(due_time.get("seconds", 0)),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _name(profile: dict[str, Any] | None) -> str | None:
    if not isinstance(profile, dict):
        return None
    name = profile.get("name")
    return name.get("fullName") if isinstance(name, dict) else None


class TeacherGoogleSyncService:
    def __init__(self, *, client: Any, repository: Any):
        self.client = client
        self.repository = repository

    def import_preview(self, owner: str) -> dict[str, list[dict[str, Any]]]:
        return {"courses": self.client.list_courses()}

    def refresh_course(self, owner: str, course_id: str) -> dict[str, Any]:
        return self.import_course(owner, course_id)

    def import_course(self, owner: str, course_id: str) -> dict[str, Any]:
        course = next((item for item in self.client.list_courses() if item.get("id") == course_id), None)
        if course is None:
            raise ValueError("course not found")

        teachers = self.client.list_teachers(course_id)
        students = self.client.list_students(course_id)
        self.repository.save_course(
            TeacherCourse(
                owner=owner,
                course_id=course_id,
                name=course.get("name", ""),
                section=course.get("section"),
                description=course.get("description"),
                room=course.get("room"),
                course_state=course.get("courseState"),
                raw={**course, "teachers": teachers, "students": students},
            )
        )

        coursework = self.client.list_coursework(course_id)
        resources = (
            ("coursework", coursework),
            ("material", self.client.list_coursework_materials(course_id)),
            ("announcement", self.client.list_announcements(course_id)),
            ("topic", self.client.list_topics(course_id)),
        )
        for resource_type, items in resources:
            for item in items:
                resource_id = item.get("id") or item.get("topicId")
                if not resource_id:
                    continue
                self.repository.save_coursework(
                    TeacherCoursework(
                        owner=owner,
                        course_id=course_id,
                        coursework_id=resource_id,
                        resource_type=resource_type,
                        title=item.get("title") or item.get("name") or item.get("text"),
                        description=item.get("description"),
                        state=item.get("state"),
                        due_at=_due_at(item),
                        raw=item,
                    )
                )

        student_names = {student.get("userId"): _name(student.get("profile")) for student in students}
        submission_count = 0
        for item in coursework:
            coursework_id = item.get("id")
            if not coursework_id:
                continue
            for submission in self.client.list_student_submissions(course_id, coursework_id):
                submission_id = submission.get("id")
                student_id = submission.get("userId")
                if not submission_id or not student_id:
                    continue
                attachments, error = self._attachments(submission)
                self.repository.save_submission(
                    TeacherSubmission(
                        owner=owner,
                        course_id=course_id,
                        coursework_id=coursework_id,
                        submission_id=submission_id,
                        student_id=student_id,
                        student_name=student_names.get(student_id),
                        state=submission.get("state"),
                        assigned_grade=submission.get("assignedGrade"),
                        attachments=attachments,
                        sync_state="error" if error else "synced",
                        sync_error=error,
                        analysis_id=None,
                        raw=submission,
                    )
                )
                submission_count += 1
        return {"course_id": course_id, "submission_count": submission_count}

    def workspace(self, owner: str, course_id: str) -> dict[str, Any] | None:
        course = next(
            (item for item in self.repository.list_courses(owner) if item.owner == owner and item.course_id == course_id),
            None,
        )
        if course is None:
            return None
        coursework = [
            item.to_row()
            for item in self.repository.list_coursework(owner, course_id)
            if item.owner == owner and item.course_id == course_id
        ]
        submissions = [
            item.to_row()
            for item in self.repository.list_submissions(owner, course_id)
            if item.owner == owner and item.course_id == course_id
        ]
        return {"course": course.to_row(), "coursework": coursework, "submissions": submissions}

    def _attachments(self, submission: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
        metadata: list[dict[str, Any]] = []
        error: str | None = None
        assignment = submission.get("assignmentSubmission")
        for attachment in assignment.get("attachments", []) if isinstance(assignment, dict) else []:
            drive_file = attachment.get("driveFile") if isinstance(attachment, dict) else None
            file_id = drive_file.get("id") if isinstance(drive_file, dict) else None
            if not file_id:
                continue
            try:
                metadata.append(self.client.get_drive_metadata(file_id))
            except Exception as exc:
                error = str(exc)
        return select_supported_attachments(metadata), error
