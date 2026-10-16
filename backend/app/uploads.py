"""Upload a paper's PDF straight to the papers bucket, past the web proxy's body limit (#266).

Every browser request goes through the Vercel proxy, which refuses a body over 4.5 MB. So the
browser asks POST /uploads for an upload URL, PUTs the PDF to Cloud Storage itself, and then
starts the analysis with POST /analyses/from-upload. The bucket is mounted at PAPERS_DIR on the
gateway and on the worker, so the file ends up where an upload through the gateway would.

The upload URL is a resumable upload session that the gateway starts with its own credentials,
so it needs no key to sign with. The session URL works like a password: whoever holds it can
upload that one object, of exactly the size the browser declared, until the session expires.
"""

import functools
import re
import secrets
from pathlib import Path

from app import store
from app.config import PAPERS_BUCKET, UPLOAD_ORIGINS

MAX_UPLOAD_BYTES = 100 * 2**20  # the limit paper uploads have always had
SESSIONS_URL = "https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o"
# The names object_name makes. Checking a name against it also keeps "../" out of a path.
OBJECT_NAME = re.compile(r"[A-Za-z0-9._-]+-[0-9a-f]{12}\.pdf")


class UploadRefused(Exception):
    """Cloud Storage would not start an upload session."""


def object_name(filename: str) -> str:
    """A new object name for an upload: <stem>-<12 random hex>.pdf, like save_upload's names.

    The content is not known yet, so the 12 hex are random rather than a hash of the bytes.
    """
    stem = Path(Path(filename).name).stem.lstrip(".")
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-")[:80] or "paper"
    return f"{stem}-{secrets.token_hex(6)}.pdf"


def start_upload(filename: str, size: int, origin: str, owner: str | None) -> dict:
    """An upload session for one PDF of `size` bytes, PUT from a page at `origin`.

    The upload is recorded as the owner's, with its size, so only they can analyse it, once.

    Raises:
        PermissionError: `origin` is not in UPLOAD_ORIGINS.
        UploadRefused: Cloud Storage would not start the session.
    """
    if origin not in UPLOAD_ORIGINS:
        raise PermissionError(f"uploads are not allowed from {origin or 'a page with no Origin'}")
    name = object_name(filename)
    url = _upload_session(name, size, origin)
    store.remember_cache(_record_key(name), {"owner": owner, "size": size, "claimed": False})
    return {"object": name, "url": url, "headers": {"Content-Type": "application/pdf"}}


def claim(name: str, owner: str | None, papers_dir: Path) -> Path:
    """The uploaded PDF `name`, checked and marked as used, so it starts one analysis only.

    Raises:
        LookupError: `owner` was not handed this upload, it was claimed already, or it has not
            reached storage yet.
        ValueError: the stored file is not the declared size, or is not a PDF.
    """
    record = store.recall_cache(_record_key(name)) if OBJECT_NAME.fullmatch(name) else None
    if record is None or record["owner"] != owner or record["claimed"]:
        raise LookupError("no such upload")
    path = papers_dir / name
    try:
        with open(path, "rb") as pdf:
            head = pdf.read(5)
    except FileNotFoundError:
        raise LookupError("the upload has not reached storage") from None
    if path.stat().st_size != record["size"] or head != b"%PDF-":
        raise ValueError("the uploaded file is not the PDF that was announced")
    store.remember_cache(_record_key(name), {**record, "claimed": True})
    return path


def _record_key(name: str) -> str:
    return store.cache_key("upload", name)


def _upload_session(name: str, size: int, origin: str) -> str:
    """Start a resumable upload of gs://PAPERS_BUCKET/name and return its session URL.

    Cloud Storage refuses a body of any other length than `size`. The Origin header makes the
    session answer the browser's cross-origin PUT, which the bucket's CORS rule also allows.
    """
    response = _storage().post(
        SESSIONS_URL.format(bucket=PAPERS_BUCKET),
        params={"uploadType": "resumable", "name": name},
        headers={
            "X-Upload-Content-Type": "application/pdf",
            "X-Upload-Content-Length": str(size),
            "Origin": origin,
        },
        json={"name": name, "contentType": "application/pdf"},
        timeout=30,
    )
    if response.status_code != 200 or "Location" not in response.headers:
        raise UploadRefused(f"Cloud Storage answered {response.status_code} for {name}")
    return response.headers["Location"]


@functools.cache
def _storage():
    """One authorised HTTP session for Cloud Storage, with the gateway's own credentials. It
    refreshes its token by itself, so the metadata server is asked once an hour, not per upload."""
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    scope = "https://www.googleapis.com/auth/devstorage.read_write"
    credentials, _ = google.auth.default(scopes=[scope])
    return AuthorizedSession(credentials)
