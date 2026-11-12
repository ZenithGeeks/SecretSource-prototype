<div align="center">
  <img src="docs/images/logo-lockup.png" alt="SecretSource" width="360" />
  <br /><br />
  <p>Checks if the papers a research paper cites really say what it claims. Every result shows the quote and where it is in the PDF.</p>
  <h4><a href="#quick-start">Quick start</a> · <a href="#troubleshooting">Troubleshooting</a> · <a href="ARCHITECTURE.md">Architecture</a> · <a href="https://github.com/ZenithGeeks/SecretSource-prototype/issues">Report a bug</a></h4>
</div>
<br />

## Contents

- [What it is](#what-it-is)
- [Screenshots](#screenshots)
- [Quick start](#quick-start)
- [Run the retrieval services on your own GPU](#run-the-retrieval-services-on-your-own-gpu)
- [Everyday use](#everyday-use)
- [Troubleshooting](#troubleshooting)
- [Speed](#speed)
- [API](#api)
- [Roadmap](#roadmap)
- [For maintainers](#for-maintainers)
- [Team](#team)
- [Acknowledgements](#acknowledgements)

## What it is

SecretSource reads a research paper, finds its claims, and checks each claim against the
paper it cites. For each claim you get a verdict (`supports`, `refutes` or `insufficient`),
the quote from the cited paper, and the page where the quote is.

Google ADK runs the agents and the order of the steps. DSPy is used for each LLM call that
must return exact data, like the claims and the verdicts. See
[How DSPy is used](ARCHITECTURE.md#how-dspy-is-used).

On your machine, Docker runs `web` (the UI at http://localhost:5173), `gateway` (the API at
http://localhost:8080), `redis` (the analysis queue), and `worker` (runs the analyses). The
heavy retrieval services are shared and already run in the cloud:

| Service | What it does | Where |
| --- | --- | --- |
| ColBERT (`colbert`) | finds text passages in the cited papers | shared cloud service |
| ColPali (`colpali`) | finds matching figures and pages; checks use it only with `VISUAL_EVIDENCE=true` | shared cloud service (GPU; first request after idle takes about a minute) |
| GROBID (`grobid`) | reads a PDF's reference list and full text | shared cloud service |
| LLM | extracts claims and writes verdicts (any OpenAI-compatible endpoint) | shared endpoint |

ColBERT and ColPali store one vector file per paper in a GCS bucket, not in a database. A
claim check searches only one cited paper, about 150 passages, and plain torch scores those in
milliseconds.

The cloud services only accept requests with a Google identity token. The gateway adds the
token for you after you do steps 3 and 4 below.

## Screenshots

Analysis results. For each claim: the verdict, the quote from the cited paper, and pages
that ColPali found:

![Analysis results with verdicts and quotes](docs/images/analysis-results.jpg)

The quote highlighted in the cited PDF:

![PDF viewer with the quote highlighted](docs/images/pdf-viewer.jpg)

<details>
<summary>More screens</summary>

Choosing a role:

![Onboarding: pick researcher, author or teacher](docs/images/onboarding.jpg)

Researcher home:

![Researcher home with quick actions, conflicts and reading queue](docs/images/researcher-home.jpg)

Author draft check (sample data):

![Author draft check with marked citations and a suggested fix](docs/images/writer-draft-check.jpg)
</details>

## Quick start

1. **Prerequisites:** Git and Docker Desktop (Docker with Compose). No GPU, no Python, no Node.

2. **Clone and copy the env file:**

   ```sh
   git clone https://github.com/ZenithGeeks/SecretSource-prototype.git
   cd SecretSource-prototype
   cp .env.cloud .env
   ```

   `.env.cloud` already has the shared URLs for the LLM, ColBERT, ColPali and Supabase, and
   `SERVICE_AUTH=google-id-token`. `.env.example` explains every setting.

3. **Fill in the empty secrets in `.env`**:

   | Variable | Value | Where it comes from |
   | --- | --- | --- |
   | `VLLM_API_KEY` | key for the shared LLM endpoint | `<from the team lead>` |
   | `S2_API_KEY` | your own free Semantic Scholar key | https://www.semanticscholar.org/product/api (strongly recommended: without it most cited papers never resolve) |
   | `SUPABASE_SERVICE_ROLE_KEY` | server key for the shared Supabase project | `<from the team lead>` |
   | `VITE_SUPABASE_ANON_KEY` | optional, turns on sign-in | `<from the team lead>` |

   Optional settings:
   - `UNPAYWALL_EMAIL`: your email. It helps find free PDFs.
   - `CLAIM_LIMIT`: the most claims to check per paper. Default `20`. `0` means all.
   - `PARALLEL_SOURCES`: how many cited papers are prepared at the same time. Default `3`.
   - `PARALLEL_CHECKS`: how many claims are judged at the same time. Default `3`.
   - `PARALLEL_SOURCES_TOTAL`, `PARALLEL_CHECKS_TOTAL`: the same two limits for a whole worker
     process. Default: the per-run values. Each worker has its own limit, so more workers put
     more load on the retrieval services and the LLM.

   Google Classroom for teachers is optional. Keep `TEACHER_GOOGLE_ENABLED=false` and
   `VITE_TEACHER_BACKEND=mock` to use the local teacher pages with sample data. To connect
   Google Classroom, see [Teacher Google Classroom setup](backend/README.md#teacher-google-classroom).

4. **Add the credentials file:** save the file from the team lead as
   `backend/secrets/service-auth.json`. Git ignores this folder, and Docker never copies it
   into an image.

5. **Start the stack:**

   ```sh
   docker compose up -d --build
   ```

   This also starts `redis` (the queue), `worker` (runs the analyses), and a local `grobid`
   container. `grobid` is not used when `GROBID_URL` points to the cloud one.

6. **Check the setup:**

   ```sh
   curl http://localhost:8080/health
   ```

   It lists each service the gateway uses (the LLM, GROBID, ColBERT, ColPali, Supabase, Redis,
   and the worker) with its URL or detail and whether it answered. `"degraded": false` means
   every required one answered. The gateway log shows the same list when it starts:
   `docker compose logs gateway`.

7. **Open the app:** go to http://localhost:5173 and paste an arXiv ID (for example `2112.01488`) or upload a PDF.

## Run the retrieval services on your own GPU

Use this when the cloud services are not available. ColBERT and ColPali run on your own
NVIDIA GPU. A 16 GB card is enough. The LLM is still the shared endpoint.

1. Start from `cp .env.local-gpu .env`. It leaves every URL empty, so compose uses its own
   containers, and sets `SERVICE_AUTH=none`. To keep the shared LLM endpoint instead of a local
   vLLM, copy the `VLLM_*` values from `.env.cloud`.

2. Start the services:

   ```sh
   docker compose up -d --build grobid colbert colpali redis gateway worker web
   ```

3. The models are ColBERTv2 (`colbert-ir/colbertv2.0`, about 0.5 GB) and ColPali (`COLPALI_MODEL=vidore/colqwen2-v1.0`, about 4 GB). In a test run, both together used about 7 to 9 GB of GPU memory.

4. The first start downloads the models, so it takes several minutes. Check that the services are up:

   ```sh
   curl http://localhost:8893/health
   curl http://localhost:8894/health
   ```

No LLM endpoint? `docker compose --profile gpu up -d --build` also runs vLLM on your GPU.

The worker reads each paper's figures and tables with Docling, on the CPU by default. This is
the slowest step of an analysis (see [Speed](#speed)). To run Docling on the
same GPU, rebuild the worker and the gateway with the GPU override:

```sh
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build worker gateway
```

To keep using it, set `COMPOSE_FILE=docker-compose.yml:docker-compose.gpu.yml` in `.env` (use `;`
instead of `:` on Windows).

## Everyday use

- Stop the stack: `docker compose down`
- After `git pull`, rebuild: `docker compose up -d --build`
- Run more analyses at once: `docker compose up -d --scale worker=3` (one worker runs one
  analysis at a time)
- After you edit `.env`, run `docker compose up -d`. Containers read `.env` only when they start
- Logs: `docker compose logs -f gateway`
- A slow or stuck request: `docker exec <gateway-container> py-spy dump --pid 1` (see
  [Profiling](backend/README.md#profiling))
- Container CPU/memory dashboards, off by default: `docker compose --profile monitoring up -d`
  (see [Monitoring](backend/README.md#monitoring))

In the web app, paste an arXiv ID, a DOI or a URL, or upload a PDF. You can watch each step
while it runs. Past analyses are in History.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/health` says `"degraded": true` | find the dependency with `"ok": false`. Its `url` is what the gateway calls and `detail` says what went wrong. Fix that URL or key in `.env`, then `docker compose up -d` |
| 401 or 403 from colbert, colpali or grobid in the gateway logs | check `SERVICE_AUTH=google-id-token`, `GOOGLE_APPLICATION_CREDENTIALS=secrets/service-auth.json`, and that `backend/secrets/service-auth.json` exists; then `docker compose up -d` |
| Gateway exits with "SERVICE_AUTH must be 'none' or 'google-id-token'" | typo in `SERVICE_AUTH` |
| 503 from the cloud services | the services sleep when nobody uses them. The first request wakes them (ColBERT: a few seconds, ColPali: about a minute). If it does not stop, tell the team lead |
| "The LM returned an empty or null response." | check `VLLM_URL` ends in `/v1` and `VLLM_MODEL` is an id the endpoint lists |
| Most citations show as unresolved / Semantic Scholar 429 | set `S2_API_KEY` |
| No figure or page hints | checks leave ColPali out unless `VISUAL_EVIDENCE=true`. With it on, ColPali may still be starting; the check works without figure hints |
| Port 5173 or 8080 already in use | another copy is running. Run `docker compose down` in that folder first |
| An analysis stays `queued` and never moves | no worker is running. Check the `worker` entry in `/health`, then `docker compose up -d worker` |
| 503 when starting an analysis | Redis is unreachable. Check the `redis` entry in `/health` and that `REDIS_URL` in `.env` is correct |

## Speed

Everything runs on our own machines: a mini PC serves the web app, the gateway and Redis, and a
PC with an RTX 5070 Ti runs GROBID, ColBERT, ColPali and the worker. The LLM is a shared endpoint.
No step bills per analysis.

One analysis of arXiv 2305.06500 on this stack takes about 84 s: claims are extracted at 37 s and
the 11 checks run from 48 s to 84 s. CONSTRAINTS.md warns when it goes over 120 s. A paper the
store has seen before reuses cached answers, so time a paper it has not seen.

Checks leave ColPali out unless `VISUAL_EVIDENCE=true`. On the 192 claim/source pairs of finished
production analyses, three runs each:

| Verdicts that differ | All 191 pairs | 85 pairs that had a figure caption |
| --- | --- | --- |
| Two runs with ColPali off | 12 to 14 | 7 to 9 |
| Two runs with ColPali on | 8 to 16 | 5 to 8 |
| One run off, one run on | 13 to 20 | 4 to 11 |

ColBERT already indexes each caption with the rest of its page.

Tried and dropped: running more Docling at once. On 10 cited PDFs with 4 CPUs,
`DOCLING_PARALLEL=1` took 377 s, `2` took 490 s and `3` took 421 s. One Docling run already uses
every CPU, so more runs only compete for them.

## API

Interactive docs: http://localhost:8080/docs. The short version:

```
POST /analyses             start an analysis {"paper": "path | DOI | arXiv | URL"}
POST /analyses/upload      upload a PDF
GET  /analyses/{id}/events  SSE progress, one event per pipeline stage
GET  /papers/{name}/find   where a sentence sits in the PDF
POST /verify               one claim against one source
GET  /health
```

## Roadmap

- [ ] One MCP server for SecretSource with API-key access, for editors and other agents (SCRUM-165)
- [x] Ready-made .env templates and a dependency report in /health (SCRUM-163)
- [ ] Papers and figures in cloud storage, so nothing lives on one machine (SCRUM-164)
- [ ] Public web, gateway and MCP entry points (SCRUM-166)
- [x] Analyses that survive cloud restarts: a Redis queue and a separate worker (SCRUM-167)

## For maintainers

The quick start is enough to use the app. The sections below are for people who change the
system.

<details>
<summary>How it works</summary>

```
frontend (React)  ──► gateway (FastAPI)  ──► Redis queue  ──► worker

worker (one analysis at a time)
   ├─ GROBID          reference + fulltext parsing
   ├─ Docling         PDF → text, figure crops (a library inside the worker)
   ├─ vLLM            claim extraction + verdicts (any OpenAI-compatible server)
   ├─ colbert service text retrieval  ─┐
   └─ colpali service visual retrieval ─┴─► GCS bucket (safetensors, MaxSim in torch)

paper.pdf
   └─ extract_claims_with_citations   claim + the references it cites (GROBID + LLM)
        └─ prepare_source             download the cited PDF, index it in ColBERT and ColPali
             └─ check_prepared        supports / refutes / insufficient + the quote
```

[ARCHITECTURE.md](ARCHITECTURE.md) goes a level deeper.
</details>

<details>
<summary>Repository layout</summary>

```
backend/            gateway API, pipeline, agents  (Python, FastAPI, ADK, DSPy)
  app/main.py         HTTP gateway the frontend talks to
  app/pipeline/       claims, sources, verify, figures, rag
  app/teacher/        Google Classroom: OAuth, roster sync, essay-check review
  a2a_server.py       the agent tree over A2A (docker compose --profile a2a)
  cli.py              agent REPL
  worker.py           runs analyses and Author draft checks pulled off the Redis queue (RQ worker)
frontend/           React + Vite UI, served by nginx which proxies /api to the gateway
services/colbert/   ColBERTv2 text retrieval (HTTP + MCP, per-paper vector files)
services/colpali/   ColPali visual retrieval (HTTP + MCP, per-paper vector files, opt-in)
deploy/             Cloud Run deploy script, vLLM-on-Cloud-Run guide
data/papers/        downloaded PDFs and figure crops (gitignored, shared volume in compose)
```
</details>

<details>
<summary>Deploying to Cloud Run</summary>

Run `PROJECT=<gcp-project> ./deploy/cloudrun.sh`. It builds every image with Cloud Build and
deploys grobid, colbert, colpali, vllm, gateway and web to Cloud Run. Set `VISION=0` to skip
colpali. ColBERT and ColPali store their vectors in a GCS bucket (`gs://<project>-vectors` by
default, override with `VECTOR_BUCKET`) that the script creates and grants the Cloud Run
service account access to. For the vLLM part (quota, start-up time, cost), read
[deploy/vllm-cloud-run.md](deploy/vllm-cloud-run.md).

We do not run on Cloud Run. Production is the compose stack on our own machines, described in
[Speed](#speed); the web app is reached through a Cloudflare tunnel.

See "Deploying this" in [ARCHITECTURE.md](ARCHITECTURE.md#services).
</details>

<details>
<summary>Monitoring</summary>

Two Google Cloud Monitoring uptime alerts watch `/health` in production: one for the health
check failing, one for too many 5xx responses. Grafana shows more detail: analysis throughput,
queue wait, and Cloud Run request and latency graphs. Grafana is not public. Reach it over an
SSH tunnel to the box it runs on. See [deploy/monitoring/README.md](deploy/monitoring/README.md).
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

You can run each part without Docker. The gateway, agent REPL, and retrieval service read the
settings in the repo-root `.env`. Use `localhost`, not container names.

The frontend dev server is the exception: Vite only reads `.env` files inside `frontend/`, never
the repo root. For sign-in to work under `npm run dev`, copy `frontend/.env.example` to
`frontend/.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the same values as
the root `.env`). Without them the app runs open, with no login screen and no Sign out.

```sh
# gateway (from backend/)
cd backend && pip install -r requirements.txt
python -m uvicorn app.main:app --port 8080

# agent REPL (from the repo root)
python backend/cli.py

# retrieval service (from services/colbert/; writes vector files under ./vectors by default)
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
- Commit and PR titles use Conventional Commits with the Jira key as scope. For example `fix(SCRUM-142): drop the stale researcher session on refresh`.
- Open pull requests against `main`.
- One service is one folder with one Dockerfile. Services talk to each other only over HTTP or MCP.
- Tool functions return `{"status": "ok" | "error", ...}`. They do not raise errors.
</details>

<details>
<summary>Optional: Supabase persistence</summary>

Set both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to save analyses in Supabase Postgres
instead of local SQLite. The service role key can read and write all data, so keep it on the
server. Never put it in the frontend or in git. See [supabase/README.md](supabase/README.md).
</details>

## Team

- [EarthWittawat](https://github.com/EarthWittawat)
- [JoyChanya](https://github.com/JoyChanya)
- [ZeaNL](https://github.com/ZeaNL)
- [Richyboy170](https://github.com/Richyboy170)

Ask @EarthWittawat for the shared .env values and the credentials file.

## Acknowledgements

[ColBERT](https://github.com/stanford-futuredata/ColBERT), [ColPali](https://github.com/illuin-tech/colpali), [GROBID](https://github.com/kermitt2/grobid), [Docling](https://github.com/docling-project/docling), [DSPy](https://github.com/stanfordnlp/dspy), [Google ADK](https://github.com/google/adk-python), [safetensors](https://github.com/huggingface/safetensors), [vLLM](https://github.com/vllm-project/vllm), [Awesome Readme Template](https://github.com/Louis3797/awesome-readme-template)

No license has been chosen yet; all rights reserved by the project team.
