from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient


def _fixtures():
    from app.teacher.models import TeacherCourse, TeacherCoursework, TeacherSubmission

    course = TeacherCourse(
        "teacher-a", "course-1", "Research Methods", "A", "Methods", "101", "ACTIVE",
        {"teachers": [{"userId": "teacher-a", "courseOwner": True, "profile": {"name": {"fullName": "Ada"}}}], "students": [{"userId": "student-1", "profile": {"name": {"fullName": "Grace"}}}]},
    )
    assignment = TeacherCoursework(
        "teacher-a", "course-1", "work-1", "coursework", "Essay", "Write one", "PUBLISHED", None,
        {"id": "work-1", "materials": [{"driveFile": {"driveFile": {"id": "file-1", "title": "Essay.pdf", "webViewLink": "https://drive.test/file-1"}}}]},
    )
    submission = TeacherSubmission(
        "teacher-a", "course-1", "work-1", "submission-1", "student-1", "Grace", "TURNED_IN", None,
        [{"id": "file-1", "name": "Essay.pdf", "mimeType": "application/pdf", "webViewLink": "https://drive.test/file-1"}],
        "synced", None, "analysis-1", {"updateTime": "2026-09-17T01:00:00Z"},
    )
    return course, assignment, submission


class FakeRepository:
    def __init__(self):
        self.course, self.assignment, self.submission = _fixtures()
        self.reviews = []
        self.feedback = None
        self.deleted = False

    def list_courses(self, owner):
        return [self.course] if owner == "teacher-a" else []

    def list_coursework(self, owner, course_id):
        return [self.assignment] if owner == "teacher-a" and course_id == "course-1" else []

    def list_submissions(self, owner, course_id, coursework_id=None):
        if owner != "teacher-a" or course_id != "course-1" or coursework_id not in (None, "work-1"):
            return []
        return [self.submission]

    def get_submission(self, owner, course_id, coursework_id, submission_id):
        return next((item for item in self.list_submissions(owner, course_id, coursework_id) if item.submission_id == submission_id), None)

    def get_professor_reviews(self, *args):
        return list(self.reviews)

    def get_professor_review(self, *args):
        return self.reviews[0] if self.reviews else None

    def save_professor_review(self, review):
        self.reviews[:] = [item for item in self.reviews if item.review_id != review.review_id]
        self.reviews.append(review)

    def get_feedback(self, *args):
        return self.feedback

    def save_feedback(self, feedback):
        self.feedback = feedback

    def get_connection_status(self, owner):
        return None

    def disconnect(self, owner):
        return True

    def delete_owner_data(self, owner):
        self.deleted = True


class FakeGoogle:
    def __init__(self, fail_return=False):
        self.patched = []
        self.returned = []
        self.fail_return = fail_return

    def patch_assigned_grade(self, course_id, coursework_id, submission_id, grade):
        self.patched.append((course_id, coursework_id, submission_id, grade))

    def return_submission(self, course_id, coursework_id, submission_id):
        if self.fail_return:
            raise RuntimeError("return unavailable")
        self.returned.append((course_id, coursework_id, submission_id))


@pytest.fixture
def teacher_client(monkeypatch):
    from app import main
    from app.teacher import analysis
    from app.teacher import router as teacher_router_module

    repository = FakeRepository()
    analyses = {"analysis-1": {"id": "analysis-1", "status": "done", "claims": [{
        "claim": "The result is supported.",
        "citations": [{"doi": "10.1/example", "title": "Example", "url": "https://doi.org/10.1/example"}],
        "verdicts": [{"cited": "10.1/example", "verdict": "supports", "quote": "It works.", "evidence": [{"page": 2}] }],
    }]}}
    analysis_service = analysis.TeacherEssayAnalysisService(
        client=FakeGoogle(), repository=repository, analysis_lookup=analyses.get,
    )
    google = FakeGoogle()
    main.app.dependency_overrides[teacher_router_module.require_teacher_user] = lambda: "teacher-a"
    main.app.dependency_overrides[teacher_router_module.get_repository] = lambda: repository
    main.app.dependency_overrides[teacher_router_module.get_analysis_read_service] = lambda: analysis_service
    main.app.dependency_overrides[teacher_router_module.get_google_client] = lambda: google
    client = TestClient(main.app)
    yield client, repository, google
    main.app.dependency_overrides.clear()


def test_teacher_reads_are_owner_scoped_and_map_assignment_and_essay_contract(teacher_client):
    client, _, _ = teacher_client

    workspace = client.get("/api/teacher/classes/course-1/workspace")
    assert workspace.status_code == 200
    assert workspace.json()["course"]["name"] == "Research Methods"
    assert workspace.json()["assignments"][0]["id"] == "work-1"

    detail = client.get("/api/teacher/classes/course-1/assignments/work-1")
    assert detail.status_code == 200
    assert detail.json()["submissions"][0]["studentId"] == "student-1"

    essay = client.get("/api/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check")
    assert essay.status_code == 200
    assert essay.json()["reviews"][0]["standing"] == "supports"
    assert essay.json()["reviews"][0]["sourceLocation"] == "p.2"


def test_teacher_review_feedback_and_grade_return_mutations_are_scoped(teacher_client):
    client, repository, google = teacher_client
    review_id = "claim-0:10.1/example"

    reviewed = client.patch(
        f"/api/teacher/classes/course-1/assignments/work-1/essay-check/reviews/{quote(review_id, safe='')}",
        json={"studentId": "student-1", "outcome": "supports", "note": "Checked."},
    )
    assert reviewed.status_code == 200
    assert repository.reviews[0].review_id == review_id

    saved = client.put(
        "/api/teacher/classes/course-1/assignments/work-1/essay-check/feedback",
        json={"studentId": "student-1", "body": "Good work.", "citationIds": [review_id]},
    )
    assert saved.status_code == 200
    assert saved.json()["feedback"]["citationIds"] == [review_id]

    sent = client.post(
        "/api/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check/feedback/send",
        json={"studentId": "student-1", "body": "Good work.", "citationIds": [review_id]},
    )
    assert sent.status_code == 200
    assert sent.json()["status"] == "sent"

    graded = client.post(
        "/api/teacher/classes/course-1/assignments/work-1/students/student-1/grade-and-return",
        json={"grade": 9},
    )
    assert graded.status_code == 200
    assert google.patched == [("course-1", "work-1", "submission-1", 9.0)]
    assert google.returned == [("course-1", "work-1", "submission-1")]


def test_grade_and_return_reports_partial_failure_after_grade_patch(teacher_client):
    client, _, _ = teacher_client
    from app import main
    from app.teacher import router as teacher_router_module

    failing = FakeGoogle(fail_return=True)
    main.app.dependency_overrides[teacher_router_module.get_google_client] = lambda: failing
    response = client.post(
        "/api/teacher/classes/course-1/assignments/work-1/students/student-1/grade-and-return",
        json={"grade": 8},
    )
    assert response.status_code == 502
    assert response.json()["detail"]["partial"] is True
