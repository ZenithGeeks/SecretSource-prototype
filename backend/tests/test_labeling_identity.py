"""Who is labeling: the name from the Supabase account, the lead check, and the cache between."""

import asyncio
from types import SimpleNamespace

import pytest
from app import auth, store
from app.labeling import identity
from fastapi import HTTPException


def request_with(token: str | None):
    headers = {"authorization": f"Bearer {token}"} if token else {}
    return SimpleNamespace(headers=headers)


class FakeSupabase:
    """Answers auth.get_user and auth.admin.get_user_by_id with one account, and counts the asks."""

    def __init__(self, user):
        self.user = user
        self.calls = 0
        self.auth = SimpleNamespace(get_user=self._get, admin=SimpleNamespace(get_user_by_id=self._get))

    def _get(self, _key):
        self.calls += 1
        return SimpleNamespace(user=self.user)


@pytest.fixture(autouse=True)
def clean_cache(monkeypatch):
    monkeypatch.setattr(identity, "_cache", {})


@pytest.fixture
def supabase(monkeypatch):
    def install(user):
        fake = FakeSupabase(user)
        monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
        monkeypatch.setattr(store, "_supabase", lambda: fake)
        return fake

    return install


def account(full_name="Chanya Wong", email="chanya@example.com"):
    return SimpleNamespace(user_metadata={"full_name": full_name}, email=email)


def test_annotator_is_local_when_login_is_off(monkeypatch):
    monkeypatch.setattr(auth, "_supabase_configured", lambda: False)
    assert asyncio.run(identity.annotator(request_with(None))) == identity.LOCAL


def test_annotator_needs_a_token(supabase):
    supabase(account())
    with pytest.raises(HTTPException) as caught:
        asyncio.run(identity.annotator(request_with(None)))
    assert caught.value.status_code == 401


def test_annotator_is_the_full_name_of_the_account(supabase):
    supabase(account())
    assert asyncio.run(identity.annotator(request_with("t"))) == "Chanya Wong"


def test_annotator_falls_back_to_the_start_of_the_email(supabase):
    supabase(account(full_name="  "))
    assert asyncio.run(identity.annotator(request_with("t"))) == "chanya"


def test_annotator_with_no_metadata_still_has_a_name(supabase):
    supabase(SimpleNamespace(user_metadata=None, email="kim@example.com"))
    assert asyncio.run(identity.annotator(request_with("t"))) == "kim"


def test_an_expired_session_is_a_401(supabase):
    supabase(None)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(identity.annotator(request_with("t")))
    assert caught.value.status_code == 401


def test_a_profile_is_looked_up_once_per_token(supabase):
    fake = supabase(account())
    asyncio.run(identity.annotator(request_with("t")))
    asyncio.run(identity.annotator(request_with("t")))
    assert fake.calls == 1


def test_a_cached_profile_expires(supabase, monkeypatch):
    fake = supabase(account())
    asyncio.run(identity.annotator(request_with("t")))
    monkeypatch.setattr(identity.time, "monotonic", lambda: 10**9)
    asyncio.run(identity.annotator(request_with("t")))
    assert fake.calls == 2


def test_everyone_is_a_lead_when_login_is_off(monkeypatch):
    monkeypatch.setattr(auth, "_supabase_configured", lambda: False)
    assert asyncio.run(identity.is_lead(request_with(None))) is True


def test_is_lead_needs_a_token(supabase):
    supabase(account())
    with pytest.raises(HTTPException) as caught:
        asyncio.run(identity.is_lead(request_with(None)))
    assert caught.value.status_code == 401


@pytest.mark.parametrize(("email", "expected"), [("Chanya@Example.com", True), ("other@example.com", False)])
def test_is_lead_matches_the_email_against_labeling_leads(supabase, monkeypatch, email, expected):
    supabase(account(email=email))
    monkeypatch.setattr("app.config.LABELING_LEADS", frozenset({"chanya@example.com"}))
    assert asyncio.run(identity.is_lead(request_with("t"))) is expected


def test_annotator_for_no_account_is_local():
    assert identity.annotator_for(None) == identity.LOCAL


def test_annotator_for_an_account_id_is_its_name_and_is_cached(supabase):
    fake = supabase(account())
    assert identity.annotator_for("u1") == "Chanya Wong"
    assert identity.annotator_for("u1") == "Chanya Wong"
    assert fake.calls == 1


def test_annotator_for_an_account_with_no_name_uses_the_email(supabase):
    supabase(account(full_name=""))
    assert identity.annotator_for("u1") == "chanya"


def test_annotator_for_an_unknown_account_is_a_403(supabase):
    supabase(None)
    with pytest.raises(HTTPException) as caught:
        identity.annotator_for("u1")
    assert caught.value.status_code == 403


def test_annotator_for_a_cached_account_uses_the_email_when_the_name_is_empty(supabase):
    supabase(account(full_name=""))
    identity.annotator_for("u1")
    assert identity.annotator_for("u1") == "chanya"
