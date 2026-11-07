from __future__ import annotations

import base64
from email import message_from_bytes

import pytest


class HttpFailure(Exception):
    def __init__(self, status: int, message: str = "Google failed"):
        super().__init__(message)
        self.resp = type("Response", (), {"status": status})()


class Request:
    def __init__(self, response):
        self._response = response

    def execute(self):
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


class Resource:
    def __init__(self, responses, calls, name="courses"):
        self.responses = responses
        self.calls = calls
        self.name = name

    def _child(self, name):
        return Resource(self.responses, self.calls, name)

    def teachers(self): return self._child("teachers")
    def students(self): return self._child("students")
    def courseWork(self): return self._child("coursework")
    def courseWorkMaterials(self): return self._child("materials")
    def announcements(self): return self._child("announcements")
    def topics(self): return self._child("topics")
    def studentSubmissions(self): return self._child("submissions")

    def list(self, **kwargs):
        self.calls.append((self.name, "list", kwargs))
        return Request(self.responses[self.name].pop(0))

    def get(self, **kwargs):
        self.calls.append((self.name, "get", kwargs))
        return Request(self.responses[self.name].pop(0))

    def get_media(self, **kwargs):
        self.calls.append((self.name, "get_media", kwargs))
        return Request(self.responses[self.name].pop(0))

    def export_media(self, **kwargs):
        self.calls.append((self.name, "export_media", kwargs))
        return Request(self.responses[self.name].pop(0))

    def patch(self, **kwargs):
        self.calls.append((self.name, "patch", kwargs))
        return Request(self.responses[self.name].pop(0))

    def return_(self, **kwargs):
        self.calls.append((self.name, "return", kwargs))
        return Request(self.responses[self.name].pop(0))


class Classroom:
    def __init__(self, responses, calls):
        self._root = Resource(responses, calls)

    def courses(self):
        return self._root


class Drive:
    def __init__(self, responses, calls):
        self._root = Resource(responses, calls, "drive")

    def files(self):
        return self._root


class Gmail:
    def __init__(self, calls):
        self.calls = calls

    def users(self):
        return self

    def messages(self):
        return self

    def send(self, **kwargs):
        self.calls.append(("gmail", "send", kwargs))
        return Request({"id": "gmail-message-1"})


def test_client_traverses_every_classroom_collection_page():
    from app.teacher.google_client import GoogleClassroomClient

    responses = {
        "courses": [{"courses": [{"id": "c1"}], "nextPageToken": "next"}, {"courses": [{"id": "c2"}]}],
        "teachers": [{"teachers": [{"userId": "t1"}], "nextPageToken": "next"}, {"teachers": [{"userId": "t2"}]}],
        "students": [{"students": [{"userId": "s1"}], "nextPageToken": "next"}, {"students": [{"userId": "s2"}]}],
        "coursework": [{"courseWork": [{"id": "cw1"}], "nextPageToken": "next"}, {"courseWork": [{"id": "cw2"}]}],
        "materials": [{"courseWorkMaterial": [{"id": "m1"}], "nextPageToken": "next"}, {"courseWorkMaterial": [{"id": "m2"}]}],
        "announcements": [{"announcements": [{"id": "a1"}], "nextPageToken": "next"}, {"announcements": [{"id": "a2"}]}],
        "topics": [{"topic": [{"topicId": "top1"}], "nextPageToken": "next"}, {"topic": [{"topicId": "top2"}]}],
        "submissions": [{"studentSubmissions": [{"id": "sub1"}], "nextPageToken": "next"}, {"studentSubmissions": [{"id": "sub2"}]}],
    }
    calls = []
    client = GoogleClassroomClient(Classroom(responses, calls), Drive({"drive": []}, calls))

    assert [course["id"] for course in client.list_courses()] == ["c1", "c2"]
    assert [teacher["userId"] for teacher in client.list_teachers("c1")] == ["t1", "t2"]
    assert [student["userId"] for student in client.list_students("c1")] == ["s1", "s2"]
    assert [work["id"] for work in client.list_coursework("c1")] == ["cw1", "cw2"]
    assert [material["id"] for material in client.list_coursework_materials("c1")] == ["m1", "m2"]
    assert [announcement["id"] for announcement in client.list_announcements("c1")] == ["a1", "a2"]
    assert [topic["topicId"] for topic in client.list_topics("c1")] == ["top1", "top2"]
    assert [submission["id"] for submission in client.list_student_submissions("c1", "cw1")] == ["sub1", "sub2"]
    for resource in ("courses", "teachers", "students", "coursework", "materials", "announcements", "topics", "submissions"):
        assert [call[2].get("pageToken") for call in calls if call[0] == resource] == [None, "next"]


def test_transient_google_errors_retry_with_injected_bounded_backoff():
    from app.teacher.google_client import GoogleClassroomClient

    calls, sleeps = [], []
    responses = {"courses": [HttpFailure(429), HttpFailure(503), {"courses": [{"id": "c1"}]}]}
    client = GoogleClassroomClient(
        Classroom(responses, calls), Drive({"drive": []}, calls), attempts=3, backoff_seconds=0.25, sleep=sleeps.append
    )

    assert client.list_courses() == [{"id": "c1"}]
    assert sleeps == [0.25, 0.5]


def test_authorization_error_is_normalized_without_a_retry():
    from app.teacher.google_client import GoogleApiError, GoogleClassroomClient

    calls = []
    client = GoogleClassroomClient(
        Classroom({"courses": [HttpFailure(403, "forbidden")]}, calls), Drive({"drive": []}, calls), sleep=lambda _: None
    )

    with pytest.raises(GoogleApiError, match="permission denied") as error:
        client.list_courses()
    assert error.value.status_code == 403
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("status", "message"),
    [(401, "authentication failed"), (404, "resource not found"), (500, "temporarily unavailable")],
)
def test_google_status_errors_are_normalized(status, message):
    """Break caught: raw Google HTTP failures escape the client boundary."""
    from app.teacher.google_client import GoogleApiError, GoogleClassroomClient

    calls, sleeps = [], []
    client = GoogleClassroomClient(
        Classroom({"courses": [HttpFailure(status)] * 3}, calls),
        Drive({"drive": []}, calls),
        attempts=3,
        sleep=sleeps.append,
    )

    with pytest.raises(GoogleApiError, match=message) as error:
        client.list_courses()

    assert error.value.status_code == status
    assert len(calls) == (3 if status == 500 else 1)
    assert sleeps == ([0.5, 1.0] if status == 500 else [])


def test_drive_and_submission_mutations_use_google_resources():
    from app.teacher.google_client import GoogleClassroomClient

    calls = []
    classroom = Classroom({"submissions": [{"assignedGrade": 95}, {"state": "RETURNED"}]}, calls)
    drive = Drive({"drive": [{"id": "f1", "mimeType": "application/pdf"}, b"pdf", b"exported"]}, calls)
    client = GoogleClassroomClient(classroom, drive)

    assert client.get_drive_metadata("f1")["id"] == "f1"
    assert client.download_drive_file("f1") == b"pdf"
    assert client.export_google_doc_as_pdf("f1") == b"exported"
    assert client.patch_assigned_grade("c1", "cw1", "sub1", 95)["assignedGrade"] == 95
    assert client.return_submission("c1", "cw1", "sub1")["state"] == "RETURNED"
    assert ("submissions", "patch", {"courseId": "c1", "courseWorkId": "cw1", "id": "sub1", "updateMask": "assignedGrade", "body": {"assignedGrade": 95.0}}) in calls
    assert ("submissions", "return", {"courseId": "c1", "courseWorkId": "cw1", "id": "sub1"}) in calls


def test_gmail_feedback_sends_the_teacher_text_with_the_student_ready_report_attached():
    from app.teacher.google_client import GoogleClassroomClient

    calls = []
    client = GoogleClassroomClient(Classroom({}, calls), Drive({"drive": []}, calls), Gmail(calls))

    result = client.send_feedback_email("student@example.edu", "Essay feedback", "Please revise.", "<h1>Report</h1><section><h4>Teacher decision</h4><p>Contradicts</p></section><section><h4>Teacher note</h4><p>Check the evidence.</p></section>")

    assert result == {"id": "gmail-message-1"}
    raw = calls[0][2]["body"]["raw"]
    message = message_from_bytes(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    assert message["To"] == "student@example.edu"
    assert message["Subject"] == "Essay feedback"
    attachment = next(part for part in message.walk() if part.get_filename() == "essay-feedback.pdf")
    assert attachment.get_content_type() == "application/pdf"
    import pymupdf
    with pymupdf.open(stream=attachment.get_payload(decode=True), filetype="pdf") as document:
        text = "".join(page.get_text() for page in document)
        assert "Report" in text
        assert "Contradicts" in text
        assert "Check the evidence." in text


def test_feedback_pdf_keeps_citations_across_multiple_pages():
    import pymupdf
    from app.teacher.google_client import _feedback_pdf

    html = '<h1>Essay feedback</h1>' + ''.join(
        f'<div><h2>Citation {number}</h2><p>{"Detailed feedback. " * 25}</p></div>'
        for number in range(1, 16)
    )
    with pymupdf.open(stream=_feedback_pdf(html), filetype="pdf") as document:
        text = ''.join(page.get_text() for page in document)
        assert len(document) > 1
        assert 'Citation 1' in text
        assert 'Citation 15' in text


def test_supported_attachments_prefer_pdf_then_google_docs_deterministically():
    """Break caught: an unsupported or lower-priority attachment is selected for analysis."""
    from app.teacher.google_client import select_supported_attachments

    attachments = select_supported_attachments(
        [
            {"id": "doc-z", "name": "z-draft", "mimeType": "application/vnd.google-apps.document"},
            {"id": "sheet", "name": "grades", "mimeType": "application/vnd.google-apps.spreadsheet"},
            {"id": "pdf-b", "name": "b-essay.pdf", "mimeType": "application/pdf", "size": "10"},
            {"id": "pdf-a", "name": "a-essay.pdf", "mimeType": "application/pdf"},
            {"id": "doc-a", "name": "a-draft", "mimeType": "application/vnd.google-apps.document"},
        ]
    )

    assert [(item["id"], item["download_strategy"]) for item in attachments] == [
        ("pdf-a", "download"),
        ("pdf-b", "download"),
        ("doc-a", "export_pdf"),
        ("doc-z", "export_pdf"),
    ]
    assert attachments[1]["size"] == "10"


def test_supported_attachments_unwrap_native_classroom_drive_files():
    """Break caught: native Classroom Drive wrappers are discarded before selection."""
    from app.teacher.google_client import select_supported_attachments

    attachments = select_supported_attachments(
        [
            {"driveFile": {"driveFile": {"id": "doc-z", "title": "z-draft", "mimeType": "application/vnd.google-apps.document"}}},
            {"driveFile": {"driveFile": {"id": "sheet", "title": "grades", "mimeType": "application/vnd.google-apps.spreadsheet"}}},
            {"driveFile": {"driveFile": {"id": "pdf-b", "title": "b-essay.pdf", "mimeType": "application/pdf", "alternateLink": "https://drive.example/pdf-b"}}},
            {"driveFile": {"driveFile": {"id": "pdf-a", "title": "a-essay.pdf", "mimeType": "application/pdf"}}},
            {"driveFile": {"driveFile": {"id": "doc-a", "title": "a-draft", "mimeType": "application/vnd.google-apps.document"}}},
        ]
    )

    assert [(item["id"], item["download_strategy"]) for item in attachments] == [
        ("pdf-a", "download"),
        ("pdf-b", "download"),
        ("doc-a", "export_pdf"),
        ("doc-z", "export_pdf"),
    ]
    assert attachments[1]["title"] == "b-essay.pdf"
    assert attachments[1]["alternateLink"] == "https://drive.example/pdf-b"


def test_refresh_token_constructor_uses_an_injected_google_service_builder():
    """Break caught: production construction bypasses the injectable service boundary."""
    from app.teacher.google_client import GoogleClassroomClient

    calls, builder_calls = [], []
    classroom = Classroom({"courses": [{"courses": []}]}, calls)
    drive = Drive({"drive": []}, calls)

    def build_service(api, version, **kwargs):
        builder_calls.append((api, version, kwargs))
        return {"classroom": classroom, "drive": drive, "gmail": Gmail(builder_calls)}[api]

    client = GoogleClassroomClient.from_refresh_token(
        "refresh-token",
        client_id="client-id",
        client_secret="client-secret",
        scopes=("scope.one",),
        service_builder=build_service,
    )

    assert client.list_courses() == []
    assert [(api, version) for api, version, _ in builder_calls] == [("classroom", "v1"), ("drive", "v3"), ("gmail", "v1")]
