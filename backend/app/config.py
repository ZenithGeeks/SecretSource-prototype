"""Central configuration. Everything is an environment variable; `.env` covers host runs
(docker compose reads the same file on its own)."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# `or` rather than a default argument on purpose: .env.example ships these empty, and an
# empty string has to mean "not set", not "connect to nothing".

# vLLM, or any OpenAI-compatible server. Unset means the compose container / localhost.
VLLM_URL = os.getenv("VLLM_URL") or "http://localhost:8000/v1"
VLLM_MODEL = os.getenv("VLLM_MODEL") or "qwen"  # must match an id from {VLLM_URL}/models
VLLM_API_KEY = os.getenv("VLLM_API_KEY") or "EMPTY"  # only checked when vLLM was started with a key

# Retrieval services. Each serves plain HTTP under /api and MCP under /mcp.
COLBERT_URL = os.getenv("COLBERT_URL") or "http://localhost:8893"
COLPALI_URL = os.getenv("COLPALI_URL") or "http://localhost:8894"  # optional; skipped when down

GROBID_URL = os.getenv("GROBID_URL") or "http://localhost:8070"

# How calls to the services above prove who they are. `google-id-token` attaches a Google
# identity token to every *.run.app URL (app/clients/service_auth.py); `none` sends nothing,
# which is all the compose containers need.
SERVICE_AUTH = os.getenv("SERVICE_AUTH") or "none"
if SERVICE_AUTH not in ("none", "google-id-token"):
    raise ValueError(f"SERVICE_AUTH must be 'none' or 'google-id-token', got {SERVICE_AUTH!r}")

PAPERS_DIR = Path(os.getenv("PAPERS_DIR", "data/papers"))
ANALYSES_DB = os.getenv("ANALYSES_DB", "data/analyses.db")

# Persistence backend. With both set, the gateway stores analyses and source resolutions in
# Supabase Postgres (whole-analysis JSON, service role) instead of the SQLite file above.
# Unset means SQLite — the default for local runs and tests.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Source lookups. Without S2_API_KEY, Semantic Scholar rate-limits most calls;
# UNPAYWALL_EMAIL lets Unpaywall answer instead (a contact address, not a key).
S2_API_KEY = os.getenv("S2_API_KEY", "")
UNPAYWALL_EMAIL = os.getenv("UNPAYWALL_EMAIL", "")

CLAIM_LIMIT = int(os.getenv("CLAIM_LIMIT", "20"))  # claims kept per paper; 0 keeps all
