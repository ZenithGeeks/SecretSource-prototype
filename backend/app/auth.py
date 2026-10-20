"""Who is asking: the Supabase user behind a request, or nobody.

The web app signs users in with Supabase and sends the session's access token as
`Authorization: Bearer <token>`, on every request including the event stream. A token in the
URL is ignored: access logs record URLs, so anyone who can read the logs could reuse it (#134).
We ask Supabase who the token belongs to and keep the answer for a few minutes, so a page that
makes ten requests does not make ten lookups.

On Cloud Run, the Vercel proxy (frontend/api/[...path].ts) spends the gateway's own
Authorization header on the Google identity token Cloud Run's IAM requires, and relays the
user's Supabase token as X-User-Authorization instead. That header wins when present; a
direct caller with no such proxy in front (local dev, docker compose, ss-core) still works
with a plain Authorization header, since there is no Google token there to make room for.

Without Supabase configured, login is off: every caller is nobody, the owner is None, and the
gateway works as one shared space, as it did before login existed. With Supabase configured, a
request with no token is a 401, like a token Supabase rejects. Treating it as nobody would show
a signed-in user whose token went missing every analysis without an owner, and would let anyone
list, open or delete those analyses (#147).

MCP clients (/mcp/, app/mcp_server.py) have no Supabase session; they come through Gatehouse
with a Gatehouse key instead. See gatehouse_user.
"""

import asyncio
import hashlib
import hmac
import os
import threading
import time

from fastapi import HTTPException, Request

CACHE_SECONDS = 300

_cache: dict[str, tuple[str, float]] = {}  # sha256(token) -> (user id, expiry)
_ids_by_email: dict[str, tuple[str, float]] = {}  # email -> (user id, expiry)
_cache_lock = threading.Lock()


def _supabase_configured() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def _token(request: Request) -> str:
    header = request.headers.get("x-user-authorization") or request.headers.get("authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else ""


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
    """FastAPI dependency: the signed-in user's id, or None when login is off."""
    if not _supabase_configured():
        return None
    token = _token(request)
    if not token:
        raise HTTPException(401, "sign in to use SecretSource")
    user_id = await asyncio.to_thread(_user_id_for, token)
    if user_id is None:
        raise HTTPException(401, "the session has expired, sign in again")
    return user_id


async def gatehouse_user(request: Request) -> str | None:
    """The SecretSource user behind a Gatehouse key, for /mcp/; None when login is off.

    Gatehouse (APISIX) checks the caller's key, then sends the key holder's email in
    X-Consumer-Custom-ID and a secret only Gatehouse and the gateway know in X-Gatehouse-Secret.
    APISIX sets both headers itself, so a caller cannot choose them. The email counts only with
    the right secret: without it, anyone who reaches the gateway could name any email.

    Raises:
        HTTPException: 401 without the secret, 403 for a key with no email or an email with no
            SecretSource account.
    """
    if not _supabase_configured():
        return None
    secret = os.getenv("GATEHOUSE_SECRET", "")
    sent = request.headers.get("x-gatehouse-secret", "")
    if not secret or not hmac.compare_digest(sent.encode(), secret.encode()):
        raise HTTPException(401, "call /mcp/ through Gatehouse, with your Gatehouse key")
    email = request.headers.get("x-consumer-custom-id", "").strip().lower()
    if not email:
        raise HTTPException(403, "this Gatehouse key has no email; ask the Gatehouse admin to set one")
    user_id = await asyncio.to_thread(_user_id_for_email, email)
    if user_id is None:
        raise HTTPException(403, f"no SecretSource account signs in as {email}")
    return user_id


def _user_id_for_email(email: str) -> str | None:
    """The id of the Supabase user with this email, or None. Supabase's admin API has no lookup
    by email, so this pages through the users; the team has tens of them, not thousands."""
    now = time.monotonic()
    with _cache_lock:
        cached = _ids_by_email.get(email)
        if cached and cached[1] > now:
            return cached[0]

    from app import store

    page = 1
    while users := store._supabase().auth.admin.list_users(page=page, per_page=1000):
        for user in users:
            # An unconfirmed sign-up could claim anyone's email, so only a confirmed one counts.
            if (user.email or "").lower() == email and user.email_confirmed_at:
                with _cache_lock:
                    _ids_by_email[email] = (user.id, now + CACHE_SECONDS)
                return user.id
        page += 1
    return None
