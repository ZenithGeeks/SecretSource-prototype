"""Teacher essay analysis adapter contracts; all external boundaries are injected."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest


class FakeGoogle:
    def __init__(self):
        self.downloaded: list[str] = []
        self.exported: list[str] = []

    def download_drive_file(self, file_id: str) -> bytes:
        self.downloaded.append(file_id)
        return b"%PDF-from-Drive"

    def export_google_doc_as_pdf(self, file_id: str) -> bytes:
        self.exported.append(file_id)
        return b"%PDF-exported"


class FakeRepository:
    def __init__(self, submission):
        self.submission = submission
        self.analysis_links: list[tuple[str, str, str, str, str]] = []
        self.reviews = []
        self.feedback = []

    def get_submission(self, owner, course_id, coursework_id, submission_id):
        if (owner, course_id, coursework_id, submission_id) == (
            self.submission.owner,
            self.submission.course_id,
            self.submission.coursework_id,
            self.submission.submission_id,
        ):
            return self.submission
        return None

    def link_submission_analysis(self, owner, course_id, coursework_id, submission_id, analysis_id):
        self.analysis_links.append((owner, course_id, coursework_id, submission_id, analysis_id))
        return True

    def get_professor_review(self, owner, course_id, coursework_id, submission_id):
        return next((review for review in self.reviews if review.owner == owner and review.submission_id == submission_id), None)

    def save_professor_review(self, review):
        self.reviews[:] = [item for item in self.reviews if (item.owner, item.submission_id) != (review.owner, review.submission_id)]
        self.reviews.append(review)

    def get_feedback(self, owner, course_id, coursework_id, submission_id):
        return next((feedback for feedback in self.feedback if feedback.owner == owner and feedback.submission_id == submission_id), None)

    def save_feedback(self, feedback):
        self.feedback[:] = [item for item in self.feedback if (item.owner, item.submission_id) != (feedback.owner, feedback.submission_id)]
        self.feedback.append(feedback)


def submission(*, attachments=None):
    from app.teacher.models import TeacherSubmission

    return TeacherSubmission(
        owner="teacher-a", course_id="course-1", coursework_id="work-1", submission_id="submission-1",
        student_id="student-1", student_name="Ada", state="TURNED_IN", assigned_grade=None,
        attachments=attachments if attachments is not None else [
            {"id": "doc-1", "name": "draft", "mimeType": "application/vnd.google-apps.document", "download_strategy": "export_pdf"},
            {"id": "pdf-1", "name": "essay.pdf", "mimeType": "application/pdf", "download_strategy": "download"},
        ],
        sync_state="synced", sync_error=None, analysis_id=None, raw={},
    )


def test_start_downloads_the_preferred_pdf_and_links_the_injected_async_job():
    """Break caught: starting a check skips the PDF, pipeline boundary, or scoped analysis link."""
    from app.teacher.analysis import TeacherEssayAnalysisService

    google = FakeGoogle()
    repository = FakeRepository(submission())
    uploaded: list[tuple[bytes, str | None]] = []
    started: list[tuple[str, bool, str]] = []

    def save_upload(content: bytes, filename: str | None) -> Path:
        uploaded.append((content, filename))
        return Path("papers/essay-0123456789ab.pdf")

    def start(paper: str, verify: bool, owner: str):
        started.append((paper, verify, owner))
        return {"id": "analysis-42"}

    result = TeacherEssayAnalysisService(
        client=google, repository=repository, save_upload=save_upload, start=start
    ).start("teacher-a", "course-1", "work-1", "submission-1")

    assert result == {"id": "analysis-42", "status": "running", "submission_id": "submission-1"}
    assert google.downloaded == ["pdf-1"]
    assert google.exported == []
    assert uploaded == [(b"%PDF-from-Drive", "essay.pdf")]
    assert started == [("papers/essay-0123456789ab.pdf", True, "teacher-a")]
    assert repository.analysis_links == [("teacher-a", "course-1", "work-1", "submission-1", "analysis-42")]


def test_start_exports_a_google_doc_only_when_no_pdf_is_stored():
    """Break caught: a document-only submission is rejected instead of exported as a PDF."""
    from app.teacher.analysis import TeacherEssayAnalysisService

    google = FakeGoogle()
    repository = FakeRepository(submission(attachments=[
        {"id": "doc-1", "name": "draft", "mimeType": "application/vnd.google-apps.document", "download_strategy": "export_pdf"}
    ]))

    result = TeacherEssayAnalysisService(
        client=google, repository=repository,
        save_upload=lambda content, filename: Path("papers/draft.pdf"),
        start=lambda paper, verify, owner: {"id": "analysis-doc"},
    ).start("teacher-a", "course-1", "work-1", "submission-1")

    assert result["id"] == "analysis-doc"
    assert google.downloaded == []
    assert google.exported == ["doc-1"]


def test_start_rejects_a_missing_or_unsupported_owner_scoped_submission():
    """Break caught: another owner's submission or an unsupported attachment reaches Google or analysis."""
    from app.teacher.analysis import TeacherEssayAnalysisService

    google = FakeGoogle()
    service = TeacherEssayAnalysisService(
        client=google, repository=FakeRepository(submission(attachments=[])),
        save_upload=lambda content, filename: Path("unused.pdf"),
        start=lambda paper, verify, owner: {"id": "unexpected"},
    )

    with pytest.raises(ValueError, match="submission not found"):
        service.start("teacher-b", "course-1", "work-1", "submission-1")
    with pytest.raises(ValueError, match="supported Drive attachment"):
        service.start("teacher-a", "course-1", "work-1", "submission-1")
    assert google.downloaded == []
    assert google.exported == []


def test_essay_check_maps_claims_verdicts_and_saved_internal_feedback():
    """Break caught: the teacher view drops analysis evidence, saved citation IDs, or job failures."""
    from app.teacher.analysis import TeacherEssayAnalysisService
    from app.teacher.models import TeacherFeedback, TeacherProfessorReview

    repository = FakeRepository(submission())
    repository.submission = submission()
    repository.submission = repository.submission.__class__(**{**repository.submission.__dict__, "analysis_id": "analysis-42"})
    repository.reviews.append(TeacherProfessorReview(
        "teacher-a", "course-1", "work-1", "submission-1", "student-1", "analysis-42", "contradicts", "Check the source.",
    ))
    repository.feedback.append(TeacherFeedback(
        "teacher-a", "course-1", "work-1", "submission-1", "student-1", "Please revise this citation.",
        "sent", datetime(2026, 9, 17, tzinfo=UTC), ("claim-0:10.5555/example",),
    ))
    analyses = {
        "analysis-42": {
            "id": "analysis-42", "status": "error", "message": "source service unavailable",
            "claims": [{
                "claim": "The paper proves the result.",
                "citations": [{"ref": "b1", "title": "Example paper", "doi": "10.5555/example", "url": "https://doi.org/10.5555/example"}],
                "verdicts": [{"cited": "10.5555/example", "verdict": "refutes", "quote": "The result was inconclusive.", "reasoning": "The evidence disagrees.", "evidence": [{"page": 7}]}],
            }],
        }
    }

    check = TeacherEssayAnalysisService(
        client=FakeGoogle(), repository=repository,
        analysis_lookup=analyses.get,
    ).essay_check("teacher-a", "course-1", "work-1", "submission-1")

    assert check["analysis"] == {"id": "analysis-42", "status": "error", "error": "source service unavailable"}
    assert check["citationSummary"] == {"total": 1, "contradicted": 1, "silent": 0, "backed": 0}
    assert check["reviews"] == [{
        "id": "claim-0:10.5555/example", "standing": "refutes", "citation": "Example paper",
        "claim": "The paper proves the result.", "sourceQuote": "The result was inconclusive.", "sourceLocation": "p.7",
        "explanation": "The evidence disagrees.",
        "supportingUrls": [{"id": "claim-0:10.5555/example-url", "url": "https://doi.org/10.5555/example", "title": "Example paper", "excerpt": "The result was inconclusive.", "location": "p.7"}],
        "paperUrl": "https://doi.org/10.5555/example",
        "professorReview": {"outcome": "contradicts", "note": "Check the source."},
    }]
    assert check["feedback"] == {
        "body": "Please revise this citation.", "preview": "Please revise this citation.", "citedPages": ["p.7"], "citationIds": ["claim-0:10.5555/example"],
    }


def test_review_and_feedback_writes_are_scoped_and_feedback_send_stays_internal():
    """Break caught: mutation crosses submission ownership, loses citation IDs, or sends feedback to Google."""
    from app.teacher.analysis import TeacherEssayAnalysisService

    google = FakeGoogle()
    repository = FakeRepository(submission())
    service = TeacherEssayAnalysisService(client=google, repository=repository)

    review = service.save_review("teacher-a", "course-1", "work-1", "submission-1", "supports", "Evidence is sound.")
    feedback = service.save_feedback(
        "teacher-a", "course-1", "work-1", "submission-1", "Good revision.", ["claim-0:10.5555/example"]
    )
    sent = service.send_feedback("teacher-a", "course-1", "work-1", "submission-1")

    assert (review.verdict, review.reasoning) == ("supports", "Evidence is sound.")
    assert (feedback.feedback_text, feedback.citation_ids, feedback.status) == (
        "Good revision.", ("claim-0:10.5555/example",), "draft"
    )
    assert sent.status == "sent"
    assert sent.sent_at is not None
    assert google.downloaded == []
    assert google.exported == []
    with pytest.raises(ValueError, match="submission not found"):
        service.save_feedback("teacher-b", "course-1", "work-1", "submission-1", "Hidden", [])
