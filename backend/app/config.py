"""Central configuration. Everything is an environment variable; `.env` covers host runs
(docker compose reads the same file on its own)."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# vLLM (OpenAI-compatible). Point VLLM_URL at the compose service or a Cloud Run URL.
VLLM_URL = os.getenv("VLLM_URL") or "http://localhost:8000/v1"
VLLM_MODEL = os.getenv("VLLM_MODEL", "qwen")  # must match an id from {VLLM_URL}/models
VLLM_API_KEY = os.getenv("VLLM_API_KEY", "EMPTY")  # only checked when vLLM was started with a key

# Retrieval services. Each serves plain HTTP under /api and MCP under /mcp.
COLBERT_URL = os.getenv("COLBERT_URL", "http://localhost:8893")
COLPALI_URL = os.getenv("COLPALI_URL", "http://localhost:8894")  # optional; skipped when down

GROBID_URL = os.getenv("GROBID_URL", "http://localhost:8070")

PAPERS_DIR = Path(os.getenv("PAPERS_DIR", "data/papers"))
ANALYSES_DB = os.getenv("ANALYSES_DB", "data/analyses.db")

# Source lookups. Without S2_API_KEY, Semantic Scholar rate-limits most calls;
# UNPAYWALL_EMAIL lets Unpaywall answer instead (a contact address, not a key).
S2_API_KEY = os.getenv("S2_API_KEY", "")
UNPAYWALL_EMAIL = os.getenv("UNPAYWALL_EMAIL", "")

CLAIM_LIMIT = int(os.getenv("CLAIM_LIMIT", "20"))  # claims kept per paper; 0 keeps all
