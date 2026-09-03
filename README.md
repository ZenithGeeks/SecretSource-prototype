# SecretSource

Papers cite other papers, and sometimes the cited paper doesn't say what the citing paper
claims it says. Checking that by hand means reading both, so almost nobody does it.
SecretSource does it automatically: take a paper, pull out its claims with the references
attached to each one, fetch those references, and judge whether they back the claim up.

Every verdict comes with the passage it relied on and the exact place in the PDF, so a
reader checks the tool the same way the tool checks the paper.

## How it works

```
frontend (React)  ──► gateway (FastAPI)
                         │
                         ├─ GROBID          reference + fulltext parsing
                         ├─ Docling         PDF → text, figure crops
                         ├─ vLLM            claim extraction + verdicts (Qwen, or Cloud Run)
                         ├─ colbert service text retrieval  ─┐
                         └─ colpali service visual retrieval ─┴─► Qdrant (MaxSim multivectors)
```

The verification loop, tool by tool:

```
paper.pdf
   └─ extract_claims_with_citations   claim + the references it cites (GROBID + LLM)
        └─ fetch_source               the cited paper's open-access PDF (arXiv / S2 / Unpaywall)
             └─ verify_claim          supports / refutes / insufficient + the quote
```

Anywhere a tool wants a paper it takes a local path, a DOI, an arXiv ID, a PMID, or a URL,
and downloads it if it has to.

There is also a multi-agent chat interface (Google ADK): a coordinator routes requests to
search / rag / paper / verify agents. `python backend/cli.py` starts it.

### Retrieval services

`services/colbert` (text) and `services/colpali` (figures and pages) are standalone
late-interaction retrievers. Each embeds with its own model, stores token/patch
multivectors in **Qdrant** (MaxSim comparator), and speaks two protocols from one process:

- **HTTP** under `/api` — used by the backend pipeline and by `dspy.ColBERTv2`
- **MCP** under `/mcp` (streamable HTTP) — used by the ADK agents and by any external MCP
  client (Cursor, VS Code, ...)

Same store, same results, one contract to maintain.

## Repository layout

```
backend/          gateway API, pipeline, agents  (Python, FastAPI, ADK, DSPy)
  app/main.py       HTTP gateway the frontend talks to
  app/pipeline/     claims, sources, verify, figures, rag
  app/agents/       ADK agent tree
  app/clients/      HTTP clients for the retrieval services
  cli.py            agent REPL
frontend/         React + Vite UI, served by nginx which proxies /api to the gateway
services/
  colbert/          ColBERTv2 text retrieval (HTTP + MCP, Qdrant)
  colpali/          ColPali visual retrieval (HTTP + MCP, Qdrant, opt-in)
deploy/           Cloud Run deploy script and vLLM-on-Cloud-Run guide
data/papers/      downloaded PDFs and figure crops (gitignored, shared volume in compose)
```

## Quick start

Needs Docker with GPU support (or a remote vLLM, see below).

```sh
cp .env.example .env      # fill in S2_API_KEY at minimum
docker compose up -d --build
```

Open <http://localhost:5173>, paste an arXiv ID (e.g. `2112.01488`), watch it run.

Visual retrieval is opt-in (downloads a ~4 GB model, shares the GPU):

```sh
docker compose --profile vision up -d colpali
```

No local GPU? Deploy vLLM to Cloud Run (`deploy/vllm-cloud-run.md`), then set in `.env`:

```
VLLM_URL=https://vllm-....run.app/v1
VLLM_API_KEY=...
```

and restart the gateway. Nothing else changes.

## Running pieces on the host

Each part runs standalone against the compose services on localhost:

```sh
# gateway
cd backend && pip install -r requirements.txt
python -m uvicorn app.main:app --port 8080

# agent REPL
python backend/cli.py

# retrieval service (needs Qdrant: docker compose up -d qdrant)
cd services/colbert && pip install -r requirements.txt
python server.py

# frontend dev server (proxies /api to :8080)
cd frontend && npm ci && npm run dev
```

`services/colpali` pins `torch<2.12` — give it its own virtualenv.

## Configuration

Everything is an environment variable; `.env.example` documents them all. The ones that
matter first:

| Variable | Default | Why you'd set it |
|---|---|---|
| `S2_API_KEY` | empty | without it Semantic Scholar rate-limits and most cited papers never resolve |
| `VLLM_URL` | local container | point at a Cloud Run vLLM instead of a local GPU |
| `QDRANT_URL` | `http://localhost:6333` | managed Qdrant (add `QDRANT_API_KEY`) |
| `CLAIM_LIMIT` | 20 | claims kept per paper; `0` keeps all (benchmarks) |
| `COLPALI_MODEL` | `vidore/colqwen2-v1.0` | bigger checkpoint, better visual retrieval |

## API

The gateway (`backend/app/main.py`) documents its routes in its module docstring;
interactive docs at `http://localhost:8080/docs`. The short version:

```
POST /analyses            start an analysis {"paper": "path | DOI | arXiv | URL"}
GET  /analyses/{id}/events  SSE progress, one event per pipeline stage
GET  /papers/{name}/find  where a sentence sits in the PDF, as boxes
POST /verify              one claim against one source, no full analysis
```

MCP endpoints: `http://localhost:8893/mcp` (ColBERT: `search_passages`, `add_paper`) and
`http://localhost:8894/mcp` (ColPali: `search_media`).

## Deploying

`deploy/cloudrun.sh` deploys grobid, colbert, gateway and web to Cloud Run; `MODEL=vllm`
adds a GPU-backed vLLM, `MODEL=vertex` (default) uses Gemini instead. Qdrant is not
deployed there — use a managed cluster and pass `QDRANT_URL` / `QDRANT_API_KEY`.
`deploy/vllm-cloud-run.md` is the step-by-step for the vLLM piece, including quota,
warm-up and cost notes.

## Working on this repo

- One service = one directory = one Dockerfile. Services talk over HTTP/MCP only; nothing
  imports across `backend/`, `services/*`, `frontend/`.
- Tool functions return `{"status": "ok" | "error", ...}` instead of raising — the agents
  and the gateway both rely on it. Typed failure reasons live in
  `backend/app/pipeline/sources.py`; the UI shows them, so keep them meaningful.
- Lint: `ruff check .` (config in `pyproject.toml`). Frontend: `npm run lint`.
- Indexes are disposable: deleting the Qdrant volume loses nothing that `add_paper` can't
  rebuild from `data/papers/`.
