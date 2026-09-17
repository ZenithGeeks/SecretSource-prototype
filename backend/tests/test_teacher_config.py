"""Configuration contracts for the optional Teacher Google Classroom integration."""

import importlib

import pytest
from app import config

GOOGLE_ENV = (
    "TEACHER_GOOGLE_ENABLED",
    "TEACHER_GOOGLE_CLIENT_ID",
    "TEACHER_GOOGLE_CLIENT_SECRET",
    "TEACHER_GOOGLE_REDIRECT_URI",
    "TEACHER_GOOGLE_ENCRYPTION_KEY",
    "TEACHER_GOOGLE_SCOPES",
    "TEACHER_GOOGLE_STATE_TTL_SECONDS",
    "TEACHER_GOOGLE_RETRY_ATTEMPTS",
    "TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS",
    "TEACHER_GOOGLE_REQUEST_TIMEOUT_SECONDS",
)


def _clear_google_env(monkeypatch):
    for name in GOOGLE_ENV:
        monkeypatch.delenv(name, raising=False)


def _reload_config(monkeypatch):
    monkeypatch.setenv("SERVICE_AUTH", "none")
    return importlib.reload(config)


def test_google_classroom_settings_are_optional_for_local_mock(monkeypatch):
    _clear_google_env(monkeypatch)

    settings = _reload_config(monkeypatch)

    assert settings.TEACHER_GOOGLE_ENABLED is False
    assert settings.TEACHER_GOOGLE_CLIENT_ID == ""
    assert settings.TEACHER_GOOGLE_CLIENT_SECRET == ""
    assert settings.TEACHER_GOOGLE_REDIRECT_URI == ""
    assert settings.TEACHER_GOOGLE_ENCRYPTION_KEY == ""
    assert "https://www.googleapis.com/auth/classroom.courses.readonly" in settings.TEACHER_GOOGLE_SCOPES


def test_enabled_google_classroom_requires_oauth_settings(monkeypatch):
    _clear_google_env(monkeypatch)
    monkeypatch.setenv("TEACHER_GOOGLE_ENABLED", "true")

    with pytest.raises(ValueError, match="TEACHER_GOOGLE_CLIENT_ID"):
        _reload_config(monkeypatch)

    monkeypatch.setenv("TEACHER_GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("TEACHER_GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("TEACHER_GOOGLE_REDIRECT_URI", "https://example.test/oauth/callback")
    monkeypatch.setenv("TEACHER_GOOGLE_ENCRYPTION_KEY", "test-key")
    settings = _reload_config(monkeypatch)

    assert settings.TEACHER_GOOGLE_ENABLED is True


def test_google_classroom_settings_parse_scopes_and_retry_values(monkeypatch):
    _clear_google_env(monkeypatch)
    monkeypatch.setenv("TEACHER_GOOGLE_ENABLED", "1")
    monkeypatch.setenv("TEACHER_GOOGLE_CLIENT_ID", "client-id")
    monkeypatch.setenv("TEACHER_GOOGLE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("TEACHER_GOOGLE_REDIRECT_URI", "https://example.test/oauth/callback")
    monkeypatch.setenv("TEACHER_GOOGLE_ENCRYPTION_KEY", "test-key")
    monkeypatch.setenv("TEACHER_GOOGLE_SCOPES", "scope.one, scope.two scope.three")
    monkeypatch.setenv("TEACHER_GOOGLE_STATE_TTL_SECONDS", "900")
    monkeypatch.setenv("TEACHER_GOOGLE_RETRY_ATTEMPTS", "4")
    monkeypatch.setenv("TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS", "0.25")
    monkeypatch.setenv("TEACHER_GOOGLE_REQUEST_TIMEOUT_SECONDS", "12.5")

    settings = _reload_config(monkeypatch)

    assert settings.TEACHER_GOOGLE_SCOPES == ("scope.one", "scope.two", "scope.three")
    assert settings.TEACHER_GOOGLE_STATE_TTL_SECONDS == 900
    assert settings.TEACHER_GOOGLE_RETRY_ATTEMPTS == 4
    assert settings.TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS == 0.25
    assert settings.TEACHER_GOOGLE_REQUEST_TIMEOUT_SECONDS == 12.5
