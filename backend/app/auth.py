"""Who is asking: the Supabase user behind a request, or nobody.

The web app signs users in with Supabase and sends the session's access token, as
`Authorization: Bearer <token>` or, for the event stream (EventSource cannot send headers),
as the `access_token` query parameter. We ask Supabase who the token belongs to and keep the
answer for a few minutes, so a page that makes ten requests does not make ten lookups.

No token, or no Supabase configured, means nobody: the owner is None and the gateway works
as one shared space, as it did before login existed. A token that Supabase rejects is a 401.
"""

import asyncio
import hashlib
import os
import threading
import time

from fastapi import HTTPException, Request

CACHE_SECONDS = 300

_cache: dict[str, tuple[str, float]] = {}  # sha256(token) -> (user id, expiry)
_cache_lock = threading.Lock()


def _supabase_configured() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def _token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.query_params.get("access_token", "").strip()


def _user_id_for(token: str) -> str | None:
    """The user id Supabase gives for this token, or None if it is not a valid session."""
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(key)
        if cached and cached[1] > now:
            return cached[0]

    from app import store

    try:
        answer = store._supabase().auth.get_user(token)
    except Exception:
        return None
    user = getattr(answer, "user", None)
    if user is None:
        return None
    with _cache_lock:
        _cache[key] = (user.id, now + CACHE_SECONDS)
    return user.id


async def current_user(request: Request) -> str | None:
    """FastAPI dependency: the signed-in user's id, or None when nobody is signed in."""
    token = _token(request)
    if not token or not _supabase_configured():
        return None
    user_id = await asyncio.to_thread(_user_id_for, token)
    if user_id is None:
        raise HTTPException(401, "the session has expired, sign in again")
    return user_id
