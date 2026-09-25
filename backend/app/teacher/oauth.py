"""Direct authorization-code Google OAuth with PKCE and server-side state."""

from __future__ import annotations

import base64
import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from urllib.parse import urlencode

import requests

from app.teacher.crypto import RefreshTokenCipher
from app.teacher.models import (
    ConnectedTeacher,
    GoogleTokenResponse,
    OAuthState,
    TeacherGoogleConnection,
)
from app.teacher.repository import TeacherGoogleRepository

GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def state_digest(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@dataclass(frozen=True)
class GoogleOAuthSettings:
    client_id: str
    redirect_uri: str
    scopes: tuple[str, ...]
    state_ttl: timedelta


@dataclass(frozen=True)
class AuthorizationStart:
    url: str
    state: str


class GoogleOAuthTransport(Protocol):
    def exchange_authorization_code(
        self, *, code: str, code_verifier: str, redirect_uri: str
    ) -> GoogleTokenResponse: ...


class GoogleAuthorizationCodeTransport:
    """The real Google HTTP boundary; tests inject a transport instead."""

    def __init__(self, client_id: str, client_secret: str, http: requests.Session | None = None):
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = http or requests.Session()

    def exchange_authorization_code(
        self, *, code: str, code_verifier: str, redirect_uri: str
    ) -> GoogleTokenResponse:
        token_response = self._http.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
            timeout=30,
        )
        token_response.raise_for_status()
        token = token_response.json()
        access_token = token.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise ValueError("Google token response did not include an access token")

        identity_response = self._http.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30,
        )
        identity_response.raise_for_status()
        identity = identity_response.json()
        subject = identity.get("sub")
        if not isinstance(subject, str) or not subject:
            raise ValueError("Google userinfo response did not include a subject")

        expires_in = token.get("expires_in")
        expires_at = (
            datetime.now(UTC) + timedelta(seconds=int(expires_in))
            if isinstance(expires_in, (int, float, str))
            else None
        )
        scopes = tuple(scope for scope in str(token.get("scope", "")).split() if scope)
        return GoogleTokenResponse(
            refresh_token=token.get("refresh_token"),
            subject=subject,
            email=identity.get("email") if isinstance(identity.get("email"), str) else None,
            scopes=scopes,
            access_token_expires_at=expires_at,
        )


class TeacherGoogleOAuthService:
    def __init__(
        self,
        *,
        repository: TeacherGoogleRepository,
        transport: GoogleOAuthTransport,
        encryption_key: str | bytes,
        settings: GoogleOAuthSettings,
        now: Callable[[], datetime] | None = None,
    ):
        self._repository = repository
        self._transport = transport
        self._cipher = RefreshTokenCipher(encryption_key)
        self._settings = settings
        self._now = now or (lambda: datetime.now(UTC))

    def start_authorization(
        self, owner: str, *, login_hint: str | None = None, switch_account: bool = False
    ) -> AuthorizationStart:
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        now = self._now()
        self._repository.save_oauth_state(
            OAuthState(
                state_hash=state_digest(state),
                owner=owner,
                code_verifier=verifier,
                redirect_uri=self._settings.redirect_uri,
                expires_at=now + self._settings.state_ttl,
            )
        )
        parameters = {
                "client_id": self._settings.client_id,
                "redirect_uri": self._settings.redirect_uri,
                "response_type": "code",
                "scope": " ".join(self._settings.scopes),
                "access_type": "offline",
                "prompt": "consent select_account" if switch_account else "consent",
                "include_granted_scopes": "true",
                "code_challenge": _pkce_challenge(verifier),
                "code_challenge_method": "S256",
                "state": state,
        }
        if login_hint:
            parameters["login_hint"] = login_hint
        query = urlencode(parameters)
        return AuthorizationStart(url=f"{GOOGLE_AUTHORIZATION_URL}?{query}", state=state)

    def complete_callback(self, *, state: str, code: str) -> ConnectedTeacher:
        saved_state = self._repository.consume_oauth_state(state_digest(state), self._now())
        if saved_state is None:
            raise ValueError("invalid, expired, or already-consumed OAuth state")
        token = self._transport.exchange_authorization_code(
            code=code,
            code_verifier=saved_state.code_verifier,
            redirect_uri=saved_state.redirect_uri,
        )
        existing = self._repository.get_connection(saved_state.owner)
        if token.refresh_token:
            ciphertext = self._cipher.encrypt(token.refresh_token)
        elif existing is not None:
            if existing.google_subject != token.subject:
                raise ValueError(
                    "Google account changed during reauthorization; reconnect with the original account"
                )
            ciphertext = existing.refresh_token_ciphertext
        else:
            raise ValueError("Google did not return a refresh token for this new connection")

        connection = TeacherGoogleConnection(
            owner=saved_state.owner,
            google_subject=token.subject,
            google_email=token.email,
            refresh_token_ciphertext=ciphertext,
            scopes=token.scopes,
            access_token_expires_at=token.access_token_expires_at,
        )
        self._repository.save_connection(connection)
        return ConnectedTeacher(
            owner=connection.owner,
            google_subject=connection.google_subject,
            google_email=connection.google_email,
            scopes=connection.scopes,
        )
