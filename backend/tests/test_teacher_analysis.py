from __future__ import annotations

from pathlib import Path

import pytest
from app.teacher.analysis import TeacherEssayAnalysisService
from app.teacher.models import TeacherSubmission


class Repository:
    def __init__(self, submission):
        self.submission = submission
        self.links = []
        self.resets = []

    def get_submission(self, *_args):
        return self.submission

    def link_submission_analysis(self, *args, **kwargs):
        self.links.append((args, kwargs))

    def reset_submission_review(self, *args):
        self.resets.append(args)


class Drive:
    def __init__(self, version="3"):
        self.downloads = []
        self.exports = []
        self.version = version

    def get_drive_metadata(self, file_id):
        return {"id": file_id, "version": self.version, "modifiedTime": "2026-09-24T12:00:00Z"}

    def download_drive_file(self, file_id):
        self.downloads.append(file_id)
        return b"pdf bytes"

    def export_google_doc_as_pdf(self, file_id):
        self.exports.append(file_id)
        return b"exported pdf bytes"


def make_submission(attachments, analysis_id=None, analysis_file_id=None, analysis_file_version=None):
    return TeacherSubmission(
        "teacher-1", "course-1", "work-1", "submission-1", "student-1", "Student",
        "TURNED_IN", None, attachments, "synced", None, analysis_id, {},
        analysis_file_id=analysis_file_id, analysis_file_version=analysis_file_version,
    )


def service_for(submission, start_calls, drive=None):
    repository = Repository(submission)
    drive = drive or Drive()
    service = TeacherEssayAnalysisService(
        client=drive,
        repository=repository,
        save_upload=lambda _content, name: Path(name),
        start=lambda _path, _verify, _owner: start_calls.append("started") or {"id": f"analysis-{len(start_calls)}"},
    )
    return service, repository, drive


def test_submission_with_multiple_pdf_attachments_is_rejected_instead_of_analyzing_the_first():
    calls = []
    submission = make_submission([
        {"id": "essay-a", "name": "draft-a.pdf", "mimeType": "application/pdf"},
        {"id": "essay-b", "name": "draft-b.pdf", "mimeType": "application/pdf"},
    ])
    service, _, drive = service_for(submission, calls)

    with pytest.raises(ValueError, match="exactly one PDF"):
        service.start("teacher-1", "course-1", "work-1", "submission-1")

    assert drive.downloads == []
    assert calls == []


def test_student_pdf_is_selected_over_non_pdf_attachment():
    calls = []
    submission = make_submission([
        {"id": "slides", "name": "slides.pptx", "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
        {"id": "essay", "name": "essay.pdf", "mimeType": "application/pdf"},
    ])
    service, repository, drive = service_for(submission, calls)

    result = service.start("teacher-1", "course-1", "work-1", "submission-1")

    assert result["id"] == "analysis-1"
    assert drive.downloads == ["essay"]
    assert repository.links[0][0][-1] == "analysis-1"
    assert repository.links[0][1] == {"file_id": "essay", "file_version": "3"}


def test_student_google_doc_is_exported_to_pdf_before_analysis():
    calls = []
    submission = make_submission([
        {"id": "essay-doc", "name": "essay draft", "mimeType": "application/vnd.google-apps.document"},
    ])
    service, repository, drive = service_for(submission, calls)

    result = service.start("teacher-1", "course-1", "work-1", "submission-1")

    assert result["id"] == "analysis-1"
    assert drive.downloads == []
    assert drive.exports == ["essay-doc"]
    assert calls == ["started"]
    assert repository.links[0][1] == {"file_id": "essay-doc", "file_version": "3"}


def test_same_pdf_version_reuses_its_existing_pipeline_analysis():
    calls = []
    submission = make_submission(
        [{"id": "essay", "name": "essay.pdf", "mimeType": "application/pdf"}],
        analysis_id="analysis-existing", analysis_file_id="essay", analysis_file_version="3",
    )
    service, repository, drive = service_for(submission, calls)
    service._analysis_lookup = lambda _analysis_id: {"status": "done"}

    result = service.start("teacher-1", "course-1", "work-1", "submission-1")

    assert result == {"id": "analysis-existing", "status": "done", "submission_id": "submission-1"}
    assert drive.downloads == []
    assert calls == []
    assert repository.links == []


def test_force_rechecks_an_unchanged_completed_submission():
    calls = []
    submission = make_submission(
        [{"id": "essay", "name": "essay.pdf", "mimeType": "application/pdf"}],
        analysis_id="analysis-existing", analysis_file_id="essay", analysis_file_version="3",
    )
    service, repository, drive = service_for(submission, calls)
    service._analysis_lookup = lambda _id: {"status": "done"}

    result = service.start("teacher-1", "course-1", "work-1", "submission-1", force=True)

    assert result["id"] == "analysis-1"
    assert calls == ["started"]
    assert drive.downloads == ["essay"]
    assert repository.resets == []


def test_force_does_not_duplicate_a_running_analysis_even_if_file_changed():
    calls = []
    submission = make_submission(
        [{"id": "essay", "name": "essay.pdf", "mimeType": "application/pdf"}],
        analysis_id="analysis-existing", analysis_file_id="essay", analysis_file_version="2",
    )
    service, repository, drive = service_for(submission, calls)
    service._analysis_lookup = lambda _id: {"status": "running"}

    result = service.start("teacher-1", "course-1", "work-1", "submission-1", force=True)

    assert result["id"] == "analysis-existing"
    assert result["status"] == "running"
    assert calls == drive.downloads == repository.resets == []


def test_changed_pdf_version_starts_a_new_pipeline_analysis():
    calls = []
    submission = make_submission(
        [{"id": "essay", "name": "essay.pdf", "mimeType": "application/pdf"}],
        analysis_id="analysis-existing", analysis_file_id="essay", analysis_file_version="2",
    )
    service, repository, drive = service_for(submission, calls, drive=Drive(version="3"))

    result = service.start("teacher-1", "course-1", "work-1", "submission-1")

    assert result["id"] == "analysis-1"
    assert drive.downloads == ["essay"]
    assert calls == ["started"]
    assert repository.links[0][1]["file_version"] == "3"
    assert repository.resets == [("teacher-1", "course-1", "work-1", "submission-1")]


def test_failed_analysis_for_the_same_pdf_can_be_retried():
    calls = []
    submission = make_submission(
        [{"id": "essay", "name": "essay.pdf", "mimeType": "application/pdf"}],
        analysis_id="analysis-failed", analysis_file_id="essay", analysis_file_version="3",
    )
    service, _, drive = service_for(submission, calls)
    service._analysis_lookup = lambda _analysis_id: {"status": "error"}

    result = service.start("teacher-1", "course-1", "work-1", "submission-1")

    assert result["id"] == "analysis-1"
    assert drive.downloads == ["essay"]
    assert calls == ["started"]
