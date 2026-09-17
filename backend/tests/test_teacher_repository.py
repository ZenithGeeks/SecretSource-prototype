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

    def upsert(self, payload, **_kwargs):
        self.action, self.payload = "upsert", payload
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
        matched = [
            row
            for row in rows
            if all(
                row.get(filter_[0]) > filter_[2]
                if len(filter_) == 3
                else row.get(filter_[0]) == filter_[1]
                for filter_ in self.filters
            )
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
            "teacher_professor_reviews": ("owner", "submission_id"),
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
