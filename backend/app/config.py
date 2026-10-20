"""Central configuration. Every setting is an environment variable.

`.env` covers host runs. docker compose reads the same file on its own.
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    value = value.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean, got {value!r}")


def _env_int(name: str, default: int, *, minimum: int = 0) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer, got {value!r}") from error
    if parsed < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {parsed}")
    return parsed


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        parsed = float(value)
    except ValueError as error:
        raise ValueError(f"{name} must be a number, got {value!r}") from error
    if parsed < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {parsed}")
    return parsed


def _env_scopes(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return tuple(scope for scope in value.replace(",", " ").split() if scope)

# `or` instead of a default argument, on purpose. .env.example ships these empty.
# An empty string must mean "not set", not "connect to nothing".

# vLLM, or any OpenAI-compatible server. When unset, it means the compose container
# or localhost.
VLLM_URL = os.getenv("VLLM_URL") or "http://localhost:8000/v1"
VLLM_MODEL = os.getenv("VLLM_MODEL") or "qwen"  # must match an id from {VLLM_URL}/models
VLLM_API_KEY = os.getenv("VLLM_API_KEY") or "EMPTY"  # only checked when vLLM was started with a key

# Retrieval services. Each serves plain HTTP under /api and MCP under /mcp.
COLBERT_URL = os.getenv("COLBERT_URL") or "http://localhost:8893"
COLPALI_URL = os.getenv("COLPALI_URL") or "http://localhost:8894"  # optional. Skipped when down

GROBID_URL = os.getenv("GROBID_URL") or "http://localhost:8070"

# The analysis queue's backing store (app/queue.py) and how the gateway hears back from a
# worker running a job in a separate process (main.py's Redis Pub/Sub subscriber).
REDIS_URL = os.getenv("REDIS_URL") or "redis://localhost:6379/0"

# LLM tracing (app/tracing.py). Unset means no tracing. Compose runs Phoenix under
# --profile tracing at http://phoenix:6006. Phoenix Cloud also wants PHOENIX_API_KEY.
PHOENIX_COLLECTOR_ENDPOINT = os.getenv("PHOENIX_COLLECTOR_ENDPOINT") or ""
PHOENIX_PROJECT_NAME = os.getenv("PHOENIX_PROJECT_NAME") or "secretsource"

# How calls to the services above prove who they are.
# `google-id-token` adds a Google identity token to every *.run.app URL.
# `api-key` sends SERVICE_API_KEY in an `apikey` header to the three URLs above, for the team
# gateway in front of the host's GPU services.
# `none` sends nothing, which compose needs.
SERVICE_AUTH = os.getenv("SERVICE_AUTH") or "none"
if SERVICE_AUTH not in ("none", "google-id-token", "api-key"):
    raise ValueError(f"SERVICE_AUTH must be 'none', 'google-id-token' or 'api-key', got {SERVICE_AUTH!r}")
SERVICE_API_KEY = os.getenv("SERVICE_API_KEY") or ""
if SERVICE_AUTH == "api-key" and not SERVICE_API_KEY:
    raise ValueError("SERVICE_AUTH=api-key needs SERVICE_API_KEY: ask the host for your key")

PAPERS_DIR = Path(os.getenv("PAPERS_DIR", "data/papers"))
# The Cloud Storage bucket mounted at PAPERS_DIR in production. When set, the browser uploads
# PDFs straight to it (app/uploads.py); when empty, uploads go through POST /analyses/upload.
PAPERS_BUCKET = os.getenv("PAPERS_BUCKET", "")
# The pages allowed to upload to that bucket, comma-separated. The bucket's CORS rule allows the
# same origins (deploy/cloudrun.sh).
UPLOAD_ORIGINS = {o.strip() for o in os.getenv("UPLOAD_ORIGINS", "").split(",") if o.strip()}
AVATARS_DIR = Path(os.getenv("AVATARS_DIR", "data/avatars"))
ANALYSES_DB = os.getenv("ANALYSES_DB", "data/analyses.db")

# Persistence backend. With both set, the gateway stores analyses and source
# resolutions in Supabase Postgres. It stores the whole analysis as JSON, using the
# service role. It uses this instead of the SQLite file above.
# When unset, it means SQLite, the default for local runs and tests.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Optional, teacher-page-only Google Classroom connection. These credentials are never sent to
# the browser; the public callback goes through the web server's existing /api proxy.
# Source lookups. Without S2_API_KEY, Semantic Scholar rate-limits most calls.
# UNPAYWALL_EMAIL lets Unpaywall answer instead. It is a contact address, not a key.
S2_API_KEY = os.getenv("S2_API_KEY", "")
UNPAYWALL_EMAIL = os.getenv("UNPAYWALL_EMAIL", "")
# Without a key, OpenAlex answers from a small daily budget shared by everyone on the same IP
# address, which on Cloud Run is used up by other tenants. Keys are free (#439).
OPENALEX_API_KEY = os.getenv("OPENALEX_API_KEY", "")
# The labeling page searches Scopus (dev.elsevier.com) for papers to label. Without a key it
# shows that the search is not set up.
SCOPUS_API_KEY = os.getenv("SCOPUS_API_KEY", "")

CLAIM_LIMIT = int(os.getenv("CLAIM_LIMIT", "20"))  # claims kept per paper. 0 keeps all

# How many cited papers are downloaded and indexed at the same time. Indexing uses the
# GPU services, so keep it small.
PARALLEL_SOURCES = int(os.getenv("PARALLEL_SOURCES", "3"))
# How many claims (a paper analysis) or citations (a draft check) are judged at the same time.
# A worker runs one job at a time, so this is that worker's limit. Judging only searches and
# asks the LLM.
PARALLEL_CHECKS = int(os.getenv("PARALLEL_CHECKS", "3"))
# The same two limits for the whole gateway, across every analysis running at once. Each run
# keeps its own limit above too, so runs take turns. Unset, they keep the load of one run.
PARALLEL_SOURCES_TOTAL = int(os.getenv("PARALLEL_SOURCES_TOTAL") or PARALLEL_SOURCES)
PARALLEL_CHECKS_TOTAL = int(os.getenv("PARALLEL_CHECKS_TOTAL") or PARALLEL_CHECKS)
# How many LLM requests this process sends at once, over every caller: analyses, author
# checks and the assistant's agents. The 9arm key allows 3 and refuses the rest with HTTP 429
# (#511). Other processes on the same key are not counted.
LLM_PARALLEL_REQUESTS = int(os.getenv("LLM_PARALLEL_REQUESTS", "3"))
# How many Docling PDF conversions run at once in this process. Each one holds about 2 GB of
# layout and table models while it runs, which killed Cloud Run gateway instances at 4Gi and 8Gi.
DOCLING_PARALLEL = int(os.getenv("DOCLING_PARALLEL", "1"))
# Whether a check also indexes the cited paper's figures in ColPali and gives the judge the
# captions it finds. Off by default: on the 192 production claim/source pairs, verdicts with
# and without it differed no more than two runs of the same setting did (#446), and it kept
# an L4 GPU awake for about $0.75 of the $1.11 an analysis cost. ColBERT already indexes the
# caption text with the rest of each page.
VISUAL_EVIDENCE = _env_flag("VISUAL_EVIDENCE")
# With VISUAL_EVIDENCE on: how long a cited paper's checks wait for its figures. Empty: until they are, so
# every verdict can use the figure captions. A number of seconds is a fast mode: after that the
# check is judged on the text alone, and a later run of the paper gets the figures. On the same
# 15 checks, 0 took 85 s instead of 264 s, and one verdict out of 15 came out wrong (#163).
FIGURE_WAIT = float(os.getenv("FIGURE_WAIT")) if os.getenv("FIGURE_WAIT") else None

# Teacher Google Classroom is deliberately opt-in. Local mock development and tests keep
# working without any Google credentials. When enabled, fail at startup with the names of
# the missing settings rather than failing later during the OAuth redirect.
_DEFAULT_TEACHER_GOOGLE_SCOPES = (
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.profile.emails",
    "https://www.googleapis.com/auth/classroom.coursework.students",
    "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
    "https://www.googleapis.com/auth/classroom.announcements.readonly",
    "https://www.googleapis.com/auth/classroom.topics.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/gmail.send",
)

TEACHER_GOOGLE_ENABLED = _env_flag("TEACHER_GOOGLE_ENABLED")
TEACHER_GOOGLE_CLIENT_ID = os.getenv("TEACHER_GOOGLE_CLIENT_ID", "").strip()
TEACHER_GOOGLE_CLIENT_SECRET = os.getenv("TEACHER_GOOGLE_CLIENT_SECRET", "").strip()
TEACHER_GOOGLE_REDIRECT_URI = os.getenv("TEACHER_GOOGLE_REDIRECT_URI", "").strip()
TEACHER_GOOGLE_ENCRYPTION_KEY = os.getenv("TEACHER_GOOGLE_ENCRYPTION_KEY", "").strip()
TEACHER_GOOGLE_SUCCESS_REDIRECT = os.getenv("TEACHER_GOOGLE_SUCCESS_REDIRECT", "").strip() or "/"
TEACHER_GOOGLE_SCOPES = _env_scopes("TEACHER_GOOGLE_SCOPES", _DEFAULT_TEACHER_GOOGLE_SCOPES)
TEACHER_GOOGLE_STATE_TTL_SECONDS = _env_int("TEACHER_GOOGLE_STATE_TTL_SECONDS", 600, minimum=1)
TEACHER_GOOGLE_RETRY_ATTEMPTS = _env_int("TEACHER_GOOGLE_RETRY_ATTEMPTS", 3, minimum=1)
TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS = _env_float(
    "TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS", 0.5, minimum=0.0
)


def validate_teacher_google_settings() -> None:
    """Raise a clear error when the opt-in Classroom integration is incomplete."""

    if not TEACHER_GOOGLE_ENABLED:
        return

    required = {
        "TEACHER_GOOGLE_CLIENT_ID": TEACHER_GOOGLE_CLIENT_ID,
        "TEACHER_GOOGLE_CLIENT_SECRET": TEACHER_GOOGLE_CLIENT_SECRET,
        "TEACHER_GOOGLE_REDIRECT_URI": TEACHER_GOOGLE_REDIRECT_URI,
        "TEACHER_GOOGLE_ENCRYPTION_KEY": TEACHER_GOOGLE_ENCRYPTION_KEY,
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
    }
    missing = [name for name, value in required.items() if not value]
    if not TEACHER_GOOGLE_SCOPES:
        missing.append("TEACHER_GOOGLE_SCOPES")
    if missing:
        names = ", ".join(missing)
        raise ValueError(f"TEACHER_GOOGLE_ENABLED is true but required settings are missing: {names}")
    try:
        Fernet(TEACHER_GOOGLE_ENCRYPTION_KEY.encode())
    except (TypeError, ValueError) as error:
        raise ValueError("TEACHER_GOOGLE_ENCRYPTION_KEY must be a valid Fernet key") from error


validate_teacher_google_settings()
