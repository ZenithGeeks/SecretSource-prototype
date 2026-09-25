"""OAuth connection behavior without a live Google or Supabase service."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet


@dataclass
class SavedState:
    state_hash: str
    owner: str
    code_verifier: str
    redirect_uri: str
    expires_at: datetime
    consumed_at: datetime | None = None


class FakeRepository:
    """In-memory repository double: it replaces Supabase, not the OAuth service."""

    def __init__(self):
        self.states: dict[str, SavedState] = {}
        self.connections: dict[str, object] = {}

    def save_oauth_state(self, state):
        row = state.to_row()
        row["expires_at"] = datetime.fromisoformat(row["expires_at"])
        self.states[state.state_hash] = SavedState(**row)

    def consume_oauth_state(self, state_hash, now):
        state = self.states.get(state_hash)
        if state is None or state.consumed_at is not None or state.expires_at <= now:
            return None
        state.consumed_at = now
        return state

    def get_connection(self, owner):
        return self.connections.get(owner)

    def save_connection(self, connection):
        self.connections[connection.owner] = connection


class FakeGoogleTransport:
    def __init__(self, token_response):
        self.token_response = token_response
        self.exchanges = []

    def exchange_authorization_code(self, *, code, code_verifier, redirect_uri):
        self.exchanges.append((code, code_verifier, redirect_uri))
        return self.token_response


def oauth_service(repository, transport, key, now):
    from app.teacher.models import GoogleTokenResponse
    from app.teacher.oauth import GoogleOAuthSettings, TeacherGoogleOAuthService

    now_fn = now if callable(now) else lambda: now
    return TeacherGoogleOAuthService(
        repository=repository,
        transport=transport,
        encryption_key=key,
        settings=GoogleOAuthSettings(
            client_id="teacher-client",
            redirect_uri="https://secret-source.test/teacher/google/callback",
            scopes=("openid", "scope.classroom"),
            state_ttl=timedelta(minutes=10),
        ),
        now=now_fn,
    ), GoogleTokenResponse


def test_oauth_rows_are_json_serializable_for_supabase():
    """Break caught: OAuth timestamps must not reach the HTTP client as datetime objects."""
    from app.teacher.models import OAuthState, TeacherGoogleConnection

    now = datetime(2026, 9, 21, 2, 45, tzinfo=UTC)
    state = OAuthState("state", "teacher-42", "verifier", "https://secret-source.test/callback", now)
    connection = TeacherGoogleConnection(
        owner="teacher-42",
        google_subject="google-42",
        google_email="teacher@example.test",
        refresh_token_ciphertext="ciphertext",
        scopes=("openid",),
        access_token_expires_at=now,
    )

    json.dumps(state.to_row())
    json.dumps(connection.to_row())


def test_start_authorization_persists_only_a_hashed_owner_bound_pkce_state():
    """Break caught: omitting PKCE, storing raw state, or losing its owner/expiry."""
    from app.teacher.oauth import state_digest

    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    repository = FakeRepository()
    service, _ = oauth_service(repository, FakeGoogleTransport(None), Fernet.generate_key(), now)

    authorization = service.start_authorization("teacher-42")

    query = parse_qs(urlparse(authorization.url).query)
    assert urlparse(authorization.url).scheme == "https"
    assert query["client_id"] == ["teacher-client"]
    assert query["redirect_uri"] == ["https://secret-source.test/teacher/google/callback"]
    assert query["response_type"] == ["code"]
    assert query["access_type"] == ["offline"]
    assert query["prompt"] == ["consent"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["scope"] == ["openid scope.classroom"]
    assert query["state"] == [authorization.state]

    saved = repository.states[state_digest(authorization.state)]
    assert saved.owner == "teacher-42"
    assert saved.expires_at == now + timedelta(minutes=10)
    assert saved.code_verifier not in authorization.url
    assert authorization.state not in vars(saved).values()


def test_start_authorization_forwards_login_hint_and_account_switch_prompt():
    """Break caught: the account selected in the Teacher UI is silently ignored by Google OAuth."""
    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    service, _ = oauth_service(FakeRepository(), FakeGoogleTransport(None), Fernet.generate_key(), now)

    authorization = service.start_authorization(
        "teacher-42", login_hint="other@example.test", switch_account=True
    )

    query = parse_qs(urlparse(authorization.url).query)
    assert query["login_hint"] == ["other@example.test"]
    assert query["prompt"] == ["consent select_account"]


def test_callback_encrypts_refresh_token_and_returns_only_safe_connection_data():
    """Break caught: persisting plaintext refresh credentials or returning them to callers."""
    from app.teacher.models import GoogleTokenResponse

    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    key = Fernet.generate_key()
    repository = FakeRepository()
    service, _ = oauth_service(
        repository,
        FakeGoogleTransport(
            GoogleTokenResponse(
                refresh_token="very-secret-refresh-token",
                subject="google-subject-7",
                email="teacher@example.test",
                scopes=("openid", "scope.classroom"),
                access_token_expires_at=now + timedelta(hours=1),
            )
        ),
        key,
        now,
    )
    authorization = service.start_authorization("teacher-42")

    connected = service.complete_callback(state=authorization.state, code="one-time-code")

    stored = repository.connections["teacher-42"]
    assert stored.refresh_token_ciphertext != "very-secret-refresh-token"
    decrypted = Fernet(key).decrypt(stored.refresh_token_ciphertext.encode()).decode()
    assert decrypted == "very-secret-refresh-token"
    assert connected.owner == "teacher-42"
    assert connected.google_subject == "google-subject-7"
    assert connected.google_email == "teacher@example.test"
    assert not hasattr(connected, "refresh_token")
    assert repository.states[next(iter(repository.states))].consumed_at == now


def test_callback_without_refresh_token_keeps_the_existing_encrypted_token():
    """Break caught: a normal reauthorization clears the usable refresh token."""
    from app.teacher.models import GoogleTokenResponse, TeacherGoogleConnection

    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    key = Fernet.generate_key()
    repository = FakeRepository()
    existing_ciphertext = Fernet(key).encrypt(b"previous-refresh-token").decode()
    repository.connections["teacher-42"] = TeacherGoogleConnection(
        owner="teacher-42",
        google_subject="old-subject",
        google_email="old@example.test",
        refresh_token_ciphertext=existing_ciphertext,
        scopes=("openid",),
        access_token_expires_at=None,
    )
    service, _ = oauth_service(
        repository,
        FakeGoogleTransport(
            GoogleTokenResponse(
                refresh_token=None,
                subject="old-subject",
                email="teacher@example.test",
                scopes=("openid", "scope.classroom"),
                access_token_expires_at=None,
            )
        ),
        key,
        now,
    )
    authorization = service.start_authorization("teacher-42")

    service.complete_callback(state=authorization.state, code="another-code")

    assert repository.connections["teacher-42"].refresh_token_ciphertext == existing_ciphertext


@pytest.mark.parametrize("refresh_token", [None, "fresh-refresh-token"])
def test_callback_rejects_a_different_google_subject_without_overwriting(refresh_token):
    """Break caught: reconnecting another account mixes its data with existing imports."""
    from app.teacher.models import GoogleTokenResponse, TeacherGoogleConnection

    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    key = Fernet.generate_key()
    repository = FakeRepository()
    existing = TeacherGoogleConnection(
        owner="teacher-42",
        google_subject="original-subject",
        google_email="original@example.test",
        refresh_token_ciphertext=Fernet(key).encrypt(b"previous-refresh-token").decode(),
        scopes=("openid",),
        access_token_expires_at=None,
    )
    repository.connections["teacher-42"] = existing
    service, _ = oauth_service(
        repository,
        FakeGoogleTransport(
            GoogleTokenResponse(
                refresh_token=refresh_token,
                subject="different-subject",
                email="different@example.test",
                scopes=("openid", "scope.classroom"),
                access_token_expires_at=None,
            )
        ),
        key,
        now,
    )
    authorization = service.start_authorization("teacher-42")

    with pytest.raises(ValueError, match="disconnect"):
        service.complete_callback(state=authorization.state, code="another-code")

    assert repository.connections["teacher-42"] == existing


@pytest.mark.parametrize("advance", [timedelta(minutes=11), timedelta()])
def test_callback_rejects_expired_or_already_consumed_state_before_token_exchange(advance):
    """Break caught: replayed or expired authorization callbacks reach Google token exchange."""
    now = datetime(2026, 9, 17, 4, 0, tzinfo=UTC)
    repository = FakeRepository()
    transport = FakeGoogleTransport(None)
    clock = [now]
    service, _ = oauth_service(repository, transport, Fernet.generate_key(), lambda: clock[0])
    authorization = service.start_authorization("teacher-42")
    if not advance:
        saved = repository.states[next(iter(repository.states))]
        saved.consumed_at = now

    clock[0] = now + advance
    with pytest.raises(ValueError, match="state"):
        service.complete_callback(state=authorization.state, code="replayed-code")

    assert transport.exchanges == []
