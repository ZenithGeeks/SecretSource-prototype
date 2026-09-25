from __future__ import annotations

import pytest


class FakeGoogle:
    def list_courses(self): return [{"id": "c1", "name": "English", "courseState": "ACTIVE"}]
    def list_teachers(self, course_id): return [{"userId": "t1", "profile": {"name": {"fullName": "Teacher"}}}]
    def list_students(self, course_id): return [{"userId": "s1", "profile": {"name": {"fullName": "Ada Lovelace"}}}]
    def list_coursework(self, course_id): return [{"id": "cw1", "title": "Essay", "description": "Write", "dueDate": {"year": 2026, "month": 9, "day": 20}}]
    def list_coursework_materials(self, course_id): return [{"id": "m1", "title": "Reading"}]
    def list_announcements(self, course_id): return [{"id": "a1", "text": "Hello"}]
    def list_topics(self, course_id): return [{"topicId": "top1", "name": "Week 1"}]
    def list_student_submissions(self, course_id, coursework_id):
        return [{"id": "sub1", "userId": "s1", "state": "TURNED_IN", "assignmentSubmission": {"attachments": [{"driveFile": {"id": "doc"}}, {"driveFile": {"id": "pdf"}}]}}]
    def get_drive_metadata(self, file_id):
        return {
            "doc": {"id": "doc", "name": "draft", "mimeType": "application/vnd.google-apps.document", "webViewLink": "https://doc"},
            "pdf": {"id": "pdf", "name": "essay.pdf", "mimeType": "application/pdf", "size": "10"},
        }[file_id]


class FakeRepository:
    def __init__(self):
        self.courses, self.coursework, self.submissions = [], [], []
        self.sync_statuses = []

    def save_course(self, value): self.courses.append(value)
    def save_coursework(self, value): self.coursework.append(value)
    def save_submission(self, value): self.submissions.append(value)
    def list_courses(self, owner): return self.courses
    def list_coursework(self, owner, course_id): return self.coursework
    def list_submissions(self, owner, course_id, coursework_id=None): return self.submissions
    def get_submission(self, owner, course_id, coursework_id, submission_id):
        return next(
            (
                item for item in self.submissions
                if (item.owner, item.course_id, item.coursework_id, item.submission_id)
                == (owner, course_id, coursework_id, submission_id)
            ),
            None,
        )
    def record_sync_status(self, owner, status, error, synced_at):
        self.sync_statuses.append((owner, status, error, synced_at))


def test_import_upserts_owner_typed_raw_resources_and_prefers_pdf_attachment():
    from app.teacher.sync import TeacherGoogleSyncService

    repository = FakeRepository()
    result = TeacherGoogleSyncService(client=FakeGoogle(), repository=repository).import_course("teacher-a", "c1")

    assert result["course_id"] == "c1"
    assert repository.courses[0].owner == "teacher-a"
    assert repository.courses[0].raw["name"] == "English"
    assert {(item.resource_type, item.coursework_id) for item in repository.coursework} == {
        ("coursework", "cw1"), ("material", "m1"), ("announcement", "a1"), ("topic", "top1")
    }
    submission = repository.submissions[0]
    assert (submission.owner, submission.course_id, submission.coursework_id, submission.submission_id) == ("teacher-a", "c1", "cw1", "sub1")
    assert submission.student_name == "Ada Lovelace"
    assert submission.attachments[0]["id"] == "pdf"
    assert submission.attachments[0]["download_strategy"] == "download"
    assert submission.attachments[1]["download_strategy"] == "export_pdf"
    assert repository.sync_statuses[-1][0:3] == ("teacher-a", "synced", None)


def test_preview_refresh_and_workspace_are_scoped_to_the_requested_owner_and_course():
    from app.teacher.models import TeacherCourse, TeacherCoursework, TeacherSubmission
    from app.teacher.sync import TeacherGoogleSyncService

    repository = FakeRepository()
    repository.courses = [
        TeacherCourse("teacher-a", "c1", "English", None, None, None, None, {}),
        TeacherCourse("teacher-b", "c1", "Other", None, None, None, None, {}),
    ]
    repository.coursework = [
        TeacherCoursework("teacher-a", "c1", "cw1", "coursework", "Essay", None, None, None, {}),
        TeacherCoursework("teacher-b", "c1", "cw2", "coursework", "Hidden", None, None, None, {}),
    ]
    repository.submissions = [
        TeacherSubmission("teacher-a", "c1", "cw1", "sub1", "s1", None, None, None, [], "synced", None, None, {}),
        TeacherSubmission("teacher-b", "c1", "cw2", "sub2", "s2", None, None, None, [], "synced", None, None, {}),
    ]
    service = TeacherGoogleSyncService(client=FakeGoogle(), repository=repository)

    assert service.import_preview("teacher-a")["courses"][0]["id"] == "c1"
    workspace = service.workspace("teacher-a", "c1")
    assert [item["coursework_id"] for item in workspace["coursework"]] == ["cw1"]
    assert [item["submission_id"] for item in workspace["submissions"]] == ["sub1"]
    assert service.workspace("teacher-a", "missing") is None
    assert service.refresh_course("teacher-a", "c1")["course_id"] == "c1"


def test_import_preview_returns_available_google_courses_without_persisting_rows():
    """Break caught: the importable-course view exposes stale local rows instead of Google courses."""
    from app.teacher.sync import TeacherGoogleSyncService

    class PreviewGoogle(FakeGoogle):
        def list_courses(self):
            return [{"id": "remote-c2", "name": "Remote Biology", "courseState": "ACTIVE"}]

    repository = FakeRepository()
    result = TeacherGoogleSyncService(client=PreviewGoogle(), repository=repository).import_preview("teacher-a")

    assert result == {"courses": [{"id": "remote-c2", "name": "Remote Biology", "courseState": "ACTIVE"}]}
    assert repository.courses == []
    assert repository.coursework == []
    assert repository.submissions == []


def test_import_records_attachment_metadata_failure_without_dropping_the_submission():
    """Break caught: one unreadable Drive file loses the submission or is reported as fully synced."""
    from app.teacher.sync import TeacherGoogleSyncService

    class MetadataFailureGoogle(FakeGoogle):
        def get_drive_metadata(self, file_id):
            if file_id in {"doc", "pdf"}:
                raise RuntimeError(f"Drive metadata unavailable for {file_id}")
            return super().get_drive_metadata(file_id)

    repository = FakeRepository()
    TeacherGoogleSyncService(client=MetadataFailureGoogle(), repository=repository).import_course("teacher-a", "c1")

    submission = repository.submissions[0]
    assert submission.sync_state == "error"
    assert submission.sync_error == "Drive metadata unavailable for doc; Drive metadata unavailable for pdf"
    assert submission.attachments == []
    assert submission.raw["id"] == "sub1"


def test_import_marks_connection_error_and_reraises_a_non_drive_google_failure():
    """Break caught: a failed import leaves the owner connection marked healthy."""
    from app.teacher.sync import TeacherGoogleSyncService

    class CourseworkFailureGoogle(FakeGoogle):
        def list_coursework(self, course_id):
            raise RuntimeError("Classroom unavailable")

    repository = FakeRepository()
    with pytest.raises(RuntimeError, match="Classroom unavailable"):
        TeacherGoogleSyncService(client=CourseworkFailureGoogle(), repository=repository).import_course("teacher-a", "c1")

    assert repository.courses[0].course_id == "c1"
    assert repository.sync_statuses[-1][0:3] == ("teacher-a", "error", "Classroom unavailable")


def test_refresh_preserves_the_existing_scoped_submission_analysis_id():
    """Break caught: a Google refresh erases local analysis linked to the same submission."""
    from app.teacher.models import TeacherSubmission
    from app.teacher.sync import TeacherGoogleSyncService

    repository = FakeRepository()
    repository.submissions = [
        TeacherSubmission("teacher-a", "c1", "cw1", "sub1", "s1", None, None, None, [], "synced", None, "analysis-1", {})
    ]

    TeacherGoogleSyncService(client=FakeGoogle(), repository=repository).refresh_course("teacher-a", "c1")

    assert repository.submissions[-1].analysis_id == "analysis-1"


class FakeScopedRowsQuery:
    def __init__(self, client, table):
        self.client = client
        self.table_name = table
        self.filters = []
        self.payload = None
        self.action = "select"

    def select(self, *_columns):
        return self

    def update(self, payload):
        self.payload = payload
        self.action = "update"
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        rows = self.client.rows.get(self.table_name, [])
        matched = [row for row in rows if all(row.get(column) == value for column, value in self.filters)]
        if self.action == "update":
            for row in matched:
                row.update(self.payload)
        return type("Response", (), {"data": [row.copy() for row in matched]})()


class FakeScopedRowsClient:
    def __init__(self, rows):
        self.rows = rows

    def table(self, table):
        return FakeScopedRowsQuery(self, table)


def test_repository_read_methods_filter_by_owner_and_course():
    """Break caught: a workspace query returns another teacher's course, coursework, or submission."""
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeScopedRowsClient(
        {
                "teacher_courses": [
                    {"id": "course-row", "synced_at": "2026-09-17T00:00:00Z", "created_at": "2026-09-17T00:00:00Z", "updated_at": "2026-09-17T00:00:00Z", "owner": "teacher-a", "course_id": "c1", "name": "English", "section": None, "description": None, "room": None, "course_state": "ACTIVE", "raw": {}},
                    {"owner": "teacher-b", "course_id": "c1", "name": "Hidden", "section": None, "description": None, "room": None, "course_state": "ACTIVE", "raw": {}},
                ],
                "teacher_coursework": [
                    {"id": "coursework-row", "synced_at": "2026-09-17T00:00:00Z", "created_at": "2026-09-17T00:00:00Z", "updated_at": "2026-09-17T00:00:00Z", "owner": "teacher-a", "course_id": "c1", "coursework_id": "cw1", "resource_type": "coursework", "title": "Essay", "description": None, "state": None, "due_at": "2026-09-20T00:00:00Z", "raw": {}},
                    {"owner": "teacher-b", "course_id": "c1", "coursework_id": "cw2", "resource_type": "coursework", "title": "Hidden", "description": None, "state": None, "due_at": None, "raw": {}},
                ],
                "teacher_submissions": [
                    {"id": "submission-row", "synced_at": "2026-09-17T00:00:00Z", "created_at": "2026-09-17T00:00:00Z", "updated_at": "2026-09-17T00:00:00Z", "owner": "teacher-a", "course_id": "c1", "coursework_id": "cw1", "submission_id": "sub1", "student_id": "s1", "student_name": "Ada", "state": "TURNED_IN", "assigned_grade": 4, "attachments": [], "sync_state": "synced", "sync_error": None, "analysis_id": None, "raw": {}},
                    {"owner": "teacher-a", "course_id": "c2", "coursework_id": "cw1", "submission_id": "sub2", "student_id": "s2", "student_name": "Grace", "state": "TURNED_IN", "assigned_grade": None, "attachments": [], "sync_state": "synced", "sync_error": None, "analysis_id": None, "raw": {}},
                    {"owner": "teacher-b", "course_id": "c1", "coursework_id": "cw3", "submission_id": "sub3", "student_id": "s3", "student_name": "Hidden", "state": "TURNED_IN", "assigned_grade": None, "attachments": [], "sync_state": "synced", "sync_error": None, "analysis_id": None, "raw": {}},
                ],
                "teacher_google_connections": [
                    {"owner": "teacher-a", "last_sync_status": None, "last_sync_error": None, "last_synced_at": None},
                    {"owner": "teacher-b", "last_sync_status": None, "last_sync_error": None, "last_synced_at": None},
                ],
            }
    )
    repository = TeacherGoogleRepository(client)

    assert [course.course_id for course in repository.list_courses("teacher-a")] == ["c1"]
    assert [coursework.coursework_id for coursework in repository.list_coursework("teacher-a", "c1")] == ["cw1"]
    assert [submission.submission_id for submission in repository.list_submissions("teacher-a", "c1")] == ["sub1"]
    assert repository.list_submissions("teacher-a", "c1", "missing") == []
    assert repository.list_coursework("teacher-a", "c1")[0].due_at.isoformat() == "2026-09-20T00:00:00+00:00"
    assert repository.list_submissions("teacher-a", "c1")[0].assigned_grade == 4.0
    repository.record_sync_status("teacher-a", "synced", None, "2026-09-17T01:00:00Z")
    assert client.rows["teacher_google_connections"] == [
        {"owner": "teacher-a", "last_sync_status": "synced", "last_sync_error": None, "last_synced_at": "2026-09-17T01:00:00Z"},
        {"owner": "teacher-b", "last_sync_status": None, "last_sync_error": None, "last_synced_at": None},
    ]
