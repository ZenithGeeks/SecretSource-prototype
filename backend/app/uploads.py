"""Upload a paper's PDF straight to the papers bucket, past the web proxy's body limit (#266).

Every browser request goes through the Vercel proxy, which refuses a body over 4.5 MB. So the
browser asks POST /uploads for an upload URL, PUTs the PDF to Cloud Storage itself, and then
starts the analysis with POST /analyses/from-upload. The bucket is mounted at PAPERS_DIR on the
gateway and on the worker, so the file ends up where an upload through the gateway would.

The upload URL is a resumable upload session that the gateway starts with its own credentials.
The session URL lets whoever holds it upload that one object of that one size, so the browser
needs no Google credentials and the gateway needs no key to sign with.
"""

import re
import secrets
from pathlib import Path
from urllib.parse import quote

from app import store
from app.config import PAPERS_BUCKET

MAX_UPLOAD_BYTES = 100 * 2**20  # the limit uploads had behind nginx (client_max_body_size)
SESSIONS_URL = "https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o"
OBJECT_NAME = re.compile(r"[A-Za-z0-9._-]+-[0-9a-f]{12}\.pdf")


class UploadUnavailable(Exception):
    """Cloud Storage would not start an upload session."""


def object_name(filename: str) -> str:
    """A new object name for an upload: <stem>-<12 random hex>.pdf, like save_upload's names.

    The content is not known yet, so the 12 hex are random rather than a hash of the bytes.
    """
    stem = Path(Path(filename).name).stem.lstrip(".")
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-")[:80] or "paper"
    return f"{stem}-{secrets.token_hex(6)}.pdf"


def start_upload(filename: str, size: int, origin: str, owner: str | None) -> dict:
    """A URL the browser can PUT one PDF of `size` bytes to, from the page at `origin`.

    The object is recorded as the owner's, so only they can start an analysis of it.

    Raises:
        UploadUnavailable: Cloud Storage did not answer with a session.
    """
    name = object_name(filename)
    url = _upload_session(name, size, origin)
    store.remember_cache(store.cache_key("upload", name), {"owner": owner})
    return {"object": name, "url": url, "headers": {"Content-Type": "application/pdf"}}


def is_owner(name: str, owner: str | None) -> bool:
    """Whether `owner` asked for the upload URL of the object `name`."""
    if not OBJECT_NAME.fullmatch(name):
        return False
    record = store.recall_cache(store.cache_key("upload", name))
    return record is not None and record.get("owner") == owner


def _upload_session(name: str, size: int, origin: str) -> str:
    """Start a resumable upload of gs://PAPERS_BUCKET/name and return its session URL.

    Cloud Storage refuses a body of any other length than `size`. The Origin header makes the
    session answer the browser's cross-origin PUT, as far as the bucket's CORS rule allows it.
    """
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/devstorage.read_write"])
    response = AuthorizedSession(credentials).post(
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
        raise UploadUnavailable(f"Cloud Storage answered {response.status_code} to {quote(name)}")
    return response.headers["Location"]
