from starlette.requests import Request

from app.auth import _token


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
