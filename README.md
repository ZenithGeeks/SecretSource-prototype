<div align="center">
  <img src="frontend/public/favicon.svg" alt="SecretSource logo" width="96" height="auto" />
  <h1>SecretSource</h1>
  <p>Automatically checks a research paper's claims against the papers it cites, and shows the passage and the exact place in the PDF behind every verdict.</p>
  <h4>
    <a href="ARCHITECTURE.md">Architecture</a>
  <span> · </span>
    <a href="frontend/documentations/COMPONENTS.md">Frontend components</a>
  <span> · </span>
    <a href="https://github.com/ZenithGeeks/SecretSource-prototype/issues">Report Bug</a>
  <span> · </span>
    <a href="https://github.com/ZenithGeeks/SecretSource-prototype/issues">Request Feature</a>
  </h4>
</div>
<br />

# :notebook_with_decorative_cover: Table of Contents

- [About the Project](#star2-about-the-project)
  - [How it works](#how-it-works)
  - [Retrieval services](#retrieval-services)
  - [Repository layout](#repository-layout)
  - [Tech Stack](#space_invader-tech-stack)
  - [Features](#dart-features)
  - [Color Reference](#art-color-reference)
  - [Environment Variables](#key-environment-variables)
- [Getting Started](#toolbox-getting-started)
  - [Prerequisites](#bangbang-prerequisites)
  - [Installation](#gear-installation)
  - [Run Locally](#running-run-locally)
  - [Running Tests](#test_tube-running-tests)
  - [Deployment](#triangular_flag_on_post-deployment)
- [Usage](#eyes-usage)
- [Roadmap](#compass-roadmap)
- [Contributing](#wave-contributing)
- [FAQ](#grey_question-faq)
- [License](#warning-license)
- [Contact](#handshake-contact)
- [Acknowledgements](#gem-acknowledgements)

## :star2: About the Project

Papers cite other papers, and sometimes the cited paper doesn't say what the citing paper
claims it says. Checking that by hand means reading both, so almost nobody does it.
SecretSource does it automatically: take a paper, pull out its claims with the references
attached to each one, fetch those references, and judge whether they back the claim up.

Every verdict comes with the passage it relied on and the exact place in the PDF, so a
reader checks the tool the same way the tool checks the paper.

### How it works

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
rag / paper / verify agents. `python backend/cli.py` starts it.

The analysis pipeline is also declared as a graph in `backend/app/workflow.py` (an ADK
Workflow): read the paper, plan the checks, one worker per cited source, assemble. ADK's
dev UI draws it and lists the events of each run:

```sh
docker compose --profile dev up -d adk-web        # then open http://localhost:8001
```

Pick `analysis`, send a DOI, arXiv ID, URL or PDF path as the message; set the session
state key `verify` to `false` to stop after the claims. The gateway still runs its own
loop (`app/main.py`); moving it onto the graph is the next step.

[ARCHITECTURE.md](ARCHITECTURE.md) goes a level deeper: the three entry points and which
one serves the product, what `verify_claim` actually calls, where run state lives, and
which file to change for a given kind of change.

### Retrieval services

`services/colbert` (text) and `services/colpali` (figures and pages) are standalone
late-interaction retrievers. Each embeds with its own model, stores token/patch
multivectors in **Qdrant** (MaxSim comparator), and speaks two protocols from one process:

- **HTTP** under `/api` — used by the backend pipeline and by `dspy.ColBERTv2`
- **MCP** under `/mcp` (streamable HTTP) — used by the ADK agents and by any external MCP
  client (Cursor, VS Code, ...)

Same store, same results, one contract to maintain.

MCP is tool-level access — a client calls `search_passages` itself. For agent-level access
there is **A2A**: `docker compose --profile a2a up -d a2a` serves the whole agent tree on
port 8002, with an agent card at `/.well-known/agent-card.json`, so another agent can send
a paper as a task and let the coordinator pick the specialist. See
[ARCHITECTURE.md](ARCHITECTURE.md#two-ways-in-for-machines).

### Repository layout

```
backend/          gateway API, pipeline, agents  (Python, FastAPI, ADK, DSPy)
  app/main.py       HTTP gateway the frontend talks to
  app/config.py     every setting, read from the environment / .env
  app/llm.py        the one model behind ADK and DSPy
  app/pipeline/     claims, sources, verify, figures, rag
  app/agents/       ADK agent tree
  app/workflow.py   the pipeline as an ADK Workflow graph
  a2a_server.py     the agent tree over A2A (docker compose --profile a2a)
  app/clients/      HTTP clients for the retrieval services
  adk_agents/       what `adk web` serves: the pipeline graph and the chat tree
  cli.py            agent REPL
frontend/         React + Vite UI, served by nginx which proxies /api to the gateway
services/
  colbert/          ColBERTv2 text retrieval (HTTP + MCP, Qdrant)
  colpali/          ColPali visual retrieval (HTTP + MCP, Qdrant, opt-in)
deploy/           Cloud Run deploy script, Qdrant VM startup script, vLLM-on-Cloud-Run guide
data/papers/      downloaded PDFs and figure crops (gitignored, shared volume in compose)
```

### :space_invader: Tech Stack

<details>
<summary>Client</summary>

- React 19
- Vite
- TypeScript
- Tailwind CSS v4
- TanStack Query
- Cytoscape (+ cytoscape-fcose, react-cytoscapejs)
- lucide-react
- Supabase JS (auth)
- nginx (serves the built UI, proxies `/api` to the gateway)

</details>

<details>
<summary>Gateway / pipeline</summary>

- Python
- FastAPI
- Uvicorn
- Google ADK (workflow graph, dev UI)
- a2a-sdk (A2A)
- DSPy
- Docling
- GROBID
- PyMuPDF
- vLLM (Qwen3, or any OpenAI-compatible server) for claim extraction and verdicts

</details>

<details>
<summary>Retrieval</summary>

- ColBERTv2 (text passages)
- ColPali / ColQwen2 (figures and pages)
- Qdrant (MaxSim multivectors)
- MCP (streamable HTTP)

</details>

<details>
<summary>Data</summary>

- Qdrant (both retrieval indexes)
- SQLite (analyses and resolved-source cache, the default)
- Supabase Postgres (optional, when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set)

</details>

<details>
<summary>DevOps</summary>

- Docker Compose
- Cloud Run (images built with Cloud Build)
- GitHub Actions
- ruff (Python lint)
- oxlint (frontend lint)
- pytest

</details>

### :dart: Features

- Claim extraction with the references attached to each claim (GROBID + LLM), each claim located back in the PDF by page and boxes
- Citation resolution from a local path, DOI, arXiv ID, PMID or URL (arXiv directly, otherwise Semantic Scholar, then Unpaywall)
- Verdicts of `supports` / `refutes` / `insufficient`, each with the quote the judge relied on
- Figure and page evidence: ColPali retrieves matching figures or rendered pages, and captions are folded into the evidence
- Live progress over SSE, one event per pipeline stage
- History of past analyses (SQLite by default, Supabase Postgres optionally), select or delete
- Multi-agent chat interface (Google ADK) with a coordinator routing to rag / paper / verify agents
- Machine access two ways: MCP (tool-level) at `/mcp` on the retrieval services, A2A (agent-level) for the whole agent tree
- ADK dev UI that draws the analysis graph and lists the events of each run
- An audit step that reports where an analysis disagrees with itself (it never rewrites a verdict)
- Verdicts marked with `indexed_in` when a source resolved through an index, and flagged when a work sits outside the public indexes

### :art: Color Reference

| Color | Hex | Used for |
| ----- | --- | -------- |
| Ink | ![#1E1A22](https://placehold.co/12x12/1E1A22/1E1A22.png) #1E1A22 | primary text |
| Plum (accent) | ![#6A2E6F](https://placehold.co/12x12/6A2E6F/6A2E6F.png) #6A2E6F | brand, links, primary button |
| Paper (canvas) | ![#F7F3EC](https://placehold.co/12x12/F7F3EC/F7F3EC.png) #F7F3EC | page background |
| Backed | ![#2F6B45](https://placehold.co/12x12/2F6B45/2F6B45.png) #2F6B45 | supports verdict |
| Contradicted | ![#A33A2E](https://placehold.co/12x12/A33A2E/A33A2E.png) #A33A2E | refutes verdict |
| Silent | ![#8A6414](https://placehold.co/12x12/8A6414/8A6414.png) #8A6414 | insufficient verdict |

The full token list, for light and dark, lives in [frontend/documentations/COMPONENTS.md](frontend/documentations/COMPONENTS.md); the palette itself is defined in `frontend/src/index.css`.

### :key: Environment Variables

Everything is an environment variable; `cp .env.example .env` and fill in the values.
Docker Compose and host runs (uvicorn, `backend/cli.py`, tests) read the same file. For
every `*_URL`, empty means "the compose container"; a value means "that service, wherever
it is".

**Keys**

| Variable | Required? | What it does |
| --- | --- | --- |
| `HF_TOKEN` | Optional | raises the Hugging Face Hub's anonymous download rate limit |
| `S2_API_KEY` | Close to required | without it Semantic Scholar 429s unauthenticated callers most of the time, and most cited papers never resolve (free from https://www.semanticscholar.org/product/api) |
| `UNPAYWALL_EMAIL` | Optional | a contact address lets Unpaywall answer when Semantic Scholar will not |
| `CLAIM_LIMIT` | Optional, default `20` | how many claims one paper may yield; `0` keeps every claim (what the benchmark wants) |

**LLM**

| Variable | Required? | What it does |
| --- | --- | --- |
| `VLLM_URL` | Required unless the `vllm` container runs (`--profile gpu`) | any OpenAI-compatible vLLM, e.g. `https://<your-vllm-host>/v1` |
| `VLLM_MODEL` | With `VLLM_URL` | an id that `{VLLM_URL}/models` lists |
| `VLLM_API_KEY` | With `VLLM_URL` | the key that server was started with (the compose container answers to `EMPTY`) |
| `VLLM_HF_MODEL` | Only the `vllm` container, default `Qwen/Qwen3.5-4B` | which checkpoint to serve; the 4B default fits a 16 GB card beside ColBERT |
| `VLLM_SERVED_NAME` | Only the `vllm` container, default `qwen` | the id the container answers to |
| `VLLM_QUANT` | Only the `vllm` container, default `fp8` | quantization |
| `VLLM_MAX_LEN` | Only the `vllm` container, default `8192` | max model length |
| `VLLM_GPU_UTIL` | Only the `vllm` container, default `0.6` | share of the whole card; with `--profile vision` raise it to `0.88` and start colbert and colpali first |

**Retrieval and parsing**

| Variable | Required? | What it does |
| --- | --- | --- |
| `COLBERT_URL` | Optional | the colbert container when empty; the shared Cloud Run services when set (through the gcloud proxy for now) |
| `COLPALI_URL` | Optional | the colpali container when empty; optional — visual hints are skipped when it is not running |
| `COLPALI_MODEL` | Optional, default `vidore/colqwen2-v1.0` | vision retrieval checkpoint (see `services/colpali/encoder.py` for the trade-offs) |
| `GROBID_URL` | Optional | the grobid container when empty (every profile starts it); a GROBID elsewhere when set |
| `QDRANT_URL` | Optional | the qdrant container when empty; a cluster URL (a GCE VM, or Qdrant Cloud) moves both indexes there — only colbert and colpali talk to Qdrant |
| `QDRANT_API_KEY` | Only with a cluster `QDRANT_URL` | the cluster's key |

**Persistence**

| Variable | Required? | What it does |
| --- | --- | --- |
| `SUPABASE_URL` | Optional, set BOTH for Postgres | the project's API URL; empty = SQLite at `ANALYSES_DB` (default, local) |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, set BOTH for Postgres | the service role key (Dashboard → Settings → API). It bypasses RLS — server-only, never shipped to the browser. Never commit a real key |

Two things worth knowing about the LLM side:

- The gateway sends `enable_thinking: false` with every request (`backend/app/llm.py`).
  A Qwen3 endpoint that thinks by default otherwise spends the whole `max_tokens` budget
  on reasoning and returns no answer, which surfaces as "The LM returned an empty or null
  response." The compose vLLM sets the same thing server-side; an external one may not.
- The gateway image installs torch from the CPU index before the rest of
  `requirements.txt`. Docling needs torch, not a GPU, so the build is pinned there rather
  than left to whichever build pip resolves.

## :toolbox: Getting Started

### :bangbang: Prerequisites

- **Docker with Compose** — every compose way of running it.
- **An NVIDIA GPU, 16 GB+** — only for the fully-local profile (`--profile gpu` / `--profile vision`). Nothing in the default profile needs a GPU.
- **Node/npm and Python** — only for host runs (the gateway on uvicorn, `backend/cli.py`, the tests, the frontend dev server). CI runs Python 3.12 and Node 22.
- **`gcloud`** — for the local-gateway, cloud-services way (the authenticated proxy) and for deploying.

### :gear: Installation

```sh
git clone https://github.com/ZenithGeeks/SecretSource-prototype.git
cd SecretSource-prototype
cp .env.example .env
```

Fill in the values in `.env` — at minimum `S2_API_KEY`, the `VLLM_*` block, and
`COLBERT_URL` / `COLPALI_URL` for the team default. `.env` is gitignored — never commit a
real token.

### :running: Run Locally

Three ways, chosen entirely in `.env`. Empty `*_URL` variables mean "the compose
container"; filled-in ones mean "that service, wherever it is". Nothing in the code
changes between them.

| | What runs on your machine | What you need |
|---|---|---|
| **Local gateway, cloud services** (team default) | grobid, gateway, web | Docker, `gcloud` |
| **Everything local** | + vllm, qdrant, colbert (+ colpali) | Docker with an NVIDIA GPU, 16 GB+ |
| **Shared Cloud Run stack** | nothing | a browser |

#### Local gateway, cloud services

```sh
cp .env.example .env   # fill in S2_API_KEY, the VLLM_* block, COLBERT_URL, COLPALI_URL
docker compose up -d --build
```

Open <http://localhost:5173>, paste an arXiv ID (e.g. `2112.01488`), watch it run.
GROBID and Docling run locally; retrieval and the LLM are wherever `.env` points.

The Cloud Run retrieval services still require a Google identity token (tracked as
issue #4 in the project's [issue tracker](https://github.com/ZenithGeeks/SecretSource-prototype/issues)),
and the gateway does not send one. Until they are public, keep gcloud's authenticated
proxy running and point the gateway at it — `.env.example` has the exact lines:

```sh
gcloud run services proxy colbert --region asia-southeast1 --port 8893
gcloud run services proxy colpali --region asia-southeast1 --port 8894
```

The first request after ~15 idle minutes wakes the services (colbert a few seconds,
colpali about a minute — it is a GPU instance that reloads its weights). Visual hints are
skipped, not failed, while colpali is still waking up.

#### Everything local

```sh
docker compose --profile gpu up -d --build        # + vllm, qdrant, colbert
docker compose --profile vision up -d colpali     # optional: figure/page retrieval, ~4 GB model
```

`VLLM_HF_MODEL` picks the checkpoint; the 4B default fits a 16 GB card beside ColBERT.
See the `.env.example` comments for the memory split with `--profile vision`.

#### Development and agent profiles

```sh
docker compose --profile dev up -d adk-web       # ADK dev UI at http://localhost:8001
docker compose --profile a2a up -d a2a           # the agent tree over A2A at http://localhost:8002
```

#### Pieces on the host

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

### :test_tube: Running Tests

Backend tests build their own PDFs with PyMuPDF, so no service or model has to be running:

```sh
cd backend && pip install -r requirements-dev.txt && pytest
```

CI (`.github/workflows/ci.yml`) runs the fast checks on every PR and on `main`:

```sh
ruff check backend services
python -m compileall -q backend/app backend/cli.py services
npm run lint        # frontend (oxlint)
npm run build       # frontend typecheck + build
```

### :triangular_flag_on_post: Deployment

`PROJECT=<gcp-project> ./deploy/cloudrun.sh` builds every image with Cloud Build and
deploys grobid, colbert, colpali (`VISION=0` skips it), vllm, gateway and web to Cloud
Run, and keeps Qdrant on a small GCE VM with a persistent disk (`deploy/qdrant-startup.sh`).
Pass `QDRANT_URL` / `QDRANT_API_KEY` to use a managed cluster instead.
[deploy/vllm-cloud-run.md](deploy/vllm-cloud-run.md) is the step-by-step for the vLLM piece,
including quota, warm-up and cost notes.

## :eyes: Usage

The gateway (`backend/app/main.py`) documents its routes in its module docstring;
interactive docs at `http://localhost:8080/docs`. The short version:

```
POST /analyses            start an analysis {"paper": "path | DOI | arXiv | URL"}
GET  /analyses/{id}/events  SSE progress, one event per pipeline stage
GET  /papers/{name}/find  where a sentence sits in the PDF, as boxes
POST /verify              one claim against one source, no full analysis
```

MCP endpoints: `http://localhost:8893/mcp/` (ColBERT: `search_passages`, `add_paper`) and
`http://localhost:8894/mcp/` (ColPali: `search_media`). Keep the trailing slash.

Example — start an analysis and follow its stages:

```sh
curl -X POST http://localhost:8080/analyses \
  -H 'Content-Type: application/json' \
  -d '{"paper": "2112.01488"}'
# -> {"id": "<analysis-id>"}

curl -N http://localhost:8080/analyses/<analysis-id>/events
```

## :compass: Roadmap

- [ ] Identity tokens for the private Cloud Run services (SCRUM-162)
- [ ] Ready-made .env templates and a dependency report in /health (SCRUM-163)
- [ ] Papers, figures and page renders in object storage (SCRUM-164)
- [ ] One MCP server for SecretSource with API-key access (SCRUM-165)
- [ ] Public web, gateway and MCP entry points; retrieval services stay private (SCRUM-166)
- [ ] Analyses that survive Cloud Run restarts (SCRUM-167)

## :wave: Contributing

- Branch names start with the Jira key (`SCRUM-<n>-short-slug`), and branch and PR titles
  carry it too; that is what links them to the board. One branch per ticket, off `main`.
- Commit and PR titles use Conventional Commits with the Jira key as scope, e.g.
  `fix(SCRUM-142): drop the stale researcher session on refresh`.
- Open pull requests against `main`.
- One service = one directory = one Dockerfile. Services talk over HTTP/MCP only; nothing
  imports across `backend/`, `services/*`, `frontend/`.
- Tool functions return `{"status": "ok" | "error", ...}` instead of raising — the agents
  and the gateway both rely on it. Typed failure reasons live in
  `backend/app/pipeline/sources.py`; the UI shows them, so keep them meaningful.
- Lint: `ruff check .` (config in `pyproject.toml`). Frontend: `npm run lint`.
- Backend tests: `cd backend && pip install -r requirements-dev.txt && pytest`. They build
  their own PDFs with PyMuPDF, so no service or model has to be running.
- Indexes are disposable: deleting the Qdrant volume loses nothing that `add_paper` can't
  rebuild from `data/papers/`.
- Changing `backend/requirements.txt` rebuilds the slow pip layer of the gateway image;
  everything else in `backend/` is a fast layer on top.
- Papers this system works with — the analyzed paper, the works it cites, the library, the
  benchmark — are expected to be in a public index. One that is not is still analyzed, and
  still gets its verdict; it is marked instead, so a reader can see the verdict rests on a
  source outside the index. What answered is recorded per work rather than assumed:
  `verify_claim` returns `indexed_in` with the index that resolved it and the ids it gave.
  Nothing claims Scopus until an Elsevier key is configured, because Semantic Scholar and
  arXiv cannot answer for Scopus.

## :grey_question: FAQ

- Why does the MCP URL need a trailing slash?
  + The retrieval services speak MCP at `/mcp/` (streamable HTTP). The trailing slash matters — `/mcp` redirects, so clients should call `http://<host>:<port>/mcp/`.
- The retrieval services reject my requests with an auth error — what do I do?
  + The shared Cloud Run retrieval services still require a Google identity token, and the gateway does not send one. Until they are public, run gcloud's authenticated proxy on your machine and point the gateway at it: `gcloud run services proxy colbert --region asia-southeast1 --port 8893` (and colpali on 8894), then set `COLBERT_URL` / `COLPALI_URL` to the proxy (`.env.example` has the exact lines).
- Can I run it without a GPU?
  + Yes. The default compose profile (grobid, gateway, web) needs no GPU at all — retrieval and the LLM come from wherever `.env` points, e.g. the shared Cloud Run services. The GPU is only needed for the fully-local `--profile gpu` / `--profile vision` profile.
- Why does the first request after a while take a minute?
  + Cold start. After ~15 idle minutes the first request wakes the Cloud Run services: colbert a few seconds, colpali about a minute because it is a GPU instance that reloads its weights. Visual hints are skipped, not failed, while colpali is still waking up.

## :warning: License

No license has been chosen yet; all rights reserved by the project team.

## :handshake: Contact

- [EarthWittawat](https://github.com/EarthWittawat)
- [JoyChanya](https://github.com/JoyChanya)
- [ZeaNL](https://github.com/ZeaNL)
- [Richyboy170](https://github.com/Richyboy170)

Project: https://github.com/ZenithGeeks/SecretSource-prototype

## :gem: Acknowledgements

- [ColBERTv2](https://github.com/stanford-futuredata/ColBERT)
- [ColPali](https://github.com/illuin-tech/colpali)
- [GROBID](https://github.com/kermitt2/grobid)
- [Docling](https://github.com/docling-project/docling)
- [DSPy](https://github.com/stanfordnlp/dspy)
- [Google ADK](https://github.com/google/adk-python)
- [Qdrant](https://github.com/qdrant/qdrant)
- [vLLM](https://github.com/vllm-project/vllm)
- [Awesome Readme Template](https://github.com/Louis3797/awesome-readme-template)
