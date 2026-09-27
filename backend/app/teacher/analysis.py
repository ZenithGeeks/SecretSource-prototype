"""Injectable adapter from Classroom submissions to the existing essay-analysis pipeline."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.teacher.google_client import GOOGLE_DOCUMENT_MIME_TYPE, select_supported_attachments
from app.teacher.models import TeacherFeedback, TeacherProfessorReview


def _citation_key(citation: dict[str, Any]) -> str:
    return str(
        citation.get("doi") or citation.get("arxiv") or citation.get("title")
        or citation.get("url") or citation.get("ref") or ""
    )


def _citation_id(claim_index: int, citation: dict[str, Any], citation_index: int) -> str:
    return f"claim-{claim_index}:{_citation_key(citation)}:{citation_index}"


def _citation_url(citation: dict[str, Any]) -> str:
    if citation.get("url"):
        return str(citation["url"])
    if citation.get("doi"):
        return f"https://doi.org/{citation['doi']}"
    if citation.get("arxiv"):
        return f"https://arxiv.org/abs/{citation['arxiv']}"
    return ""


def _attachment_filename(attachment: dict[str, Any]) -> str:
    name = str(attachment.get("name") or attachment.get("title") or "submission.pdf")
    return name if Path(name).suffix.lower() == ".pdf" else f"{name}.pdf"


def _source_location(verdict: dict[str, Any]) -> str:
    evidence = verdict.get("evidence")
    if isinstance(evidence, list) and evidence and isinstance(evidence[0], dict):
        page = evidence[0].get("page")
        if page is not None:
            return f"p.{page}"
    return ""


class TeacherEssayAnalysisService:
    """Starts analysis jobs and presents their saved snapshots as Teacher EssayCheck data.

    Production defaults import ``app.main`` only at the moment the existing pipeline is needed.
    Unit tests provide every dependency, so no Google, LLM, or Supabase service is contacted.
    """

    def __init__(
        self,
        *,
        client: Any,
        repository: Any,
        save_upload: Callable[[bytes, str | None], Path] | None = None,
        start: Callable[[str, bool, str | None], dict[str, Any]] | None = None,
        analysis_lookup: Callable[[str], dict[str, Any] | None] | None = None,
        now: Callable[[], datetime] | None = None,
    ):
        self.client = client
        self.repository = repository
        self._save_upload = save_upload
        self._start = start
        self._analysis_lookup = analysis_lookup
        self._now = now or (lambda: datetime.now(UTC))

    def start(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str, *, verify: bool = True
    ) -> dict[str, Any]:
        submission = self._submission(owner, course_id, coursework_id, submission_id)
        attachments = select_supported_attachments(submission.attachments)
        if len(attachments) != 1:
            raise ValueError("submission must contain exactly one PDF or Google Doc attachment")
        attachment = attachments[0]
        file_id = attachment.get("id")
        if not file_id:
            raise ValueError("submission has no supported Drive attachment")
        metadata = self.client.get_drive_metadata(file_id) if hasattr(self.client, "get_drive_metadata") else attachment
        file_version = str(metadata.get("version") or metadata.get("modifiedTime") or metadata.get("md5Checksum") or "")
        if (
            submission.analysis_id
            and submission.analysis_file_id == file_id
            and submission.analysis_file_version == file_version
        ):
            snapshot = self._analysis(submission.analysis_id)
            if snapshot.get("status") in {"running", "done"}:
                return {"id": submission.analysis_id, "status": snapshot["status"], "submission_id": submission_id}
        content = (
            self.client.export_google_doc_as_pdf(file_id)
            if attachment.get("mimeType") == GOOGLE_DOCUMENT_MIME_TYPE
            else self.client.download_drive_file(file_id)
        )
        path = self._save(content, _attachment_filename(attachment))
        job = self._launch(path.as_posix(), verify, owner)
        analysis_id = job.get("id")
        if not analysis_id:
            raise ValueError("analysis pipeline did not return an id")
        if submission.analysis_id and hasattr(self.repository, "reset_submission_review"):
            self.repository.reset_submission_review(owner, course_id, coursework_id, submission_id)
        self.repository.link_submission_analysis(
            owner, course_id, coursework_id, submission_id, analysis_id, file_id=file_id, file_version=file_version
        )
        return {"id": analysis_id, "status": "running", "submission_id": submission_id}

    def essay_check(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str
    ) -> dict[str, Any]:
        submission = self._submission(owner, course_id, coursework_id, submission_id)
        snapshot = self._analysis(submission.analysis_id)
        get_reviews = getattr(self.repository, "get_professor_reviews", None)
        saved_reviews = (
            get_reviews(owner, course_id, coursework_id, submission_id)
            if get_reviews is not None
            else self.repository.get_professor_review(owner, course_id, coursework_id, submission_id)
        )
        reviews = self._reviews(snapshot, saved_reviews)
        feedback = self.repository.get_feedback(owner, course_id, coursework_id, submission_id)
        return {
            "assignment": {
                "assignmentId": coursework_id,
                "courseId": course_id,
                "course": course_id,
                "name": coursework_id,
                "courseWorkId": coursework_id,
            },
            "student": {
                "id": submission.student_id,
                "name": submission.student_name or submission.student_id,
                "fileName": _attachment_filename(submission.attachments[0]) if submission.attachments else "submission.pdf",
                "email": submission.student_email,
            },
            "citationSummary": self._summary(reviews),
            "reviews": reviews,
            "feedback": self._feedback(feedback, reviews),
            "navigation": {},
            "analysis": {
                "id": submission.analysis_id,
                "status": snapshot.get("status", "missing"),
                "error": snapshot.get("message") if snapshot.get("status") == "error" else None,
            },
        }

    def save_review(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str, verdict: str, reasoning: str,
        *, review_id: str = "",
    ) -> TeacherProfessorReview:
        submission = self._submission(owner, course_id, coursework_id, submission_id)
        review = TeacherProfessorReview(
            owner, course_id, coursework_id, submission_id, submission.student_id,
            submission.analysis_id, verdict, reasoning,
            review_id,
        )
        self.repository.save_professor_review(review)
        return review

    def save_feedback(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str,
        feedback_text: str, citation_ids: list[str] | tuple[str, ...],
    ) -> TeacherFeedback:
        submission = self._submission(owner, course_id, coursework_id, submission_id)
        feedback = TeacherFeedback(
            owner, course_id, coursework_id, submission_id, submission.student_id,
            feedback_text, "draft", None, tuple(citation_ids),
        )
        self.repository.save_feedback(feedback)
        return feedback

    def send_feedback(
        self, owner: str, course_id: str, coursework_id: str, submission_id: str, report_html: str | None = None
    ) -> TeacherFeedback:
        """Email the saved teacher feedback and its student-ready HTML report through Gmail."""
        submission = self._submission(owner, course_id, coursework_id, submission_id)
        feedback = self.repository.get_feedback(owner, course_id, coursework_id, submission_id)
        if feedback is None:
            raise ValueError("feedback not found")
        if feedback.status == "sent":
            return feedback
        if not feedback.feedback_text.strip():
            raise ValueError("feedback is empty")
        if not submission.student_email:
            raise ValueError("student email is unavailable; refresh Classroom student email access")
        if self.client is None or not hasattr(self.client, "send_feedback_email"):
            raise ValueError("Gmail feedback delivery is unavailable; reconnect Google with Gmail sending access")
        self.client.send_feedback_email(
            submission.student_email,
            f"Essay feedback for {coursework_id}",
            feedback.feedback_text,
            report_html,
        )
        sent = TeacherFeedback(
            owner, course_id, coursework_id, submission_id, submission.student_id,
            feedback.feedback_text, "sent", self._now(), feedback.citation_ids,
        )
        self.repository.save_feedback(sent)
        return sent

    def _submission(self, owner: str, course_id: str, coursework_id: str, submission_id: str) -> Any:
        submission = self.repository.get_submission(owner, course_id, coursework_id, submission_id)
        if submission is None:
            raise ValueError("submission not found")
        return submission

    def _save(self, content: bytes, filename: str) -> Path:
        if self._save_upload is None:
            from app.main import save_upload

            return save_upload(content, filename)
        return self._save_upload(content, filename)

    def _launch(self, paper: str, verify: bool, owner: str) -> dict[str, Any]:
        if self._start is None:
            from app.main import _start

            return _start(paper, verify, owner)
        return self._start(paper, verify, owner)

    def _analysis(self, analysis_id: str | None) -> dict[str, Any]:
        if not analysis_id:
            return {"status": "missing", "message": "analysis not started", "claims": []}
        if self._analysis_lookup is None:
            from app.main import analyses

            snapshot = analyses.get(analysis_id)
        else:
            snapshot = self._analysis_lookup(analysis_id)
        return snapshot or {"status": "missing", "message": "analysis not found", "claims": []}

    def _reviews(
        self, snapshot: dict[str, Any], professor_reviews: TeacherProfessorReview | list[TeacherProfessorReview] | None
    ) -> list[dict[str, Any]]:
        if isinstance(professor_reviews, list):
            saved_by_id = {review.review_id: review for review in professor_reviews if review.review_id}
            fallback_review = next((review for review in professor_reviews if not review.review_id), None)
        else:
            saved_by_id = {}
            fallback_review = professor_reviews
        cards: list[dict[str, Any]] = []
        for claim_index, claim in enumerate(snapshot.get("claims") or []):
            verdicts = {str(item.get("cited")): item for item in claim.get("verdicts") or []}
            unchecked = {str(item.get("source")): item for item in claim.get("unchecked") or []}
            for citation_index, citation in enumerate(claim.get("citations") or []):
                key = _citation_key(citation)
                citation_id = _citation_id(claim_index, citation, citation_index)
                verdict = verdicts.get(key, {})
                standing = str(verdict.get("verdict") or ("unchecked" if key in unchecked else "insufficient"))
                if standing not in {"supports", "refutes", "insufficient", "unchecked"}:
                    standing = "unchecked"
                quote = str(verdict.get("quote") or "")
                location = _source_location(verdict)
                url = _citation_url(citation)
                title = str(citation.get("title") or key)
                professor_review = saved_by_id.get(citation_id) or fallback_review
                cards.append({
                    "id": citation_id,
                    "standing": standing,
                    "citation": title,
                    "claim": str(claim.get("claim") or ""),
                    "sourceQuote": quote,
                    "sourceLocation": location,
                    "explanation": verdict.get("reasoning") or unchecked.get(key, {}).get("message") or None,
                    "supportingUrls": ([{
                        "id": f"{citation_id}-url", "url": url, "title": title,
                        "excerpt": quote, "location": location,
                    }] if url else []),
                    "paperUrl": url or None,
                    "professorReview": {
                        "outcome": professor_review.verdict if professor_review is not None else "not-reviewed",
                        "note": professor_review.reasoning if professor_review is not None else "",
                    },
                })
        return cards

    @staticmethod
    def _summary(reviews: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "total": len(reviews),
            "contradicted": sum(review["standing"] == "refutes" for review in reviews),
            "silent": sum(review["standing"] in {"insufficient", "unchecked"} for review in reviews),
            "backed": sum(review["standing"] == "supports" for review in reviews),
        }

    @staticmethod
    def _feedback(feedback: TeacherFeedback | None, reviews: list[dict[str, Any]]) -> dict[str, Any]:
        citation_ids = list(feedback.citation_ids) if feedback is not None else []
        locations = {review["id"]: review["sourceLocation"] for review in reviews}
        return {
            "body": feedback.feedback_text if feedback is not None else "",
            "preview": feedback.feedback_text if feedback is not None else "",
            "citedPages": [locations[citation_id] for citation_id in citation_ids if locations.get(citation_id)],
            "citationIds": citation_ids,
        }
