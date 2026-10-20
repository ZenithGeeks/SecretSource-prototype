"""Who is labeling: the name written to every row's `annotator` column.

It comes from the Supabase account behind the token, never from the request body, so nobody can
label as somebody else. Anyone signed in may label.
"""

import asyncio
import hashlib
import threading
import time

from fastapi import HTTPException, Request

from app import auth

CACHE_SECONDS = 300
LOCAL = "local"  # login is off: one shared space, as everywhere else in the gateway

_cache: dict[str, tuple[tuple[str, str], float]] = {}
_lock = threading.Lock()


def _profile(token: str) -> tuple[str, str]:
    """(full name, e-mail) of the account behind this token, kept a few minutes."""
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _lock:
        cached = _cache.get(key)
        if cached and cached[1] > now:
            return cached[0]
    from app import store

    user = getattr(store._supabase().auth.get_user(token), "user", None)
    if user is None:
        raise HTTPException(401, "the session has expired, sign in again")
    meta = getattr(user, "user_metadata", None) or {}
    profile = (str(meta.get("full_name") or "").strip(), str(user.email or "").strip())
    with _lock:
        _cache[key] = (profile, now + CACHE_SECONDS)
    return profile


async def annotator(request: Request) -> str:
    """FastAPI dependency: the labeler's name, or 401/403."""
    if not auth._supabase_configured():
        return LOCAL
    token = auth._token(request)
    if not token:
        raise HTTPException(401, "sign in to use SecretSource")
    name, email = await asyncio.to_thread(_profile, token)
    return name or email.split("@")[0]


def annotator_for(user_id: str | None) -> str:
    """The labeler's name for an account id, for callers with no Supabase token (the MCP server).

    Raises:
        HTTPException: 403 when Supabase has no such account.
    """
    if user_id is None:
        return LOCAL
    key = f"id:{user_id}"
    now = time.monotonic()
    with _lock:
        cached = _cache.get(key)
        if cached and cached[1] > now:
            return cached[0][0] or cached[0][1].split("@")[0]
    from app import store

    user = getattr(store._supabase().auth.admin.get_user_by_id(user_id), "user", None)
    if user is None:
        raise HTTPException(403, "this account is not a SecretSource account")
    meta = getattr(user, "user_metadata", None) or {}
    profile = (str(meta.get("full_name") or "").strip(), str(user.email or "").strip())
    with _lock:
        _cache[key] = (profile, now + CACHE_SECONDS)
    return profile[0] or profile[1].split("@")[0]
