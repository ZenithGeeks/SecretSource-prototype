from __future__ import annotations

from dataclasses import replace
from inspect import iscoroutinefunction
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
        student_email="grace@example.edu",
    )
    return course, assignment, submission


class FakeRepository:
    def __init__(self):
        self.course, self.assignment, self.submission = _fixtures()
        self.reviews = []
        self.feedback = None
        self.review_activity = []
        self.feedback_activity = []
        self.deleted = False
        self.disconnected = []
        self.list_submissions_calls = 0
        self.fail_feedback_save = False
        self.fail_feedback_read = False

    def list_courses(self, owner):
        return [self.course] if owner == "teacher-a" else []

    def list_coursework(self, owner, course_id):
        return [self.assignment] if owner == "teacher-a" and course_id == "course-1" else []

    def list_submissions(self, owner, course_id, coursework_id=None):
        self.list_submissions_calls += 1
        if owner != "teacher-a" or course_id != "course-1" or coursework_id not in (None, "work-1"):
            return []
        return [self.submission]

    def get_submission(self, owner, course_id, coursework_id, submission_id):
        if (
            owner == "teacher-a"
            and course_id == "course-1"
            and coursework_id == "work-1"
            and submission_id == self.submission.submission_id
        ):
            return self.submission
        return None

    def get_professor_reviews(self, *args):
        return list(self.reviews)

    def list_professor_review_activity(self, owner):
        return [item for item in self.review_activity if item.get("owner") == owner]

    def get_professor_review(self, *args):
        return self.reviews[0] if self.reviews else None

    def save_professor_review(self, review):
        self.reviews[:] = [item for item in self.reviews if item.review_id != review.review_id]
        self.reviews.append(review)

    def get_feedback(self, *args):
        if self.fail_feedback_read:
            raise RuntimeError("database read failed")
        return self.feedback

    def list_feedback_activity(self, owner):
        return [item for item in self.feedback_activity if item.get("owner") == owner]

    def save_feedback(self, feedback):
        if self.fail_feedback_save:
            raise RuntimeError("database write failed")
        self.feedback = feedback

    def save_submission(self, submission):
        self.submission = submission

    def link_submission_analysis(self, owner, course_id, coursework_id, submission_id, analysis_id, **version):
        self.submission = replace(self.submission, analysis_id=analysis_id, **{
            "analysis_file_id": version.get("file_id"),
            "analysis_file_version": version.get("file_version"),
        })

    def get_connection_status(self, owner):
        return None

    def disconnect(self, owner):
        self.disconnected.append(owner)
        return True


class FakeGoogle:
    def __init__(self, fail_return=False):
        self.patched = []
        self.returned = []
        self.fail_return = fail_return
        self.sent_emails = []
        self.downloads = []

    def get_drive_metadata(self, file_id):
        return {"id": file_id, "version": "1"}

    def download_drive_file(self, file_id):
        self.downloads.append(file_id)
        return b"pdf bytes"

    def send_feedback_email(self, recipient, subject, body, report_html=None):
        self.sent_emails.append((recipient, subject, body, report_html))
        return {"id": "message-1"}

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
    google = FakeGoogle()
    analysis_starts = []
    repository.analysis_starts = analysis_starts
    analysis_service = analysis.TeacherEssayAnalysisService(
        client=google, repository=repository, analysis_lookup=analyses.get,
        save_upload=lambda _content, filename: __import__("pathlib").Path(filename),
        start=lambda _path, _verify, _owner: analysis_starts.append("start") or {"id": f"prepared-{len(analysis_starts)}"},
    )
    main.app.dependency_overrides[teacher_router_module.require_teacher_user] = lambda: "teacher-a"
    main.app.dependency_overrides[teacher_router_module.get_repository] = lambda: repository
    main.app.dependency_overrides[teacher_router_module.get_analysis_read_service] = lambda: analysis_service
    main.app.dependency_overrides[teacher_router_module.get_analysis_service] = lambda: analysis_service
    main.app.dependency_overrides[teacher_router_module.get_google_client] = lambda: google
    client = TestClient(main.app)
    yield client, repository, google
    main.app.dependency_overrides.clear()


def test_teacher_reads_are_owner_scoped_and_map_assignment_and_essay_contract(teacher_client):
    client, _, _ = teacher_client

    workspace = client.get("/teacher/classes/course-1/workspace")
    assert workspace.status_code == 200
    assert workspace.json()["course"]["name"] == "Research Methods"
    assert workspace.json()["assignments"][0]["id"] == "work-1"

    detail = client.get("/teacher/classes/course-1/assignments/work-1")
    assert detail.status_code == 200
    assert detail.json()["submissions"][0]["studentId"] == "student-1"

    essay = client.get("/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check")
    assert essay.status_code == 200
    assert essay.json()["reviews"][0]["standing"] == "supports"
    assert essay.json()["reviews"][0]["sourceLocation"] == "p.2"


def test_teacher_history_lists_completed_analysis_and_saved_teacher_activity(teacher_client, monkeypatch):
    from app import main

    client, repository, _ = teacher_client
    _, _, first = _fixtures()
    second = replace(
        first,
        submission_id="submission-2",
        student_id="student-2",
        student_name="Lin",
        analysis_id=None,
        attachments=[{"id": "file-2", "name": "Lin essay.pdf", "mimeType": "application/pdf"}],
    )
    other_teacher = replace(
        first,
        submission_id="submission-3",
        student_id="student-3",
        student_name="Mali",
        analysis_id="another-teacher-analysis",
    )
    still_running = replace(
        first,
        submission_id="submission-4",
        student_id="student-4",
        analysis_id="analysis-running",
    )
    repository.list_submissions = lambda owner, course_id, coursework_id=None: [first, second, other_teacher, still_running]
    repository.review_activity = [
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "submission-2", "updated_at": "2026-09-20T12:00:00+00:00"},
        {"owner": "teacher-b", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "submission-2", "updated_at": "2026-09-25T12:00:00+00:00"},
    ]
    repository.feedback_activity = [
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "submission-2", "feedback_text": "Good evidence.", "status": "draft", "updated_at": "2026-09-21T12:00:00+00:00", "sent_at": None},
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "submission-4", "feedback_text": "   ", "status": "draft", "updated_at": "2026-09-25T12:00:00+00:00", "sent_at": None},
    ]
    monkeypatch.setattr(main, "analyses", {
        "analysis-1": {"id": "analysis-1", "owner": "teacher-a", "status": "done", "started": "2026-09-19T12:00:00+00:00", "completed": "2026-09-22T12:00:00+00:00"},
        "another-teacher-analysis": {"id": "another-teacher-analysis", "owner": "teacher-b", "status": "done", "started": "2026-09-22T12:00:00+00:00"},
        "analysis-running": {"id": "analysis-running", "owner": "teacher-a", "status": "running", "started": "2026-09-23T12:00:00+00:00"},
    })

    response = client.get("/teacher/history")

    assert response.status_code == 200
    rows = response.json()
    assert [row["studentId"] for row in rows] == ["student-1", "student-2"]
    assert rows[0]["checkedAt"] == "2026-09-22T12:00:00+00:00"
    assert rows[0]["analysisId"] == "analysis-1"
    assert rows[0]["activity"] == ["analysis"]
    assert rows[1]["checkedAt"] == "2026-09-21T12:00:00+00:00"
    assert rows[1]["activity"] == ["professor-review", "feedback"]
    assert rows[1]["courseName"] == "Research Methods"
    assert rows[1]["assignmentTitle"] == "Essay"


def test_teacher_review_feedback_and_grade_return_mutations_are_scoped(teacher_client):
    client, repository, google = teacher_client
    review_id = "claim-0:10.1/example:0"

    reviewed = client.patch(
        f"/teacher/classes/course-1/assignments/work-1/essay-check/reviews/{quote(review_id, safe='')}",
        json={"studentId": "student-1", "outcome": "supports", "note": "Checked."},
    )
    assert reviewed.status_code == 200
    assert repository.reviews[0].review_id == review_id

    saved = client.put(
        "/teacher/classes/course-1/assignments/work-1/essay-check/feedback",
        json={"studentId": "student-1", "body": "Good work.", "citationIds": [review_id]},
    )
    assert saved.status_code == 200
    assert saved.json()["feedback"]["citationIds"] == [review_id]

    sent = client.post(
        "/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check/feedback/send",
        json={"studentId": "student-1", "body": "Good work.", "citationIds": [review_id], "reportHtml": "<h1>Feedback</h1>"},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "sent"
    assert google.sent_emails == [("grace@example.edu", "Essay feedback for work-1", "Good work.", "<h1>Feedback</h1>")]

    graded = client.post(
        "/teacher/classes/course-1/assignments/work-1/students/student-1/grade-and-return",
        json={"grade": 9},
    )
    assert graded.status_code == 200
    assert google.patched == [("course-1", "work-1", "submission-1", 9.0)]
    assert google.returned == [("course-1", "work-1", "submission-1")]
    assert repository.submission.assigned_grade == 9
    assert repository.submission.state == "RETURNED"


def test_update_review_resolves_the_submission_once(teacher_client):
    client, repository, _ = teacher_client
    essay = client.get("/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check")
    review_id = essay.json()["reviews"][0]["id"]
    repository.list_submissions_calls = 0

    response = client.patch(
        f"/teacher/classes/course-1/assignments/work-1/essay-check/reviews/{quote(review_id, safe='')}",
        json={"studentId": "student-1", "outcome": "supports", "note": "Checked."},
    )

    assert response.status_code == 200
    assert repository.list_submissions_calls == 1


def test_google_disconnect_removes_the_connection_without_deleting_imported_data(teacher_client):
    client, repository, _ = teacher_client

    response = client.delete("/teacher/google")

    assert response.status_code == 200
    assert response.json() == {
        "connected": False,
        "connectionDeleted": True,
        "importedDataDeleted": False,
    }
    assert repository.disconnected == ["teacher-a"]
    assert repository.deleted is False


def test_recheck_route_forces_a_new_analysis_for_the_same_file(teacher_client):
    client, repository, google = teacher_client
    repository.submission = replace(repository.submission, analysis_file_id="file-1", analysis_file_version="1")
    path = "/teacher/classes/course-1/assignments/work-1/students/student-1/analyze"
    cached = client.post(path)
    assert cached.status_code == 200
    assert cached.json()["id"] == "analysis-1"
    assert repository.analysis_starts == []

    response = client.post(path + "?force=true")
    assert response.status_code == 200, response.text
    assert response.json()["id"] == "prepared-1"
    assert repository.analysis_starts == ["start"]
    assert google.downloads == ["file-1"]


def test_analyze_submission_runs_on_the_event_loop():
    """Break caught: the analysis route runs in FastAPI's worker thread without an event loop."""
    from app.teacher.router import analyze_submission

    assert iscoroutinefunction(analyze_submission)


def test_prepare_selected_classwork_starts_analysis_for_each_single_pdf_submission(teacher_client):
    client, repository, google = teacher_client

    response = client.post(
        "/teacher/classes/course-1/essay-checks:prepare",
        json={"assignmentIds": ["work-1", "work-1"]},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "prepared": [{"assignmentId": "work-1", "submissionId": "submission-1", "studentId": "student-1", "studentName": "Grace", "analysisId": "prepared-1", "status": "running"}],
        "skipped": [],
        "failed": [],
    }
    assert repository.analysis_starts == ["start"]
    assert google.downloads == ["file-1"]
    assert repository.submission.analysis_id == "prepared-1"


def test_prepare_selected_classwork_skips_ambiguous_pdf_submissions(teacher_client):
    client, repository, google = teacher_client
    repository.submission = replace(repository.submission, attachments=[
        {"id": "draft-a", "name": "draft-a.pdf", "mimeType": "application/pdf"},
        {"id": "draft-b", "name": "draft-b.pdf", "mimeType": "application/pdf"},
    ])

    response = client.post("/teacher/classes/course-1/essay-checks:prepare", json={"assignmentIds": ["work-1"]})

    assert response.status_code == 200
    assert response.json()["prepared"] == []
    assert response.json()["skipped"] == [{
        "assignmentId": "work-1", "submissionId": "submission-1", "studentId": "student-1",
        "studentName": "Grace", "reason": "submission must contain exactly one PDF attachment",
    }]
    assert repository.analysis_starts == []
    assert google.downloads == []


def test_feedback_is_not_marked_sent_without_student_email(teacher_client):
    client, repository, _ = teacher_client
    repository.submission = replace(repository.submission, student_email=None)

    response = client.post(
        "/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check/feedback/send",
        json={"studentId": "student-1", "body": "Please revise.", "citationIds": []},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "student email is unavailable; refresh Classroom student email access"
    assert repository.feedback.status == "draft"


def test_feedback_send_reports_draft_save_failure_without_attempting_email(teacher_client):
    client, repository, google = teacher_client
    repository.fail_feedback_save = True

    response = client.post(
        "/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check/feedback/send",
        json={"studentId": "student-1", "body": "Please revise.", "citationIds": []},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Feedback could not be prepared. No email was sent. Please try again."
    assert google.sent_emails == []


def test_feedback_send_reports_feedback_read_failure_without_attempting_email(teacher_client):
    client, repository, google = teacher_client
    repository.fail_feedback_read = True

    response = client.post(
        "/teacher/classes/course-1/assignments/work-1/students/student-1/essay-check/feedback/send",
        json={"studentId": "student-1", "body": "Please revise.", "citationIds": []},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Feedback could not be prepared. No email was sent. Please try again."
    assert google.sent_emails == []


def test_essay_review_citation_ids_are_unique_even_when_citations_have_no_identifiers():
    from app.teacher.analysis import TeacherEssayAnalysisService

    _, _, submission = _fixtures()
    repository = FakeRepository()
    repository.submission = submission
    service = TeacherEssayAnalysisService(
        client=FakeGoogle(),
        repository=repository,
        analysis_lookup=lambda _analysis_id: {
            "status": "done",
            "claims": [{"claim": "A claim", "citations": [{}, {}]}],
        },
    )

    essay = service.essay_check("teacher-a", "course-1", "work-1", "submission-1")

    assert [review["id"] for review in essay["reviews"]] == ["claim-0::0", "claim-0::1"]


def test_grade_and_return_reports_partial_failure_after_grade_patch(teacher_client):
    client, _, _ = teacher_client
    from app import main
    from app.teacher import router as teacher_router_module

    failing = FakeGoogle(fail_return=True)
    main.app.dependency_overrides[teacher_router_module.get_google_client] = lambda: failing
    response = client.post(
        "/teacher/classes/course-1/assignments/work-1/students/student-1/grade-and-return",
        json={"grade": 8},
    )
    assert response.status_code == 502
    assert response.json()["detail"]["partial"] is True


class _ImportClient:
    def list_students(self, course_id):
        return [{"userId": "s1"}, {"userId": "s2"}]

    def list_teachers(self, course_id):
        return [{"userId": "t1", "profile": {"name": {"fullName": "Ada"}}}]

    def list_coursework(self, course_id):
        link = {"link": {"url": "https://example.test/a", "title": "A"}}
        return [{"id": "w1", "materials": [link]}, {"id": "w2"}]

    def list_coursework_materials(self, course_id):
        return [{"id": "m1", "materials": [{"link": {"url": "https://example.test/b"}}]}]

    def list_announcements(self, course_id):
        return [{"id": "n1", "text": "hi"}]

    def list_topics(self, course_id):
        return [{"topicId": "t1", "name": "Unit 1"}]


class _ImportService:
    client = _ImportClient()

    def import_preview(self, owner):
        return {"courses": [{"id": "course-9", "name": "Biology", "section": "B"}]}


@pytest.fixture
def import_client():
    from app import main
    from app.teacher import router as teacher_router_module

    main.app.dependency_overrides[teacher_router_module.require_teacher_user] = lambda: "teacher-a"
    main.app.dependency_overrides[teacher_router_module.get_sync_service] = lambda: _ImportService()
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


COUNT_FIELDS = ("assignmentCount", "topicCount", "announcementCount", "linkedFileCount")


def test_import_preview_returns_real_classroom_counts(import_client):
    response = import_client.get("/teacher/classes/importable/course-9/preview")

    assert response.status_code == 200
    course = response.json()["course"]
    assert course["assignmentCount"] == 2
    assert course["topicCount"] == 1
    assert course["announcementCount"] == 1
    assert course["linkedFileCount"] == 2
    assert course["studentCount"] == 2


def test_importable_list_does_not_pretend_to_know_counts(import_client):
    response = import_client.get("/teacher/classes/importable")

    assert response.status_code == 200
    [course] = response.json()
    assert course["name"] == "Biology"
    assert all(course[field] is None for field in COUNT_FIELDS)
