from app import auth
from app.auth import _token, acting_user, current_user
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request


def _request(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
    }
    return Request(scope)


def test_x_user_authorization_wins_when_both_headers_are_present():
    request = _request(
        {"x-user-authorization": "Bearer user-token", "authorization": "Bearer google-id-token"}
    )
    assert _token(request) == "user-token"


def test_authorization_alone_still_works_for_a_direct_caller():
    assert _token(_request({"authorization": "Bearer user-token"})) == "user-token"


def test_no_bearer_token_at_all_is_empty():
    assert _token(_request({})) == ""


def test_the_signed_in_user_is_the_acting_user_inside_the_route(monkeypatch):
    # app.llm reads acting_user to say whom each LLM call is for, so it must reach the route.
    monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
    monkeypatch.setattr(auth, "_user_id_for", lambda token: "user-a")
    app = FastAPI()

    @app.get("/who")
    async def who(user: str | None = Depends(current_user)):
        return {"acting": acting_user.get()}

    response = TestClient(app).get("/who", headers={"authorization": "Bearer token"})

    assert response.json() == {"acting": "user-a"}


def _who_app() -> TestClient:
    app = FastAPI()

    @app.get("/who")
    async def who(user: str | None = Depends(current_user)):
        return {"user": user}

    return TestClient(app)


def _signed_in_as(monkeypatch, email: str, team: frozenset[str]) -> None:
    from app import config

    monkeypatch.setattr(auth, "_supabase_configured", lambda: True)
    monkeypatch.setattr(auth, "_user_for", lambda token: ("user-a", email))
    monkeypatch.setattr(config, "TEAM_EMAILS", team)


def test_an_account_on_the_team_list_gets_in(monkeypatch):
    _signed_in_as(monkeypatch, "Ada@Example.com", frozenset({"ada@example.com"}))

    response = _who_app().get("/who", headers={"authorization": "Bearer token"})

    assert response.json() == {"user": "user-a"}


def test_an_account_off_the_team_list_is_refused(monkeypatch):
    _signed_in_as(monkeypatch, "stranger@example.com", frozenset({"ada@example.com"}))

    response = _who_app().get("/who", headers={"authorization": "Bearer token"})

    assert response.status_code == 403
    assert "stranger@example.com" in response.json()["detail"]


def test_an_empty_team_list_lets_every_account_in(monkeypatch):
    _signed_in_as(monkeypatch, "stranger@example.com", frozenset())

    response = _who_app().get("/who", headers={"authorization": "Bearer token"})

    assert response.json() == {"user": "user-a"}


def test_a_lookup_is_cached_with_its_email(monkeypatch):
    calls = []

    class Answer:
        user = type("User", (), {"id": "user-b", "email": "bo@example.com"})()

    class Auth:
        def get_user(self, token):
            calls.append(token)
            return Answer()

    from app import store

    monkeypatch.setattr(store, "_supabase", lambda: type("Client", (), {"auth": Auth()})())
    auth._cache.clear()

    assert auth._user_for("fresh-token") == ("user-b", "bo@example.com")
    assert auth._user_id_for("fresh-token") == "user-b"
    assert calls == ["fresh-token"]
