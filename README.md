<div align="center">
  <img src="frontend/public/favicon.svg" alt="SecretSource logo" width="80" />
  <h1>SecretSource</h1>
  <p>Checks a research paper's claims against the papers it cites, with the quote and the exact place in the PDF behind every verdict.</p>
  <h4><a href="#rocket-quick-start">Quick start</a> · <a href="#wrench-troubleshooting">Troubleshooting</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="https://github.com/ZenithGeeks/SecretSource-prototype/issues">Report a bug</a></h4>
</div>
<br />

## :notebook_with_decorative_cover: Contents

- [What it is](#star2-what-it-is)
- [Quick start](#rocket-quick-start)
- [Everyday use](#computer-everyday-use)
- [Troubleshooting](#wrench-troubleshooting)
- [API](#electric_plug-api)
- [Roadmap](#compass-roadmap)
- [For maintainers](#hammer_and_wrench-for-maintainers)
- [Team](#handshake-team)
- [Acknowledgements](#gem-acknowledgements)

## :star2: What it is

SecretSource checks a research paper's claims against the papers it cites. Each verdict
(`supports` / `refutes` / `insufficient`) comes with the quote it relied on and the exact
place in the PDF.

On your machine, Docker runs two things: `web` (the UI at http://localhost:5173) and
`gateway` (the API at http://localhost:8080). Everything heavy is shared and already
running in the cloud:

| Service | What it does | Where |
| --- | --- | --- |
| ColBERT (`colbert`) | finds text passages in the cited papers | shared cloud service |
| ColPali (`colpali`) | finds matching figures and pages | shared cloud service (GPU; first request after idle takes about a minute) |
| GROBID (`grobid`) | reads a PDF's reference list and full text | shared cloud service |
| Qdrant | stores the ColBERT and ColPali indexes | shared cloud; only ColBERT and ColPali talk to it, so you never configure it |
| LLM | extracts claims and writes verdicts (any OpenAI-compatible endpoint) | shared endpoint |

The shared cloud services only accept requests that carry a Google identity token; the gateway adds it automatically once you follow steps 3 and 4 below.

## :rocket: Quick start

1. **Prerequisites:** Git and Docker Desktop (Docker with Compose). No GPU, no Python, no Node.

2. **Clone and copy the env file:**

   ```sh
   git clone https://github.com/ZenithGeeks/SecretSource-prototype.git
   cd SecretSource-prototype
   cp .env.example .env
   ```

3. **Fill in `.env`** — everything else in `.env.example` can stay empty:

   | Variable | Value | Where it comes from |
   | --- | --- | --- |
   | `VLLM_URL` | shared LLM endpoint, ends in `/v1` | `<from the team lead>` |
   | `VLLM_MODEL` | model id the endpoint lists | `<from the team lead>` |
   | `VLLM_API_KEY` | key for that endpoint | `<from the team lead>` |
   | `COLBERT_URL` | shared ColBERT URL | `<from the team lead>` |
   | `COLPALI_URL` | shared ColPali URL | `<from the team lead>` |
   | `GROBID_URL` | shared GROBID URL | `<from the team lead>` |
   | `SERVICE_AUTH` | `google-id-token` | type it |
   | `GOOGLE_APPLICATION_CREDENTIALS` | `secrets/service-auth.json` | type it (the file itself comes from the team lead) |
   | `S2_API_KEY` | your own free Semantic Scholar key | https://www.semanticscholar.org/product/api (strongly recommended: without it most cited papers never resolve) |

   Optional: `UNPAYWALL_EMAIL` (a contact email that helps find open-access PDFs) and `CLAIM_LIMIT` (max claims per paper, default `20`; `0` = all).

4. **Add the credentials file:** save the file the team lead gives you as `backend/secrets/service-auth.json`. That folder is already in the repo, is gitignored, and is never copied into Docker images.

5. **Start the stack:**

   ```sh
   docker compose up -d --build
   ```

   This also starts a local `grobid` container; it sits unused when `GROBID_URL` points at the shared one.

6. **Open the app:** go to http://localhost:5173 and paste an arXiv ID (for example `2112.01488`) or upload a PDF. Check the API is up with:

   ```sh
   curl http://localhost:8080/health
   ```

## :computer: Everyday use

- Stop the stack: `docker compose down`
- After `git pull`, rebuild: `docker compose up -d --build`
- `.env` is only read when containers start, so run `docker compose up -d` after editing it
- Logs: `docker compose logs -f gateway`

In the UI, paste an arXiv ID, DOI or URL (or upload a PDF), watch the pipeline stages as they happen, and find past analyses in the history.

## :wrench: Troubleshooting

| Symptom | Fix |
| --- | --- |
| 401 or 403 from colbert, colpali or grobid in the gateway logs | check `SERVICE_AUTH=google-id-token`, `GOOGLE_APPLICATION_CREDENTIALS=secrets/service-auth.json`, and that `backend/secrets/service-auth.json` exists; then `docker compose up -d` |
| Gateway exits with "SERVICE_AUTH must be 'none' or 'google-id-token'" | typo in `SERVICE_AUTH` |
| 503 from the cloud services | the first request after idle wakes them (ColBERT a few seconds, ColPali about a minute); if it keeps happening the cloud project itself is down, tell the team lead |
| "The LM returned an empty or null response." | check `VLLM_URL` ends in `/v1` and `VLLM_MODEL` is an id the endpoint lists |
| Most citations show as unresolved / Semantic Scholar 429 | set `S2_API_KEY` |
| Figure/page hints missing | ColPali is still waking up; hints are skipped, not failed, until it answers |
| Port 5173 or 8080 already in use | another copy of the stack is running; `docker compose down` there first |

## :electric_plug: API

Interactive docs: http://localhost:8080/docs. The short version:

```
POST /analyses             start an analysis {"paper": "path | DOI | arXiv | URL"}
POST /analyses/upload      upload a PDF
GET  /analyses/{id}/events  SSE progress, one event per pipeline stage
GET  /papers/{name}/find   where a sentence sits in the PDF
POST /verify               one claim against one source
GET  /health
```

## :compass: Roadmap

- [ ] One MCP server for SecretSource with API-key access, for editors and other agents (SCRUM-165)
- [ ] Ready-made .env templates and a dependency report in /health (SCRUM-163)
- [ ] Papers and figures in cloud storage, so nothing lives on one machine (SCRUM-164)
- [ ] Public web, gateway and MCP entry points (SCRUM-166)
- [ ] Analyses that survive cloud restarts (SCRUM-167)

## :hammer_and_wrench: For maintainers

The quick start above is the team path; everything below is for people who change the stack itself.

<details>
<summary>How it works</summary>

```
frontend (React)  ──► gateway (FastAPI)
                         │
                         ├─ GROBID          reference + fulltext parsing
                         ├─ Docling         PDF → text, figure crops (a library inside the gateway)
                         ├─ vLLM            claim extraction + verdicts (any OpenAI-compatible server)
                         ├─ colbert service text retrieval  ─┐
                         └─ colpali service visual retrieval ─┴─► Qdrant (MaxSim multivectors)

paper.pdf
   └─ extract_claims_with_citations   claim + the references it cites (GROBID + LLM)
        └─ fetch_source               the cited paper's open-access PDF (arXiv / S2 / Unpaywall)
             └─ verify_claim          supports / refutes / insufficient + the quote
```

[ARCHITECTURE.md](ARCHITECTURE.md) goes a level deeper.
</details>

<details>
<summary>Repository layout</summary>

```
backend/            gateway API, pipeline, agents  (Python, FastAPI, ADK, DSPy)
  app/main.py         HTTP gateway the frontend talks to
  app/pipeline/       claims, sources, verify, figures, rag
  app/workflow.py     the pipeline as an ADK Workflow graph
  a2a_server.py       the agent tree over A2A (docker compose --profile a2a)
  cli.py              agent REPL
frontend/           React + Vite UI, served by nginx which proxies /api to the gateway
services/colbert/   ColBERTv2 text retrieval (HTTP + MCP, Qdrant)
services/colpali/   ColPali visual retrieval (HTTP + MCP, Qdrant, opt-in)
deploy/             Cloud Run deploy script, Qdrant VM startup script, vLLM-on-Cloud-Run guide
data/papers/        downloaded PDFs and figure crops (gitignored, shared volume in compose)
```
</details>

<details>
<summary>Deploying to Cloud Run</summary>

`PROJECT=<gcp-project> ./deploy/cloudrun.sh` builds every image with Cloud Build and deploys grobid, colbert, colpali (`VISION=0` skips it), vllm, gateway and web to Cloud Run, and keeps Qdrant on a small GCE VM with a persistent disk (`deploy/qdrant-startup.sh`). Pass `QDRANT_URL` / `QDRANT_API_KEY` to use a managed cluster instead. [deploy/vllm-cloud-run.md](deploy/vllm-cloud-run.md) is the step-by-step for the vLLM piece, including quota, warm-up and cost notes.
</details>

<details>
<summary>Running everything locally (NVIDIA GPU)</summary>

Leave the `*_URL` variables in `.env` empty and set `SERVICE_AUTH=none`, then:

```sh
docker compose --profile gpu up -d --build        # + vllm, qdrant, colbert
docker compose --profile vision up -d colpali     # optional: figure/page retrieval
```

`VLLM_HF_MODEL` picks the checkpoint (the 4B default fits a 16 GB card beside ColBERT); `VLLM_GPU_UTIL` is the share of the whole card (default `0.6`), raised to `0.88` with `--profile vision` (start colbert and colpali first).
</details>

<details>
<summary>Dev tools: ADK web UI and A2A</summary>

```sh
docker compose --profile dev up -d adk-web       # then open http://localhost:8001
docker compose --profile a2a up -d a2a           # the agent tree over A2A at http://localhost:8002
```
</details>

<details>
<summary>Running pieces on the host</summary>

Each part also runs standalone, against whatever `.env` says (use `localhost` rather than container names):

```sh
# gateway (from backend/)
cd backend && pip install -r requirements.txt
python -m uvicorn app.main:app --port 8080

# agent REPL (from the repo root)
python backend/cli.py

# retrieval service (from services/colbert/; needs Qdrant: docker compose up -d qdrant)
cd services/colbert && pip install -r requirements.txt
python server.py

# frontend dev server (from frontend/; proxies /api to :8080)
cd frontend && npm ci && npm run dev
```
</details>

<details>
<summary>Tests and CI</summary>

```sh
cd backend && pip install -r requirements-dev.txt && pytest
```

CI runs on every PR and on `main`: `ruff check backend services`, `python -m compileall -q backend/app backend/cli.py services`, `npm run lint` and `npm run build` (frontend).
</details>

<details>
<summary>Contributing</summary>

- Branch names start with the Jira key: `SCRUM-<n>-short-slug`, one branch per ticket, off `main`.
- Commit and PR titles use Conventional Commits with the Jira key as scope, e.g. `fix(SCRUM-142): drop the stale researcher session on refresh`.
- Open pull requests against `main`. One service = one directory = one Dockerfile; services talk over HTTP/MCP only.
- Tool functions return `{"status": "ok" | "error", ...}` instead of raising.
</details>

<details>
<summary>Optional: Supabase persistence</summary>

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (both) to store analyses in Supabase Postgres instead of local SQLite. The service role key bypasses RLS — server-only, never shipped to the browser. Never commit a real key. See [supabase/README.md](supabase/README.md).
</details>

## :handshake: Team

- [EarthWittawat](https://github.com/EarthWittawat)
- [JoyChanya](https://github.com/JoyChanya)
- [ZeaNL](https://github.com/ZeaNL)
- [Richyboy170](https://github.com/Richyboy170)

Ask @EarthWittawat for the shared .env values and the credentials file.

## :gem: Acknowledgements

[ColBERT](https://github.com/stanford-futuredata/ColBERT), [ColPali](https://github.com/illuin-tech/colpali), [GROBID](https://github.com/kermitt2/grobid), [Docling](https://github.com/docling-project/docling), [DSPy](https://github.com/stanfordnlp/dspy), [Google ADK](https://github.com/google/adk-python), [Qdrant](https://github.com/qdrant/qdrant), [vLLM](https://github.com/vllm-project/vllm), [Awesome Readme Template](https://github.com/Louis3797/awesome-readme-template)

No license has been chosen yet; all rights reserved by the project team.
