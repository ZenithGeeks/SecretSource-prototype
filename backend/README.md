# SecretSource backend

The backend reads a research paper, finds its claims, and checks each claim against the
paper it cites. It is a FastAPI gateway that the web app talks to. The same code also runs
as a chat agent (`cli.py`), an A2A server (`a2a_server.py`) and an ADK graph (`adk web`).

For how the pipeline works inside, read [ARCHITECTURE.md](../ARCHITECTURE.md). This page
covers how to run the backend, how it is organised, and the HTTP API.

## Contents

- [Run it](#run-it)
- [Settings](#settings)
- [Login](#login)
- [Folder layout](#folder-layout)
- [Profiling](#profiling)
- [Monitoring](#monitoring)
- [Tracing](#tracing)
- [Deploy](#deploy)
- [Tests](#tests)
- [HTTP API](#http-api)
  - [Analyses](#analyses)
  - [Progress events](#progress-events)
  - [Papers](#papers)
  - [Researcher](#researcher)
  - [Teacher](#teacher)
  - [Other routes](#other-routes)

## Run it

The usual way is Docker Compose from the repository root:

```bash
docker compose up -d gateway worker
curl http://localhost:8080/health
```

`gateway` only accepts a request and puts the analysis, or an Author draft check, on a Redis
queue; `worker` is the process that actually runs it (see [ARCHITECTURE.md#services](../ARCHITECTURE.md#services)).
Starting `gateway` alone brings up its dependencies (`redis`, `grobid`) but not `worker`, so
analyses and draft checks would queue and never run.

Run more than one worker to run more jobs at once:
`docker compose up -d --scale worker=3`, or start extra `python worker.py` processes outside
compose. How many analyses and draft checks run at once equals how many workers are running.
One worker runs one job at a time, so a draft check waits behind whatever that worker is already doing.

Production uses Redis Cloud's free plan, which has no TLS. Anyone who can write to that Redis
could queue a job, so the worker only runs `app.queue.run_analysis_job` and
`app.queue.run_draft_check_job` (and each job's own failure callback) and refuses anything else,
and jobs are stored as JSON, not pickle, for the same reason (`AnalysisWorker` in `app/queue.py`).

The gateway needs GROBID, ColBERT and an LLM endpoint. ColPali is optional. Their URLs come
from `.env` (see the root [README](../README.md)).

To run it on your own machine instead:

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8080
```

You also need a Redis server reachable at `REDIS_URL`, and, in another terminal from the same
`backend/` folder, `python worker.py` running the analyses and draft checks.

On the host, use `localhost` URLs in `.env`, not compose service names. The host also needs
`dspy` and `pymupdf`, which `requirements.txt` installs.

Other entry points:

| Command | What it does |
| --- | --- |
| `python cli.py` | chat with the coordinator agent in the terminal |
| `python cli.py "list the claims in data/papers/x.pdf"` | one turn, then exit |
| `python -m uvicorn a2a_server:app --port 8002` | serve the agents over A2A |
| `docker compose --profile dev up -d adk-web` | ADK's dev UI on http://localhost:8001 |

## Settings

Every setting is an environment variable, read in `app/config.py`. Empty means "use the
default".

| Variable | Default | What it does |
| --- | --- | --- |
| `VLLM_URL` | `http://localhost:8000/v1` | OpenAI-compatible LLM endpoint |
| `VLLM_MODEL` | `qwen` | model id, as listed by `{VLLM_URL}/models` |
| `VLLM_API_KEY` | `EMPTY` | key for that endpoint |
| `GROBID_URL` | `http://localhost:8070` | GROBID, reads references and body text |
| `COLBERT_URL` | `http://localhost:8893` | ColBERT text search service |
| `COLPALI_URL` | `http://localhost:8894` | ColPali figure and page search; skipped when down |
| `REDIS_URL` | `redis://localhost:6379/0` | the analysis job queue (`app/queue.py`), and how a worker's progress reaches the gateway |
| `PHOENIX_COLLECTOR_ENDPOINT` | empty (off) | Arize Phoenix to send LLM traces to, see [Tracing](#tracing) |
| `PHOENIX_PROJECT_NAME` | `secretsource` | the Phoenix project the traces go in |
| `PHOENIX_API_KEY` | empty | only for Phoenix Cloud |
| `WORKER_METRICS_PORT` | `9101` | host runs of `worker.py` only: the port its Prometheus metrics are served on (under compose it is always 9101) |
| `SERVICE_AUTH` | `none` | `google-id-token` adds an identity token for private Cloud Run services |
| `GOOGLE_APPLICATION_CREDENTIALS` | empty | credentials file used for those tokens |
| `PAPERS_DIR` | `data/papers` | downloaded PDFs and figure crops |
| `ANALYSES_DB` | `data/analyses.db` | SQLite file for analyses, when Supabase is not set |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | empty | both set: store analyses and projects in Supabase instead of SQLite, and turn on login (see Login) |
| `SESSION_DB_URL` | empty | Postgres URL where the chat agents keep their sessions (`app/sessions.py`); empty keeps them in memory, so a restart forgets them. ADK's tables go in the `adk` schema, never `public` |
| `DIRECT_URL` | empty | used when `SESSION_DB_URL` is empty; it is the name Supabase's Connect dialog gives the session pooler URL |
| `A2A_HOST`, `A2A_PORT` | `localhost`, `8002` | the address the A2A agent card tells callers to use (`a2a_server.py`), not the address the server binds |
| `S2_API_KEY` | empty | Semantic Scholar key; without it most lookups are rate limited |
| `UNPAYWALL_EMAIL` | empty | contact email that lets Unpaywall answer lookups |
| `CLAIM_LIMIT` | `20` | most claims kept per paper; `0` keeps all |
| `PARALLEL_SOURCES` | `3` | cited papers downloaded and indexed at the same time |
| `PARALLEL_CHECKS` | `3` | claims, or draft-check citations, judged at the same time inside one worker. A worker runs one job at a time, so this is that worker's limit |
| `PARALLEL_SOURCES_TOTAL` | `PARALLEL_SOURCES` | cited papers prepared at the same time inside one worker; a worker runs one analysis at a time, so this only limits that run |
| `PARALLEL_CHECKS_TOTAL` | `PARALLEL_CHECKS` | claims judged at the same time inside one worker; a worker runs one analysis at a time, so this only limits that run |
| `GATEWAY_PORT` | `8080` | port when started with `python -m app.main` |
| `PAGE_CACHE` | `/tmp/pages` | where rendered page images are cached |
| `DOCLING_FORMULAS` | empty | `1` also reads formulas as LaTeX (downloads another model) |
| `DOCLING_OCR` | `auto` | `auto` runs OCR only on a PDF without a text layer (a scan); `always` or `never` overrides that |
| `DOCLING_PARALLEL` | `1` | how many PDFs Docling converts at the same time in one process. Default 1. Each one uses about 2 GB of memory |
| `FIGURE_WAIT` | empty | empty: a cited paper's checks wait until its figures are indexed, so the judge can read their captions. A number of seconds is a fast mode: after that the check is judged on the text alone, and a later run of the paper gets the figures. `0` took 85 s instead of 264 s on 15 checks, with one verdict wrong |
| `TEACHER_GOOGLE_ENABLED` | `false` | validates and enables the optional Classroom OAuth connection |
| `TEACHER_GOOGLE_CLIENT_ID` | empty | Google OAuth web-client id |
| `TEACHER_GOOGLE_CLIENT_SECRET` | empty | Google OAuth web-client secret; server-only |
| `TEACHER_GOOGLE_REDIRECT_URI` | empty | exact allowlisted OAuth callback |
| `TEACHER_GOOGLE_ENCRYPTION_KEY` | empty | Fernet key used to encrypt stored refresh tokens; server-only |
| `TEACHER_GOOGLE_SUCCESS_REDIRECT` | `/` | local teacher page to open after a successful OAuth callback |
| `TEACHER_GOOGLE_SCOPES` | built-in minimum | comma- or whitespace-separated OAuth scope override |
| `TEACHER_GOOGLE_STATE_TTL_SECONDS` | `600` | lifetime of one-time OAuth state/PKCE records |
| `TEACHER_GOOGLE_RETRY_ATTEMPTS` | `3` | bounded attempts for transient Google API failures |
| `TEACHER_GOOGLE_RETRY_BACKOFF_SECONDS` | `0.5` | initial retry backoff |

The service role key can read and write all data. Keep it on the server and never put it in
the frontend or in git.

### Teacher Google Classroom

The Classroom integration is disabled by default, so local mock teacher development and tests
do not need Google credentials. To enable it for the backend, set `TEACHER_GOOGLE_ENABLED=true`
and all of the required OAuth/encryption variables above.

Set up Google Cloud before enabling the flag:

1. Enable the Google Classroom API and Google Drive API in the selected Cloud project.
2. Configure the OAuth consent screen and add teacher accounts as test users while the app is
   still in testing.
3. Create a Web application OAuth client and register the exact value of
   `TEACHER_GOOGLE_REDIRECT_URI`. The default local callback is
   `http://localhost:8080/api/teacher/google/callback`.
4. The built-in scopes cover Classroom courses, rosters, coursework/submissions, materials,
   announcements, topics, Drive read access, and the signed-in Google subject/email. Request
   only the scopes needed by the deployment if overriding `TEACHER_GOOGLE_SCOPES`.
5. Generate the encryption key from the backend environment with:

   ```sh
   py -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Keep the result in `TEACHER_GOOGLE_ENCRYPTION_KEY`; changing it makes existing encrypted
   refresh tokens unreadable.
6. Apply these migrations in timestamp order with the Supabase CLI or SQL editor:

   - `supabase/migrations/20260917120000_teacher_classroom.sql`
   - `supabase/migrations/20260917160000_teacher_professor_review_ids.sql`
   - `supabase/migrations/20260921120000_teacher_feedback_citation_ids.sql`
   - `supabase/migrations/20260925120000_teacher_review_composite_ids.sql`

   The tables have RLS enabled and no browser policies; only the service role is intended
   to access them.

The frontend remains on its local mock adapter unless `VITE_TEACHER_BACKEND=remote` is set at
frontend build time. `VITE_TEACHER_BACKEND=mock` is the safe default. Never expose the Google
client secret, encryption key, or Supabase service-role key through a `VITE_*` variable.

## Login

Login is on when the gateway has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and the web
image was built with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (build arguments of the
`web` service in `docker-compose.yml`).

- The web app sends the user's Supabase access token as `Authorization: Bearer <token>` on every
  request, including the event stream. A token in the URL is ignored, because access logs record
  URLs.
- The gateway asks Supabase who the token belongs to (`app/auth.py`) and remembers the answer
  for 5 minutes.
- A token Supabase rejects returns `401` with `the session has expired, sign in again`.
- With login on, a request with no token returns `401` with `sign in to use SecretSource`, on
  every route except `POST /verify` and `GET /health`. When the web app has no session to send,
  or gets a `401`, it signs out and shows the sign-in screen.
- Without Supabase settings, login is off: every request is nobody, and every analysis is
  shared, as before login existed.
- A new analysis gets `owner`, the user id of whoever started it (`null` when login is off).
  Each caller sees only analyses whose `owner` is them. Someone else's analysis returns `404`,
  not `403`, so an id does not tell anyone that it exists.
- A paper under `/papers/{name}` is served only when it is the analysed paper, or a cited paper
  a check read, in one of the caller's analyses. Anything else returns `404`.

## Folder layout

```
backend/
├── app/
│   ├── main.py          HTTP gateway: the routes below; POST /analyses queues the run for a worker
│   ├── queue.py         the Redis job queue an RQ worker pulls analyses from
│   ├── config.py        all settings
│   ├── store.py         saves analyses and source lookups (SQLite or Supabase)
│   ├── auth.py          who is asking: the Supabase user behind a request's token
│   ├── researcher.py    the researcher screens, built from one user's analyses
│   ├── sessions.py      where the chat agents keep sessions (Postgres or memory)
│   ├── backfill_titles.py  gives stored analyses the title a new run would give them
│   ├── llm.py           the LLM for ADK (adk_model) and for DSPy (dspy_lm)
│   ├── workflow.py      the same pipeline as an ADK Workflow graph
│   ├── agents/team.py   chat agents: coordinator, rag_agent, paper_agent, verify_agent
│   ├── clients/         HTTP clients for ColBERT, ColPali and GROBID, and identity tokens
│   ├── author/          the Author role: drafts, projects, sources, draft checks, search (see Author below)
│   ├── teacher/         Google Classroom: OAuth, roster sync, essay-check review (see Teacher below)
│   └── pipeline/
│       ├── claims.py    reads a paper and extracts claims with their citations
│       ├── sources.py   finds and downloads a cited paper
│       ├── verify.py    indexes a cited paper and judges a claim against it
│       ├── figures.py   figure crops, tables and formulas (Docling)
│       ├── rag.py       question answering over indexed papers
│       └── audit.py     checks a finished analysis for problems
├── adk_agents/          entry points for `adk web` (chat and analysis)
├── cli.py               terminal chat with the coordinator
├── a2a_server.py        the agents over A2A
├── worker.py            runs analyses and Author draft checks pulled off the queue (RQ worker)
└── tests/
```

If you change what a user sees, change `app/main.py` or `app/pipeline/`. The gateway is the
only part the web app uses.

## Profiling

`py-spy` is installed in the gateway image so a slow or stuck request can be diagnosed on a
live container, no restart or code change needed:

```bash
docker exec <gateway-container> py-spy dump --pid 1   # one snapshot of every thread's stack
docker exec <gateway-container> py-spy top --pid 1     # live, updating view of what's using CPU
```

`py-spy dump` on a request that's hanging shows the exact call it's blocked on. It would have
caught #224/#228 (`asyncio.to_thread` missing on a synchronous route) right away, instead of by
reading `main.py` line by line. It needs `SYS_PTRACE` (docker-compose.yml grants it to the
`gateway` service); without it py-spy fails with a permission error, not a hang.

## Monitoring

`GET /metrics` on the gateway itself, always on, counts analyses accepted
(`analyses_started_total`). The rest of the pipeline's metrics are counted in the RQ worker
processes, where the pipeline actually runs now: success rate, queue wait and duration, claim
verdicts, audit findings, and LLM token usage. They are served in Prometheus format
(`app/metrics.py`) on `WORKER_METRICS_PORT` (default `9101`). Container-level CPU/memory
(cadvisor) and Grafana are opt-in, off by default, so a small box like a shared VM doesn't run
three extra containers it never asked for:

```bash
docker compose --profile monitoring up -d
```

Starts cadvisor (`:8085`), Prometheus (`:9090`, scrapes cadvisor, the gateway's `/metrics`, and
every `worker` replica's metrics every 15s), and Grafana (`:3001`) with the Prometheus
datasource and a "System evaluation" dashboard already provisioned. There is nothing to add by
hand. See [deploy/monitoring/README.md](../deploy/monitoring/README.md) for what the dashboard
shows. This exists because ss-core, back when it had 2GB RAM and 1 vCPU, once OOM-crashed with nothing showing
memory climbing beforehand, and because until now nothing said whether analyses were actually
succeeding.

## Tracing

[Arize Phoenix](https://arize.com/docs/phoenix) shows each LLM call the backend makes: the
prompt, the answer, the tokens and the time, grouped into the DSPy module or the ADK agent run
that made it. Metrics say how many calls failed or how slow they were; a trace says which
prompt it was and what the model answered. `app/tracing.py` turns it on in the gateway (chat
agents) and in each worker (the analysis pipeline) when `PHOENIX_COLLECTOR_ENDPOINT` is set.

```bash
docker compose --profile tracing up -d phoenix
# in .env: PHOENIX_COLLECTOR_ENDPOINT=http://phoenix:6006   (host run: http://localhost:6006)
docker compose up -d gateway worker
```

Then open http://localhost:6006. Traces are kept in the `phoenix-data` volume.

- Spans are sent over HTTP to `{endpoint}/v1/traces` from a background thread, so a call never
  waits on Phoenix, and a Phoenix that is down only loses traces.
- Traces hold paper text, prompts and answers, and the Phoenix UI has no login. Keep
  `BIND_ADDRESS` private, and do not point a production gateway at a Phoenix outside our
  project without agreeing on that first.
- A worker puts each analysis in one trace, named `analysis` with its `analysis.id`, so every
  extraction and judge call of that run sits under it. Chat agent runs are one trace per turn.

## Deploy

`.github/workflows/deploy-gateway.yml` builds and deploys only the gateway to Google Cloud Run,
on every push to `main` that touches `backend/**`. It refuses to deploy when the `REDIS_URL`
repository secret is empty, because a gateway with no Redis would answer every `POST /analyses`
with `503`.

The worker that drains the queue is not part of that deploy. It runs on `ss-core`, as the
compose service `worker` in the compose project `secretsource-worker`, kept up and scaled by
hand.

The gateway and the worker must see the same `data/papers`: the gateway saves uploads there and
serves pages and figures from it, and the worker reads the PDFs and writes the figures. Both mount
the Cloud Storage bucket `gcp-edu-471706-papers`:

- Cloud Run: a `cloud-storage` volume mounted at `/app/data/papers` (`deploy/cloudrun.sh` adds it;
  `gcloud run deploy` in `deploy-gateway.yml` keeps it).
- ss-core: `gcsfuse` mounts the bucket at `PAPERS_HOST_DIR` (`/var/lib/docker/app-data/papers`)
  from `/etc/fstab`, with the service-account key in `backend/secrets/service-auth.json` and
  `allow_other,implicit_dirs`. A systemd drop-in (`RequiresMountsFor=`) starts Docker only after
  the mount, so the worker never binds the empty folder underneath.

Without the shared folder, every uploaded PDF ends with "no paper found matching the title".

The browser uploads a paper's PDF straight to that bucket, because the Vercel proxy refuses a
request body over 4.5 MB (#266). `POST /uploads` starts a Cloud Storage resumable upload for one
PDF of the size the browser states and returns its URL; the browser PUTs the file there and calls
`POST /analyses/from-upload`. This needs `PAPERS_BUCKET`, `UPLOAD_ORIGINS` (the web app's origin)
and a CORS rule on the bucket that allows PUT from that origin
(`gcloud storage buckets update gs://gcp-edu-471706-papers --cors-file=...`). Without the two
settings, uploads go through `POST /analyses/upload` as before.

## Tests

The tests need `google-adk` and `pymupdf`, so run them inside the gateway image. Mount the
whole repository, not only `backend/`: the teacher tests read `supabase/migrations/` and
`.env.cloud` from the repository root.

```bash
docker compose build gateway
docker run --rm -v "$PWD:/repo" -w /repo/backend secretsource-prototype-gateway \
  sh -c "pip install -q pytest && python -m pytest -q"
```

On Git Bash for Windows, put `MSYS_NO_PATHCONV=1` before `docker run` and use
`$(pwd -W)` instead of `$PWD`.

`tests/test_sources.py` also runs on the host with `pytest tests/test_sources.py`. Lint with
`ruff check backend` from the repository root.

`tests/test_run_analysis_job_rq.py` runs a real `AnalysisWorker` against a real Redis. It is
skipped when no Redis answers at `REDIS_URL`.

## HTTP API

All routes return JSON unless noted. CORS allows every origin. The web app reaches these
routes under `/api`, for example `/api/analyses`.

Errors use FastAPI's shape: `{"detail": "<message>"}` with a `400` or `404` status. One
exception: a partial failure in Teacher's `grade-and-return` returns `502` with `detail` as an
object, `{"message": "...", "partial": true}`, so a caller can tell that Classroom and the
local record may disagree (see that route below).

### Analyses

#### `POST /analyses`

Starts an analysis. It records a `queued` stage and puts the analysis on the Redis job queue
(`app/queue.py`) for a worker to run, then returns at once.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `paper` | string | yes | a local path, DOI, arXiv ID or URL |
| `verify` | boolean | no | check each claim against its cited paper; default `true` |

```bash
curl -X POST http://localhost:8080/analyses \
  -H 'Content-Type: application/json' \
  -d '{"paper": "2112.01488"}'
```

Response: `{"id": "3f9c2a7b1d04"}`, a 12-character id.

Errors: `503` when the queue (Redis) cannot be reached; nothing is created.

#### `POST /analyses/upload`

Starts an analysis of an uploaded PDF, the same way as `POST /analyses`. The file is saved in
`PAPERS_DIR` as `<stem>-<first 12 hex of its sha256>.pdf`, so two users' `paper.pdf` stay two
files (#168).

| Parameter | In | Required | Meaning |
| --- | --- | --- | --- |
| `file` | multipart form | yes | the PDF |
| `verify` | query | no | default `true` |

Response: `{"id": "<analysis id>"}`.

Errors, and nothing is saved or created for any of them:
- `413` when the file is over 100 MB (`uploads.MAX_UPLOAD_BYTES`).
- `422` when the file does not start with `%PDF-`.
- `503` when the queue (Redis) cannot be reached.

#### `GET /analyses`

Every analysis the caller may see, newest first, without `stages`, `references`,
`markers` and `outline`.

#### `GET /analyses/{id}`

One analysis with its results.

| Field | Meaning |
| --- | --- |
| `id` | the analysis id |
| `paper` | what the analysis was started with |
| `status` | `running`, `done` or `error` |
| `message` | the error, when `status` is `error` |
| `file` | the local PDF path, once the paper is read |
| `claims` | the claims found, see below |
| `stages` | every progress event so far, see [Progress events](#progress-events) |
| `audit` | problems the audit found in the finished analysis; usually empty |
| `owner` | the user id of whoever started it, or `null` |
| `title`, `authors`, `year` | the analysed paper's own title, authors and year; missing on older analyses |
| `figures` | the analysed paper's figures whose caption gives their number: `label`, `page`, `caption`, `image` |
| `references` | the references the paper's citation markers point to, by GROBID id (like `b12`); each is a citation (see below) |
| `markers` | where the paper cites a reference: `ref`, `text` (the marker as printed, like `[13]`), `page`, `x0`, `y0`, `x1`, `y1`, `page_width`, `page_height` in PDF points |
| `outline` | the paper's numbered sections in order: `n` (like `3.1`), `title`, `page`, `y` (the top of the heading, in PDF points); missing on older analyses |

Each claim has:

| Field | Meaning |
| --- | --- |
| `claim` | the claim in short form |
| `sentence` | the sentence from the paper it came from |
| `source` | where that sentence is in the PDF: `page`, `boxes`, `page_width`, `page_height`; `null` if not found |
| `section` | the `n` of the outline section the sentence is in, like `3.1`; missing when the sentence was not found or comes before the first numbered heading |
| `citations` | the works the sentence cites: `title`, `authors`, `year`, `doi`, `arxiv`, `url`, `ref` (GROBID's id, like `b12`) and `label` (the number the paper prints, like `13`) |
| `verdicts` | one result per cited work that was checked (same shape as `POST /verify`), plus `cited` |
| `unchecked` | one entry per cited work that could not be checked: `source`, `reason`, `message` |

`reason` is one of `unresolvable`, `no-open-access`, `not-downloadable`,
`lookup-unavailable`, `web-source`, `indexing-failed` or `failed`.

Errors: `404` when the id is unknown.

#### `DELETE /analyses/{id}`

Deletes an analysis. A queued analysis (its job not yet started) is deleted right away, and
its job is cancelled. Response: `{"deleted": "<analysis id>"}`. Errors: `404` when the id is
unknown, `409` when a worker has already started the job; delete it once it finishes.

A server restart keeps all analyses, because each change is saved. An analysis whose job is
still queued or running in a worker stays `running` after a gateway restart, and catches up
from the worker's progress. Only an analysis whose job is gone is marked `error` with the
message `interrupted by a restart`.

### Progress events

#### `GET /analyses/{id}/events`

A server-sent events stream (`text/event-stream`). It first sends every stage recorded so
far, then each new stage as it happens. It ends when the analysis is no longer running.

Each event is one `data:` line with a JSON object:

| `stage` | Extra fields | When |
| --- | --- | --- |
| `queued` | `message` | waiting for a free worker |
| `extracting` | `message` | reading the paper started |
| `extracted` | `claims`, `extracted`, `windows` | claims found; `extracted` is the count before repeats and the cap were removed |
| `planned` | `checks`, `sources` | how many checks will run, against how many cited works |
| `verifying` | `claim`, `source` | a check started |
| `verified` | `claim`, `source`, `verdict` | a check finished |
| `failed` | `claim`, `source`, `reason`, `message` | a cited work could not be checked |
| `figures` | `figures` | the analysed paper's numbered figures were read |
| `audited` | `findings` | the audit ran; `findings` is usually `0` |
| `done` | | the analysis finished |
| `error` | `message` | the analysis failed |

Every event also has `at`, the Unix time it was recorded. `claim` is the index of the claim in `claims`. Checks run in parallel, so events for
different claims arrive in any order. To show verdicts while a run is still going, read
`GET /analyses/{id}` again after `extracted`, `verified` and `failed`.

```bash
curl -N http://localhost:8080/analyses/3f9c2a7b1d04/events
```

With login on, add `-H "Authorization: Bearer <token>"`, as for every other route.

Errors: `404` when the id is unknown.

### Papers

`{name}` is a file name inside `PAPERS_DIR`, for example `2112.01488.pdf`. A name with a
path in it, or one that starts with `.`, returns `400`. A missing file returns `404`.
A paper that is not the analysed paper, or a cited paper a check read, in one of the
caller's analyses also returns `404` (see [Login](#login)).

#### `GET /papers/{name}`

The PDF itself, as `application/pdf`.

#### `GET /papers/{name}/pages/{page}.png`

One page rendered as a PNG. `page` starts at 1. Pages are rendered once and then served
from `PAGE_CACHE`.

| Query | Default | Meaning |
| --- | --- | --- |
| `dpi` | `110` | resolution; values above `300` are lowered to `300` |

Errors: `404` when the page number is out of range.

#### `GET /papers/{name}/figures/{figure}.png`

One cropped figure, the image that a verdict's `pages` entry names in its `image` field.
`figure` must look like `figure-3`; anything else returns `400`. A crop that was never made
returns `404`.

#### `GET /papers/{name}/find`

Finds a piece of text in the paper.

| Query | Required | Meaning |
| --- | --- | --- |
| `q` | yes | the text to find |
| `page` | no | only search this page |

Response: `page`, `boxes`, `page_width`, `page_height` and `coverage` (how much of the text
was matched). Boxes are in PDF points with the origin at the top left. To draw them on a
page image, divide by `page_width` and `page_height`. When nothing is found:
`{"page": null, "boxes": []}`.

### Researcher

These routes build the researcher screens from the caller's own finished analyses; they make
no LLM calls.

#### `GET /researcher/home`

| Field | Meaning |
| --- | --- |
| `alert` | one sentence for the top of the page, for example how many claims a source contradicts |
| `conflicts` | claims a cited work contradicts: `claim`, `for`, `against`, `analysis`, `claimIndex` |
| `queue` | works cited by more than one claim that are not analysed: `paper`, `note`, `identifier` |
| `library` | `papers`, `claims`, `verified`, `tally` |

`tally` counts claims as `backed`, `silent`, `contradicted` and `unchecked`.

#### `GET /researcher/projects`

The caller's projects, newest change first, then `unsorted` when some papers are in no project.
Each has: `id`, `name`, `papers`, `claims`, `clusters`, `tally`, `updated`, and `unsorted: true`
on the last one.

#### `POST /researcher/projects`

Body `{"name": "...", "description": "..."}`. Returns the new project in the same shape.
`400` when the name is empty.

#### `GET /researcher/projects/{id}/library`

One project's papers: `summary`, `clusters`, `papers` (each `id`, `title`, `cite`, `cluster`,
`claims`, `backed`, `contradicted`, `linked`). `backed` and `contradicted` are `null` for a
paper that was not verified. Use `unsorted` as the id for papers in no project. `404` for an
unknown project.

#### `POST /researcher/projects/{id}/papers`

Body `{"analysis_id": "..."}`. Puts one of the caller's analyses in the project and returns the
project. `404` when the analysis or project is not the caller's.

#### `POST /researcher/consensus`

Body `{"question": "..."}`. What the works cited in the caller's papers say about the question,
from verdicts already found: `question`, `supports`, `refutes`, `silent`, `span` (years),
`note`, `rows` (each `paper`, `cite`, `verdict`, `quote`, `claim`, `analysis`, `claimIndex`),
`unlisted` (rows past the first 20).

#### `GET /researcher/graph`

The knowledge graph: `stats`, `clusters`, `nodes`, `edges` (a paper to a claim: `relation` is
`asserts`, `backs`, `contradicts`, `silent` or `unchecked`) and `paperEdges` (paper to paper).
A paper node has `indexed`: `yes` when a public index knew the work, `no` when none did, empty
when the run does not say.

#### `GET /researcher/gaps`

What the caller's library leaves open, from verdicts already found (no LLM call). Three lists,
newest paper first:

- `notBacked`: claims that were checked but that no cited work backs or contradicts: `claim`,
  `checked` (the works read), `analysis`, `claimIndex`.
- `contradicted`: claims a cited work contradicts: `claim`, `for`, `against`, `analysis`,
  `claimIndex`. Home's `conflicts` is the first 5 of this list.
- `missing`: works cited by at least two claims that are not in the library: `paper`, `note`,
  `identifier`, `analysis` (a paper that cites it). Home's `queue` is the first 5.

### Assistant

Questions about the caller's papers, answered as short statements that the judge checks before
they count (`app/assistant.py`). A chat is an ADK session (`app/chats.py`), kept in Postgres when
`SESSION_DB_URL` is set and in memory otherwise, where a restart loses it. Cloud Run needs the
`SESSION_DB_URL` repo secret for that reason. Another user's chat is a `404`.

| Route | Does |
| --- | --- |
| `POST /assistant/chats` | body `{"context"}`, optional; starts a chat: `{id, title, updated}` |
| `GET /assistant/chats` | the caller's chats, newest first |
| `GET /assistant/chats/{id}` | the chat, its `context` (the screen of the last question) and `messages` |
| `POST /assistant/chats/{id}/messages` | body `{"question", "context"}`; the answer as server-sent events |

`context` is `{"screen", "analysis", "node"}`, all optional. With `analysis`, or a graph `node`
of an analysed paper (`a:<id>`) or of one of its claims (`c:<id>:<n>`), the answer comes from
that paper; an analysis that is not the caller's is a `404`. Otherwise it comes from the
passages of the papers the caller may open (`papers_of`).

The events, one `data:` line each:

| `type` | Fields | When |
| --- | --- | --- |
| `statement` | `index`, `text`, `source` (the PDF), `page` (of the passage, when the answer named one) | all at once, when the answer is written |
| `verdict` | `index`, `verdict` (`supports`, `refutes`, `insufficient`, `unchecked`, `error`), `quote`, `reasoning` | as each check ends, in any order |
| `done` | `statements` | last; `0` when the papers do not answer the question |
| `error` | `message` | the answer failed; nothing follows |

A statement whose verdict is not `supports` is not backed; the reply shows it marked, not
hidden. The reply is saved to the chat once `done` is sent. After an `error`, or when the reader
leaves first, the question stays in the chat with no reply. Two questions to one chat at once
are both recorded: a write that finds the chat changed reads it again and retries.

### Author

The Author role's own records: LaTeX drafts, the projects (a `.bib` plus drafts) they belong
to, saved sources, and draft checks. Everything is owner-scoped — unlike analyses, nothing here
is shared with the team; another user's row is a `404`. Code in `app/author/`.

A draft is `{id, projectId, title, version, files, pdfs, status, lastCheckedAt, lastCheckId,
runningCheckId, sinceLastCheck, created, updated, savedAt}`. `files` are `{name, kind, content}`
(`kind` is `tex` or `bib`; the project's `.bib` is included with `shared: true`). `status` is
`{checked, counts, open}` from the latest finished check, with `counts` per verdict:
`supports`, `refutes`, `insufficient`, `unavailable` (the source could not be read),
`unchecked` (no bib entry, or no check yet).

#### Drafts

| Route | Does |
| --- | --- |
| `GET /author/drafts` | the caller's drafts, newest change first |
| `POST /author/drafts` | body `{"title", "projectId", "files": [{"name", "content"}]}`; an empty `main.tex` when no files |
| `POST /author/drafts/upload?projectId=` | multipart `.tex`, `.bib` or Overleaf `.zip` (its `.tex`/`.bib` files; figures are left out) |
| `GET /author/drafts/{id}` | the draft with its files and uploaded PDFs |
| `PATCH /author/drafts/{id}` | `title`, `projectId` (empty to unfile) |
| `DELETE /author/drafts/{id}` | the draft and its finished checks |
| `PUT /author/drafts/{id}/files/{name}` | body `{"content"}`; a new name adds the file. Does not bump the version |
| `DELETE /author/drafts/{id}/files/{name}` | keeps at least one file |
| `POST /author/drafts/{id}/save` | Ctrl/Cmd+S: `version + 1`. A check on a draft with unsaved edits saves first, the same way, so every check's `version` names the content it checked |
| `GET /author/drafts/{id}/parse` | `{texFiles, citeCommands, bibEntries, warnings}`; a warning is `{type, detail, file, line}` with `type` one of `missing-key`, `duplicate-key`, `unused-entry`, `no-doi-url` |
| `POST /author/drafts/{id}/citations/{key}/pdf` | multipart PDF for a bib key no check can read; used instead of a lookup by the next check |
| `POST /author/drafts/{id}/report` | the verification report of the latest check as `application/pdf`; `409` before any check |

#### Draft checks

`POST /author/drafts/{id}/check` → `{"id"}`. It records a `queued` stage and puts the check on
the same Redis queue as a paper analysis (`app/queue.py`, `run_draft_check_job`). A worker runs
it. Draft checks wait behind paper analyses already on that queue, and a check still running
after 30 minutes is stopped (`JOB_TIMEOUT`). Every `\cite` in the draft's `.tex` files is
verified against the work its bib entry names (an uploaded PDF, else DOI, arXiv id, URL or
title), `PARALLEL_CHECKS` at a time. A worker runs one job at a time, so that is the limit for
that worker; each extra worker has its own. The same (claim, source) pair is judged once and
read from the `cache` table after that. `409` while a check of that draft is queued or running.
`503` when the queue cannot be reached; nothing is kept.

| Route | Does |
| --- | --- |
| `GET /author/drafts/{id}/checks` | history, newest first: `{id, version, status, startedAt, finishedAt, summary, sinceLastCheck, previousVersion, previousId, unchanged}`; `unchanged` is a re-check of the same text and bibliography as the check before. Every timestamp is ISO 8601 in UTC with the offset written (`+00:00`) |
| `GET /author/checks/{id}` | the same plus `citations` and `stages` |
| `GET /author/checks/{id}/events` | SSE, like `/analyses/{id}/events`: `queued`, then `planned`, `checking`/`checked` per citation, then `done` or `error` |
| `GET /author/checks/{id}/compare` | against the finished check before it: `{current, previous, rows}`; a row's `change` is `added`, `removed`, `fixed`, `new`, `changed` or `same` |
| `PATCH /author/checks/{id}/citations/{cid}` | what the author did: `resolution` `{kind: replaced|overridden, note, previousKey}` (or `null` to reopen), and for a replacement the new `key`, `sourceRef`, `verdict`, `evidence`. `409` while the check is still queued or running |
| `DELETE /author/checks/{id}` | deletes a finished check. A queued check is cancelled first. A missing job is deleted too, and so is a started job whose worker record has expired. `409` only while a worker is running it. `503` when Redis cannot be reached. A finished or failed job whose snapshot was missed is read back from the store, then deleted |

A citation is `{id, key, file, line, column, section, sentence, claim, verdict, sourceRef,
evidence: {passage, pdf, page}, explanation, reason, message, resolution}`. An overridden
resolution is carried over to the next check when the same key still cites the same sentence.
`sinceLastCheck` is `{addedCitations, fixedIssues, newIssues}`.

A draft check uses the same queue, worker and restart rule as a paper analysis. A gateway
restart leaves it `running` while its RQ job is still queued or being run, and marks it
`interrupted by a restart` only when that job is gone. Progress is the analysis SSE path:
the worker publishes each stage and `useAuthorCheck` reads `GET /author/checks/{id}/events`.

Deploy the worker with this code before the gateway that enqueues `run_draft_check_job`. An
older worker refuses the job. No new service, queue or environment variable: the worker
already has the store, `PAPERS_DIR` and `PARALLEL_CHECKS`.

#### Projects and the Library

| Route | Does |
| --- | --- |
| `GET /author/projects` | cards: `{id, name, bibName, entries, cited, needWork, tally, drafts, checkedAt}` |
| `POST /author/projects` | body `{"name", "bib", "bibName"}` |
| `POST /author/projects/import` | multipart `.bib` (the bibliography) or `.zip` (its `.bib` plus one draft from its `.tex` files) |
| `GET /author/projects/{id}` | the card plus `bib`, `draftList` and `history` (check rows per draft id) |
| `PATCH /author/projects/{id}` | `name`, `bib`, `bibName` |
| `DELETE /author/projects/{id}` | the drafts stay and become unfiled |
| `DELETE /author/projects/{id}/bib/{key}` | drops every entry with that key |
| `POST /author/projects/{id}/bib/{key}/pdf` | like the draft route, for the project's `.bib` |
| `GET /author/library` | `{projects, unsorted: {sources, pdfs, drafts}, attention, saved}`; an attention row is `{kind: replace|upload-pdf|remove, key, title, detail, draftId, projectId, checkId, citationId}` |

#### Saved sources

| Route | Does |
| --- | --- |
| `GET /author/sources?project=` | newest first, each with `inBib` and `bibName` |
| `POST /author/sources` | a work to keep (`title`, `authorsList`, `year`, `venue`, `doi`, `arxiv`, `url`, `identifier`, `projectId`, `claim`, `verdict`); a unique `key` and `bibtex` are made when missing |
| `POST /author/sources/{id}/add-to-bib` | body `{"projectId"}`; appends the entry, `409` when the key is there already |
| `POST /author/sources/{id}/pdf` | multipart PDF |
| `DELETE /author/sources/{id}` | |

#### Your data

`GET /author/export` → `{exportedAt, projects, drafts, sources, checks}`. `DELETE
/user/data?scope=author` (the Author tab's Settings → Delete all) removes these and the
caller's draft checks, and nothing of the Researcher's; `scope=researcher` is the reverse,
and `scope=all` (the default) both.

### Teacher

Routes below live under `/teacher` (`/api/teacher` from the browser) and back the teacher's
Google Classroom workspace. Every route needs a signed-in caller and returns `401` with
`sign in to use Google Classroom` otherwise, except `GET /teacher/google/callback`, which
Google's browser redirect calls directly and which authenticates by its own one-time state
instead of a bearer token.

Six routes call the Google Classroom API live and share three error cases: `503` with
`Google Classroom integration is disabled` when `TEACHER_GOOGLE_ENABLED` is off, `409` with
`Google Classroom is not connected` when the caller has no stored connection, and `502` with
`stored Google Classroom credentials are unusable` when the stored refresh token fails to
decrypt. A live Classroom API call that then fails returns `502`, with the Google-reported
message when there is one or `Google Classroom request failed` otherwise. Those routes are
called out below; every other route reads and writes local storage only, and works the same
whether or not a Google account is connected.

##### Google connection

#### `GET /teacher/google/connect`

Starts the OAuth flow and returns the URL to send the teacher to. `503` when
`TEACHER_GOOGLE_ENABLED` is off.

| Query | Required | Meaning |
| --- | --- | --- |
| `loginHint` | no | pre-fills the Google account picker |
| `switch` | no | forces the account chooser (`prompt=consent select_account`) instead of just `consent`; default `false` |

Response: `{"authorizationUrl": "<url>"}`. Errors: `502` when the authorization request could
not be built or saved.

#### `GET /teacher/google/callback`

The OAuth redirect target. Google calls this directly; it is the only route in this module
that does not require sign-in. On success it redirects (`303`) to
`TEACHER_GOOGLE_SUCCESS_REDIRECT`, so it does not return JSON.

| Query | Required | Meaning |
| --- | --- | --- |
| `state` | yes | the opaque state issued by `/google/connect` |
| `code` | no | the authorization code |
| `error` | no | set by Google when the teacher declined or the flow failed |

Errors: `503` when `TEACHER_GOOGLE_ENABLED` is off, `400` when `error` is set
(`Google OAuth was not completed: <error>`), `400` when `code` is missing, and `400` when the
exchange succeeds but is rejected: the state is invalid, expired, or already used; the Google
account returned differs from the one already connected for this teacher; or Google returned no
refresh token for a first-time connection (it omits one on a repeat consent). `502` on any
other failure completing the exchange.

#### `GET /teacher/google/status`

| Field | Meaning |
| --- | --- |
| `connected` | whether a Google account is stored for this teacher |
| `email` | the connected Google account; omitted when not connected |
| `scopes` | the OAuth scopes actually granted; omitted when not connected |
| `sync.status`, `sync.lastSyncedAt`, `sync.error` | the most recent class import/refresh result; all `null` when never synced or not connected |

#### `DELETE /teacher/google`

Deletes the stored connection. Response: `{"connected": false, "connectionDeleted": <bool>,
"importedDataDeleted": false}`. `connectionDeleted` is `false` when there was nothing to
delete. `importedDataDeleted` is hardcoded `false`: previously imported courses, coursework,
and submissions are not deleted by disconnecting.

##### Home

#### `GET /teacher/home`

A dashboard summary built from the caller's first imported class and that class's first
assignment (whatever order the repository returns them in; there is no "current class"
selector yet).

| Field | Meaning |
| --- | --- |
| `user` | the caller's id |
| `course`, `courseId` | the first class, or `""` when none is imported |
| `checkedEssays` | submissions with an analysis started |
| `totalEssays` | total submissions for that class |
| `citationsNeedingAttention` | currently always equal to `checkedEssays` |
| `assignment`, `assignmentId` | the first assignment in that class, or `""` |
| `submissions` | that assignment's submissions, each the same shape as a workspace submission (see below) plus `initial`, `summary` (`"Ready for review"` or `"Not checked yet"`), `standing` (always `"unchecked"`) |
| `library` | `paperCount` (equals `checkedEssays`), `visibility` (always `"Private to this teacher"`), `papers` (always `[]`) |
| `mostMisusedSource` | always `null` |

No error cases beyond the shared `401`; an unconnected or empty account just returns empty
fields.

##### Classes and rosters

`GET /classes`, `GET .../workspace` and `GET .../assignments/{assignment_id}` read local
storage only. `GET .../importable`, `GET .../importable/{course_id}/preview`,
`POST .../import` and `POST .../refresh` call Google Classroom live and can return the shared
`503`/`409`/`502` errors described above.

#### `GET /teacher/classes`

The caller's already-imported classes. Each entry: `id`, `name`, `section`, `subject`,
`status` (always `"active"`), `teacherName`, `studentCount`, `assignmentCount`, `topicCount`,
`announcementCount`, `linkedFileCount`, `lastSyncedAt`.

#### `GET /teacher/classes/importable`

The teacher's Google Classroom courses that are not yet imported. Same per-course shape as
`GET /classes` above, but built straight from the raw Classroom course listing without a
roster or coursework fetch, so only `id`, `name`, `section`, `subject`, and `status` are
meaningful: `teacherName` is always `""`, `studentCount` is `0`, and `assignmentCount`,
`topicCount`, `announcementCount`, `linkedFileCount` are `null` (not fetched). Use the preview
below for real counts.

#### `GET /teacher/classes/importable/{course_id}/preview`

What importing one course would bring in, without importing it.

| Field | Meaning |
| --- | --- |
| `course` | the course, same shape as `GET /classes/importable`, but with a real roster fetch behind it so `studentCount` and `teacherName` are correct; `assignmentCount`, `topicCount`, `announcementCount` and `linkedFileCount` are still always `0` here too — use `resources` below for those counts |
| `resources` | four entries, each `key`, `label`, `count`, `detail`, covering `course`, `classwork`, `people`, and `drive` (materials, announcements and topics combined) |

Errors: `404` when `course_id` is not one of the teacher's Google Classroom courses.

#### `POST /teacher/classes/{course_id}/import`

Imports a course: its roster, coursework, materials, announcements, topics, and every
student's submissions, into local storage.

Response: `{"course": <same shape as GET /classes>, "sync": {"course_id": "...",
"submission_count": <int>}}`. Errors: `404` when `course_id` is not one of the teacher's
Google Classroom courses.

#### `GET /teacher/classes/{course_id}/workspace`

The imported class's workspace.

| Field | Meaning |
| --- | --- |
| `course` | same shape as `GET /classes` |
| `description` | the course description |
| `assignments` | each: `id`, `courseId`, `title`, `dueAt`, `enrolledCount`, `submittedCount`, `missingCount`, `returnedCount`, `pendingReviewCount`, `status` (`not-started`, `pending`, or `returned`), `materials` |
| `submissions` | each: `id`, `assignmentId`, `studentId`, `studentName`, `fileName`, `state` (`missing`, `submitted`, or `returned`), `submittedAt`, `attachments` |
| `people` | teachers and students: `id`, `name`, `initials`, `role`, `isCourseOwner` |
| `latestAnnouncement` | `title`, `postedBy` (always empty), `postedAt`, `body`; `null` when there is none |
| `materials` | standalone classwork materials: `id`, `title`, `kind`, `accessible` |
| `topics` | `id`, `name`, `assignmentCount` |

Errors: `404` when the course was never imported for this teacher.

#### `POST /teacher/classes/{course_id}/refresh`

Re-imports a course (identical work to `POST .../import`) and returns the refreshed workspace.

Response: `{"workspace": <same shape as GET .../workspace>, "sync": {"course_id": "...",
"submission_count": <int>}}`. Errors: `404` when `course_id` is not one of the teacher's
Google Classroom courses.

#### `GET /teacher/classes/{course_id}/assignments/{assignment_id}`

Response: `{"assignment": <same shape as a workspace assignments entry>, "submissions":
[<same shape as workspace submissions entries>]}`. Errors: `404` when the course was never
imported, or the assignment id is not coursework in that course.

##### Essay checks and reviews

Each route below addresses a submission by `student_id` and returns `404` with
`submission not found` when that student has no submission for the assignment. Only
`POST .../analyze` calls Google live (and can return the shared `503`/`409`/`502` errors); the
rest work entirely from local storage, including from a previously imported analysis after the
Google account has since been disconnected.

#### `POST /teacher/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/analyze`

Downloads the student's Drive attachment and starts an analysis on it through the same
pipeline as `POST /analyses`.

| Query | Required | Meaning |
| --- | --- | --- |
| `verify` | no | check each claim against its cited paper; default `true` |

Response: `{"id": "<analysis id>", "status": "running", "submission_id": "<id>"}`. Errors:
`409` when the submission has no supported Drive attachment (a PDF or a Google Doc), `404`
when the submission is not found, `503` when the analysis queue (Redis) cannot be reached.

#### `GET /teacher/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/essay-check`

The essay-check screen for one submission. The response is nested; the pieces are:

- `assignment`: `assignmentId`, `courseId`, `course`, `name`, `courseWorkId` (the last two
  currently just repeat the ids, not a fetched title).
- `student`: `id`, `name`, `fileName`.
- `citationSummary`: `total`, `contradicted`, `silent`, `backed` — counts over `reviews`.
- `reviews`: one card per citation in the underlying analysis, each `id`, `standing`
  (`supports`, `refutes`, `insufficient`, or `unchecked`), `citation`, `claim`, `sourceQuote`,
  `sourceLocation`, `explanation`, `supportingUrls` (list of `id`, `url`, `title`, `excerpt`,
  `location`), `paperUrl`, and `professorReview` (`outcome`, `note`; `outcome` is
  `not-reviewed` until a teacher saves one — see the `PATCH` route below for the other values).
- `feedback`: `body`, `preview`, `citedPages`, `citationIds`.
- `navigation`: currently always `{}`.
- `analysis`: `id`, `status` (`missing` when no analysis has been started yet, otherwise the
  analysis's own `running`/`done`/`error`), `error` (present only when `status` is `error`).

Errors: `404` when the submission is not found.

#### `PATCH /teacher/classes/{course_id}/assignments/{assignment_id}/essay-check/reviews/{review_id}`

Saves the teacher's own verdict on one citation card. `review_id` is a `reviews[].id` from the
essay-check response above, and may itself contain `/`, hence the path-matching route.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `studentId` | string | yes | which student's essay check this belongs to |
| `outcome` | string | yes | one of `not-reviewed`, `supports`, `contradicts`, `inconclusive` |
| `note` | string | no | free text; default `""` |

Returns the updated essay-check object (same shape as `GET .../essay-check`). Errors: `404`
when the submission is not found, `404` when `review_id` is not one of that submission's
review card ids, `422` when `outcome` is not one of the four listed values.

#### `PUT /teacher/classes/{course_id}/assignments/{assignment_id}/essay-check/feedback`

Saves a draft of the feedback to send back to the student.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `studentId` | string | yes | which student's essay check this belongs to |
| `body` | string | no | the feedback text; default `""` |
| `citationIds` | list of string | no | `reviews[].id`s the feedback cites; default `[]` |

Returns the updated essay-check object. Errors: `404` when the submission is not found, `422`
when `citationIds` contains an id that is not one of that submission's review card ids.

#### `POST /teacher/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/essay-check/feedback/send`

Marks the saved feedback sent. Classroom has no per-student private-comment API, so this only
updates local status and never posts anything to Classroom itself.

The body is the same shape as `PUT .../feedback` above, and is optional: when given, it is
saved first (same `404`/`422` rules as `PUT .../feedback`); when omitted, whatever `PUT
.../feedback` last saved is sent as-is.

Response: `{"assignmentId": "...", "studentId": "...", "status": "sent", "sentAt": "<ISO
timestamp>"}`. Errors: `404` when the submission is not found, `404` when there is no saved
feedback to send (nothing was ever saved with `PUT .../feedback`).

##### Grading

#### `POST /teacher/classes/{course_id}/assignments/{assignment_id}/students/{student_id}/grade-and-return`

Sets the assigned grade in Google Classroom and returns the submission to the student. Calls
Google live and can return the shared `503`/`409`/`502` errors described above.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `grade` | number | yes | the grade to assign; must be `>= 0` |

Response: `{"submissionId": "...", "studentId": "...", "grade": <number>, "status":
"returned"}`. Errors: `404` when the course, assignment, or submission is not found or not the
caller's.

Setting the grade in Classroom can fail with the shared `502` Google-error shape. A failure
after that point returns `502` with a `detail` object instead of a string, so the caller can
tell Classroom's state and local state may now disagree: `{"message": "grade saved but return
failed", "partial": true}` when returning the submission fails, or `{"message": "grade
returned but local submission update failed", "partial": true}` when Classroom accepted the
return but the local submission record could not be updated to match.

### Other routes

#### `POST /verify`

Checks one claim against one source, outside any analysis.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `claim` | string | yes | the claim to check |
| `source` | string | yes | the cited paper: a local path, DOI, arXiv ID or URL |

A successful check returns:

| Field | Meaning |
| --- | --- |
| `status` | `ok` |
| `verdict` | `supports`, `refutes` or `insufficient` |
| `quote` | the sentence from the cited paper the verdict rests on |
| `reasoning` | one sentence from the model |
| `evidence` | the passages it read: `text`, `page`, `start`, `end`, `score` |
| `pages` | figures or pages ColPali matched: `page`, `score`, `kind`, `label`, `caption`, `image` |
| `page_model` | the ColPali model that matched them; empty when ColPali is down |
| `indexed_in` | which public index found the cited paper, and the ids it gave |
| `claim`, `source` | what was checked |

A failed check returns `status: "error"` with `message` and `reason`.

#### `GET /health`

No login needed. `ok` means the gateway is up. `analyses` is how many rows this process is
holding (running jobs, the newest loaded at startup, and owners read since), not how many the
store has. The rest comes from `app/dependencies.py`, from a check at most 30 s old:

```json
{
  "ok": true,
  "analyses": 12,
  "degraded": false,
  "service_auth": "none",
  "checked_at": 1789360000.0,
  "dependencies": [
    {"name": "llm", "url": "https://gateway.9arm.co/v1", "auth": "api key", "required": true, "ok": true, "detail": "HTTP 200"},
    {"name": "grobid", "url": "http://grobid:8070", "auth": "none", "required": true, "ok": true, "detail": "HTTP 200"},
    {"name": "colbert", "url": "http://colbert:8893", "auth": "none", "required": true, "ok": false, "detail": "ConnectionError: ..."},
    {"name": "colpali", "url": "http://colpali:8894", "auth": "none", "required": false, "ok": true, "detail": "HTTP 200"},
    {"name": "supabase", "url": "", "auth": "none", "required": false, "ok": null, "detail": "not set: analyses are stored in SQLite at ..."},
    {"name": "redis", "url": "redis://redis:6379/0", "auth": "url password", "required": true, "ok": true, "detail": "PONG"},
    {"name": "worker", "url": "redis://redis:6379/0", "auth": "url password", "required": true, "ok": true, "detail": "1 worker, 0 waiting"}
  ]
}
```

`redis` pings Redis directly; `worker` counts RQ workers registered on the `analyses` queue and jobs
waiting on it, so a down Redis or a dead worker shows here instead of only surfacing as a stuck or
failed analysis.

| Field | Meaning |
| --- | --- |
| `degraded` | a required dependency did not answer; analyses will fail until it does |
| `url` | what the gateway calls, without any password or query string |
| `auth` | `google-id-token` for a `*.run.app` URL with `SERVICE_AUTH=google-id-token`, `api key`, `service role key`, or `none` |
| `required` | ColPali is not: checks go on with text passages when it is down. Supabase is only when it is set |
| `ok` | answered with 2xx; for the LLM, also lists `VLLM_MODEL` in `/models`. `null` means not set |
| `detail` | the HTTP status, or the error |

The gateway logs the same list once at startup, and `python -m app.dependencies` prints it.
