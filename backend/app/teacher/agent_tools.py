"""Owner-scoped, read-only Classroom tools for the teacher assistant."""

import asyncio

from google.adk.tools import ToolContext


async def teacher_classes(tool_context: ToolContext) -> dict:
    """List the signed-in teacher's imported Classroom courses and their IDs."""
    owner = tool_context.state.get("user")
    if not owner:
        return {"status": "error", "message": "Sign in to access Classroom data."}
    from app.teacher.repository import TeacherGoogleRepository

    courses = await asyncio.to_thread(TeacherGoogleRepository().list_courses, owner)
    return {"courses": [{"id": course.course_id, "name": course.name} for course in courses]}


async def teacher_assignments(course_id: str, tool_context: ToolContext) -> dict:
    """List imported assignments and their IDs for one of the teacher's courses."""
    owner = tool_context.state.get("user")
    if not owner:
        return {"status": "error", "message": "Sign in to access Classroom data."}
    from app.teacher.repository import TeacherGoogleRepository

    repository = TeacherGoogleRepository()
    courses = await asyncio.to_thread(repository.list_courses, owner)
    if not any(course.course_id == course_id for course in courses):
        return {"status": "error", "message": "Course not found."}
    work = await asyncio.to_thread(repository.list_coursework, owner, course_id)
    return {"assignments": [{"id": item.coursework_id, "title": item.title} for item in work if item.resource_type == "coursework"]}


async def teacher_essay_review(course_id: str, assignment_id: str, student_id: str, tool_context: ToolContext) -> dict:
    """Read one student's saved essay review using IDs from the teacher's Classroom data."""
    owner = tool_context.state.get("user")
    if not owner:
        return {"status": "error", "message": "Sign in to access Classroom data."}
    from app.teacher.analysis import TeacherEssayAnalysisService
    from app.teacher.repository import TeacherGoogleRepository

    repository = TeacherGoogleRepository()
    submissions = await asyncio.to_thread(repository.list_submissions, owner, course_id, assignment_id)
    submission = next((item for item in submissions if item.student_id == student_id), None)
    if not submission:
        return {"status": "error", "message": "Submission not found."}
    snapshot = None
    if submission.analysis_id:
        from fastapi import HTTPException

        from app.main import _owned

        try:
            snapshot = await asyncio.to_thread(_owned, submission.analysis_id, owner)
        except HTTPException:
            return {"status": "error", "message": "Analysis not found."}
    service = TeacherEssayAnalysisService(client=None, repository=repository, analysis_lookup=lambda _id: snapshot)
    return await asyncio.to_thread(service.essay_check, owner, course_id, assignment_id, submission.submission_id)


async def teacher_submissions(course_id: str, assignment_id: str, tool_context: ToolContext) -> dict:
    """List students and IDs for an imported assignment, without changing any records."""
    owner = tool_context.state.get("user")
    if not owner:
        return {"status": "error", "message": "Sign in to access Classroom data."}
    from app.teacher.repository import TeacherGoogleRepository

    submissions = await asyncio.to_thread(TeacherGoogleRepository().list_submissions, owner, course_id, assignment_id)
    return {"submissions": [{"student_id": item.student_id, "student_name": item.student_name, "state": item.state} for item in submissions]}
