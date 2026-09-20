"""Small, owner-scoped read-only Google Classroom boundary for the Teacher import flow."""
from __future__ import annotations

import base64, hashlib, os, secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import requests
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app import config, store
from app.auth import current_user

router = APIRouter(prefix="/teacher", tags=["teacher"])
SCOPES = (
    "openid https://www.googleapis.com/auth/userinfo.email "
    "https://www.googleapis.com/auth/classroom.courses.readonly "
    "https://www.googleapis.com/auth/classroom.rosters.readonly "
    "https://www.googleapis.com/auth/classroom.coursework.students.readonly "
    "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly "
    "https://www.googleapis.com/auth/classroom.announcements.readonly "
    "https://www.googleapis.com/auth/classroom.topics.readonly "
    "https://www.googleapis.com/auth/drive.readonly"
)

def _owner(user: str | None = Depends(current_user)) -> str:
    if not user: raise HTTPException(401, "sign in to use Google Classroom")
    if not config.TEACHER_GOOGLE_ENABLED: raise HTTPException(503, "Google Classroom is disabled")
    return user

def _db():
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY: raise HTTPException(503, "Google Classroom persistence is not configured")
    return store._supabase()

def _state_hash(value: str) -> str: return hashlib.sha256(value.encode()).hexdigest()
def _challenge(value: str) -> str: return base64.urlsafe_b64encode(hashlib.sha256(value.encode()).digest()).rstrip(b"=").decode()

@router.get("/google/status")
def status(owner: str = Depends(_owner)):
    rows = _db().table("teacher_google_connections").select("google_email").eq("owner", owner).limit(1).execute().data
    return {"connected": bool(rows), "email": rows[0].get("google_email") if rows else None}

@router.get("/google/connect")
def connect(loginHint: str | None = None, switch: bool = False, owner: str = Depends(_owner)):
    if not all((config.TEACHER_GOOGLE_CLIENT_ID, config.TEACHER_GOOGLE_CLIENT_SECRET, config.TEACHER_GOOGLE_REDIRECT_URI, config.TEACHER_GOOGLE_ENCRYPTION_KEY)):
        raise HTTPException(503, "Google Classroom OAuth is not configured")
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    _db().table("teacher_google_oauth_states").insert({"state_hash": _state_hash(state), "owner": owner, "verifier": verifier, "expires_at": (datetime.now(UTC)+timedelta(minutes=10)).isoformat()}).execute()
    query = {"client_id": config.TEACHER_GOOGLE_CLIENT_ID, "redirect_uri": config.TEACHER_GOOGLE_REDIRECT_URI, "response_type": "code", "scope": SCOPES, "access_type": "offline", "include_granted_scopes": "true", "code_challenge": _challenge(verifier), "code_challenge_method": "S256", "state": state}
    if loginHint: query["login_hint"] = loginHint
    if switch: query["prompt"] = "select_account consent"
    return {"authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(query)}

@router.get("/google/callback")
def callback(state: str, code: str):
    db = _db(); rows = db.table("teacher_google_oauth_states").select("*").eq("state_hash", _state_hash(state)).is_("used_at", "null").limit(1).execute().data
    if not rows: raise HTTPException(400, "invalid or expired OAuth state")
    saved = rows[0]
    if datetime.fromisoformat(saved["expires_at"].replace("Z", "+00:00")) <= datetime.now(UTC): raise HTTPException(400, "expired OAuth state")
    db.table("teacher_google_oauth_states").update({"used_at": datetime.now(UTC).isoformat()}).eq("id", saved["id"]).is_("used_at", "null").execute()
    token = requests.post("https://oauth2.googleapis.com/token", data={"code": code, "client_id": config.TEACHER_GOOGLE_CLIENT_ID, "client_secret": config.TEACHER_GOOGLE_CLIENT_SECRET, "redirect_uri": config.TEACHER_GOOGLE_REDIRECT_URI, "grant_type": "authorization_code", "code_verifier": saved["verifier"]}, timeout=30); token.raise_for_status(); payload = token.json()
    refresh = payload.get("refresh_token")
    if not refresh: raise HTTPException(400, "Google did not return a refresh token")
    me = requests.get("https://openidconnect.googleapis.com/v1/userinfo", headers={"Authorization": f"Bearer {payload['access_token']}"}, timeout=30); me.raise_for_status(); profile = me.json()
    db.table("teacher_google_connections").upsert({"owner": saved["owner"], "google_subject": profile["sub"], "google_email": profile.get("email"), "refresh_token_ciphertext": Fernet(config.TEACHER_GOOGLE_ENCRYPTION_KEY.encode()).encrypt(refresh.encode()).decode()}, on_conflict="owner").execute()
    return RedirectResponse(config.TEACHER_GOOGLE_SUCCESS_REDIRECT, status_code=303)
