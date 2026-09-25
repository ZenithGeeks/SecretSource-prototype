"""Service-role persistence contracts for Teacher Google Classroom data."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeSupabase:
    """A small Supabase query fake that executes owner filters against stored rows."""

    def __init__(self):
        self.rows: dict[str, list[dict]] = {}
        self.upsert_conflicts: list[tuple[str, str | None]] = []

    def table(self, table):
        return FakeQuery(self, table)


class FakeQuery:
    def __init__(self, client, table):
        self.client = client
        self.table_name = table
        self.action = "select"
        self.payload = None
        self.filters = []

    def insert(self, payload):
        self.action, self.payload = "insert", payload
        return self

    def upsert(self, payload, **kwargs):
        self.action, self.payload = "upsert", payload
        self.client.upsert_conflicts.append((self.table_name, kwargs.get("on_conflict")))
        return self

    def select(self, *_columns):
        self.action = "select"
        return self

    def update(self, payload):
        self.action, self.payload = "update", payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def is_(self, column, value):
        self.filters.append((column, None if value == "null" else value))
        return self

    def gt(self, column, value):
        self.filters.append((column, ">", value))
        return self

    def limit(self, _value):
        return self

    def execute(self):
        rows = self.client.rows.setdefault(self.table_name, [])

        def matches(row, filter_):
            if len(filter_) != 3:
                return row.get(filter_[0]) == filter_[1]
            value, expected = row.get(filter_[0]), filter_[2]
            if isinstance(value, datetime) and isinstance(expected, str):
                expected = datetime.fromisoformat(expected.replace("Z", "+00:00"))
            return value > expected

        matched = [
            row
            for row in rows if all(matches(row, filter_) for filter_ in self.filters)
        ]
        if self.action == "select":
            response = FakeResponse([row.copy() for row in matched])
            callback = getattr(self.client, "after_select", None)
            if callback is not None:
                callback(self.table_name)
            return response
        if self.action == "insert":
            rows.append(self.payload.copy())
            return FakeResponse([self.payload.copy()])
        if self.action == "update":
            for row in matched:
                row.update(self.payload)
            return FakeResponse([row.copy() for row in matched])
        if self.action == "delete":
            self.client.rows[self.table_name] = [row for row in rows if row not in matched]
            return FakeResponse([row.copy() for row in matched])

        resource_keys = {
            "teacher_google_connections": ("owner",),
            "teacher_courses": ("owner", "course_id"),
            "teacher_coursework": ("owner", "course_id", "coursework_id"),
            "teacher_submissions": ("owner", "course_id", "coursework_id", "submission_id"),
            "teacher_professor_reviews": ("owner", "submission_id", "review_id"),
            "teacher_feedback": ("owner", "submission_id"),
        }
        keys = resource_keys[self.table_name]
        existing = next(
            (
                row
                for row in rows
                if tuple(row.get(key) for key in keys) == tuple(self.payload[key] for key in keys)
            ),
            None,
        )
        if existing is None:
            rows.append(self.payload.copy())
        else:
            existing.update(self.payload)
        return FakeResponse([self.payload.copy()])


def test_connection_reads_are_scoped_to_the_requested_owner():
    """Break caught: a connection lookup leaks another teacher's encrypted credential."""
    from app.teacher.models import TeacherGoogleConnection
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    repository = TeacherGoogleRepository(client)
    repository.save_connection(
        TeacherGoogleConnection("teacher-a", "subject-a", "a@example.test", "cipher-a", ("openid",), None)
    )
    repository.save_connection(
        TeacherGoogleConnection("teacher-b", "subject-b", "b@example.test", "cipher-b", ("openid",), None)
    )

    connection = repository.get_connection("teacher-a")

    assert connection is not None
    assert connection.owner == "teacher-a"
    assert connection.refresh_token_ciphertext == "cipher-a"


def test_connection_status_is_owner_scoped_and_omits_refresh_token_ciphertext():
    """Break caught: a status endpoint leaks credentials or another teacher's connection."""
    from app.teacher.models import TeacherGoogleConnection
    from app.teacher.repository import TeacherGoogleRepository

    repository = TeacherGoogleRepository(FakeSupabase())
    repository.save_connection(
        TeacherGoogleConnection("teacher-a", "subject-a", "a@example.test", "cipher-a", ("openid",), None)
    )
    repository.save_connection(
        TeacherGoogleConnection("teacher-b", "subject-b", "b@example.test", "cipher-b", ("openid",), None)
    )

    status = repository.get_connection_status("teacher-a")

    assert status is not None
    assert status.owner == "teacher-a"
    assert status.google_subject == "subject-a"
    assert not hasattr(status, "refresh_token_ciphertext")


def test_connection_status_includes_the_last_recorded_sync_details():
    """Break caught: the connection-status route always reports an unsynced Classroom account."""
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    client.rows["teacher_google_connections"] = [
        {
            "owner": "teacher-a",
            "google_subject": "subject-a",
            "google_email": "a@example.test",
            "scopes": ["openid"],
            "last_synced_at": "2026-09-17T01:00:00Z",
            "last_sync_status": "synced",
            "last_sync_error": None,
        }
    ]

    status = TeacherGoogleRepository(client).get_connection_status("teacher-a")

    assert status is not None
    assert status.last_synced_at == datetime(2026, 9, 17, 1, 0, tzinfo=UTC)
    assert status.last_sync_status == "synced"
    assert status.last_sync_error is None


def test_disconnect_deletes_only_the_requested_owner_connection():
    """Break caught: disconnect leaves credentials behind or deletes another teacher's connection."""
    from app.teacher.models import TeacherGoogleConnection
    from app.teacher.repository import TeacherGoogleRepository

    repository = TeacherGoogleRepository(FakeSupabase())
    repository.save_connection(
        TeacherGoogleConnection("teacher-a", "subject-a", "a@example.test", "cipher-a", ("openid",), None)
    )
    repository.save_connection(
        TeacherGoogleConnection("teacher-b", "subject-b", "b@example.test", "cipher-b", ("openid",), None)
    )

    assert repository.disconnect("teacher-a") is True
    assert repository.get_connection("teacher-a") is None
    assert repository.get_connection("teacher-b") is not None
    assert repository.disconnect("teacher-a") is False


def test_state_can_be_consumed_once_before_its_expiry():
    """Break caught: OAuth state can be reused or accepted after its expiration."""
    from app.teacher.models import OAuthState
    from app.teacher.repository import TeacherGoogleRepository

    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    repository = TeacherGoogleRepository(FakeSupabase())
    state = OAuthState(
        state_hash="digest",
        owner="teacher-a",
        code_verifier="verifier",
        redirect_uri="https://example.test/callback",
        expires_at=now + timedelta(minutes=10),
    )
    repository.save_oauth_state(state)

    assert repository.consume_oauth_state("digest", now).owner == "teacher-a"
    assert repository.consume_oauth_state("digest", now) is None


def test_state_consumption_does_not_win_a_race_with_expiry():
    """Break caught: the conditional consume update accepts a state that has just expired."""
    from app.teacher.models import OAuthState
    from app.teacher.repository import TeacherGoogleRepository

    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    client = FakeSupabase()
    repository = TeacherGoogleRepository(client)
    repository.save_oauth_state(
        OAuthState(
            state_hash="digest",
            owner="teacher-a",
            code_verifier="verifier",
            redirect_uri="https://example.test/callback",
            expires_at=now + timedelta(seconds=1),
        )
    )

    def expire_state_after_read(table):
        if table == "teacher_google_oauth_states":
            client.rows[table][0]["expires_at"] = now

    client.after_select = expire_state_after_read

    assert repository.consume_oauth_state("digest", now) is None
    assert client.rows["teacher_google_oauth_states"][0]["consumed_at"] is None


def test_course_upsert_keeps_raw_google_json_and_owner_key_for_later_sync_tasks():
    """Break caught: later sync cannot store a course snapshot without losing source JSON or ownership."""
    from app.teacher.models import TeacherCourse
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    repository = TeacherGoogleRepository(client)
    course = TeacherCourse(
        owner="teacher-a",
        course_id="course-99",
        name="Research Methods",
        section="1",
        description=None,
        room="A-1",
        course_state="ACTIVE",
        raw={"id": "course-99", "name": "Research Methods", "teacherFolder": {"id": "folder-1"}},
    )

    repository.save_course(course)

    assert client.rows["teacher_courses"] == [
        {
            "owner": "teacher-a",
            "course_id": "course-99",
            "name": "Research Methods",
            "section": "1",
            "description": None,
            "room": "A-1",
            "course_state": "ACTIVE",
            "raw": {"id": "course-99", "name": "Research Methods", "teacherFolder": {"id": "folder-1"}},
        }
    ]


def test_professor_review_upsert_uses_the_review_id_schema_conflict_target():
    """Break caught: review updates fail after the review-ID migration removes the old unique key."""
    from app.teacher.models import TeacherProfessorReview
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    repository = TeacherGoogleRepository(client)

    repository.save_professor_review(
        TeacherProfessorReview(
            "teacher-a",
            "course-1",
            "work-1",
            "submission-1",
            "student-1",
            "analysis-1",
            "supports",
            "Checked.",
            "claim-1",
        )
    )

    assert client.upsert_conflicts == [
        ("teacher_professor_reviews", "owner,submission_id,review_id")
    ]


def test_link_submission_analysis_updates_only_the_owned_submission():
    """Break caught: starting analysis crashes or links an analysis to the wrong submission."""
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    client.rows["teacher_submissions"] = [
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1"},
        {"owner": "teacher-b", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1"},
    ]

    TeacherGoogleRepository(client).link_submission_analysis("teacher-a", "course-1", "work-1", "sub-1", "analysis-1")

    assert client.rows["teacher_submissions"] == [
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1", "analysis_id": "analysis-1"},
        {"owner": "teacher-b", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1"},
    ]


def test_get_professor_reviews_returns_only_the_submission_reviews():
    """Break caught: essay checks crash or show another submission's review cards."""
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    client.rows["teacher_professor_reviews"] = [
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1", "student_id": "student-1", "analysis_id": "analysis-1", "verdict": "supports", "reasoning": "Checked.", "review_id": "citation-1"},
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-2", "student_id": "student-2", "analysis_id": "analysis-2", "verdict": "contradicts", "reasoning": "Hidden.", "review_id": "citation-2"},
    ]

    reviews = TeacherGoogleRepository(client).get_professor_reviews("teacher-a", "course-1", "work-1", "sub-1")

    assert [(review.review_id, review.verdict) for review in reviews] == [("citation-1", "supports")]


def test_get_professor_review_returns_the_legacy_submission_review():
    """Break caught: the single-review compatibility lookup is absent from the real repository."""
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    client.rows["teacher_professor_reviews"] = [
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1", "student_id": "student-1", "analysis_id": "analysis-1", "verdict": "supports", "reasoning": "Checked.", "review_id": ""},
    ]

    review = TeacherGoogleRepository(client).get_professor_review("teacher-a", "course-1", "work-1", "sub-1")

    assert review is not None
    assert review.verdict == "supports"


def test_get_feedback_returns_saved_citation_ids_for_the_owned_submission():
    """Break caught: essay checks crash or lose citation selections when reading feedback."""
    from app.teacher.repository import TeacherGoogleRepository

    client = FakeSupabase()
    client.rows["teacher_feedback"] = [
        {"owner": "teacher-a", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1", "student_id": "student-1", "feedback_text": "Good work.", "status": "draft", "sent_at": None, "citation_ids": ["citation-1"]},
        {"owner": "teacher-b", "course_id": "course-1", "coursework_id": "work-1", "submission_id": "sub-1", "student_id": "student-2", "feedback_text": "Hidden.", "status": "draft", "sent_at": None, "citation_ids": ["citation-2"]},
    ]

    feedback = TeacherGoogleRepository(client).get_feedback("teacher-a", "course-1", "work-1", "sub-1")

    assert feedback is not None
    assert feedback.feedback_text == "Good work."
    assert feedback.citation_ids == ("citation-1",)
