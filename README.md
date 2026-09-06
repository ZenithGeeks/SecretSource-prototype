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
                         ├─ Docling         PDF → text, figure crops (a library inside the gateway)
                         ├─ vLLM            claim extraction + verdicts (Qwen3, any OpenAI-compatible server)
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
  app/config.py     every setting, read from the environment / .env
  app/llm.py        the one model behind ADK and DSPy
  app/pipeline/     claims, sources, verify, figures, rag
  app/agents/       ADK agent tree
  app/clients/      HTTP clients for the retrieval services
  cli.py            agent REPL
frontend/         React + Vite UI, served by nginx which proxies /api to the gateway
services/
  colbert/          ColBERTv2 text retrieval (HTTP + MCP, Qdrant)
  colpali/          ColPali visual retrieval (HTTP + MCP, Qdrant, opt-in)
deploy/           Cloud Run deploy script, Qdrant VM startup script, vLLM-on-Cloud-Run guide
data/papers/      downloaded PDFs and figure crops (gitignored, shared volume in compose)
```

## Running it

Three ways, chosen entirely in `.env`. Empty `*_URL` variables mean "the compose
container"; filled-in ones mean "that service, wherever it is". Nothing in the code
changes between them.

| | What runs on your machine | What you need |
|---|---|---|
| **Local gateway, cloud services** (team default) | grobid, gateway, web | Docker, `gcloud` |
| **Everything local** | + vllm, qdrant, colbert (+ colpali) | Docker with an NVIDIA GPU, 16 GB+ |
| **Shared Cloud Run stack** | nothing | a browser |

### Local gateway, cloud services

```sh
cp .env.example .env   # fill in S2_API_KEY, the VLLM_* block, COLBERT_URL, COLPALI_URL
docker compose up -d --build
```

Open <http://localhost:5173>, paste an arXiv ID (e.g. `2112.01488`), watch it run.
GROBID and Docling run locally; retrieval and the LLM are wherever `.env` points.

The Cloud Run retrieval services still require a Google identity token
([#4](https://github.com/ZenithGeeks/SecretSource-prototype/issues/4)), and the gateway does
not send one. Until they are public, keep gcloud's authenticated proxy running and point
the gateway at it — `.env.example` has the exact lines:

```sh
gcloud run services proxy colbert --region asia-southeast1 --port 8893
gcloud run services proxy colpali --region asia-southeast1 --port 8894
```

The first request after ~15 idle minutes wakes the services (colbert a few seconds,
colpali about a minute — it is a GPU instance that reloads its weights). Visual hints are
skipped, not failed, while colpali is still waking up.

### Everything local

```sh
docker compose --profile gpu up -d --build        # + vllm, qdrant, colbert
docker compose --profile vision up -d colpali     # optional: figure/page retrieval, ~4 GB model
```

`VLLM_HF_MODEL` picks the checkpoint; the 4B default fits a 16 GB card beside ColBERT.
See the `.env.example` comments for the memory split with `--profile vision`.

### Pieces on the host

Each part also runs standalone, against whatever `.env` says (use `localhost` rather than
container names there):

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

| Variable | Empty means | Why you'd set it |
|---|---|---|
| `S2_API_KEY` | — | without it Semantic Scholar rate-limits and most cited papers never resolve |
| `VLLM_URL`, `VLLM_MODEL`, `VLLM_API_KEY` | the `vllm` container | any OpenAI-compatible vLLM: Cloud Run, a teammate's server, a hosted endpoint |
| `COLBERT_URL`, `COLPALI_URL` | the compose containers | the shared Cloud Run services (through the gcloud proxy for now) |
| `GROBID_URL` | the `grobid` container | a GROBID elsewhere |
| `QDRANT_URL`, `QDRANT_API_KEY` | the `qdrant` container | the team's GCE VM or Qdrant Cloud (only colbert/colpali use it) |
| `CLAIM_LIMIT` | 20 | claims kept per paper; `0` keeps all (benchmarks) |
| `COLPALI_MODEL` | `vidore/colqwen2-v1.0` | bigger checkpoint, better visual retrieval |

Two things worth knowing about the LLM side:

- The gateway sends `enable_thinking: false` with every request (`backend/app/llm.py`).
  A Qwen3 endpoint that thinks by default otherwise spends the whole `max_tokens` budget
  on reasoning and returns no answer, which surfaces as "The LM returned an empty or null
  response." The compose vLLM sets the same thing server-side; an external one may not.
- The gateway image installs torch from the CPU index before the rest of
  `requirements.txt`. Docling needs torch, not a GPU, so the build is pinned there rather
  than left to whichever build pip resolves.

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

`PROJECT=<gcp-project> ./deploy/cloudrun.sh` builds every image with Cloud Build and
deploys grobid, colbert, colpali (`VISION=0` skips it), vllm, gateway and web to Cloud
Run, and keeps Qdrant on a small GCE VM with a persistent disk (`deploy/qdrant-startup.sh`).
Pass `QDRANT_URL` / `QDRANT_API_KEY` to use a managed cluster instead.
`deploy/vllm-cloud-run.md` is the step-by-step for the vLLM piece, including quota,
warm-up and cost notes.

## Working on this repo

- Branch and PR titles carry the Jira key (`SCRUM-120: ...`); that is what links them to
  the board. One branch per ticket, off `main`.
- One service = one directory = one Dockerfile. Services talk over HTTP/MCP only; nothing
  imports across `backend/`, `services/*`, `frontend/`.
- Tool functions return `{"status": "ok" | "error", ...}` instead of raising — the agents
  and the gateway both rely on it. Typed failure reasons live in
  `backend/app/pipeline/sources.py`; the UI shows them, so keep them meaningful.
- Lint: `ruff check .` (config in `pyproject.toml`). Frontend: `npm run lint`.
- Indexes are disposable: deleting the Qdrant volume loses nothing that `add_paper` can't
  rebuild from `data/papers/`.
- Changing `backend/requirements.txt` rebuilds the slow pip layer of the gateway image;
  everything else in `backend/` is a fast layer on top.
