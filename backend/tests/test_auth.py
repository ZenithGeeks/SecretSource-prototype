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
