from types import SimpleNamespace

import pytest
import set_role
from app import auth, store


def _fake_admin(monkeypatch, user_id: str | None) -> list:
    updates = []
    monkeypatch.setattr(auth, "_user_id_for_email", lambda email: user_id if email == "a@x.org" else None)
    admin = SimpleNamespace(update_user_by_id=lambda uid, attrs: updates.append((uid, attrs)))
    monkeypatch.setattr(store, "_supabase", lambda: SimpleNamespace(auth=SimpleNamespace(admin=admin)))
    return updates


def test_the_role_goes_in_app_metadata(monkeypatch):
    updates = _fake_admin(monkeypatch, "u1")
    assert set_role.set_role(" A@x.org ", "labeler") == "u1"
    assert updates == [("u1", {"app_metadata": {"role": "labeler"}})]


def test_an_unknown_email_writes_nothing(monkeypatch):
    updates = _fake_admin(monkeypatch, "u1")
    with pytest.raises(LookupError):
        set_role.set_role("b@x.org", "labeler")
    assert updates == []
