"""Central configuration. Every setting is an environment variable.

`.env` covers host runs. docker compose reads the same file on its own.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

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

# How calls to the services above prove who they are.
# `google-id-token` adds a Google identity token to every *.run.app URL.
# `none` sends nothing, which compose needs.
SERVICE_AUTH = os.getenv("SERVICE_AUTH") or "none"
if SERVICE_AUTH not in ("none", "google-id-token"):
    raise ValueError(f"SERVICE_AUTH must be 'none' or 'google-id-token', got {SERVICE_AUTH!r}")

PAPERS_DIR = Path(os.getenv("PAPERS_DIR", "data/papers"))
ANALYSES_DB = os.getenv("ANALYSES_DB", "data/analyses.db")

# Persistence backend. With both set, the gateway stores analyses and source
# resolutions in Supabase Postgres. It stores the whole analysis as JSON, using the
# service role. It uses this instead of the SQLite file above.
# When unset, it means SQLite, the default for local runs and tests.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Source lookups. Without S2_API_KEY, Semantic Scholar rate-limits most calls.
# UNPAYWALL_EMAIL lets Unpaywall answer instead. It is a contact address, not a key.
S2_API_KEY = os.getenv("S2_API_KEY", "")
UNPAYWALL_EMAIL = os.getenv("UNPAYWALL_EMAIL", "")

CLAIM_LIMIT = int(os.getenv("CLAIM_LIMIT", "20"))  # claims kept per paper. 0 keeps all

# How many cited papers are downloaded and indexed at the same time. Indexing uses the
# GPU services, so keep it small.
PARALLEL_SOURCES = int(os.getenv("PARALLEL_SOURCES", "3"))
# How many claims are judged at the same time. Judging only searches and asks the LLM.
PARALLEL_CHECKS = int(os.getenv("PARALLEL_CHECKS", "3"))
# The same two limits for the whole gateway, across every analysis running at once. Each run
# keeps its own limit above too, so runs take turns. Unset, they keep the load of one run.
PARALLEL_SOURCES_TOTAL = int(os.getenv("PARALLEL_SOURCES_TOTAL") or PARALLEL_SOURCES)
PARALLEL_CHECKS_TOTAL = int(os.getenv("PARALLEL_CHECKS_TOTAL") or PARALLEL_CHECKS)
# Seconds a cited paper's checks wait for its figures to be indexed before they go on with the
# text alone; a later check of the same paper gets the figures. The same 24 checks on a warm GPU
# gateway took 86 s with 0 (no figures), 175 s with 20 (2 verdicts with figures), and 447 s
# waiting for all of them (14 verdicts with figures). A large value brings that last one back.
FIGURE_WAIT = float(os.getenv("FIGURE_WAIT") or "0")
